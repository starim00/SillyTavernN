import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createServer, type ServerApplication } from "./app.js";
import { prepareConversationPrompt } from "./prompt-service.js";

const applications: ServerApplication[] = [];

type PersonaRouteResponse = {
  id: string;
  revision: number;
  isDefault: boolean;
};

async function application(seedDevelopmentData = true) {
  const dataDirectory = await mkdtemp(path.join(tmpdir(), "stn-server-"));
  const created = await createServer({
    dataDirectory,
    databasePath: ":memory:",
    seedDevelopmentData,
    authentication: false,
  });
  applications.push(created);
  return { ...created, dataDirectory };
}

afterEach(async () => {
  await Promise.all(applications.splice(0).map(({ app }) => app.close()));
});

describe("SillyTavern N server", () => {
  it("exposes user persona CRUD and conversation switching", async () => {
    const { app, context } = await application(false);
    const card = context.store.createCard({
      id: "card-persona-route",
      kind: "character",
      name: "Persona route card",
    }).card;
    const createdPersona = await app.inject({
      method: "POST",
      url: "/api/personas",
      payload: {
        name: "Route user",
        description: "Route description",
        title: "Investigator",
        isDefault: true,
      },
    });
    expect(createdPersona.statusCode).toBe(201);
    const persona = (createdPersona.json() as { data: PersonaRouteResponse })
      .data;
    expect(persona).toMatchObject({ isDefault: true, revision: 1 });

    const conversation = context.store.createConversation({
      id: "conversation-persona-route",
      title: "Persona route conversation",
      cardId: card.id,
    });
    expect(conversation.personaId).toBe(persona.id);

    const switched = await app.inject({
      method: "PATCH",
      url: `/api/conversations/${conversation.id}/persona`,
      payload: { personaId: null, expectedRevision: conversation.revision },
    });
    expect(switched.statusCode).toBe(200);
    expect(switched.json()).toMatchObject({
      data: { id: conversation.id, personaId: persona.id },
    });

    const updated = await app.inject({
      method: "PATCH",
      url: `/api/personas/${persona.id}`,
      payload: {
        expectedRevision: persona.revision,
        name: "Updated route user",
      },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      data: { id: persona.id, name: "Updated route user" },
    });

    const listed = await app.inject({ method: "GET", url: "/api/personas" });
    expect(listed.json()).toMatchObject({
      data: [expect.objectContaining({ id: persona.id })],
    });

    const removed = await app.inject({
      method: "DELETE",
      url: `/api/personas/${persona.id}`,
      payload: { expectedRevision: persona.revision + 1 },
    });
    expect(removed.statusCode).toBe(200);
    expect(context.store.getConversation(conversation.id).personaId).toBeNull();
  });

  it("cascade-deletes cards and presets through their public routes", async () => {
    const { app, context } = await application(false);
    const card = context.store.createCard({
      id: "card-delete-route",
      kind: "character",
      name: "Delete route card",
    }).card;
    const conversation = context.store.createConversation({
      id: "conversation-delete-route",
      title: "Delete route conversation",
      cardId: card.id,
    });
    const worldbook = context.store.createWorldbook({
      id: "worldbook-delete-route",
      name: "Delete route lore",
    });
    context.store.bindWorldbook({
      worldbookId: worldbook.id,
      scopeType: "card",
      scopeId: card.id,
    });
    context.store.setExtensionSetting("stn.regex", `card:${card.id}`, true);

    const deletedCard = await app.inject({
      method: "DELETE",
      url: `/api/cards/${card.id}`,
      payload: { expectedRevision: card.revision },
    });
    expect(deletedCard.statusCode).toBe(200);
    expect(deletedCard.json()).toMatchObject({
      data: {
        card: { id: card.id },
        conversationIds: [conversation.id],
        worldbookIds: [worldbook.id],
      },
    });
    expect(context.store.listCards()).toEqual([]);
    expect(context.store.listConversations()).toEqual([]);
    expect(context.store.listWorldbooks()).toEqual([]);

    const preset = context.store.createPreset({
      id: "preset-delete-route",
      name: "Delete route preset",
      kind: "chat-completion",
    });
    context.store.setExtensionSetting(
      "stn.tavern-helper",
      `variables:preset:${preset.id}`,
      { value: true },
    );
    const deletedPreset = await app.inject({
      method: "DELETE",
      url: `/api/presets/${preset.id}`,
      payload: { expectedRevision: preset.revision },
    });
    expect(deletedPreset.statusCode).toBe(200);
    expect(deletedPreset.json()).toMatchObject({
      data: { id: preset.id },
    });
    expect(context.store.listPresets()).toEqual([]);
  });

  it("replaces one card's worldbook combination without deleting library books", async () => {
    const { app, context } = await application(false);
    const card = context.store.createCard({
      id: "card-worldbook-route",
      kind: "character",
      name: "Worldbook route card",
    }).card;
    const conversation = context.store.createConversation({
      id: "conversation-worldbook-route",
      title: "Worldbook route conversation",
      cardId: card.id,
    });
    const first = context.store.createWorldbook({
      id: "worldbook-route-first",
      name: "First route lore",
    });
    const second = context.store.createWorldbook({
      id: "worldbook-route-second",
      name: "Second route lore",
    });
    context.store.bindWorldbook({
      worldbookId: first.id,
      scopeType: "card",
      scopeId: card.id,
    });

    const response = await app.inject({
      method: "PUT",
      url: `/api/cards/${card.id}/worldbooks`,
      payload: {
        expectedWorldbookIds: [first.id],
        worldbookIds: [second.id],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: {
        card: { id: card.id, worldbookIds: [second.id] },
        conversations: [
          {
            id: conversation.id,
            worldbookIds: [second.id],
          },
        ],
      },
    });
    expect(context.store.listWorldbooks()).toHaveLength(2);
  });

  it("deletes a conversation and its conversation-scoped state through its public route", async () => {
    const { app, context } = await application(false);
    const card = context.store.createCard({
      id: "card-conversation-delete-route",
      kind: "character",
      name: "Conversation delete route card",
    }).card;
    const conversation = context.store.createConversation({
      id: "conversation-delete-route-state",
      title: "Conversation delete route state",
      cardId: card.id,
    });
    const message = context.store.addUserMessage({
      id: "message-delete-route-state",
      conversationId: conversation.id,
      content: "Delete this message too.",
    });
    const exclusiveWorldbook = context.store.createWorldbook({
      id: "worldbook-delete-route-state",
      name: "Conversation-only lore",
    });
    context.store.bindWorldbook({
      worldbookId: exclusiveWorldbook.id,
      scopeType: "conversation",
      scopeId: conversation.id,
    });
    context.store.createArtifact({
      kind: "chat_summary",
      scopeType: "conversation",
      scopeId: conversation.id,
      content: "Delete this summary too.",
    });
    context.store.setExtensionSetting(
      "stn.tavern-helper",
      `variables:conversation:${conversation.id}`,
      { state: "delete" },
    );
    context.store.setExtensionSetting(
      "stn.tavern-helper",
      `variables:message:${message.id}`,
      { state: "delete-message" },
    );

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/conversations/${conversation.id}`,
      payload: {
        expectedRevision: context.store.getConversation(conversation.id)
          .revision,
      },
    });

    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toMatchObject({
      data: { id: conversation.id, title: conversation.title },
    });
    expect(context.store.listConversations()).toEqual([]);
    expect(context.store.listWorldbooks()).toEqual([]);
    expect(context.store.listArtifacts()).toEqual([]);
    expect(
      context.store.database.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM extension_settings WHERE key LIKE ?",
        `%${conversation.id}%`,
      )?.count,
    ).toBe(0);
  });

  it("serves a real workspace and persists offline CRUD", async () => {
    const { app, context } = await application();
    const health = await app.inject({ method: "GET", url: "/api/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ data: { ok: true } });

    const cards = await app.inject({ method: "GET", url: "/api/cards" });
    expect(cards.json()).toMatchObject({
      data: [
        {
          id: "card-fog-harbor",
          kind: "character",
          participants: [
            {
              id: "participant-harbor",
              role: "character",
            },
          ],
        },
      ],
    });

    const unifiedCard = await app.inject({
      method: "POST",
      url: "/api/cards",
      payload: {
        name: "Unified card",
        description: "One user-facing card abstraction.",
        participants: [{ name: "Model-side participant" }],
      },
    });
    expect(unifiedCard.statusCode).toBe(201);
    expect(unifiedCard.json()).toMatchObject({
      data: {
        card: { kind: "character", name: "Unified card" },
        participants: [{ name: "Model-side participant" }],
      },
    });
    const unifiedCardBody = unifiedCard.json() as {
      data: { card: { id: string } };
    };
    const nestedCreated = await app.inject({
      method: "POST",
      url: `/api/cards/${unifiedCardBody.data.card.id}/conversations`,
      payload: { title: "Nested new conversation" },
    });
    expect(nestedCreated.statusCode).toBe(201);
    expect(nestedCreated.json()).toMatchObject({
      data: {
        title: "Nested new conversation",
        cardId: unifiedCardBody.data.card.id,
        participantIds: [expect.any(String)],
      },
    });

    const missingCard = await app.inject({
      method: "POST",
      url: "/api/conversations",
      payload: {
        title: "Unbound conversation",
      },
    });
    expect(missingCard.statusCode).toBe(400);

    const clientSelectedParticipants = await app.inject({
      method: "POST",
      url: "/api/conversations",
      payload: {
        title: "Client-selected participants",
        cardId: "card-fog-harbor",
        participantIds: [],
      },
    });
    expect(clientSelectedParticipants.statusCode).toBe(400);

    const created = await app.inject({
      method: "POST",
      url: "/api/conversations",
      payload: {
        title: "Card-bound conversation",
        cardId: "card-fog-harbor",
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      data: {
        title: "Card-bound conversation",
        cardId: "card-fog-harbor",
        participantIds: ["participant-harbor"],
      },
    });
    const conversationId = (created.json() as { data: { id: string } }).data.id;
    context.store.createParticipant({
      id: "participant-harbor-later",
      cardId: "card-fog-harbor",
      name: "Later card participant",
    });
    const sharedWorldbook = context.store.createWorldbook({
      id: "worldbook-card-context",
      name: "Card context",
    });
    context.store.bindWorldbook({
      worldbookId: sharedWorldbook.id,
      scopeType: "card",
      scopeId: "card-fog-harbor",
    });
    context.store.bindWorldbook({
      worldbookId: sharedWorldbook.id,
      scopeType: "conversation",
      scopeId: conversationId,
    });

    const cardsWithBindings = await app.inject({
      method: "GET",
      url: "/api/cards",
    });
    expect(
      (
        cardsWithBindings.json() as {
          data: Array<{ id: string; worldbookIds: string[] }>;
        }
      ).data,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "card-fog-harbor",
          worldbookIds: ["worldbook-card-context"],
        }),
      ]),
    );

    const cardHistory = await app.inject({
      method: "GET",
      url: "/api/conversations?cardId=card-fog-harbor",
    });
    expect(cardHistory.statusCode).toBe(200);
    expect(
      (
        cardHistory.json() as {
          data: { items: Array<{ id: string; cardId: string }> };
        }
      ).data.items,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: conversationId,
          cardId: "card-fog-harbor",
          participantIds: ["participant-harbor", "participant-harbor-later"],
          worldbookIds: ["worldbook-card-context"],
        }),
      ]),
    );
    const nestedHistory = await app.inject({
      method: "GET",
      url: "/api/cards/card-fog-harbor/conversations",
    });
    expect(nestedHistory.json()).toEqual(cardHistory.json());

    const message = await app.inject({
      method: "POST",
      url: `/api/conversations/${conversationId}/messages`,
      payload: {
        content: "Continue this card-bound conversation.",
      },
    });
    expect(message.statusCode).toBe(201);
    expect(message.json()).toMatchObject({
      data: {
        role: "user",
        participantId: null,
        content: "Continue this card-bound conversation.",
      },
    });

    const ordinaryAssistant = await app.inject({
      method: "POST",
      url: `/api/conversations/${conversationId}/messages`,
      payload: {
        role: "assistant",
        content: "User-created assistant message",
      },
    });
    expect(ordinaryAssistant.statusCode).toBe(201);
    expect(ordinaryAssistant.json()).toMatchObject({
      data: {
        role: "assistant",
        participantId: null,
        content: "User-created assistant message",
      },
    });
    const ordinaryAssistantData = (
      ordinaryAssistant.json() as { data: { id: string; revision: number } }
    ).data;
    await app.inject({
      method: "DELETE",
      url: `/api/messages/${ordinaryAssistantData.id}`,
      payload: { expectedRevision: ordinaryAssistantData.revision },
    });

    for (const role of ["narrator", "system", "tool"]) {
      const forged = await app.inject({
        method: "POST",
        url: `/api/conversations/${conversationId}/messages`,
        payload: {
          role,
          content: "Client-controlled role",
        },
      });
      expect(forged.statusCode).toBe(400);
    }
    const forgedAttribution = await app.inject({
      method: "POST",
      url: `/api/conversations/${conversationId}/messages`,
      payload: {
        participantId: "participant-harbor",
        content: "Client-controlled attribution",
      },
    });
    expect(forgedAttribution.statusCode).toBe(400);

    const helperAssistant = await app.inject({
      method: "POST",
      url: `/api/compatibility/tavern-helper/conversations/${conversationId}/messages`,
      payload: {
        role: "assistant",
        content: "Trusted helper-created assistant floor.",
      },
    });
    expect(helperAssistant.statusCode).toBe(201);
    expect(helperAssistant.json()).toMatchObject({
      data: {
        role: "assistant",
        participantId: null,
        content: "Trusted helper-created assistant floor.",
      },
    });
    const helperAssistantData = (
      helperAssistant.json() as { data: { id: string; revision: number } }
    ).data;
    const helperAssistantDeletion = await app.inject({
      method: "DELETE",
      url: `/api/messages/${helperAssistantData.id}`,
      payload: { expectedRevision: helperAssistantData.revision },
    });
    expect(helperAssistantDeletion.statusCode).toBe(200);

    context.store.addInternalMessage({
      id: "internal-world-instruction",
      conversationId,
      role: "system",
      content: "Internal only",
    });
    const visibleMessages = await app.inject({
      method: "GET",
      url: `/api/conversations/${conversationId}/messages`,
    });
    expect(visibleMessages.json()).toMatchObject({
      data: {
        items: [
          expect.objectContaining({
            role: "user",
            content: "Continue this card-bound conversation.",
          }),
        ],
      },
    });
    expect(visibleMessages.body).not.toContain("Internal only");
  });

  it("imports a newly authored portable card and preserves unknown fields", async () => {
    const { app } = await application(false);
    const source = JSON.stringify({
      spec: "chara_card_v3",
      spec_version: "3.0",
      data: {
        name: "Portable ensemble",
        kind: "ensemble",
        participants: [
          { name: "Narrator", kind: "narrator" },
          { name: "Member A", kind: "character" },
        ],
        custom_future_field: { retained: true },
      },
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/cards/import",
      headers: {
        "content-type": "application/octet-stream",
        "x-file-name": "ensemble.json",
      },
      payload: Buffer.from(source),
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      data: {
        card: { kind: "ensemble", name: "Portable ensemble" },
        sourceFormat: "chara_card_v3",
      },
    });
    const cards = await app.inject({ method: "GET", url: "/api/cards" });
    const cardPayload = cards.json() as {
      data: Array<{ legacyPayload: unknown }>;
    };
    expect(cardPayload.data[0]?.legacyPayload).toMatchObject({
      compatibility: {
        unknownFields: {
          data: { custom_future_field: { retained: true } },
        },
      },
    });
  });

  it("starts a card-bound conversation with one assistant greeting and greeting swipes", async () => {
    const { app } = await application(false);
    const imported = await app.inject({
      method: "POST",
      url: "/api/cards/import",
      headers: {
        "content-type": "application/octet-stream",
        "x-file-name": "greeting-card.json",
      },
      payload: Buffer.from(
        JSON.stringify({
          spec: "chara_card_v3",
          spec_version: "3.0",
          data: {
            name: "Greeting card",
            first_mes: "Primary model greeting",
            alternate_greetings: [
              "Alternate model greeting A",
              "Alternate model greeting B",
            ],
          },
        }),
      ),
    });
    expect(imported.statusCode).toBe(201);
    const importedBody = imported.json() as {
      data: { card: { id: string }; participantIds: string[] };
    };

    const created = await app.inject({
      method: "POST",
      url: "/api/conversations",
      payload: {
        title: "Greeting conversation",
        cardId: importedBody.data.card.id,
      },
    });
    expect(created.statusCode).toBe(201);
    const conversationId = (created.json() as { data: { id: string } }).data.id;
    const messages = await app.inject({
      method: "GET",
      url: `/api/conversations/${conversationId}/messages`,
    });
    expect(messages.statusCode).toBe(200);
    const messageItems = (messages.json() as { data: { items: unknown[] } })
      .data.items;
    expect(messageItems).toHaveLength(1);
    expect(messageItems[0]).toMatchObject({
      role: "assistant",
      participantId: null,
      content: "Primary model greeting",
      swipes: [
        { content: "Primary model greeting", selected: true },
        { content: "Alternate model greeting A", selected: false },
        { content: "Alternate model greeting B", selected: false },
      ],
    });
  });

  it("serves, recalls, positions, and edits imported worldbook entries", async () => {
    const { app, context } = await application(false);
    const imported = await app.inject({
      method: "POST",
      url: "/api/cards/import",
      headers: {
        "content-type": "application/octet-stream",
        "x-file-name": "worldbook-flow-card.json",
      },
      payload: Buffer.from(
        JSON.stringify({
          spec: "chara_card_v3",
          spec_version: "3.0",
          data: {
            id: "card-worldbook-flow",
            name: "Worldbook flow card",
            character_book: {
              id: "worldbook-flow",
              name: "Flow lore",
              entries: [
                {
                  id: 7,
                  comment: "Moon gate",
                  keys: ["moon"],
                  secondary_keys: ["tide"],
                  selective: false,
                  constant: false,
                  enabled: true,
                  content: "The moon gate is open.",
                  insertion_order: 800,
                  extensions: {
                    position: 0,
                    role: 0,
                  },
                },
                {
                  id: 8,
                  comment: "Always-on rule",
                  keys: [],
                  secondary_keys: ["not-required"],
                  selective: true,
                  constant: true,
                  enabled: true,
                  content: "Always preserve the harbor rule.",
                  insertion_order: 700,
                  extensions: {
                    position: 4,
                    depth: 2,
                    role: 1,
                  },
                },
                {
                  id: 9,
                  comment: "Disabled rule",
                  keys: [],
                  constant: true,
                  enabled: false,
                  content: "This disabled text must stay out.",
                  insertion_order: 600,
                },
              ],
            },
          },
        }),
      ),
    });
    expect(imported.statusCode).toBe(201);

    const listed = await app.inject({ method: "GET", url: "/api/worldbooks" });
    expect(listed.statusCode).toBe(200);
    const listedBody = listed.json() as {
      data: Array<{
        id: string;
        imported: boolean;
        entries: Array<
          Record<string, unknown> & {
            id: string;
            legacyUid: number | null;
          }
        >;
      }>;
    };
    const listedWorldbook = listedBody.data.find(
      (candidate) => candidate.id === "worldbook-flow",
    );
    expect(listedWorldbook).toMatchObject({
      id: "worldbook-flow",
      imported: true,
    });
    const entryByLegacyUid = (legacyUid: number) => {
      const entry = listedWorldbook?.entries.find(
        (candidate) => candidate.legacyUid === legacyUid,
      );
      if (!entry) {
        throw new Error(`Missing imported entry ${String(legacyUid)}`);
      }
      return entry;
    };
    const moonEntry = entryByLegacyUid(7);
    const alwaysEntry = entryByLegacyUid(8);
    const disabledEntry = entryByLegacyUid(9);
    expect(moonEntry.id).toMatch(/^worldbook-entry-/u);
    expect(moonEntry).toMatchObject({
      legacyUid: 7,
      title: "Moon gate",
      primaryKeys: ["moon"],
      secondaryKeys: ["tide"],
      enabled: true,
      constant: false,
      insertionPosition: "before-card",
      insertionRole: "system",
      order: 800,
      priority: 800,
    });
    expect(alwaysEntry).toMatchObject({
      legacyUid: 8,
      title: "Always-on rule",
      enabled: true,
      constant: true,
      insertionPosition: "at-depth",
      insertionDepth: 2,
      insertionRole: "user",
    });
    expect(disabledEntry).toMatchObject({
      legacyUid: 9,
      title: "Disabled rule",
      enabled: false,
      constant: true,
    });

    const conversation = context.store.createConversation({
      id: "conversation-worldbook-flow",
      title: "Worldbook flow",
      cardId: "card-worldbook-flow",
    });
    context.store.addUserMessage({
      conversationId: conversation.id,
      content: "I inspect the moon.",
    });
    const prompt = await prepareConversationPrompt(context.store, {
      conversationId: conversation.id,
    });
    const loreSegments = prompt.segments.filter(
      (segment) => segment.source.kind === "worldbook",
    );
    expect(loreSegments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "system",
          position: "before-card",
          content: "The moon gate is open.",
        }),
        expect.objectContaining({
          role: "user",
          position: "history",
          content: "Always preserve the harbor rule.",
        }),
      ]),
    );
    expect(prompt.textPrompt).not.toContain(
      "This disabled text must stay out.",
    );

    const beforeDirtyWrite = context.store.getWorldbook("worldbook-flow");
    const beforeDirtyEntry = context.store.getWorldbookEntry(moonEntry.id);
    context.store.updateWorldbookEntryHuman({
      worldbookId: beforeDirtyWrite.id,
      entryId: beforeDirtyEntry.id,
      expectedWorldbookRevision: beforeDirtyWrite.revision,
      expectedEntryRevision: beforeDirtyEntry.revision,
      patch: { keys: ["/moon{1,3}/i"] },
    });
    const listedAfterDirtyWrite = await app.inject({
      method: "GET",
      url: "/api/worldbooks",
    });
    const dirtyWorldbook = (
      listedAfterDirtyWrite.json() as {
        data: Array<{
          id: string;
          entries: Array<Record<string, unknown>>;
        }>;
      }
    ).data.find((candidate) => candidate.id === "worldbook-flow");
    expect(
      dirtyWorldbook?.entries.find(
        (candidate) => candidate.id === moonEntry.id,
      ),
    ).toMatchObject({
      primaryKeys: ["/moon{1,3}/i"],
      secondaryKeys: [],
      selective: false,
    });

    const beforeWorldbook = context.store.getWorldbook("worldbook-flow");
    const beforeEntry = context.store.getWorldbookEntry(moonEntry.id);
    const updated = await app.inject({
      method: "PATCH",
      url: `/api/worldbooks/worldbook-flow/entries/${encodeURIComponent(
        moonEntry.id,
      )}`,
      payload: {
        expectedWorldbookRevision: beforeWorldbook.revision,
        expectedEntryRevision: beforeEntry.revision,
        title: "Tide gate",
        primaryKeys: ["tide"],
        secondaryKeys: [],
        secondaryLogic: "any",
        selective: false,
        content: "The tide gate is open.",
        enabled: true,
        constant: false,
        caseSensitive: true,
        matchWholeWords: true,
        useRegex: false,
        scanDepth: null,
        recursion: false,
        preventRecursion: true,
        excludeRecursion: false,
        delayUntilRecursion: false,
        insertionPosition: "after-card",
        outletName: "tide-gate",
        insertionDepth: null,
        insertionRole: "assistant",
        order: 900,
        priority: 950,
      },
    });
    expect(updated.statusCode).toBe(200);
    const updatedBody = updated.json() as {
      data: {
        worldbook: {
          id: string;
          revision: number;
          entries: Array<Record<string, unknown>>;
        };
      };
    };
    expect(updatedBody.data.worldbook).toMatchObject({
      id: "worldbook-flow",
      revision: beforeWorldbook.revision + 1,
    });
    expect(
      updatedBody.data.worldbook.entries.find(
        (candidate) => candidate.id === moonEntry.id,
      ),
    ).toMatchObject({
      id: moonEntry.id,
      legacyUid: 7,
      title: "Tide gate",
      primaryKeys: ["tide"],
      secondaryKeys: [],
      content: "The tide gate is open.",
      enabled: true,
      constant: false,
      caseSensitive: true,
      matchWholeWords: true,
      useRegex: false,
      scanDepth: null,
      recursion: false,
      preventRecursion: true,
      insertionPosition: "after-card",
      outletName: "tide-gate",
      insertionDepth: null,
      insertionRole: "assistant",
      order: 900,
      priority: 950,
      agentEditable: false,
      revision: beforeEntry.revision + 1,
    });
    expect(context.store.getWorldbookEntry(moonEntry.id)).toMatchObject({
      keys: ["tide"],
      enabled: true,
      position: 900,
      agentEditable: false,
      metadata: {
        label: "Tide gate",
        primaryKeys: ["tide"],
        secondaryKeys: [],
        constant: false,
        insertionPosition: "after-card",
        outletName: "tide-gate",
        insertionRole: "assistant",
        priority: 950,
        scanDepth: null,
      },
    });
  });

  it("applies only granted card and preset markdown regexes to display copies", async () => {
    const { app, context } = await application(false);
    const script = (
      id: string,
      placement: number,
      findRegex: string,
      replaceString: string,
      minDepth: number | null,
      maxDepth: number | null,
    ) => ({
      id,
      scriptName: id,
      findRegex,
      replaceString,
      trimStrings: [],
      placement: [placement],
      disabled: false,
      markdownOnly: true,
      promptOnly: false,
      runOnEdit: true,
      substituteRegex: 0,
      minDepth,
      maxDepth,
    });
    const imported = await app.inject({
      method: "POST",
      url: "/api/cards/import",
      headers: {
        "content-type": "application/octet-stream",
        "x-file-name": "display-regex-card.json",
      },
      payload: Buffer.from(
        JSON.stringify({
          spec: "chara_card_v3",
          spec_version: "3.0",
          data: {
            id: "card-display-regex",
            name: "Display fixture",
            first_mes: "Hello raw",
            extensions: {
              regex_scripts: [
                script(
                  "card-assistant",
                  2,
                  "Hello|PRESET",
                  "<strong>CARD</strong>",
                  1,
                  1,
                ),
                script("card-user", 1, "secret", "visible", null, 0),
              ],
            },
          },
        }),
      ),
    });
    const cardId = (imported.json() as { data: { card: { id: string } } }).data
      .card.id;
    const created = await app.inject({
      method: "POST",
      url: "/api/conversations",
      payload: {
        title: "Regex display",
        cardId,
      },
    });
    const conversationId = (created.json() as { data: { id: string } }).data.id;
    await app.inject({
      method: "POST",
      url: `/api/conversations/${conversationId}/messages`,
      payload: { content: "secret raw user input" },
    });

    const now = "2026-07-29T00:00:00.000Z";
    context.store.createPreset({
      id: "preset-display-regex",
      name: "Display preset",
      kind: "native",
      payload: {
        id: "preset-display-regex",
        name: "Display preset",
        mode: "native",
        prompts: [],
        generation: { stop: [], samplerOrder: [], additional: {} },
        extensions: {
          regex_scripts: [
            script("preset-assistant", 2, "Hello", "PRESET", null, null),
          ],
        },
        createdAt: now,
        updatedAt: now,
      },
    });

    const denied = await app.inject({
      method: "GET",
      url: `/api/conversations/${conversationId}/messages?presetId=preset-display-regex`,
    });
    const deniedItems = (
      denied.json() as {
        data: {
          items: Array<{
            role: string;
            content: string;
            displayContent: string;
            appliedRegexScriptIds: string[];
          }>;
        };
      }
    ).data.items;
    expect(deniedItems.find((item) => item.role === "user")).toMatchObject({
      content: "secret raw user input",
      displayContent: "secret raw user input",
      appliedRegexScriptIds: [],
    });
    expect(deniedItems.find((item) => item.role === "assistant")).toMatchObject(
      {
        content: "Hello raw",
        displayContent: "Hello raw",
        appliedRegexScriptIds: [],
      },
    );

    await app.inject({
      method: "PUT",
      url: "/api/compatibility/regex-grants",
      payload: { scope: "card", id: cardId, granted: true },
    });
    const cardOnly = await app.inject({
      method: "GET",
      url: `/api/conversations/${conversationId}/messages?presetId=preset-display-regex`,
    });
    const cardOnlyItems = (
      cardOnly.json() as {
        data: {
          items: Array<{
            content: string;
            displayContent: string;
            appliedRegexScriptIds: string[];
          }>;
        };
      }
    ).data.items;
    expect(
      cardOnlyItems.find((item) => item.content === "secret raw user input"),
    ).toMatchObject({
      displayContent: "visible raw user input",
      appliedRegexScriptIds: ["card-user"],
    });
    expect(
      cardOnlyItems.find((item) => item.content === "Hello raw"),
    ).toMatchObject({
      displayContent: "<strong>CARD</strong> raw",
      appliedRegexScriptIds: ["card-assistant"],
    });

    await app.inject({
      method: "PUT",
      url: "/api/compatibility/regex-grants",
      payload: {
        scope: "preset",
        id: "preset-display-regex",
        granted: true,
      },
    });
    const combined = await app.inject({
      method: "GET",
      url: `/api/conversations/${conversationId}/messages?presetId=preset-display-regex`,
    });
    const combinedBody = combined.json() as {
      data: {
        items: Array<{
          id: string;
          content: string;
          displayContent: string;
          appliedRegexScriptIds: string[];
        }>;
      };
    };
    const combinedAssistant = combinedBody.data.items.find(
      (message) => message.content === "Hello raw",
    );
    expect(combinedAssistant).toMatchObject({
      content: "Hello raw",
      displayContent: "<strong>CARD</strong> raw",
      appliedRegexScriptIds: ["preset-assistant", "card-assistant"],
    });
    expect(context.store.getMessage(combinedAssistant?.id ?? "").content).toBe(
      "Hello raw",
    );
  });

  it("streams with the fake provider and persists only the completed assistant message", async () => {
    const { app, context } = await application();
    const before = context.store.listMessages("conversation-harbor").length;
    const speakerInjection = await app.inject({
      method: "POST",
      url: "/api/conversations/conversation-harbor/generate",
      payload: {
        connectionId: "fake",
        participantId: "participant-harbor",
      },
    });
    expect(speakerInjection.statusCode).toBe(400);
    expect(context.store.listMessages("conversation-harbor")).toHaveLength(
      before,
    );
    const response = await app.inject({
      method: "POST",
      url: "/api/conversations/conversation-harbor/generate",
      payload: { connectionId: "fake" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.body).toContain('"type":"text-delta"');
    expect(response.body).toContain('"type":"message-persisted"');
    expect(context.store.listMessages("conversation-harbor")).toHaveLength(
      before + 1,
    );
    expect(
      context.store.listMessages("conversation-harbor").at(-1),
    ).toMatchObject({ role: "assistant", participantId: null });
  });

  it("returns 404 for the removed standalone planning endpoints", async () => {
    const { app } = await application();
    const removed = [
      { method: "POST" as const, url: "/api/agent/runs" },
      { method: "POST" as const, url: "/api/agent/runs/run-old/plan" },
      { method: "POST" as const, url: "/api/agent/runs/run-old/complete" },
      { method: "GET" as const, url: "/api/agent/tools" },
      { method: "GET" as const, url: "/api/agent/audit" },
    ];
    for (const request of removed) {
      const response = await app.inject(request);
      expect(response.statusCode, request.url).toBe(404);
    }
  });

  it("enforces entry permission, confirmation, audit, idempotency and undo", async () => {
    const { app, context } = await application();
    const run = context.agents.createRun({
      id: "run-e2e",
      conversationId: "conversation-harbor",
      requestedBy: "local-user",
      provider: "fake",
      model: "fake-model",
      objective: "Remember the late bell.",
      idempotencyKey: "run-e2e-key",
    }).run;
    context.agents.transitionRun(run.id, ["queued"], "running", {
      currentStep: 1,
    });

    let worldbook = context.store.getWorldbook("worldbook-harbor");
    let entry = context.store.getWorldbookEntry("entry-clocktower");
    const originalContent = entry.content;
    const blocked = await app.inject({
      method: "POST",
      url: "/api/agent/runs/run-e2e/tools",
      payload: {
        idempotencyKey: "blocked",
        toolName: "worldbook.entry.update",
        arguments: {
          worldbookId: worldbook.id,
          entryId: entry.id,
          expectedRevision: worldbook.revision,
          expectedEntryRevision: entry.revision,
          patch: { content: "blocked" },
        },
        confirmed: true,
      },
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json()).toMatchObject({
      error: { code: "WORLD_BOOK_ENTRY_NOT_AGENT_EDITABLE" },
    });
    expect(context.store.getWorldbookEntry(entry.id).content).toBe(
      originalContent,
    );

    const permission = await app.inject({
      method: "PATCH",
      url:
        `/api/worldbooks/${worldbook.id}/entries/` + `${entry.id}/permission`,
      payload: {
        agentEditable: true,
        expectedWorldbookRevision: worldbook.revision,
        expectedEntryRevision: entry.revision,
      },
    });
    expect(permission.statusCode).toBe(200);
    expect(permission.json()).toMatchObject({
      data: {
        worldbook: {
          id: worldbook.id,
          revision: worldbook.revision + 1,
          entries: [
            expect.objectContaining({
              id: entry.id,
              agentEditable: true,
              revision: entry.revision + 1,
            }),
          ],
        },
      },
    });
    worldbook = context.store.getWorldbook(worldbook.id);
    entry = context.store.getWorldbookEntry(entry.id);

    const proposed = await app.inject({
      method: "POST",
      url: "/api/agent/runs/run-e2e/tools",
      payload: {
        idempotencyKey: "update-bell",
        toolName: "worldbook.entry.update",
        arguments: {
          worldbookId: worldbook.id,
          entryId: entry.id,
          expectedRevision: worldbook.revision,
          expectedEntryRevision: entry.revision,
          patch: {
            title: "Late bell",
            keys: ["bell"],
            content: "The clocktower bell can ring one beat late.",
          },
        },
      },
    });
    expect(proposed.json()).toMatchObject({
      data: { call: { status: "awaiting_confirmation" } },
    });

    const applied = await app.inject({
      method: "POST",
      url: "/api/agent/runs/run-e2e/tools",
      payload: {
        idempotencyKey: "update-bell",
        toolName: "worldbook.entry.update",
        arguments: {
          worldbookId: worldbook.id,
          entryId: entry.id,
          expectedRevision: worldbook.revision,
          expectedEntryRevision: entry.revision,
          patch: {
            title: "Late bell",
            keys: ["bell"],
            content: "The clocktower bell can ring one beat late.",
          },
        },
        confirmed: true,
      },
    });
    expect(applied.json()).toMatchObject({
      data: { call: { status: "succeeded" } },
    });
    const auditId = (
      applied.json() as { data: { result: { auditId: string } } }
    ).data.result.auditId;
    const replayed = await app.inject({
      method: "POST",
      url: "/api/agent/runs/run-e2e/tools",
      payload: {
        idempotencyKey: "update-bell",
        toolName: "worldbook.entry.update",
        arguments: {},
        confirmed: true,
      },
    });
    expect(replayed.json()).toMatchObject({ data: { replayed: true } });

    const undone = await app.inject({
      method: "POST",
      url: "/api/agent/runs/run-e2e/tools",
      payload: {
        idempotencyKey: "undo-bell",
        toolName: "agent.change.undo",
        arguments: { auditId },
        confirmed: true,
      },
    });
    expect(undone.json()).toMatchObject({
      data: { call: { status: "succeeded" } },
    });
    expect(context.store.getWorldbookEntry(entry.id).content).toBe(
      originalContent,
    );
  });

  it("stores Provider keys only in the server vault and never returns them", async () => {
    const { app, dataDirectory } = await application(false);
    const response = await app.inject({
      method: "POST",
      url: "/api/providers/connections",
      payload: {
        name: "Local compatible endpoint",
        protocol: "openai-compatible",
        baseUrl: "http://127.0.0.1:1234/v1",
        model: "local-model",
        apiKey: "server-only-secret",
        nativeToolCalling: true,
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.body).not.toContain("server-only-secret");
    expect(response.json()).toMatchObject({
      data: { hasApiKey: true, nativeToolCalling: true },
    });
    const file = path.join(dataDirectory, "provider-secrets.json");
    expect(await readFile(file, "utf8")).toContain("server-only-secret");
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it("exports Provider connections without secrets by default and includes them only on request", async () => {
    const { app } = await application(false);
    const createdResponse = await app.inject({
      method: "POST",
      url: "/api/providers/connections",
      payload: {
        name: "Portable endpoint",
        protocol: "openai-responses",
        baseUrl: "https://example.test",
        model: "portable-model",
        headers: { "X-Provider": "portable" },
        apiKey: "portable-secret",
        nativeToolCalling: true,
      },
    });
    const created = createdResponse.json() as { data: { id: string } };

    const safeExport = await app.inject({
      method: "POST",
      url: `/api/providers/connections/${created.data.id}/export`,
      payload: { includeApiKey: false },
    });
    expect(safeExport.statusCode).toBe(200);
    expect(safeExport.headers["cache-control"]).toBe("no-store");
    expect(safeExport.body).not.toContain("portable-secret");
    expect(safeExport.json()).toMatchObject({
      data: {
        format: "sillytavern-n.provider-connection",
        version: 1,
        connection: {
          name: "Portable endpoint",
          protocol: "openai-responses",
          headers: { "X-Provider": "portable" },
        },
      },
    });

    const secretExport = await app.inject({
      method: "POST",
      url: `/api/providers/connections/${created.data.id}/export`,
      payload: { includeApiKey: true },
    });
    expect(secretExport.statusCode).toBe(200);
    expect(secretExport.headers["cache-control"]).toBe("no-store");
    expect(secretExport.json()).toMatchObject({
      data: { connection: { apiKey: "portable-secret" } },
    });
  });

  it("creates OpenAI Responses connections with native tools enabled by default", async () => {
    const { app, context } = await application(false);
    const response = await app.inject({
      method: "POST",
      url: "/api/providers/connections",
      payload: {
        name: "DeepSeek Responses",
        protocol: "openai-responses",
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-v4-flash",
      },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json() as {
      data: { id: string; protocol: string; nativeToolCalling: boolean };
    };
    expect(body).toMatchObject({
      data: {
        protocol: "openai-responses",
        nativeToolCalling: true,
      },
    });
    expect(context.store.getProviderConnection(body.data.id)).toMatchObject({
      protocol: "openai-responses",
      nativeToolCalling: true,
    });
  });

  it("keeps the existing Provider secret when a key PATCH has a stale revision", async () => {
    const { app, context, dataDirectory } = await application(false);
    const createdResponse = await app.inject({
      method: "POST",
      url: "/api/providers/connections",
      payload: {
        name: "Atomic endpoint",
        protocol: "openai-compatible",
        baseUrl: "http://127.0.0.1:1234/v1",
        model: "local-model",
        apiKey: "original-secret",
      },
    });
    const created = createdResponse.json() as {
      data: { id: string; revision: number };
    };
    const before = context.store.getProviderConnection(created.data.id);

    const stale = await app.inject({
      method: "PATCH",
      url: `/api/providers/connections/${created.data.id}`,
      payload: {
        expectedRevision: created.data.revision - 1,
        apiKey: "must-not-replace-original",
      },
    });

    expect(stale.statusCode).toBe(409);
    const after = context.store.getProviderConnection(created.data.id);
    expect(after.apiKeyRef).toBe(before.apiKeyRef);
    expect(await context.vault.get(after.apiKeyRef)).toBe("original-secret");
    const vaultFile = await readFile(
      path.join(dataDirectory, "provider-secrets.json"),
      "utf8",
    );
    expect(vaultFile).not.toContain("must-not-replace-original");
  });

  it("denies legacy RPC by default and keeps its actor permission separate", async () => {
    const { app } = await application(false);
    const rpc = {
      protocol: "stn.legacy.v1",
      id: "rpc-1",
      pluginId: "st-prompt-template",
      actor: "legacy-plugin",
      method: "settings.save",
      capability: "settings.write",
      params: { value: { template: "safe" } },
    };
    const denied = await app.inject({
      method: "POST",
      url: "/api/legacy/rpc",
      payload: rpc,
    });
    expect(denied.statusCode).toBe(403);

    const grant = await app.inject({
      method: "PUT",
      url: "/api/legacy/grants",
      payload: {
        pluginId: "st-prompt-template",
        capability: "settings.write",
        granted: true,
      },
    });
    expect(grant.statusCode).toBe(200);
    const allowed = await app.inject({
      method: "POST",
      url: "/api/legacy/rpc",
      payload: rpc,
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toMatchObject({ ok: true });

    const forgedActor = await app.inject({
      method: "POST",
      url: "/api/legacy/rpc",
      payload: { ...rpc, id: "rpc-actor-forgery", actor: "embedded-script" },
    });
    expect(forgedActor.statusCode).toBe(403);

    const substitutedCapability = await app.inject({
      method: "POST",
      url: "/api/legacy/rpc",
      payload: {
        ...rpc,
        id: "rpc-capability-substitution",
        method: "chat.message.send",
      },
    });
    expect(substitutedCapability.statusCode).toBe(403);

    const settingsReadGrant = await app.inject({
      method: "PUT",
      url: "/api/legacy/grants",
      payload: {
        pluginId: "st-prompt-template",
        capability: "settings.read",
        granted: true,
      },
    });
    expect(settingsReadGrant.statusCode).toBe(200);
    const loaded = await app.inject({
      method: "POST",
      url: "/api/legacy/rpc",
      payload: {
        ...rpc,
        id: "rpc-settings-load",
        method: "settings.load",
        capability: "settings.read",
        params: {},
      },
    });
    expect(loaded.statusCode).toBe(200);
    expect(loaded.json()).toMatchObject({
      ok: true,
      result: { template: "safe" },
    });
  });

  it("keeps Tavern Helper source out of legacy-plugin read projections", async () => {
    const { app, context } = await application(false);
    const helper = {
      scripts: [
        {
          type: "script",
          enabled: false,
          name: "Clean-room inert script",
          id: "fixture-script",
          content: "/* intentionally inert */",
          info: "",
          button: { enabled: false, buttons: [] },
          data: {},
          export_with: { data: true, button: true },
        },
      ],
      variables: { fixture: "value" },
    };
    const safeMetadata = { fixture: "retained for legacy plugins" };
    const sourceExtensions = {
      safe_metadata: safeMetadata,
      tavern_helper: helper,
      TavernHelper_scripts: helper.scripts,
      TavernHelper_characterScriptVariables: helper.variables,
      nested_legacy: {
        retained: true,
        tavern_helper: helper,
      },
    };
    const { card } = context.store.createCard({
      id: "card-helper-read",
      kind: "character",
      name: "Helper read fixture",
      legacyPayload: {
        normalized: { extensions: sourceExtensions },
      },
    });
    const conversation = context.store.createConversation({
      id: "conversation-helper-read",
      title: "Helper read",
      cardId: card.id,
    });
    const preset = context.store.createPreset({
      id: "preset-helper-read",
      name: "Helper preset",
      kind: "chat-completion",
      payload: {
        extensions: {
          legacySource: { extensions: sourceExtensions },
        },
      },
    });
    const rpc = (
      id: string,
      method: string,
      capability: string,
      params: unknown,
      actor: "legacy-plugin" | "embedded-script" = "legacy-plugin",
    ) => ({
      protocol: "stn.legacy.v1",
      id,
      pluginId: "js-slash-runner",
      actor,
      method,
      capability,
      params,
    });

    const denied = await app.inject({
      method: "POST",
      url: "/api/legacy/rpc",
      payload: rpc(
        "character-denied",
        "character.current.read",
        "character.read",
        { conversationId: conversation.id },
      ),
    });
    expect(denied.statusCode).toBe(403);

    for (const capability of ["character.read", "preset.read"]) {
      expect(
        await app.inject({
          method: "PUT",
          url: "/api/legacy/grants",
          payload: {
            pluginId: "js-slash-runner",
            capability,
            granted: true,
          },
        }),
      ).toMatchObject({ statusCode: 200 });
    }

    const character = await app.inject({
      method: "POST",
      url: "/api/legacy/rpc",
      payload: rpc(
        "character-read",
        "character.current.read",
        "character.read",
        { conversationId: conversation.id },
      ),
    });
    expect(character.json()).toMatchObject({
      ok: true,
      result: {
        id: card.id,
        chid: 0,
        character: {
          name: card.name,
          data: {
            extensions: {
              safe_metadata: safeMetadata,
              nested_legacy: { retained: true },
            },
          },
        },
      },
    });
    expect(
      (
        character.json() as {
          result: { character: { data: { extensions: unknown } } };
        }
      ).result.character.data.extensions,
    ).toEqual({
      safe_metadata: safeMetadata,
      nested_legacy: { retained: true },
    });
    expect(JSON.stringify(character.json())).not.toContain(
      "intentionally inert",
    );

    const presetRead = await app.inject({
      method: "POST",
      url: "/api/legacy/rpc",
      payload: rpc("preset-read", "preset.current.read", "preset.read", {
        presetId: preset.id,
      }),
    });
    expect(presetRead.json()).toMatchObject({
      ok: true,
      result: {
        id: preset.id,
        preset: {
          extensions: {
            safe_metadata: safeMetadata,
            nested_legacy: { retained: true },
          },
        },
      },
    });
    expect(
      (
        presetRead.json() as {
          result: { preset: { extensions: unknown } };
        }
      ).result.preset.extensions,
    ).toEqual({
      safe_metadata: safeMetadata,
      nested_legacy: { retained: true },
    });
    expect(JSON.stringify(presetRead.json())).not.toContain(
      "intentionally inert",
    );

    expect(
      (
        context.store.getCard(card.id).legacyPayload.normalized as {
          extensions: typeof sourceExtensions;
        }
      ).extensions,
    ).toEqual(sourceExtensions);
    expect(
      (
        context.store.getPreset(preset.id).payload.extensions as {
          legacySource: { extensions: typeof sourceExtensions };
        }
      ).legacySource.extensions,
    ).toEqual(sourceExtensions);

    await app.inject({
      method: "PUT",
      url: "/api/legacy/grants",
      payload: {
        pluginId: "js-slash-runner",
        actor: "embedded-script",
        capability: "character.read",
        granted: true,
      },
    });
    const scriptActor = await app.inject({
      method: "POST",
      url: "/api/legacy/rpc",
      payload: rpc(
        "character-script-actor",
        "character.scripts.read",
        "character.read",
        { conversationId: conversation.id },
        "embedded-script",
      ),
    });
    expect(scriptActor.statusCode).toBe(200);
    expect(scriptActor.json()).toMatchObject({
      ok: true,
      result: {
        id: card.id,
        extensions: {
          tavern_helper: helper,
          TavernHelper_scripts: helper.scripts,
          TavernHelper_characterScriptVariables: helper.variables,
        },
      },
    });
    expect(JSON.stringify(scriptActor.json())).toContain("intentionally inert");

    const forgedPluginActor = await app.inject({
      method: "POST",
      url: "/api/legacy/rpc",
      payload: rpc(
        "character-script-forged-plugin",
        "character.scripts.read",
        "character.read",
        { conversationId: conversation.id },
      ),
    });
    expect(forgedPluginActor.statusCode).toBe(403);
  });
});
