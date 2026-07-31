import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DeterministicFakeProvider,
  type FakeProviderScript,
  type ProviderRequest,
} from "@stn/providers";
import type { ProviderEvent } from "@stn/contracts";

import { createServer, type ServerApplication } from "../app.js";

const applications: ServerApplication[] = [];

async function application(): Promise<ServerApplication> {
  const dataDirectory = await mkdtemp(
    path.join(tmpdir(), "stn-provider-tools-"),
  );
  const created = await createServer({
    dataDirectory,
    databasePath: ":memory:",
    seedDevelopmentData: false,
  });
  applications.push(created);
  return created;
}

class SequencedFakeProvider extends DeterministicFakeProvider {
  readonly requests: ProviderRequest[] = [];

  constructor(private readonly scripts: readonly FakeProviderScript[]) {
    super();
  }

  override async *generate(request: ProviderRequest, signal?: AbortSignal) {
    const script = this.scripts[this.requests.length];
    this.requests.push(request);
    if (script === undefined) {
      throw new Error("The fake provider received an unexpected extra turn.");
    }
    yield* new DeterministicFakeProvider(script).generate(request, signal);
  }
}

class PartialFailureProvider extends DeterministicFakeProvider {
  override async *generate(
    request: ProviderRequest,
  ): AsyncIterable<ProviderEvent> {
    yield {
      type: "start",
      requestId: request.requestId,
      sequence: 0,
      model: "partial-failure",
      capabilities: this.capabilities(),
    };
    yield {
      type: "text-delta",
      requestId: request.requestId,
      sequence: 1,
      delta: "Content received before the proxy disconnected.",
    };
    yield {
      type: "error",
      requestId: request.requestId,
      sequence: 2,
      code: "PROVIDER_REQUEST_FAILED",
      message: "Proxy disconnected.",
      retryable: true,
    };
  }
}

type StreamEvent = { type: string; [key: string]: unknown };

function streamEvents(body: string): StreamEvent[] {
  return body
    .split("\n\n")
    .map((frame) =>
      frame
        .split("\n")
        .find((line) => line.startsWith("data: "))
        ?.slice("data: ".length),
    )
    .filter((data): data is string => data !== undefined)
    .map((data) => JSON.parse(data) as StreamEvent);
}

function workspaceFixture(server: ServerApplication) {
  const card = server.context.store.createCard({
    id: "card-provider-tools",
    kind: "character",
    name: "Provider tools card",
  }).card;
  const conversation = server.context.store.createConversation({
    id: "conversation-provider-tools",
    title: "Ordinary chat with optional tools",
    cardId: card.id,
  });
  server.context.store.addUserMessage({
    id: "message-provider-tools-user",
    conversationId: conversation.id,
    content: "Check the available lore, then answer normally.",
  });
  const worldbook = server.context.store.createWorldbook({
    id: "worldbook-provider-tools",
    name: "Conversation lore",
    source: "import",
    entries: [
      {
        id: "entry-provider-tools",
        keys: ["harbor"],
        content: "The harbor bell rings at dusk.",
      },
    ],
  });
  server.context.store.bindWorldbook({
    worldbookId: worldbook.id,
    scopeType: "conversation",
    scopeId: conversation.id,
  });
  return { conversation, worldbook };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(applications.splice(0).map(({ app }) => app.close()));
});

