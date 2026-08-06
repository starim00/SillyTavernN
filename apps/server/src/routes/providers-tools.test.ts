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

import {
  createServer,
  type ServerApplication,
  type ServerOptions,
} from "../app.js";

const applications: ServerApplication[] = [];

async function application(
  options: Pick<ServerOptions, "generationBudget"> = {},
): Promise<ServerApplication> {
  const dataDirectory = await mkdtemp(
    path.join(tmpdir(), "stn-provider-tools-"),
  );
  const created = await createServer({
    dataDirectory,
    databasePath: ":memory:",
    seedDevelopmentData: false,
    ...options,
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

class BlockingProvider extends DeterministicFakeProvider {
  release: (() => void) | undefined;

  override async *generate(
    request: ProviderRequest,
    signal?: AbortSignal,
  ): AsyncIterable<ProviderEvent> {
    yield {
      type: "start",
      requestId: request.requestId,
      sequence: 0,
      model: "blocking",
      capabilities: this.capabilities(),
    };
    await new Promise<void>((resolve, reject) => {
      this.release = resolve;
      signal?.addEventListener("abort", () => reject(new Error("Aborted")), {
        once: true,
      });
    });
    yield {
      type: "finish",
      requestId: request.requestId,
      sequence: 1,
      reason: "stop",
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
  const participant = server.context.store.createParticipant({
    id: "participant-provider-tools",
    cardId: card.id,
    name: "Harbor keeper",
    role: "character",
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
  return { conversation, worldbook, participant };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(applications.splice(0).map(({ app }) => app.close()));
});

describe("ordinary generation worldbook tools", () => {
  it("limits one active generation per conversation and releases the reservation", async () => {
    const server = await application();
    const { conversation } = workspaceFixture(server);
    const provider = new BlockingProvider();
    vi.spyOn(server.context.providers, "get").mockResolvedValue(provider);

    const first = server.app.inject({
      method: "POST",
      url: `/api/conversations/${conversation.id}/generate`,
      payload: { connectionId: "blocking" },
    });
    await vi.waitFor(() => expect(server.context.generations.size).toBe(1));
    const second = await server.app.inject({
      method: "POST",
      url: `/api/conversations/${conversation.id}/generate`,
      payload: { connectionId: "blocking" },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({
      error: { code: "GENERATION_ALREADY_ACTIVE" },
    });

    await vi.waitFor(() => expect(provider.release).toBeTypeOf("function"));
    provider.release?.();
    await first;
    expect(server.context.generations.size).toBe(0);
  });

  it("persists visible output as partial when the event budget is exhausted", async () => {
    const server = await application({
      generationBudget: { maxEvents: 2 },
    });
    const { conversation } = workspaceFixture(server);
    vi.spyOn(server.context.providers, "get").mockResolvedValue(
      new DeterministicFakeProvider({ text: "budgeted output" }),
    );

    const response = await server.app.inject({
      method: "POST",
      url: `/api/conversations/${conversation.id}/generate`,
      payload: { connectionId: "budget" },
    });
    expect(streamEvents(response.body)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "generation-limit" }),
        expect.objectContaining({
          type: "message-persisted",
          state: "partial",
          finishReason: "limit",
        }),
      ]),
    );
    expect(
      server.context.store.listMessages(conversation.id).at(-1),
    ).toMatchObject({
      content: "budgeted output",
      generationStatus: "partial",
      finishReason: "limit",
    });
  });

  it("regenerates directly into the target message without a temporary message", async () => {
    const server = await application();
    const { conversation } = workspaceFixture(server);
    const original = server.context.store.persistAssistantGeneration({
      conversationId: conversation.id,
      content: "original answer",
      status: "complete",
      finishReason: "stop",
    }).message;
    vi.spyOn(server.context.providers, "get").mockResolvedValue(
      new DeterministicFakeProvider({ text: "regenerated answer" }),
    );

    const response = await server.app.inject({
      method: "POST",
      url: `/api/messages/${original.id}/regenerate`,
      payload: {
        connectionId: "regenerate",
        expectedMessageRevision: original.revision,
      },
    });
    expect(response.statusCode).toBe(200);
    const assistantMessages = server.context.store
      .listMessages(conversation.id)
      .filter((message) => message.role === "assistant");
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]).toMatchObject({
      id: original.id,
      content: "regenerated answer",
      generationStatus: "complete",
    });
    expect(server.context.store.listSwipes(original.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          content: "original answer",
          selected: false,
        }),
        expect.objectContaining({
          content: "regenerated answer",
          selected: true,
        }),
      ]),
    );
  });

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
      "chat.messages.list",
      "chat.summary.get",
      "chat.summary.create",
      "chat.summary.update",
      "character.profile.get",
      "character.profile.create",
      "character.profile.update",
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

  it("lists ordered messages before proposing, confirming, auditing, and undoing a summary", async () => {
    const server = await application();
    const { conversation } = workspaceFixture(server);
    const messageId = "message-provider-tools-user";
    const provider = new SequencedFakeProvider([
      {
        toolCalls: [
          {
            id: "call-messages",
            name: "chat.messages.list",
            arguments: { limit: 200 },
          },
        ],
      },
      {
        toolCalls: [
          {
            id: "call-summary",
            name: "chat.summary.create",
            arguments: {
              title: "Dusk summary",
              content: "The harbor bell rings at dusk.",
              sourceFromMessageId: messageId,
              sourceToMessageId: messageId,
              keyEvents: [],
              unresolvedThreads: [],
              characterStates: {},
            },
          },
        ],
      },
    ]);
    vi.spyOn(server.context.providers, "get").mockResolvedValue(provider);

    const response = await server.app.inject({
      method: "POST",
      url: `/api/conversations/${conversation.id}/generate`,
      payload: { connectionId: "sequenced-fake" },
    });
    const events = streamEvents(response.body);
    const messagesResult = events.find(
      (event) =>
        event.type === "tool-result" &&
        event.providerCallId === "call-messages",
    );
    expect(messagesResult?.result).toMatchObject({
      items: [
        expect.objectContaining({
          id: messageId,
          order: 0,
          role: "user",
          preview: "Check the available lore, then answer normally.",
        }),
      ],
      offset: 0,
      limit: 200,
      total: 1,
      hasMore: false,
    });

    const proposal = events.find((event) => event.type === "tool-proposal") as
      | {
          run: { id: string; status: string };
          toolCall: {
            idempotencyKey: string;
            toolName: string;
            arguments: Record<string, unknown>;
            status: string;
          };
        }
      | undefined;
    expect(proposal).toMatchObject({
      run: { status: "waiting_confirmation" },
      toolCall: {
        toolName: "chat.summary.create",
        status: "awaiting_confirmation",
      },
    });
    expect(provider.requests[0]?.messages[0]?.content).toContain(
      "chat.messages.list",
    );

    const confirmed = await server.app.inject({
      method: "POST",
      url: `/api/agent/runs/${proposal!.run.id}/tools`,
      payload: {
        idempotencyKey: proposal!.toolCall.idempotencyKey,
        toolName: proposal!.toolCall.toolName,
        arguments: proposal!.toolCall.arguments,
        confirmed: true,
      },
    });
    const confirmedBody = confirmed.json() as {
      data: {
        result: { auditId: string; artifact: { id: string; revision: number } };
      };
    };
    expect(confirmedBody.data.result.artifact.revision).toBe(1);
    expect(server.context.agents.getRun(proposal!.run.id).status).toBe(
      "completed",
    );

    const undone = await server.app.inject({
      method: "POST",
      url: `/api/agent/runs/${proposal!.run.id}/tools`,
      payload: {
        idempotencyKey: "summary-undo",
        toolName: "agent.change.undo",
        arguments: { auditId: confirmedBody.data.result.auditId },
        confirmed: true,
      },
    });
    expect(undone.json()).toMatchObject({
      data: { call: { status: "succeeded" } },
    });
    expect(
      server.context.store.getLatestArtifact(
        "chat_summary",
        "conversation",
        conversation.id,
      ),
    ).toBeNull();
  });

  it("keeps participant profile reads and writes scoped to the current card", async () => {
    const server = await application();
    const { conversation, participant } = workspaceFixture(server);
    const provider = new SequencedFakeProvider([
      {
        toolCalls: [
          {
            id: "call-profile-get",
            name: "character.profile.get",
            arguments: { participantId: participant.id },
          },
        ],
      },
      {
        toolCalls: [
          {
            id: "call-profile-create",
            name: "character.profile.create",
            arguments: {
              participantId: participant.id,
              title: "Harbor keeper profile",
              content: "Keeps the evening bell schedule.",
              traits: ["careful"],
              goals: [],
              relationships: [],
              facts: [],
            },
          },
        ],
      },
    ]);
    vi.spyOn(server.context.providers, "get").mockResolvedValue(provider);

    const response = await server.app.inject({
      method: "POST",
      url: `/api/conversations/${conversation.id}/generate`,
      payload: { connectionId: "sequenced-fake" },
    });
    const events = streamEvents(response.body);
    expect(
      events.find((event) => event.providerCallId === "call-profile-get"),
    ).toMatchObject({
      type: "tool-result",
      result: { found: false },
    });
    const proposal = events.find((event) => event.type === "tool-proposal") as
      | {
          run: { id: string };
          toolCall: {
            idempotencyKey: string;
            toolName: string;
            arguments: Record<string, unknown>;
          };
        }
      | undefined;
    expect(proposal?.toolCall.toolName).toBe("character.profile.create");

    const confirmed = await server.app.inject({
      method: "POST",
      url: `/api/agent/runs/${proposal!.run.id}/tools`,
      payload: {
        idempotencyKey: proposal!.toolCall.idempotencyKey,
        toolName: proposal!.toolCall.toolName,
        arguments: proposal!.toolCall.arguments,
        confirmed: true,
      },
    });
    expect(confirmed.json()).toMatchObject({
      data: {
        call: { status: "succeeded" },
        result: { artifact: { kind: "character_profile" } },
      },
    });
  });
});
