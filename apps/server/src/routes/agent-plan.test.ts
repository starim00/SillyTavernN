import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createServer, type ServerApplication } from "../app.js";

const applications: ServerApplication[] = [];

async function application() {
  const dataDirectory = await mkdtemp(path.join(tmpdir(), "stn-agent-plan-"));
  const created = await createServer({
    dataDirectory,
    databasePath: ":memory:",
    seedDevelopmentData: false,
  });
  applications.push(created);
  return created;
}

afterEach(async () => {
  await Promise.all(applications.splice(0).map(({ app }) => app.close()));
});

function conversationFixture(application: ServerApplication) {
  const card = application.context.store.createCard({
    id: "card-plan",
    kind: "ensemble",
    name: "Planning scene",
    participants: [
      { id: "participant-user", name: "User", role: "user" },
      { id: "participant-guide", name: "Guide", role: "participant" },
    ],
  });
  const conversation = application.context.store.createConversation({
    id: "conversation-plan",
    title: "Planning conversation",
    cardId: card.card.id,
  });
  const first = application.context.store.addUserMessage({
    id: "message-plan-1",
    conversationId: conversation.id,
    content: "Remember the late bell.",
  });
  const second = application.context.store.addAssistantMessage({
    id: "message-plan-2",
    conversationId: conversation.id,
    parentMessageId: first.id,
    participantId: "participant-guide",
    content: "It rang one beat after midnight.",
  });
  return { card, conversation, first, second };
}