describe("ordinary generation worldbook tools", () => {
  it("persists received text when the provider stream fails", async () => {
    const server = await application();
    const { conversation } = workspaceFixture(server);
    vi.spyOn(server.context.providers, "get").mockResolvedValue(
      new PartialFailureProvider(),
    );

    const response = await server.app.inject({
      method: "POST",
      url: `/api/conversations/${conversation.id}/generate`,
      payload: { connectionId: "partial-failure" },
    });

    const events = streamEvents(response.body);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "error",
        code: "PROVIDER_REQUEST_FAILED",
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "message-persisted",
        incomplete: true,
        reason: "error",
        errorCode: "PROVIDER_REQUEST_FAILED",
      }),
    );
    expect(
      server.context.store.listMessages(conversation.id).at(-1),
    ).toMatchObject({
      role: "assistant",
      content: "Content received before the proxy disconnected.",
    });
  });

  it("feeds a read result back as a tool message before persisting normal assistant text", async () => {
    const server = await application();
    const { conversation, worldbook } = workspaceFixture(server);
    const provider = new SequencedFakeProvider([
      {
        toolCalls: [
          {
            id: "call-list",
            name: "worldbook.list",
            arguments: {},
          },
        ],
      },
      {
        chunks: [
          "I checked the available lore. The harbor bell rings at dusk.",
        ],
      },
    ]);
    vi.spyOn(server.context.providers, "get").mockResolvedValue(provider);

    const response = await server.app.inject({
      method: "POST",
      url: `/api/conversations/${conversation.id}/generate`,
      payload: { connectionId: "sequenced-fake" },
    });

    expect(response.statusCode).toBe(200);
    const events = streamEvents(response.body);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool-result",
        providerCallId: "call-list",
        result: [
          expect.objectContaining({
            id: worldbook.id,
            name: worldbook.name,
            revision: worldbook.revision,
          }),
        ],
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "text-delta",
        delta: "I checked the available lore. The harbor bell rings at dusk.",
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: "message-persisted" }),
    );

    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[0]?.tools?.map((tool) => tool.name)).toEqual([
      "worldbook.list",
      "worldbook.get",
      "worldbook.search",
      "worldbook.entry.create",
      "worldbook.entry.update",
      "worldbook.entry.delete",
    ]);
    expect(provider.requests[0]?.messages[0]?.content).toContain(worldbook.id);
    expect(
      provider.requests[0]?.messages.some(
        (message) => message.role === "tool" || message.toolCalls !== undefined,
      ),
    ).toBe(false);

    const continuedMessages = provider.requests[1]?.messages ?? [];
    expect(continuedMessages.at(-2)).toMatchObject({
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: "call-list",
          name: "worldbook.list",
          arguments: {},
        },
      ],
    });
    expect(continuedMessages.at(-1)).toMatchObject({
      role: "tool",
      name: "worldbook.list",
      toolCallId: "call-list",
    });
    expect(JSON.parse(continuedMessages.at(-1)?.content ?? "null")).toEqual([
      expect.objectContaining({
        id: worldbook.id,
        name: worldbook.name,
      }),
    ]);

    const messages = server.context.store.listMessages(conversation.id);
    expect(messages).toHaveLength(2);
    expect(messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(messages[1]).toMatchObject({
      role: "assistant",
      content: "I checked the available lore. The harbor bell rings at dusk.",
    });
    expect(
      messages.some(
        (message) => message.role === "system" || message.role === "tool",
      ),
    ).toBe(false);

    const run = server.context.agents.listRuns(conversation.id)[0];
    expect(run).toMatchObject({ status: "completed", currentStep: 2 });
    expect(server.context.agents.listToolCalls(run!.id)).toEqual([
      expect.objectContaining({
        toolName: "worldbook.list",
        status: "succeeded",
        effect: "read",
      }),
    ]);
  });

  it("emits a write proposal, skips later tools, and does not persist proposal text as chat", async () => {
    const server = await application();
    const { conversation, worldbook } = workspaceFixture(server);
    const provider = new SequencedFakeProvider([
      {
        toolCalls: [
          {
            id: "call-create",
            name: "worldbook.entry.create",
            arguments: {
              worldbookId: worldbook.id,
              expectedRevision: worldbook.revision,
              entry: {
                title: "Evening signal",
                keys: ["signal"],
                content: "A second bell marks the evening signal.",
              },
            },
          },
          {
            id: "call-create-later",
            name: "worldbook.entry.create",
            arguments: {
              worldbookId: worldbook.id,
              expectedRevision: worldbook.revision,
              entry: {
                content: "This later call must never become a proposal.",
              },
            },
          },
        ],
      },
    ]);
    vi.spyOn(server.context.providers, "get").mockResolvedValue(provider);

    const beforeEntries = server.context.store.listWorldbookEntries(
      worldbook.id,
    );
    const response = await server.app.inject({
      method: "POST",
      url: `/api/conversations/${conversation.id}/generate`,
      payload: { connectionId: "sequenced-fake" },
    });

    expect(response.statusCode).toBe(200);
    const events = streamEvents(response.body);
    const proposal = events.find((event) => event.type === "tool-proposal") as
      | {
          run: { id: string; status: string };
          toolCall: {
            idempotencyKey: string;
            toolName: string;
            arguments: Record<string, unknown>;
            status: string;
            requiresConfirmation: boolean;
          };
        }
      | undefined;
    expect(proposal).toMatchObject({
      run: { status: "waiting_confirmation" },
      toolCall: {
        toolName: "worldbook.entry.create",
        status: "awaiting_confirmation",
        requiresConfirmation: true,
      },
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool-rejected",
        providerCallId: "call-create-later",
        code: "AGENT_RUN_WAITING_CONFIRMATION",
      }),
    );
    expect(events.some((event) => event.type === "message-persisted")).toBe(
      false,
    );
    expect(provider.requests).toHaveLength(1);
    expect(server.context.store.listWorldbookEntries(worldbook.id)).toEqual(
      beforeEntries,
    );
    expect(
      server.context.store
        .listMessages(conversation.id)
        .map((message) => message.role),
    ).toEqual(["user"]);

    expect(proposal).toBeDefined();
    const runId = proposal!.run.id;
    expect(server.context.agents.listToolCalls(runId)).toEqual([
      expect.objectContaining({
        toolName: "worldbook.entry.create",
        status: "awaiting_confirmation",
      }),
    ]);

    const confirmed = await server.app.inject({
      method: "POST",
      url: `/api/agent/runs/${runId}/tools`,
      payload: {
        idempotencyKey: proposal!.toolCall.idempotencyKey,
        toolName: proposal!.toolCall.toolName,
        arguments: proposal!.toolCall.arguments,
        confirmed: true,
      },
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json()).toMatchObject({
      data: { call: { status: "succeeded" } },
    });
    expect(server.context.store.listWorldbookEntries(worldbook.id)).toEqual([
      ...beforeEntries,
      expect.objectContaining({
        content: "A second bell marks the evening signal.",
      }),
    ]);
    expect(
      server.context.store
        .listMessages(conversation.id)
        .map((message) => message.role),
    ).toEqual(["user"]);
  });
});
