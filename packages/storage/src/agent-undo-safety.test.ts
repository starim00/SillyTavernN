import { describe, expect, it } from "vitest";

import { AgentStore } from "./agent-store.js";
import { AppStore } from "./store.js";

function boundRunFixture(prefix: string) {
  const store = new AppStore();
  const agents = new AgentStore(store);
  const card = store.createCard({
    id: `${prefix}-card`,
    kind: "character",
    name: `${prefix} card`,
  }).card;
  const conversation = store.createConversation({
    id: `${prefix}-conversation`,
    title: `${prefix} conversation`,
    cardId: card.id,
  });
  const worldbook = store.createWorldbook({
    id: `${prefix}-worldbook`,
    name: `${prefix} worldbook`,
  });
  store.bindWorldbook({
    worldbookId: worldbook.id,
    scopeType: "conversation",
    scopeId: conversation.id,
  });
  const run = agents.createRun({
    id: `${prefix}-run`,
    conversationId: conversation.id,
    requestedBy: "local-user",
    provider: "fake",
    model: "fake",
    objective: "Create one fact.",
    idempotencyKey: `${prefix}-run`,
  }).run;
  return { store, agents, card, conversation, worldbook, run };
}

function createEntry(
  fixture: ReturnType<typeof boundRunFixture>,
  idempotencyKey: string,
) {
  const argumentsValue = {
    worldbookId: fixture.worldbook.id,
    expectedRevision: fixture.worldbook.revision,
    entry: { title: "Fact", content: "A durable fact." },
  };
  fixture.agents.executeTool({
    runId: fixture.run.id,
    idempotencyKey,
    toolName: "worldbook.entry.create",
    arguments: argumentsValue,
  });
  return fixture.agents.executeTool({
    runId: fixture.run.id,
    idempotencyKey,
    toolName: "worldbook.entry.create",
    arguments: argumentsValue,
    confirmed: true,
  }).result as {
    auditId: string;
    revision: number;
    entry: { id: string; revision: number; agentEditable: boolean };
  };
}

describe("Agent undo authorization", () => {
  it("requires the authored entry to be AI-editable and safely rebases one human permission change", () => {
    const fixture = boundRunFixture("undo-permission");
    try {
      const created = createEntry(fixture, "create");
      expect(created.entry.agentEditable).toBe(false);

      expect(() =>
        fixture.agents.executeTool({
          runId: fixture.run.id,
          idempotencyKey: "undo-while-locked",
          toolName: "agent.change.undo",
          arguments: { auditId: created.auditId },
          confirmed: true,
        }),
      ).toThrowError(
        expect.objectContaining({
          code: "WORLD_BOOK_ENTRY_NOT_AGENT_EDITABLE",
        }),
      );
      expect(fixture.store.getWorldbookEntry(created.entry.id)).toBeDefined();

      fixture.store.setWorldbookEntryPermission({
        worldbookId: fixture.worldbook.id,
        entryId: created.entry.id,
        expectedWorldbookRevision: created.revision,
        expectedEntryRevision: created.entry.revision,
        agentEditable: true,
        actorKind: "human",
        actorId: "local-user",
      });
      const undone = fixture.agents.executeTool({
        runId: fixture.run.id,
        idempotencyKey: "undo-after-permission",
        toolName: "agent.change.undo",
        arguments: { auditId: created.auditId },
        confirmed: true,
      });
      expect(undone.call.status).toBe("succeeded");
      expect(fixture.store.listWorldbookEntries(fixture.worldbook.id)).toEqual(
        [],
      );
    } finally {
      fixture.store.close();
    }
  });

  it("rejects an audit id presented by a different conversation tool run", () => {
    const source = boundRunFixture("undo-source");
    const targetConversation = source.store.createConversation({
      id: "undo-target-conversation",
      title: "Target conversation",
      cardId: source.card.id,
    });
    const targetRun = source.agents.createRun({
      id: "undo-target-run",
      conversationId: targetConversation.id,
      requestedBy: "local-user",
      provider: "fake",
      model: "fake",
      objective: "Try a foreign undo.",
      idempotencyKey: "undo-target-run",
    }).run;
    try {
      const created = createEntry(source, "source-create");
      expect(() =>
        source.agents.executeTool({
          runId: targetRun.id,
          idempotencyKey: "foreign-undo",
          toolName: "agent.change.undo",
          arguments: { auditId: created.auditId },
          confirmed: true,
        }),
      ).toThrowError(expect.objectContaining({ code: "permission_denied" }));
      expect(source.store.getWorldbookEntry(created.entry.id)).toBeDefined();
    } finally {
      source.store.close();
    }
  });
});
