import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { AgentStore } from "./agent-store.js";
import { AppDatabase } from "./database.js";
import { AppStore } from "./store.js";

function createConversationFixture(store: AppStore) {
  const card = store.createCard({
    id: "card-1",
    kind: "ensemble",
    name: "A neutral scene",
    participants: [
      { id: "participant-user", name: "User", role: "user" },
      { id: "participant-a", name: "Participant A" },
    ],
  });
  const conversation = store.createConversation({
    id: "conversation-1",
    title: "Conversation",
    cardId: card.card.id,
  });
  const first = store.addUserMessage({
    id: "message-1",
    conversationId: conversation.id,
    content: "Remember the tide.",
  });
  const second = store.addAssistantMessage({
    id: "message-2",
    conversationId: conversation.id,
    parentMessageId: first.id,
    participantId: "participant-a",
    content: "The tide changed at dusk.",
  });
  return { card, conversation, first, second };
}

describe("AppStore", () => {
  it("stores OpenAI Responses connections and preserves them through v11 rebuild", () => {
    const store = new AppStore();
    try {
      const created = store.createProviderConnection({
        id: "provider-responses",
        name: "DeepSeek Responses",
        protocol: "openai-responses",
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-v4-flash",
        headers: { "X-Test": "fixture" },
        apiKeyRef: "provider-secret",
        nativeToolCalling: true,
      });
      expect(created).toMatchObject({
        id: "provider-responses",
        protocol: "openai-responses",
        headers: { "X-Test": "fixture" },
        apiKeyRef: "provider-secret",
        nativeToolCalling: true,
      });
      expect(
        store.database.get<{ version: number }>(
          "SELECT version FROM schema_migrations WHERE version = 11",
        ),
      ).toEqual({ version: 11 });
      expect(
        store.database.get<{ sql: string }>(
          "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'provider_connections'",
        )?.sql,
      ).toContain("openai-responses");
      expect(store.getProviderConnection(created.id)).toMatchObject(created);
    } finally {
      store.close();
    }
  });

  it("prunes orphan Tavern Helper floor variables during migration", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "stn-variable-prune-"));
    const databasePath = path.join(directory, "workspace.sqlite");
    const initialStore = new AppStore(new AppDatabase({ path: databasePath }));
    try {
      const { first } = createConversationFixture(initialStore);
      const swipe = initialStore.addSwipe({
        id: "swipe-live-variable",
        messageId: first.id,
        content: "Live swipe.",
      });
      initialStore.setExtensionSetting(
        "stn.tavern-helper",
        `variables:message:${first.id}`,
        { live: true },
      );
      initialStore.setExtensionSetting(
        "stn.tavern-helper",
        `variables:swipe:${swipe.id}`,
        { live: true },
      );
      initialStore.setExtensionSetting(
        "stn.tavern-helper",
        "variables:message:missing-message",
        { orphan: true },
      );
      initialStore.setExtensionSetting(
        "stn.tavern-helper",
        "variables:swipe:missing-swipe",
        { orphan: true },
      );
      initialStore.database.run(
        "DELETE FROM schema_migrations WHERE version = 15",
      );
    } finally {
      initialStore.close();
    }

    const migratedStore = new AppStore(new AppDatabase({ path: databasePath }));
    try {
      expect(
        migratedStore.database.get<{ count: number }>(
          `SELECT COUNT(*) AS count
           FROM extension_settings
           WHERE extension_id = 'stn.tavern-helper'
             AND key IN (?, ?)`,
          "variables:message:missing-message",
          "variables:swipe:missing-swipe",
        )?.count,
      ).toBe(0);
      expect(
        migratedStore.getExtensionSetting(
          "stn.tavern-helper",
          "variables:message:message-1",
        ).value,
      ).toEqual({ live: true });
      expect(
        migratedStore.getExtensionSetting(
          "stn.tavern-helper",
          "variables:swipe:swipe-live-variable",
        ).value,
      ).toEqual({ live: true });
    } finally {
      migratedStore.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("copies legacy provider rows when applying v10 to v11", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "stn-provider-v11-"));
    const databasePath = path.join(directory, "legacy.sqlite");
    const legacy = new DatabaseSync(databasePath, {
      enableForeignKeyConstraints: true,
    });
    try {
      legacy.exec(`
        CREATE TABLE schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TEXT NOT NULL
        );
        INSERT INTO schema_migrations(version, name, applied_at)
        VALUES
          (1, 'v1', '2026-01-01T00:00:00.000Z'),
          (2, 'v2', '2026-01-01T00:00:00.000Z'),
          (3, 'v3', '2026-01-01T00:00:00.000Z'),
          (4, 'v4', '2026-01-01T00:00:00.000Z'),
          (5, 'v5', '2026-01-01T00:00:00.000Z'),
          (6, 'v6', '2026-01-01T00:00:00.000Z'),
          (7, 'v7', '2026-01-01T00:00:00.000Z'),
          (8, 'v8', '2026-01-01T00:00:00.000Z'),
          (9, 'v9', '2026-01-01T00:00:00.000Z'),
          (10, 'v10', '2026-01-01T00:00:00.000Z');
        CREATE TABLE provider_connections (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          protocol TEXT NOT NULL CHECK (
            protocol IN ('openai-compatible','text-completion','fake')
          ),
          base_url TEXT NOT NULL,
          model TEXT NOT NULL,
          headers_json TEXT NOT NULL DEFAULT '{}',
          api_key_ref TEXT,
          native_tool_calling INTEGER NOT NULL DEFAULT 0 CHECK (native_tool_calling IN (0,1)),
          revision INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE messages (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          parent_message_id TEXT,
          role TEXT NOT NULL,
          participant_id TEXT,
          content TEXT NOT NULL,
          revision INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          generation_status TEXT NOT NULL DEFAULT 'complete',
          finish_reason TEXT,
          provider_error_code TEXT
        );
        INSERT INTO provider_connections(
          id, name, protocol, base_url, model, headers_json, api_key_ref,
          native_tool_calling, revision, created_at, updated_at
        ) VALUES (
          'legacy-provider', 'Legacy', 'openai-compatible', 'http://legacy/v1',
          'legacy-model', '{"X-Test":"keep"}', 'provider:legacy', 1, 7,
          '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z'
        );
      `);
    } finally {
      legacy.close();
    }
    const database = new AppDatabase({ path: databasePath });
    try {
      expect(
        database.get<{
          id: string;
          protocol: string;
          headers_json: string;
          api_key_ref: string;
          revision: number;
        }>(
          "SELECT * FROM provider_connections WHERE id = ?",
          "legacy-provider",
        ),
      ).toMatchObject({
        id: "legacy-provider",
        protocol: "openai-compatible",
        headers_json: '{"X-Test":"keep"}',
        api_key_ref: "provider:legacy",
        revision: 7,
      });
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("creates, switches and deletes user personas without leaving chat bindings", () => {
    const store = new AppStore();
    try {
      const first = store.createPersona({
        id: "persona-first",
        name: "First user",
        description: "First description",
        isDefault: true,
      });
      const second = store.createPersona({
        id: "persona-second",
        name: "Second user",
        description: "Second description",
      });
      const card = store.createCard({
        id: "card-persona",
        kind: "character",
        name: "Persona card",
      }).card;
      const conversation = store.createConversation({
        id: "conversation-persona",
        title: "Persona chat",
        cardId: card.id,
      });

      expect(conversation.personaId).toBe(first.id);
      const defaultSecond = store.updatePersona({
        id: second.id,
        expectedRevision: second.revision,
        patch: { isDefault: true },
      });
      expect(defaultSecond.isDefault).toBe(true);
      expect(store.getPersona(first.id).isDefault).toBe(false);

      const switched = store.setConversationPersona({
        id: conversation.id,
        personaId: second.id,
        expectedRevision: conversation.revision,
      });
      expect(switched.personaId).toBe(second.id);

      store.deletePersona(second.id, defaultSecond.revision);
      expect(store.getConversation(conversation.id).personaId).toBeNull();
    } finally {
      store.close();
    }
  });

  it("requires a card, groups histories by card and resolves card participants dynamically", () => {
    const store = new AppStore();
    try {
      const firstCard = store.createCard({
        id: "card-history-a",
        kind: "character",
        name: "Card A",
        participants: [
          {
            id: "participant-history-a",
            name: "Initial participant",
          },
        ],
      }).card;
      const secondCard = store.createCard({
        id: "card-history-b",
        kind: "world",
        name: "Card B",
      }).card;
      const firstConversation = store.createConversation({
        id: "conversation-history-a",
        title: "First history",
        cardId: firstCard.id,
      });
      store.createConversation({
        id: "conversation-history-b",
        title: "Second history",
        cardId: secondCard.id,
      });

      expect(store.listCardConversations(firstCard.id)).toEqual([
        expect.objectContaining({
          id: firstConversation.id,
          cardId: firstCard.id,
        }),
      ]);
      expect(store.listCardConversations(secondCard.id)).toEqual([
        expect.objectContaining({ cardId: secondCard.id }),
      ]);
      expect(
        store.database.get<{ count: number }>(
          `SELECT COUNT(*) AS count
           FROM conversation_participants
           WHERE conversation_id = ?`,
          firstConversation.id,
        )?.count,
      ).toBe(0);

      store.createParticipant({
        id: "participant-history-later",
        cardId: firstCard.id,
        name: "Added later",
      });
      expect(
        store
          .listConversationParticipants(firstConversation.id)
          .map((participant) => participant.id),
      ).toEqual(["participant-history-a", "participant-history-later"]);

      expect(() =>
        store.database.run(
          `INSERT INTO conversations(
             id, title, card_id, revision, created_at, updated_at
           ) VALUES (?, ?, NULL, 1, ?, ?)`,
          "conversation-unbound",
          "Unbound",
          "2026-07-29T00:00:00.000Z",
          "2026-07-29T00:00:00.000Z",
        ),
      ).toThrow(/conversation card_id is required/u);
      expect(() => store.deleteCard(firstCard.id, firstCard.revision)).toThrow(
        expect.objectContaining({ code: "card_has_conversations" }),
      );
    } finally {
      store.close();
    }
  });

  it("stores ordinary chat as user and assistant messages only", () => {
    const store = new AppStore();
    try {
      const { conversation, first, second } = createConversationFixture(store);
      expect(first).toMatchObject({ role: "user", participantId: null });
      expect(second).toMatchObject({
        role: "assistant",
        participantId: "participant-a",
      });
      store.database.run(
        "UPDATE messages SET created_at = ? WHERE id = ?",
        "2026-07-30T00:00:00.000Z",
        first.id,
      );
      store.database.run(
        "UPDATE messages SET created_at = ? WHERE id = ?",
        "2026-07-29T00:00:00.000Z",
        second.id,
      );
      expect(store.listChatMessages(conversation.id)).toEqual([
        expect.objectContaining({ id: first.id, role: "user" }),
        expect.objectContaining({ id: second.id, role: "assistant" }),
      ]);
      expect(() =>
        store.database.run(
          `INSERT INTO messages(
             id, conversation_id, role, participant_id, content,
             revision, created_at, updated_at
           ) VALUES (?, ?, 'narrator', NULL, '', 1, ?, ?)`,
          "message-narrator",
          conversation.id,
          new Date().toISOString(),
          new Date().toISOString(),
        ),
      ).toThrow();
    } finally {
      store.close();
    }
  });

  it("cascade-deletes a card with its chats, exclusive worldbooks and compatibility state", () => {
    const store = new AppStore();
    try {
      const { card, conversation, first } = createConversationFixture(store);
      const exclusiveWorldbook = store.createWorldbook({
        id: "worldbook-card-owned",
        name: "Card owned lore",
      });
      store.bindWorldbook({
        worldbookId: exclusiveWorldbook.id,
        scopeType: "card",
        scopeId: card.card.id,
      });
      store.bindWorldbook({
        worldbookId: exclusiveWorldbook.id,
        scopeType: "conversation",
        scopeId: conversation.id,
      });
      const sharedWorldbook = store.createWorldbook({
        id: "worldbook-shared",
        name: "Shared lore",
      });
      store.bindWorldbook({
        worldbookId: sharedWorldbook.id,
        scopeType: "card",
        scopeId: card.card.id,
      });
      store.bindWorldbook({
        worldbookId: sharedWorldbook.id,
        scopeType: "global",
      });
      store.createArtifact({
        kind: "chat_summary",
        scopeType: "conversation",
        scopeId: conversation.id,
        content: "summary",
      });
      store.setExtensionSetting("stn.regex", `card:${card.card.id}`, true);
      store.setExtensionSetting(
        "stn.tavern-helper",
        `variables:card:${card.card.id}`,
        { cardValue: 1 },
      );
      store.setExtensionSetting(
        "stn.tavern-helper",
        `variables:conversation:${conversation.id}`,
        { chatValue: 1 },
      );
      store.setExtensionSetting(
        "stn.tavern-helper",
        `variables:message:${first.id}`,
        { messageValue: 1 },
      );
      store.setExtensionSetting(
        "stn.tavern-helper",
        "variables:swipe:swipe-delete",
        { swipeValue: 1 },
      );
      store.setExtensionSetting(
        "stn.tavern-helper",
        `variables:script:card:${card.card.id}:fixture`,
        { scriptValue: 1 },
      );

      const deleted = store.deleteCardCascade(card.card.id, card.card.revision);

      expect(deleted).toMatchObject({
        card: { id: card.card.id },
        conversationIds: [conversation.id],
        worldbookIds: [exclusiveWorldbook.id],
      });
      expect(store.listCards()).toEqual([]);
      expect(store.listConversations()).toEqual([]);
      expect(store.listWorldbooks()).toEqual([
        expect.objectContaining({ id: sharedWorldbook.id }),
      ]);
      expect(store.listArtifacts()).toEqual([]);
      expect(
        store.database.get<{ count: number }>(
          `SELECT COUNT(*) AS count
           FROM extension_settings
           WHERE key LIKE ? OR key = ?`,
          `%${card.card.id}%`,
          `variables:conversation:${conversation.id}`,
        )?.count,
      ).toBe(0);
    } finally {
      store.close();
    }
  });

  it("atomically replaces a card's worldbook combination", () => {
    const store = new AppStore();
    try {
      const card = store.createCard({
        id: "card-worldbook-combination",
        kind: "character",
        name: "Combination card",
      }).card;
      const first = store.createWorldbook({
        id: "worldbook-combination-first",
        name: "First lore",
      });
      const second = store.createWorldbook({
        id: "worldbook-combination-second",
        name: "Second lore",
      });
      store.bindWorldbook({
        worldbookId: first.id,
        scopeType: "card",
        scopeId: card.id,
      });

      expect(
        store
          .replaceCardWorldbooks({
            cardId: card.id,
            expectedWorldbookIds: [first.id],
            worldbookIds: [second.id],
          })
          .map((binding) => binding.worldbookId),
      ).toEqual([second.id]);
      expect(
        store
          .listWorldbooks()
          .map((worldbook) => worldbook.id)
          .sort(),
      ).toEqual([first.id, second.id].sort());
      expect(() =>
        store.replaceCardWorldbooks({
          cardId: card.id,
          expectedWorldbookIds: [first.id],
          worldbookIds: [first.id, second.id],
        }),
      ).toThrow(/changed concurrently/u);
    } finally {
      store.close();
    }
  });

  it("deletes a preset with its regex, scripts, variables and artifacts", () => {
    const store = new AppStore();
    try {
      const preset = store.createPreset({
        id: "preset-delete",
        name: "Delete me",
        kind: "chat-completion",
      });
      store.createArtifact({
        kind: "preset_note",
        scopeType: "preset",
        scopeId: preset.id,
        content: "note",
      });
      store.setExtensionSetting("stn.regex", `preset:${preset.id}`, true);
      store.setExtensionSetting(
        "stn.tavern-helper",
        `variables:preset:${preset.id}`,
        { presetValue: 1 },
      );
      store.setExtensionSetting(
        "stn.tavern-helper",
        `variables:script:preset:${preset.id}:fixture`,
        { scriptValue: 1 },
      );

      expect(store.deletePreset(preset.id, preset.revision)).toMatchObject({
        id: preset.id,
      });
      expect(store.listPresets()).toEqual([]);
      expect(store.listArtifacts()).toEqual([]);
      expect(
        store.database.get<{ count: number }>(
          "SELECT COUNT(*) AS count FROM extension_settings WHERE key LIKE ?",
          `%${preset.id}%`,
        )?.count,
      ).toBe(0);
    } finally {
      store.close();
    }
  });

  it("deletes a conversation with its messages, variables, artifacts and exclusive worldbooks", () => {
    const store = new AppStore();
    try {
      const { card, conversation, first } = createConversationFixture(store);
      const otherConversation = store.createConversation({
        id: "conversation-keep",
        title: "Keep this conversation",
        cardId: card.card.id,
      });
      const otherMessage = store.addUserMessage({
        id: "message-keep",
        conversationId: otherConversation.id,
        content: "Keep this message.",
      });
      const exclusiveWorldbook = store.createWorldbook({
        id: "worldbook-conversation-owned",
        name: "Conversation-owned lore",
      });
      store.bindWorldbook({
        worldbookId: exclusiveWorldbook.id,
        scopeType: "conversation",
        scopeId: conversation.id,
      });
      const sharedWorldbook = store.createWorldbook({
        id: "worldbook-conversation-shared",
        name: "Shared conversation lore",
      });
      store.bindWorldbook({
        worldbookId: sharedWorldbook.id,
        scopeType: "conversation",
        scopeId: conversation.id,
      });
      store.bindWorldbook({
        worldbookId: sharedWorldbook.id,
        scopeType: "global",
      });
      store.addSwipe({
        id: "swipe-delete",
        messageId: first.id,
        content: "Alternative that should be deleted.",
        selected: true,
      });
      store.createArtifact({
        kind: "chat_summary",
        scopeType: "conversation",
        scopeId: conversation.id,
        content: "Conversation summary.",
      });
      store.createArtifact({
        kind: "message_variables",
        scopeType: "message",
        scopeId: first.id,
        content: "Message artifact.",
      });
      store.createArtifact({
        kind: "chat_summary",
        scopeType: "conversation",
        scopeId: otherConversation.id,
        content: "Keep summary.",
      });
      store.setExtensionSetting(
        "stn.tavern-helper",
        `variables:conversation:${conversation.id}`,
        { chatValue: 1 },
      );
      store.setExtensionSetting(
        "stn.tavern-helper",
        `variables:message:${first.id}`,
        { messageValue: 1 },
      );
      store.setExtensionSetting(
        "stn.tavern-helper",
        `variables:conversation:${otherConversation.id}`,
        { keepValue: 1 },
      );
      store.setExtensionSetting(
        "stn.tavern-helper",
        `variables:message:${otherMessage.id}`,
        { keepMessageValue: 1 },
      );

      const deleted = store.deleteConversation(
        conversation.id,
        store.getConversation(conversation.id).revision,
      );

      expect(deleted.id).toBe(conversation.id);
      expect(store.listConversations()).toEqual([
        expect.objectContaining({ id: otherConversation.id }),
      ]);
      expect(store.listWorldbooks()).toEqual([
        expect.objectContaining({ id: sharedWorldbook.id }),
      ]);
      expect(
        store.database.get<{ count: number }>(
          "SELECT COUNT(*) AS count FROM messages WHERE conversation_id = ?",
          conversation.id,
        )?.count,
      ).toBe(0);
      expect(
        store.database.get<{ count: number }>(
          "SELECT COUNT(*) AS count FROM swipes WHERE message_id = ?",
          first.id,
        )?.count,
      ).toBe(0);
      expect(
        store.database.get<{ count: number }>(
          "SELECT COUNT(*) AS count FROM artifacts WHERE scope_id IN (?, ?)",
          conversation.id,
          first.id,
        )?.count,
      ).toBe(0);
      expect(
        store.database.get<{ count: number }>(
          `SELECT COUNT(*) AS count
           FROM extension_settings
           WHERE key IN (?, ?, ?, ?)`,
          `variables:conversation:${conversation.id}`,
          `variables:message:${first.id}`,
          "variables:swipe:swipe-delete",
          `variables:conversation:${otherConversation.id}`,
        )?.count,
      ).toBe(1);
      expect(
        store.getExtensionSetting(
          "stn.tavern-helper",
          `variables:message:${otherMessage.id}`,
        ).value,
      ).toEqual({ keepMessageValue: 1 });
    } finally {
      store.close();
    }
  });

  it("deletes a message and every later floor with their associated data", () => {
    const store = new AppStore();
    try {
      const { conversation, first, second } = createConversationFixture(store);
      const swipe = store.addSwipe({
        id: "swipe-message-delete",
        messageId: first.id,
        content: "Alternative response.",
      });
      const laterSwipe = store.addSwipe({
        id: "swipe-later-message-delete",
        messageId: second.id,
        content: "Later alternative response.",
      });
      store.createArtifact({
        kind: "message_variables",
        scopeType: "message",
        scopeId: first.id,
        content: "Delete this artifact.",
      });
      store.createArtifact({
        kind: "message_variables",
        scopeType: "message",
        scopeId: second.id,
        content: "Keep this artifact.",
      });
      store.setExtensionSetting(
        "stn.tavern-helper",
        `variables:message:${first.id}`,
        { deleteMessageValue: 1 },
      );
      store.setExtensionSetting(
        "stn.tavern-helper",
        `variables:swipe:${swipe.id}`,
        { deleteSwipeValue: 1 },
      );
      store.setExtensionSetting(
        "stn.tavern-helper",
        `variables:message:${second.id}`,
        { deleteLaterMessageValue: 1 },
      );
      store.setExtensionSetting(
        "stn.tavern-helper",
        `variables:swipe:${laterSwipe.id}`,
        { deleteLaterSwipeValue: 1 },
      );

      expect(
        store.deleteMessage(first.id, store.getMessage(first.id).revision),
      ).toMatchObject({
        id: first.id,
        conversationId: conversation.id,
      });

      expect(store.listMessages(conversation.id)).toEqual([]);
      expect(
        store.database.get<{ count: number }>(
          "SELECT COUNT(*) AS count FROM artifacts WHERE scope_type = 'message' AND scope_id = ?",
          first.id,
        )?.count,
      ).toBe(0);
      expect(store.listArtifacts()).toEqual([]);
      expect(
        store.database.get<{ count: number }>(
          `SELECT COUNT(*) AS count
           FROM extension_settings
           WHERE extension_id = 'stn.tavern-helper'
             AND key IN (?, ?, ?, ?)`,
          `variables:message:${first.id}`,
          `variables:swipe:${swipe.id}`,
          `variables:message:${second.id}`,
          `variables:swipe:${laterSwipe.id}`,
        )?.count,
      ).toBe(0);
    } finally {
      store.close();
    }
  });

  it("keeps every floor before the deleted message", () => {
    const store = new AppStore();
    try {
      const { conversation, first, second } = createConversationFixture(store);

      store.deleteMessage(second.id, second.revision);

      expect(store.listMessages(conversation.id)).toEqual([
        expect.objectContaining({ id: first.id }),
      ]);
    } finally {
      store.close();
    }
  });

  it("migrates persisted narrator rows to assistant without losing swipes", () => {
    const directory = mkdtempSync(
      path.join(tmpdir(), "stn-message-migration-"),
    );
    const databasePath = path.join(directory, "legacy.sqlite");
    const legacy = new DatabaseSync(databasePath, {
      enableForeignKeyConstraints: true,
    });
    try {
      legacy.exec(`
        CREATE TABLE schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TEXT NOT NULL
        );
        INSERT INTO schema_migrations(version, name, applied_at)
        VALUES
          (1, 'legacy-1', '2026-01-01T00:00:00.000Z'),
          (2, 'legacy-2', '2026-01-01T00:00:00.000Z'),
          (3, 'legacy-3', '2026-01-01T00:00:00.000Z'),
          (4, 'legacy-4', '2026-01-01T00:00:00.000Z'),
          (5, 'legacy-5', '2026-01-01T00:00:00.000Z');

        CREATE TABLE conversations (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          card_id TEXT,
          revision INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE participants (
          id TEXT PRIMARY KEY,
          card_id TEXT,
          name TEXT NOT NULL,
          role TEXT NOT NULL,
          profile_json TEXT NOT NULL DEFAULT '{}',
          legacy_payload_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE messages (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          parent_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
          role TEXT NOT NULL CHECK (role IN ('system','user','assistant','narrator','tool')),
          participant_id TEXT REFERENCES participants(id) ON DELETE SET NULL,
          content TEXT NOT NULL,
          revision INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX messages_conversation_idx
          ON messages(conversation_id, created_at);
        CREATE TABLE swipes (
          id TEXT PRIMARY KEY,
          message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
          position INTEGER NOT NULL,
          content TEXT NOT NULL,
          selected INTEGER NOT NULL DEFAULT 0 CHECK (selected IN (0,1)),
          revision INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (message_id, position)
        );
        CREATE TABLE worldbooks (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          agent_editable INTEGER NOT NULL DEFAULT 0
            CHECK (agent_editable IN (0,1)),
          revision INTEGER NOT NULL DEFAULT 1,
          legacy_payload_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          permission_updated_by TEXT,
          permission_updated_at TEXT,
          agent_write_mode TEXT NOT NULL DEFAULT 'confirm'
            CHECK (agent_write_mode IN ('confirm','auto-create-update'))
        );
        CREATE TABLE worldbook_bindings (
          id TEXT PRIMARY KEY,
          worldbook_id TEXT NOT NULL REFERENCES worldbooks(id) ON DELETE CASCADE,
          scope_type TEXT NOT NULL,
          scope_id TEXT,
          created_at TEXT NOT NULL
        );
        CREATE TABLE worldbook_entries (
          id TEXT PRIMARY KEY,
          worldbook_id TEXT NOT NULL
            REFERENCES worldbooks(id) ON DELETE CASCADE,
          legacy_uid INTEGER,
          keys_json TEXT NOT NULL DEFAULT '[]',
          content TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
          position INTEGER NOT NULL DEFAULT 0,
          revision INTEGER NOT NULL DEFAULT 1,
          metadata_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        INSERT INTO conversations(
          id, title, card_id, revision, created_at, updated_at
        ) VALUES (
          'conversation-legacy', 'Legacy', 'card-legacy', 1,
          '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
        );
        INSERT INTO participants(
          id, card_id, name, role, profile_json, legacy_payload_json,
          created_at, updated_at
        ) VALUES (
          'participant-narrator', NULL, 'Narrator', 'narrator', '{}', '{}',
          '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
        );
        INSERT INTO messages(
          id, conversation_id, parent_message_id, role, participant_id,
          content, revision, created_at, updated_at
        ) VALUES (
          'message-legacy', 'conversation-legacy', NULL, 'narrator',
          'participant-narrator', 'Narrated body', 2,
          '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
        );
        INSERT INTO swipes(
          id, message_id, position, content, selected, revision,
          created_at, updated_at
        ) VALUES (
          'swipe-legacy', 'message-legacy', 0, 'Alternate body', 1, 1,
          '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
        );
      `);
    } finally {
      legacy.close();
    }

    const store = new AppStore(new AppDatabase({ path: databasePath }));
    try {
      expect(store.getMessage("message-legacy")).toMatchObject({
        role: "assistant",
        participantId: "participant-narrator",
        content: "Narrated body",
      });
      expect(store.listSwipes("message-legacy")).toEqual([
        expect.objectContaining({
          id: "swipe-legacy",
          content: "Alternate body",
          selected: true,
        }),
      ]);
      expect(store.database.all("PRAGMA foreign_key_check")).toEqual([]);
    } finally {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("keeps internal messages out of ordinary chat and validates assistant attribution", () => {
    const store = new AppStore();
    try {
      const { conversation } = createConversationFixture(store);
      const internal = store.addInternalMessage({
        id: "message-system",
        conversationId: conversation.id,
        role: "system",
        content: "Internal instruction",
      });
      expect(store.listMessages(conversation.id)).toContainEqual(
        expect.objectContaining({ id: internal.id, role: "system" }),
      );
      expect(store.listChatMessages(conversation.id)).not.toContainEqual(
        expect.objectContaining({ id: internal.id }),
      );
      expect(() =>
        store.updateMessage({
          id: internal.id,
          expectedRevision: internal.revision,
          content: "Public edit",
        }),
      ).toThrowError(
        expect.objectContaining({ code: "internal_message_not_editable" }),
      );
      expect(() =>
        store.addAssistantMessage({
          conversationId: conversation.id,
          participantId: "participant-user",
          content: "Invalid attribution",
        }),
      ).toThrowError(
        expect.objectContaining({ code: "invalid_assistant_attribution" }),
      );
    } finally {
      store.close();
    }
  });

  it("keeps the selected swipe aligned when a chat message is edited", () => {
    const store = new AppStore();
    try {
      const { second } = createConversationFixture(store);
      const selected = store.addSwipe({
        id: "swipe-selected",
        messageId: second.id,
        content: "Selected alternate body.",
        selected: true,
      });
      store.addSwipe({
        id: "swipe-unselected",
        messageId: second.id,
        content: "Unselected alternate body.",
        selected: false,
      });
      const current = store.getMessage(second.id);

      const updated = store.updateMessage({
        id: current.id,
        expectedRevision: current.revision,
        content: "Selected alternate body.\n\n<StatusPlaceHolderImpl/>",
      });

      expect(updated.content).toContain("<StatusPlaceHolderImpl/>");
      expect(store.listSwipes(second.id)).toEqual([
        expect.objectContaining({
          id: selected.id,
          content: "Selected alternate body.\n\n<StatusPlaceHolderImpl/>",
          selected: true,
          revision: selected.revision + 1,
        }),
        expect.objectContaining({
          id: "swipe-unselected",
          content: "Unselected alternate body.",
          selected: false,
          revision: 1,
        }),
      ]);
    } finally {
      store.close();
    }
  });

  it("uses insertion order when paginating messages with equal timestamps", () => {
    const store = new AppStore();
    try {
      const { card } = createConversationFixture(store);
      const conversation = store.createConversation({
        id: "conversation-equal-times",
        title: "Equal timestamp order",
        cardId: card.card.id,
      });
      const createdAt = "2026-08-18T10:22:00.000Z";
      const messages = [
        store.addUserMessage({
          id: "z-first-user",
          conversationId: conversation.id,
          content: "First user",
          createdAt,
        }),
        store.addAssistantMessage({
          id: "a-first-assistant",
          conversationId: conversation.id,
          content: "First assistant",
          createdAt,
        }),
        store.addUserMessage({
          id: "y-second-user",
          conversationId: conversation.id,
          content: "Second user",
          createdAt,
        }),
        store.addAssistantMessage({
          id: "b-second-assistant",
          conversationId: conversation.id,
          content: "Second assistant",
          createdAt,
        }),
      ];

      expect(
        store
          .listChatMessagesPage({ conversationId: conversation.id, limit: 10 })
          .items.map((message) => message.id),
      ).toEqual(messages.map((message) => message.id));

      const newer = store.listChatMessagesPage({
        conversationId: conversation.id,
        limit: 2,
      });
      expect(newer.items.map((message) => message.id)).toEqual([
        "y-second-user",
        "b-second-assistant",
      ]);
      const cursor = newer.items[0]!;
      expect(
        store
          .listChatMessagesPage({
            conversationId: conversation.id,
            limit: 2,
            before: { createdAt: cursor.createdAt, id: cursor.id },
          })
          .items.map((message) => message.id),
      ).toEqual(["z-first-user", "a-first-assistant"]);
    } finally {
      store.close();
    }
  });

  it("selects an earlier swipe without violating the one-selected index", () => {
    const store = new AppStore();
    try {
      const { second } = createConversationFixture(store);
      const earlier = store.addSwipe({
        id: "swipe-earlier-unselected",
        messageId: second.id,
        content: "Earlier candidate.",
        selected: false,
      });
      store.addSwipe({
        id: "swipe-later-selected",
        messageId: second.id,
        content: "Later selected candidate.",
        selected: true,
      });
      const current = store.getMessage(second.id);

      const selected = store.selectSwipe({
        messageId: current.id,
        swipeId: earlier.id,
        expectedMessageRevision: current.revision,
      });

      expect(selected.message).toMatchObject({
        content: "Earlier candidate.",
        revision: current.revision + 1,
      });
      expect(selected.swipe).toMatchObject({
        id: earlier.id,
        selected: true,
      });
      expect(store.listSwipes(second.id)).toEqual([
        expect.objectContaining({
          id: "swipe-earlier-unselected",
          selected: true,
        }),
        expect.objectContaining({
          id: "swipe-later-selected",
          selected: false,
        }),
      ]);
    } finally {
      store.close();
    }
  });

  it("persists generated content and all swipe choices atomically", () => {
    const store = new AppStore();
    try {
      const { conversation } = createConversationFixture(store);
      const before = store.getConversation(conversation.id);
      const persisted = store.persistAssistantGeneration({
        conversationId: conversation.id,
        content: "Primary generated reply.",
        alternatives: ["Alternative reply."],
        status: "partial",
        finishReason: "length",
        providerRawFinishReason: "safety",
        providerSawDone: true,
        providerLastFrameType: "chat.completion.chunk",
        providerUpstreamRequestId: "upstream-request-1",
        reasoningText: "Visible reasoning.",
        providerAttribution: {
          connectionId: "responses-1",
          name: "Responses 主连接",
        },
        providerContext: {
          connectionId: "responses-1",
          items: [{ type: "reasoning", id: "reasoning-1" }],
        },
      });

      expect(persisted.message).toMatchObject({
        content: "Primary generated reply.",
        generationStatus: "partial",
        finishReason: "length",
        providerRawFinishReason: "safety",
        providerSawDone: true,
        providerLastFrameType: "chat.completion.chunk",
        providerUpstreamRequestId: "upstream-request-1",
      });
      expect(persisted.swipes).toEqual([
        expect.objectContaining({
          content: "Primary generated reply.",
          reasoningText: "Visible reasoning.",
          providerConnectionId: "responses-1",
          providerName: "Responses 主连接",
          selected: true,
        }),
        expect.objectContaining({
          content: "Alternative reply.",
          providerConnectionId: "responses-1",
          providerName: "Responses 主连接",
          selected: false,
        }),
      ]);
      expect(
        store.selectedProviderContexts(conversation.id, "responses-1"),
      ).toEqual(
        new Map([
          [persisted.message.id, [{ type: "reasoning", id: "reasoning-1" }]],
        ]),
      );
      expect(
        store.selectedProviderContexts(conversation.id, "responses-2"),
      ).toEqual(new Map());
      expect(store.getConversation(conversation.id).revision).toBe(
        before.revision + 1,
      );
    } finally {
      store.close();
    }
  });

  it("rolls back a generated message when a later swipe insert fails", () => {
    const store = new AppStore();
    try {
      const { conversation } = createConversationFixture(store);
      const beforeMessages = store.listMessages(conversation.id);
      const beforeConversation = store.getConversation(conversation.id);
      store.database.raw.exec(`
        CREATE TRIGGER fail_generation_second_swipe
        BEFORE INSERT ON swipes
        WHEN NEW.position = 1
        BEGIN
          SELECT RAISE(ABORT, 'injected swipe failure');
        END;
      `);

      expect(() =>
        store.persistAssistantGeneration({
          conversationId: conversation.id,
          content: "Primary generated reply.",
          alternatives: ["This insert fails."],
          status: "complete",
          finishReason: "stop",
        }),
      ).toThrow("injected swipe failure");
      expect(store.listMessages(conversation.id)).toEqual(beforeMessages);
      expect(store.getConversation(conversation.id)).toEqual(
        beforeConversation,
      );
    } finally {
      store.close();
    }
  });

  it("regenerates an existing assistant message without a temporary message", () => {
    const store = new AppStore();
    try {
      const { conversation, second } = createConversationFixture(store);
      const beforeCount = store.listMessages(conversation.id).length;
      const persisted = store.persistAssistantGeneration({
        conversationId: conversation.id,
        targetMessageId: second.id,
        expectedMessageRevision: second.revision,
        content: "Regenerated reply.",
        alternatives: ["Second regenerated choice."],
        status: "complete",
        finishReason: "stop",
      });

      expect(store.listMessages(conversation.id)).toHaveLength(beforeCount);
      expect(persisted.message).toMatchObject({
        id: second.id,
        content: "Regenerated reply.",
      });
      expect(persisted.swipes.at(-2)).toEqual(
        expect.objectContaining({
          content: "Regenerated reply.",
          selected: true,
        }),
      );
      expect(() =>
        store.persistAssistantGeneration({
          conversationId: conversation.id,
          targetMessageId: second.id,
          expectedMessageRevision: second.revision,
          content: "Stale retry.",
          status: "complete",
          finishReason: "stop",
        }),
      ).toThrowError(expect.objectContaining({ code: "revision_conflict" }));
    } finally {
      store.close();
    }
  });

  it("forces imported worldbooks to remain Agent read-only", () => {
    const store = new AppStore();
    try {
      const worldbook = store.createWorldbook({
        id: "book-import",
        name: "Imported",
        source: "import",
        agentEditable: true,
        entries: [
          {
            id: "entry-import",
            content: "Imported lore",
            metadata: { agentEditable: true },
          },
        ],
      });
      expect(worldbook.agentEditable).toBe(false);
      expect(worldbook.agentWriteMode).toBe("confirm");
      expect(store.getWorldbookEntry("entry-import")).toMatchObject({
        agentEditable: false,
        permissionUpdatedBy: null,
        permissionUpdatedAt: null,
      });
    } finally {
      store.close();
    }
  });

  it("updates one entry permission atomically against both revisions", () => {
    const store = new AppStore();
    try {
      const worldbook = store.createWorldbook({
        id: "book-entry-permissions",
        name: "Entry permissions",
        // Legacy aggregate metadata must not flow into new entries.
        agentEditable: true,
        entries: [
          { id: "entry-editable", content: "Editable candidate" },
          { id: "entry-readonly", content: "Read-only candidate" },
        ],
      });
      const original = store.getWorldbookEntry("entry-editable");
      expect(original.agentEditable).toBe(false);
      expect(store.getWorldbookEntry("entry-readonly").agentEditable).toBe(
        false,
      );

      const updated = store.setWorldbookEntryPermission({
        worldbookId: worldbook.id,
        entryId: original.id,
        expectedWorldbookRevision: worldbook.revision,
        expectedEntryRevision: original.revision,
        agentEditable: true,
        actorKind: "human",
        actorId: "user-1",
      });
      expect(updated.worldbook).toMatchObject({
        agentEditable: true,
        revision: worldbook.revision + 1,
      });
      expect(updated.entry).toMatchObject({
        agentEditable: true,
        permissionUpdatedBy: "user-1",
        revision: original.revision + 1,
      });
      expect(updated.entry.permissionUpdatedAt).toEqual(expect.any(String));
      expect(store.getWorldbookEntry("entry-readonly").agentEditable).toBe(
        false,
      );
      const [permissionAudit] = store.listAuditRecords({
        resourceType: "worldbook-entry",
        resourceId: original.id,
      });
      expect(permissionAudit).toMatchObject({
        actorKind: "human",
        actorId: "user-1",
        action: "worldbook.entry.permission.update",
      });
      expect(permissionAudit?.before).toMatchObject({ agentEditable: false });
      expect(permissionAudit?.after).toMatchObject({ agentEditable: true });
      expect(permissionAudit?.inversePatch).toMatchObject({
        operation: "worldbook.entry.permission.restore",
        expectedWorldbookRevision: updated.worldbook.revision,
        expectedEntryRevision: updated.entry.revision,
      });

      expect(() =>
        store.setWorldbookEntryPermission({
          worldbookId: worldbook.id,
          entryId: original.id,
          expectedWorldbookRevision: updated.worldbook.revision,
          expectedEntryRevision: original.revision,
          agentEditable: false,
          actorKind: "human",
          actorId: "user-1",
        }),
      ).toThrowError(expect.objectContaining({ code: "revision_conflict" }));
      expect(store.getWorldbook(worldbook.id).revision).toBe(
        updated.worldbook.revision,
      );
      expect(store.getWorldbookEntry(original.id)).toMatchObject({
        agentEditable: true,
        revision: updated.entry.revision,
      });

      expect(() =>
        store.setWorldbookEntryPermission({
          worldbookId: worldbook.id,
          entryId: original.id,
          expectedWorldbookRevision: worldbook.revision,
          expectedEntryRevision: updated.entry.revision,
          agentEditable: false,
          actorKind: "human",
          actorId: "user-1",
        }),
      ).toThrowError(expect.objectContaining({ code: "revision_conflict" }));
      expect(store.getWorldbookEntry(original.id).agentEditable).toBe(true);

      expect(() =>
        store.setWorldbookEntryPermission({
          worldbookId: worldbook.id,
          entryId: original.id,
          expectedWorldbookRevision: updated.worldbook.revision,
          expectedEntryRevision: updated.entry.revision,
          agentEditable: false,
          actorKind: "agent",
          actorId: "run-1",
        }),
      ).toThrowError(expect.objectContaining({ code: "permission_denied" }));
      expect(store.getWorldbookEntry(original.id).agentEditable).toBe(true);
    } finally {
      store.close();
    }
  });

  it("migrates existing worldbook entries to explicit read-only permissions", () => {
    const directory = mkdtempSync(
      path.join(tmpdir(), "stn-worldbook-entry-permission-migration-"),
    );
    const databasePath = path.join(directory, "legacy.sqlite");
    const legacy = new DatabaseSync(databasePath, {
      enableForeignKeyConstraints: true,
    });
    try {
      legacy.exec(`
        CREATE TABLE schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TEXT NOT NULL
        );
        INSERT INTO schema_migrations(version, name, applied_at)
        VALUES
          (1, 'legacy-1', '2026-01-01T00:00:00.000Z'),
          (2, 'legacy-2', '2026-01-01T00:00:00.000Z'),
          (3, 'legacy-3', '2026-01-01T00:00:00.000Z'),
          (4, 'legacy-4', '2026-01-01T00:00:00.000Z'),
          (5, 'legacy-5', '2026-01-01T00:00:00.000Z'),
          (6, 'legacy-6', '2026-01-01T00:00:00.000Z');

        CREATE TABLE conversations (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          card_id TEXT,
          revision INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE worldbooks (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          agent_editable INTEGER NOT NULL DEFAULT 0
            CHECK (agent_editable IN (0,1)),
          revision INTEGER NOT NULL DEFAULT 1,
          legacy_payload_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          permission_updated_by TEXT,
          permission_updated_at TEXT,
          agent_write_mode TEXT NOT NULL DEFAULT 'confirm'
            CHECK (agent_write_mode IN ('confirm','auto-create-update'))
        );
        CREATE TABLE messages (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          parent_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
          role TEXT NOT NULL,
          participant_id TEXT,
          content TEXT NOT NULL,
          revision INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE swipes (
          id TEXT PRIMARY KEY,
          message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
          position INTEGER NOT NULL,
          content TEXT NOT NULL,
          selected INTEGER NOT NULL DEFAULT 0,
          revision INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE worldbook_bindings (
          id TEXT PRIMARY KEY,
          worldbook_id TEXT NOT NULL REFERENCES worldbooks(id) ON DELETE CASCADE,
          scope_type TEXT NOT NULL,
          scope_id TEXT,
          created_at TEXT NOT NULL
        );
        CREATE TABLE worldbook_entries (
          id TEXT PRIMARY KEY,
          worldbook_id TEXT NOT NULL
            REFERENCES worldbooks(id) ON DELETE CASCADE,
          legacy_uid INTEGER,
          keys_json TEXT NOT NULL DEFAULT '[]',
          content TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
          position INTEGER NOT NULL DEFAULT 0,
          revision INTEGER NOT NULL DEFAULT 1,
          metadata_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO worldbooks(
          id, name, agent_editable, revision, legacy_payload_json,
          created_at, updated_at
        ) VALUES (
          'book-legacy-permission', 'Legacy aggregate permission', 1, 4, '{}',
          '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
        );
        INSERT INTO worldbook_entries(
          id, worldbook_id, keys_json, content, enabled, position, revision,
          metadata_json, created_at, updated_at
        ) VALUES (
          'entry-legacy-permission', 'book-legacy-permission', '[]', 'Lore',
          1, 0, 3, '{}',
          '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
        );
      `);
    } finally {
      legacy.close();
    }

    const store = new AppStore(new AppDatabase({ path: databasePath }));
    try {
      expect(
        store.database
          .all<{ name: string }>("PRAGMA table_info(worldbook_entries)")
          .map((column) => column.name),
      ).toEqual(
        expect.arrayContaining([
          "agent_editable",
          "permission_updated_by",
          "permission_updated_at",
        ]),
      );
      expect(store.getWorldbook("book-legacy-permission").agentEditable).toBe(
        true,
      );
      expect(store.getWorldbookEntry("entry-legacy-permission")).toMatchObject({
        agentEditable: false,
        permissionUpdatedBy: null,
        permissionUpdatedAt: null,
        revision: 3,
      });
      expect(
        store.database.get<{ version: number }>(
          "SELECT version FROM schema_migrations WHERE version = 7",
        ),
      ).toEqual({ version: 7 });
    } finally {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("does not delete an entry through a different worldbook id", () => {
    const store = new AppStore();
    try {
      const left = store.createWorldbook({
        id: "book-left",
        name: "Left",
        entries: [{ id: "entry-left", content: "left" }],
      });
      const right = store.createWorldbook({
        id: "book-right",
        name: "Right",
      });
      expect(() =>
        store.deleteWorldbookEntryHuman({
          worldbookId: right.id,
          entryId: "entry-left",
          expectedWorldbookRevision: right.revision,
          expectedEntryRevision: 1,
          confirmed: true,
        }),
      ).toThrowError(/not found/iu);
      expect(store.getWorldbookEntry("entry-left").worldbookId).toBe(left.id);
    } finally {
      store.close();
    }
  });

  it("rolls nested repository writes back with the enclosing transaction", () => {
    const store = new AppStore();
    try {
      expect(() =>
        store.database.transaction(() => {
          store.createCard({
            id: "card-rollback",
            kind: "world",
            name: "Transient world",
          });
          throw new Error("fixture rollback");
        }),
      ).toThrowError("fixture rollback");
      expect(store.listCards()).toEqual([]);
    } finally {
      store.close();
    }
  });

  it("rejects stale revisions without overwriting the winning update", () => {
    const store = new AppStore();
    try {
      const { card } = store.createCard({
        id: "card-revision",
        kind: "scenario",
        name: "Original",
      });
      const updated = store.updateCard({
        id: card.id,
        expectedRevision: card.revision,
        patch: { name: "Winner" },
      });
      expect(() =>
        store.updateCard({
          id: card.id,
          expectedRevision: card.revision,
          patch: { name: "Stale writer" },
        }),
      ).toThrowError(expect.objectContaining({ code: "revision_conflict" }));
      expect(store.getCard(card.id)).toMatchObject({
        name: "Winner",
        revision: updated.revision,
      });
    } finally {
      store.close();
    }
  });

  it("replaces card content while retaining participant identity for historical messages", () => {
    const store = new AppStore();
    try {
      const created = store.createCard({
        id: "card-replace-content",
        kind: "character",
        name: "Original card",
        participants: [
          {
            id: "participant-retained",
            name: "Original participant",
            role: "character",
            profile: {
              id: "participant-retained",
              name: "Original participant",
            },
          },
          {
            id: "participant-detached",
            name: "Removed participant",
            role: "character",
          },
        ],
      });
      const conversation = store.createConversation({
        id: "conversation-retained",
        cardId: created.card.id,
        title: "Historical chat",
      });
      const message = store.addAssistantMessage({
        id: "message-retained-author",
        conversationId: conversation.id,
        participantId: "participant-retained",
        content: "Historical reply",
      });

      const replaced = store.replaceCardContent({
        id: created.card.id,
        expectedRevision: created.card.revision,
        card: {
          kind: "ensemble",
          name: "Updated card",
          description: "Updated description",
          legacyPayload: { normalized: { fixture: "updated" } },
        },
        participants: [
          {
            id: "participant-retained",
            name: "Updated participant",
            role: "narrator",
            profile: {
              id: "participant-retained",
              name: "Updated participant",
            },
          },
        ],
      });

      expect(replaced.card).toMatchObject({
        id: created.card.id,
        kind: "ensemble",
        name: "Updated card",
        revision: created.card.revision + 1,
      });
      expect(replaced.participants).toMatchObject([
        { id: "participant-retained", name: "Updated participant" },
      ]);
      expect(store.getMessage(message.id).participantId).toBe(
        "participant-retained",
      );
      expect(store.listCardConversations(created.card.id)).toHaveLength(1);
      expect(store.listCardParticipants(created.card.id)).toHaveLength(1);
      expect(store.getParticipant("participant-detached").cardId).toBeNull();
    } finally {
      store.close();
    }
  });
});

describe("AgentStore", () => {
  it("can read worldbooks bound through the conversation card", () => {
    const store = new AppStore();
    const agents = new AgentStore(store);
    try {
      const { card, conversation } = createConversationFixture(store);
      const worldbook = store.createWorldbook({
        id: "book-card-binding",
        name: "Card lore",
      });
      store.bindWorldbook({
        worldbookId: worldbook.id,
        scopeType: "card",
        scopeId: card.card.id,
      });
      const run = agents.createRun({
        id: "run-card-binding",
        conversationId: conversation.id,
        requestedBy: "user-1",
        provider: "fake",
        model: "fake",
        objective: "Read card lore",
        idempotencyKey: "run-card-binding",
      }).run;
      const listed = agents.executeTool({
        runId: run.id,
        idempotencyKey: "list-card-lore",
        toolName: "worldbook.list",
        arguments: {},
      });
      expect(listed.call.status).toBe("succeeded");
      expect(listed.result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "book-card-binding" }),
        ]),
      );
    } finally {
      store.close();
    }
  });

  it("lists ordered conversation messages with bounded pagination", () => {
    const store = new AppStore();
    const agents = new AgentStore(store);
    try {
      const { conversation, first, second } = createConversationFixture(store);
      const run = agents.createRun({
        id: "run-messages",
        conversationId: conversation.id,
        requestedBy: "user-1",
        provider: "fake",
        model: "fake",
        objective: "List messages",
        idempotencyKey: "run-messages",
      }).run;
      const listed = agents.executeTool({
        runId: run.id,
        idempotencyKey: "messages-list",
        toolName: "chat.messages.list",
        arguments: { limit: 200 },
      });
      expect(listed.result).toMatchObject({
        offset: 0,
        limit: 200,
        total: 2,
        items: [
          { id: first.id, order: 0, role: "user" },
          { id: second.id, order: 1, role: "assistant" },
        ],
      });
      expect(() =>
        agents.executeTool({
          runId: run.id,
          idempotencyKey: "messages-too-large",
          toolName: "chat.messages.list",
          arguments: { limit: 201 },
        }),
      ).toThrowError(
        expect.objectContaining({ code: "TOOL_ARGUMENT_INVALID" }),
      );
    } finally {
      store.close();
    }
  });

  it("gates entry updates and deletes on per-entry permission", () => {
    const store = new AppStore();
    const agents = new AgentStore(store);
    try {
      const { conversation } = createConversationFixture(store);
      const worldbook = store.createWorldbook({
        id: "book-1",
        name: "World",
        source: "import",
      });
      store.bindWorldbook({
        worldbookId: worldbook.id,
        scopeType: "conversation",
        scopeId: conversation.id,
      });
      const run = agents.createRun({
        id: "run-1",
        conversationId: conversation.id,
        requestedBy: "user-1",
        provider: "fake",
        model: "fake",
        objective: "Remember a durable fact",
        idempotencyKey: "run-key-1",
      }).run;

      const createArguments = {
        worldbookId: worldbook.id,
        expectedRevision: worldbook.revision,
        entry: {
          title: "Late bell",
          keys: ["bell"],
          content: "The bell rings one beat late.",
        },
      };
      const proposedCreate = agents.executeTool({
        runId: run.id,
        idempotencyKey: "call-create",
        toolName: "worldbook.entry.create",
        arguments: createArguments,
      });
      expect(proposedCreate.call.status).toBe("awaiting_confirmation");
      expect(store.listWorldbookEntries(worldbook.id)).toHaveLength(0);

      const created = agents.executeTool({
        runId: run.id,
        idempotencyKey: "call-create",
        toolName: "worldbook.entry.create",
        arguments: createArguments,
        confirmed: true,
      });
      expect(created.call.status).toBe("succeeded");
      expect(store.listWorldbookEntries(worldbook.id)).toHaveLength(1);
      const createResult = created.result as {
        auditId: string;
        entry: {
          id: string;
          revision: number;
          agentEditable: boolean;
        };
        revision: number;
      };
      expect(createResult.entry.agentEditable).toBe(false);
      expect(
        agents.executeTool({
          runId: run.id,
          idempotencyKey: "call-create",
          toolName: "worldbook.entry.create",
          arguments: {},
          confirmed: true,
        }).replayed,
      ).toBe(true);
      expect(
        store.getAuditRecord(createResult.auditId).inversePatch.operation,
      ).toBe("worldbook.entry.delete");

      const updateArguments = {
        worldbookId: worldbook.id,
        entryId: createResult.entry.id,
        expectedRevision: createResult.revision,
        expectedEntryRevision: createResult.entry.revision,
        patch: {
          title: "Later bell",
          keys: ["bell", "/clock{1,3}/i"],
          content: "The bell now rings two beats late.",
        },
      };
      const updateRun = agents.createRun({
        id: "run-update",
        conversationId: conversation.id,
        requestedBy: "user-1",
        provider: "fake",
        model: "fake",
        objective: "Update the durable fact",
        idempotencyKey: "run-key-update",
      }).run;
      expect(
        agents.executeTool({
          runId: updateRun.id,
          idempotencyKey: "call-update",
          toolName: "worldbook.entry.update",
          arguments: updateArguments,
        }).call.status,
      ).toBe("awaiting_confirmation");
      expect(() =>
        agents.executeTool({
          runId: updateRun.id,
          idempotencyKey: "call-update",
          toolName: "worldbook.entry.update",
          arguments: updateArguments,
          confirmed: true,
        }),
      ).toThrowError(
        expect.objectContaining({
          code: "WORLD_BOOK_ENTRY_NOT_AGENT_EDITABLE",
        }),
      );
      expect(
        agents
          .listToolCalls(updateRun.id)
          .find((call) => call.idempotencyKey === "call-update"),
      ).toMatchObject({
        status: "awaiting_confirmation",
        error: { code: "WORLD_BOOK_ENTRY_NOT_AGENT_EDITABLE" },
      });

      const grantedForUpdate = store.setWorldbookEntryPermission({
        worldbookId: worldbook.id,
        entryId: createResult.entry.id,
        expectedWorldbookRevision: createResult.revision,
        expectedEntryRevision: createResult.entry.revision,
        agentEditable: true,
        actorKind: "human",
        actorId: "user-1",
      });
      expect(grantedForUpdate.worldbook.revision).toBe(
        createResult.revision + 1,
      );
      expect(grantedForUpdate.entry.revision).toBe(
        createResult.entry.revision + 1,
      );

      const updated = agents.executeTool({
        runId: updateRun.id,
        idempotencyKey: "call-update",
        toolName: "worldbook.entry.update",
        arguments: updateArguments,
        confirmed: true,
      });
      expect(updated.call.status).toBe("succeeded");
      const updateResult = updated.result as {
        auditId: string;
        entry: { id: string; revision: number; agentEditable: boolean };
        revision: number;
      };
      expect(updateResult.entry).toMatchObject({
        keys: ["bell", "/clock{1,3}/i"],
        content: "The bell now rings two beats late.",
        agentEditable: true,
      });
      expect(
        store.getWorldbookEntry(updateResult.entry.id).metadata,
      ).toMatchObject({
        label: "Later bell",
        title: "Later bell",
        primaryKeys: ["bell", "/clock{1,3}/i"],
        secondaryKeys: [],
        selective: false,
      });

      const revokedForDelete = store.setWorldbookEntryPermission({
        worldbookId: worldbook.id,
        entryId: updateResult.entry.id,
        expectedWorldbookRevision: updateResult.revision,
        expectedEntryRevision: updateResult.entry.revision,
        agentEditable: false,
        actorKind: "human",
        actorId: "user-1",
      });
      const deleteArguments = {
        worldbookId: worldbook.id,
        entryId: updateResult.entry.id,
        expectedRevision: revokedForDelete.worldbook.revision,
        expectedEntryRevision: revokedForDelete.entry.revision,
      };
      const deleteRun = agents.createRun({
        id: "run-delete",
        conversationId: conversation.id,
        requestedBy: "user-1",
        provider: "fake",
        model: "fake",
        objective: "Delete the durable fact",
        idempotencyKey: "run-key-delete",
      }).run;
      expect(
        agents.executeTool({
          runId: deleteRun.id,
          idempotencyKey: "call-delete",
          toolName: "worldbook.entry.delete",
          arguments: deleteArguments,
        }).call.status,
      ).toBe("awaiting_confirmation");
      expect(() =>
        agents.executeTool({
          runId: deleteRun.id,
          idempotencyKey: "call-delete",
          toolName: "worldbook.entry.delete",
          arguments: deleteArguments,
          confirmed: true,
        }),
      ).toThrowError(
        expect.objectContaining({
          code: "WORLD_BOOK_ENTRY_NOT_AGENT_EDITABLE",
        }),
      );

      const grantedForDelete = store.setWorldbookEntryPermission({
        worldbookId: worldbook.id,
        entryId: updateResult.entry.id,
        expectedWorldbookRevision: revokedForDelete.worldbook.revision,
        expectedEntryRevision: revokedForDelete.entry.revision,
        agentEditable: true,
        actorKind: "human",
        actorId: "user-1",
      });
      expect(grantedForDelete.entry.agentEditable).toBe(true);
      const deleted = agents.executeTool({
        runId: deleteRun.id,
        idempotencyKey: "call-delete",
        toolName: "worldbook.entry.delete",
        arguments: deleteArguments,
        confirmed: true,
      });
      expect(deleted.call.status).toBe("succeeded");
      expect(store.listWorldbookEntries(worldbook.id)).toHaveLength(0);
      const deleteResult = deleted.result as {
        auditId: string;
        deletedEntryId: string;
      };
      expect(
        agents.executeTool({
          runId: deleteRun.id,
          idempotencyKey: "call-delete",
          toolName: "worldbook.entry.delete",
          arguments: {},
          confirmed: true,
        }).replayed,
      ).toBe(true);
      expect(
        store.getAuditRecord(deleteResult.auditId).inversePatch.operation,
      ).toBe("worldbook.entry.recreate");

      const undone = agents.executeTool({
        runId: deleteRun.id,
        idempotencyKey: "call-undo",
        toolName: "agent.change.undo",
        arguments: { auditId: deleteResult.auditId },
        confirmed: true,
      });
      expect(undone.call.status).toBe("succeeded");
      expect(store.listWorldbookEntries(worldbook.id)).toEqual([
        expect.objectContaining({
          id: deleteResult.deletedEntryId,
          agentEditable: false,
        }),
      ]);
      expect(
        store.getAuditRecord(deleteResult.auditId).undoneAt,
      ).not.toBeNull();
    } finally {
      store.close();
    }
  });

  it("creates summary and participant-profile artifacts without changing messages or cards", () => {
    const store = new AppStore();
    const agents = new AgentStore(store);
    try {
      const { card, conversation, first, second } =
        createConversationFixture(store);
      const run = agents.createRun({
        id: "run-artifacts",
        conversationId: conversation.id,
        requestedBy: "user-1",
        provider: "fake",
        model: "fake",
        objective: "Create derived artifacts",
        idempotencyKey: "run-artifacts",
      }).run;
      const beforeMessages = store.listMessages(conversation.id);
      const beforeCard = store.getCard(card.card.id);

      const summary = agents.executeTool({
        runId: run.id,
        idempotencyKey: "summary-create",
        toolName: "chat.summary.create",
        arguments: {
          title: "Tide summary",
          content: "The tide changed at dusk.",
          sourceFromMessageId: first.id,
          sourceToMessageId: second.id,
          keyEvents: ["tide changed"],
        },
      });
      expect(summary.call.status).toBe("awaiting_confirmation");
      const confirmedSummary = agents.executeTool({
        runId: run.id,
        idempotencyKey: "summary-create",
        toolName: "chat.summary.create",
        arguments: {
          title: "Tide summary",
          content: "The tide changed at dusk.",
          sourceFromMessageId: first.id,
          sourceToMessageId: second.id,
          keyEvents: ["tide changed"],
        },
        confirmed: true,
      });
      expect(confirmedSummary.call.status).toBe("succeeded");

      const profileRun = agents.createRun({
        id: "run-profile",
        conversationId: conversation.id,
        requestedBy: "user-1",
        provider: "fake",
        model: "fake",
        objective: "Create a participant profile",
        idempotencyKey: "run-profile",
      }).run;
      const profile = agents.executeTool({
        runId: profileRun.id,
        idempotencyKey: "profile-create",
        toolName: "character.profile.create",
        arguments: {
          participantId: "participant-a",
          title: "Participant A",
          content: "Observed the tide.",
          traits: ["observant"],
          facts: [
            {
              text: "Observed the tide",
              sourceMessageIds: [second.id],
              confidence: "high",
            },
          ],
        },
      });
      expect(profile.call.status).toBe("awaiting_confirmation");
      const confirmedProfile = agents.executeTool({
        runId: profileRun.id,
        idempotencyKey: "profile-create",
        toolName: "character.profile.create",
        arguments: {
          participantId: "participant-a",
          title: "Participant A",
          content: "Observed the tide.",
          traits: ["observant"],
          facts: [
            {
              text: "Observed the tide",
              sourceMessageIds: [second.id],
              confidence: "high",
            },
          ],
        },
        confirmed: true,
      });
      expect(confirmedProfile.call.status).toBe("succeeded");
      expect(
        store.getLatestArtifact("chat_summary", "conversation", conversation.id)
          ?.sourceFromMessageId,
      ).toBe(first.id);
      expect(
        store.getLatestArtifact(
          "character_profile",
          "conversation-participant",
          `${conversation.id}:participant-a`,
        ),
      ).not.toBeNull();
      expect(store.listMessages(conversation.id)).toEqual(beforeMessages);
      expect(store.getCard(card.card.id)).toEqual(beforeCard);
    } finally {
      store.close();
    }
  });

  it("keeps summary ranges ordered and participant profiles on the current card", () => {
    const store = new AppStore();
    const agents = new AgentStore(store);
    try {
      const { conversation, first, second } = createConversationFixture(store);
      const invalidSummaryRun = agents.createRun({
        id: "run-invalid-summary-range",
        conversationId: conversation.id,
        requestedBy: "user-1",
        provider: "fake",
        model: "fake",
        objective: "Reject an invalid summary range",
        idempotencyKey: "run-invalid-summary-range",
      }).run;
      const invalidSummary = agents.executeTool({
        runId: invalidSummaryRun.id,
        idempotencyKey: "invalid-summary-range",
        toolName: "chat.summary.create",
        arguments: {
          content: "This range is backwards.",
          sourceFromMessageId: second.id,
          sourceToMessageId: first.id,
        },
      });
      expect(invalidSummary.call.status).toBe("awaiting_confirmation");
      expect(() =>
        agents.executeTool({
          runId: invalidSummaryRun.id,
          idempotencyKey: "invalid-summary-range",
          toolName: "chat.summary.create",
          arguments: {
            content: "This range is backwards.",
            sourceFromMessageId: second.id,
            sourceToMessageId: first.id,
          },
          confirmed: true,
        }),
      ).toThrowError(
        expect.objectContaining({ code: "TOOL_ARGUMENT_INVALID" }),
      );

      store.createCard({
        id: "card-foreign-profile",
        kind: "character",
        name: "Foreign card",
        participants: [
          { id: "participant-foreign", name: "Foreign participant" },
        ],
      });
      const foreignProfileRun = agents.createRun({
        id: "run-foreign-profile",
        conversationId: conversation.id,
        requestedBy: "user-1",
        provider: "fake",
        model: "fake",
        objective: "Reject a foreign participant",
        idempotencyKey: "run-foreign-profile",
      }).run;
      expect(() =>
        agents.executeTool({
          runId: foreignProfileRun.id,
          idempotencyKey: "foreign-profile-read",
          toolName: "character.profile.get",
          arguments: { participantId: "participant-foreign" },
        }),
      ).toThrowError(expect.objectContaining({ code: "permission_denied" }));
    } finally {
      store.close();
    }
  });

  it("rejects queued tools after a run is cancelled", () => {
    const store = new AppStore();
    const agents = new AgentStore(store);
    try {
      const { conversation } = createConversationFixture(store);
      const run = agents.createRun({
        id: "run-cancel",
        conversationId: conversation.id,
        requestedBy: "user-1",
        provider: "fake",
        model: "fake",
        objective: "Cancel",
        idempotencyKey: "run-cancel",
      }).run;
      expect(agents.cancelRun(run.id, "user-1").status).toBe("cancelled");
      expect(() =>
        agents.executeTool({
          runId: run.id,
          idempotencyKey: "after-cancel",
          toolName: "worldbook.list",
          arguments: {},
        }),
      ).toThrowError(expect.objectContaining({ code: "run_cancelled" }));
    } finally {
      store.close();
    }
  });
});