describe("Agent planning route", () => {
  it("plans a confirmation-gated entry create, then audits and undoes it", async () => {
    const server = await application();
    const { app, context } = server;
    const { conversation } = conversationFixture(server);
    const worldbook = context.store.createWorldbook({
      id: "worldbook-plan",
      name: "Imported lore",
      source: "import",
    });
    context.store.bindWorldbook({
      worldbookId: worldbook.id,
      scopeType: "conversation",
      scopeId: conversation.id,
    });

    const createdResponse = await app.inject({
      method: "POST",
      url: "/api/agent/runs",
      payload: {
        id: "run-plan",
        conversationId: conversation.id,
        connectionId: "fake",
        objective: "The clocktower bell rings one beat late.",
        idempotencyKey: "run-plan-key",
        maxSteps: 2,
      },
    });
    expect(createdResponse.statusCode).toBe(201);
    expect(createdResponse.json()).toMatchObject({
      data: { run: { provider: "fake", status: "queued" } },
    });

    const listed = await app.inject({
      method: "GET",
      url: `/api/agent/runs?conversationId=${conversation.id}`,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toMatchObject({
      data: [{ id: "run-plan", conversationId: conversation.id }],
    });

    const planResponse = await app.inject({
      method: "POST",
      url: "/api/agent/runs/run-plan/plan",
    });
    expect(planResponse.statusCode).toBe(200);
    const planned = planResponse.json() as {
      data: {
        run: { status: string; currentStep: number };
        toolCalls: Array<{
          id: string;
          idempotencyKey: string;
          toolName: string;
          arguments: {
            worldbookId: string;
            expectedRevision: number;
            entry: { content: string };
          };
          status: string;
        }>;
      };
    };
    expect(planned.data.run).toMatchObject({
      status: "waiting_confirmation",
      currentStep: 1,
    });
    expect(planned.data.toolCalls).toHaveLength(1);
    const proposal = planned.data.toolCalls[0]!;
    expect(proposal).toMatchObject({
      toolName: "worldbook.entry.create",
      status: "awaiting_confirmation",
      arguments: {
        worldbookId: worldbook.id,
        expectedRevision: worldbook.revision,
        entry: { content: "The clocktower bell rings one beat late." },
      },
    });
    expect(context.store.listWorldbookEntries(worldbook.id)).toEqual([]);

    const confirmationPayload = {
      idempotencyKey: proposal.idempotencyKey,
      toolName: proposal.toolName,
      arguments: proposal.arguments,
      confirmed: true,
    };
    const appliedResponse = await app.inject({
      method: "POST",
      url: "/api/agent/runs/run-plan/tools",
      payload: confirmationPayload,
    });
    expect(appliedResponse.statusCode).toBe(200);
    const applied = appliedResponse.json() as {
      data: {
        call: { status: string; arguments: { expectedRevision: number } };
        result: { auditId: string };
      };
    };
    expect(applied.data.call).toMatchObject({
      status: "succeeded",
      arguments: { expectedRevision: worldbook.revision },
    });
    expect(context.store.listWorldbookEntries(worldbook.id)).toHaveLength(1);
    expect(context.store.listWorldbookEntries(worldbook.id)[0]).toMatchObject({
      agentEditable: false,
    });
    expect(
      context.store.getAuditRecord(applied.data.result.auditId),
    ).toMatchObject({
      runId: "run-plan",
      action: "worldbook.entry.create",
    });

    const createdEntry = context.store.listWorldbookEntries(worldbook.id)[0]!;
    const currentWorldbook = context.store.getWorldbook(worldbook.id);
    const permissionResponse = await app.inject({
      method: "PATCH",
      url:
        `/api/worldbooks/${worldbook.id}/entries/` +
        `${createdEntry.id}/permission`,
      payload: {
        agentEditable: true,
        expectedWorldbookRevision: currentWorldbook.revision,
        expectedEntryRevision: createdEntry.revision,
      },
    });
    expect(permissionResponse.statusCode).toBe(200);

    const undoResponse = await app.inject({
      method: "POST",
      url: "/api/agent/runs/run-plan/tools",
      payload: {
        idempotencyKey: "undo-plan-write",
        toolName: "agent.change.undo",
        arguments: { auditId: applied.data.result.auditId },
        confirmed: true,
      },
    });
    expect(undoResponse.statusCode).toBe(200);
    expect(undoResponse.json()).toMatchObject({
      data: { call: { status: "succeeded" } },
    });
    expect(context.store.listWorldbookEntries(worldbook.id)).toEqual([]);
    expect(
      context.store.getAuditRecord(applied.data.result.auditId).undoneAt,
    ).not.toBeNull();
  });

  it("creates a confirmation-gated summary proposal and cancellation prevents execution", async () => {
    const server = await application();
    const { app, context } = server;
    const { conversation, first, second } = conversationFixture(server);
    await app.inject({
      method: "POST",
      url: "/api/agent/runs",
      payload: {
        id: "run-summary-plan",
        conversationId: conversation.id,
        connectionId: "fake",
        objective: "Summarize the exchange.",
        idempotencyKey: "run-summary-plan-key",
      },
    });

    const plannedResponse = await app.inject({
      method: "POST",
      url: "/api/agent/runs/run-summary-plan/plan",
    });
    const planned = plannedResponse.json() as {
      data: {
        toolCalls: Array<{
          idempotencyKey: string;
          toolName: string;
          arguments: Record<string, unknown>;
        }>;
      };
    };
    expect(plannedResponse.statusCode).toBe(200);
    expect(planned.data.toolCalls[0]).toMatchObject({
      toolName: "chat.summary.create",
      arguments: {
        sourceFromMessageId: first.id,
        sourceToMessageId: second.id,
      },
    });
    expect(
      context.store.getLatestArtifact(
        "chat_summary",
        "conversation",
        conversation.id,
      ),
    ).toBeNull();

    const cancelled = await app.inject({
      method: "POST",
      url: "/api/agent/runs/run-summary-plan/cancel",
    });
    expect(cancelled.json()).toMatchObject({
      data: { status: "cancelled" },
    });
    expect(context.agents.listToolCalls("run-summary-plan")[0]).toMatchObject({
      status: "cancelled",
    });

    const proposal = planned.data.toolCalls[0]!;
    const afterCancel = await app.inject({
      method: "POST",
      url: "/api/agent/runs/run-summary-plan/tools",
      payload: {
        idempotencyKey: proposal.idempotencyKey,
        toolName: proposal.toolName,
        arguments: proposal.arguments,
        confirmed: true,
      },
    });
    expect(afterCancel.statusCode).toBe(409);
    expect(afterCancel.json()).toMatchObject({
      error: { code: "run_cancelled" },
    });
  });

  it("resolves a persisted connection id and completes when the provider emits no tool call", async () => {
    const server = await application();
    const { app, context } = server;
    const { conversation } = conversationFixture(server);
    context.store.createProviderConnection({
      id: "fake-text-connection",
      name: "Text-only fake script",
      protocol: "fake",
      baseUrl: "",
      model: "fake-model",
      nativeToolCalling: true,
    });

    const created = await app.inject({
      method: "POST",
      url: "/api/agent/runs",
      payload: {
        id: "run-text-plan",
        conversationId: conversation.id,
        connectionId: "fake-text-connection",
        objective: "Respond without a write.",
        idempotencyKey: "run-text-plan-key",
      },
    });
    expect(created.json()).toMatchObject({
      data: { run: { provider: "fake-text-connection" } },
    });

    const planned = await app.inject({
      method: "POST",
      url: "/api/agent/runs/run-text-plan/plan",
    });
    expect(planned.statusCode).toBe(200);
    expect(planned.json()).toMatchObject({
      data: {
        run: { status: "completed", currentStep: 1 },
        text: "A deterministic response.",
        toolCalls: [],
      },
    });
  });
});
