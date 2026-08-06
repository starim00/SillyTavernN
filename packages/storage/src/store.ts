import { randomUUID } from "node:crypto";

import { AppDatabase } from "./database.js";
import {
  ConflictError,
  NotFoundError,
  PermissionError,
  StorageError,
} from "./errors.js";
import type {
  ActorKind,
  AuditRecord,
  Artifact,
  BindingScope,
  Card,
  CardKind,
  Conversation,
  ExtensionSetting,
  GenerationFinishReason,
  GenerationStatus,
  JsonObject,
  JsonValue,
  MessageRole,
  Message,
  InternalMessageRole,
  Persona,
  Participant,
  Preset,
  ProviderConnection,
  Swipe,
  Worldbook,
  WorldbookBinding,
  WorldbookEntry,
} from "./models.js";

type RowValue = string | number | null;
type Row = Record<string, RowValue>;

const timestamp = (): string => new Date().toISOString();
const identifier = (): string => randomUUID();

function encode(value: unknown): string {
  return JSON.stringify(value);
}

function decodeValue(value: string | null): JsonValue | null {
  if (value === null) {
    return null;
  }
  return JSON.parse(value) as JsonValue;
}

function decodeObject(value: string): JsonObject {
  const decoded = JSON.parse(value) as JsonValue;
  if (
    decoded === null ||
    Array.isArray(decoded) ||
    typeof decoded !== "object"
  ) {
    throw new StorageError(
      "invalid_persisted_json",
      "Expected a persisted JSON object.",
      500,
    );
  }
  return decoded;
}

function decodeStringArray(value: string): string[] {
  const decoded = JSON.parse(value) as unknown;
  if (
    !Array.isArray(decoded) ||
    !decoded.every((item) => typeof item === "string")
  ) {
    throw new StorageError(
      "invalid_persisted_json",
      "Expected a persisted string array.",
      500,
    );
  }
  return decoded;
}

function asBoolean(value: RowValue | undefined): boolean {
  return value === 1;
}

export interface CreateParticipantInput {
  id?: string;
  name: string;
  role?: string;
  profile?: JsonObject;
  legacyPayload?: JsonObject;
}

export interface PersistAssistantGenerationInput {
  conversationId: string;
  content: string;
  alternatives?: readonly string[];
  status: GenerationStatus;
  finishReason: GenerationFinishReason;
  providerErrorCode?: string;
  targetMessageId?: string;
  expectedMessageRevision?: number;
}

export interface PersistAssistantGenerationResult {
  message: Message;
  swipes: Swipe[];
}

export interface ConversationPageCursor {
  updatedAt: string;
  id: string;
}

export interface MessagePageCursor {
  createdAt: string;
  id: string;
}

export interface PageResult<T> {
  items: T[];
  hasMore: boolean;
}

export interface CreatePersonaInput {
  id?: string;
  name: string;
  description?: string;
  title?: string;
  isDefault?: boolean;
}

export interface CreateCardInput {
  id?: string;
  kind: CardKind;
  name: string;
  description?: string;
  legacyPayload?: JsonObject;
  participants?: CreateParticipantInput[];
}

export interface CreateWorldbookInput {
  id?: string;
  name: string;
  source?: "native" | "import";
  /** @deprecated Agent write authorization is evaluated per worldbook entry. */
  agentEditable?: boolean;
  legacyPayload?: JsonObject;
  entries?: Array<{
    id?: string;
    legacyUid?: number | null;
    keys?: string[];
    content: string;
    enabled?: boolean;
    position?: number;
    metadata?: JsonObject;
  }>;
}

export interface CreateArtifactInput {
  id?: string;
  kind: string;
  scopeType: string;
  scopeId: string;
  title?: string;
  content: string;
  metadata?: JsonObject;
}

export class AppStore {
  readonly database: AppDatabase;

  constructor(database = new AppDatabase()) {
    this.database = database;
  }

  close(): void {
    this.database.close();
  }

  createCard(input: CreateCardInput): {
    card: Card;
    participants: Participant[];
  } {
    return this.database.transaction(() => {
      const now = timestamp();
      const id = input.id ?? identifier();
      this.database.run(
        `INSERT INTO cards(id, kind, name, description, legacy_payload_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        id,
        input.kind,
        input.name,
        input.description ?? "",
        encode(input.legacyPayload ?? {}),
        now,
        now,
      );
      const participants = (input.participants ?? []).map((participant) =>
        this.createParticipantInternal({ ...participant, cardId: id }, now),
      );
      return { card: this.getCard(id), participants };
    });
  }

  listCards(): Card[] {
    return this.database
      .all<Row>("SELECT * FROM cards ORDER BY updated_at DESC, id")
      .map((row) => this.mapCard(row));
  }

  getCard(id: string): Card {
    const row = this.database.get<Row>("SELECT * FROM cards WHERE id = ?", id);
    if (!row) {
      throw new NotFoundError("card", id);
    }
    return this.mapCard(row);
  }

  updateCard(input: {
    id: string;
    expectedRevision: number;
    patch: {
      kind?: CardKind;
      name?: string;
      description?: string;
      legacyPayload?: JsonObject;
    };
  }): Card {
    return this.database.transaction(() => {
      const current = this.getCard(input.id);
      this.assertRevision(
        "card",
        current.id,
        current.revision,
        input.expectedRevision,
      );
      const next = { ...current, ...input.patch };
      this.database.run(
        `UPDATE cards
         SET kind = ?, name = ?, description = ?, legacy_payload_json = ?,
             revision = revision + 1, updated_at = ?
         WHERE id = ? AND revision = ?`,
        next.kind,
        next.name,
        next.description,
        encode(next.legacyPayload),
        timestamp(),
        current.id,
        input.expectedRevision,
      );
      const changed = this.database.get<{ count: number }>(
        "SELECT changes() AS count",
      );
      if ((changed?.count ?? 0) !== 1) {
        throw new ConflictError(`Card '${current.id}' changed concurrently.`);
      }
      return this.getCard(current.id);
    });
  }

  deleteCard(id: string, expectedRevision: number): Card {
    return this.database.transaction(() => {
      const current = this.getCard(id);
      this.assertRevision("card", id, current.revision, expectedRevision);
      const conversationCount =
        this.database.get<{ count: number }>(
          "SELECT COUNT(*) AS count FROM conversations WHERE card_id = ?",
          id,
        )?.count ?? 0;
      if (conversationCount > 0) {
        throw new StorageError(
          "card_has_conversations",
          `Card '${id}' cannot be deleted while it owns conversations.`,
          409,
          { cardId: id, conversationCount },
        );
      }
      this.database.run(
        "DELETE FROM cards WHERE id = ? AND revision = ?",
        id,
        expectedRevision,
      );
      return current;
    });
  }

  deleteCardCascade(
    id: string,
    expectedRevision: number,
  ): {
    card: Card;
    conversationIds: string[];
    worldbookIds: string[];
  } {
    return this.database.transaction(() => {
      const card = this.getCard(id);
      this.assertRevision("card", id, card.revision, expectedRevision);
      const conversationIds = this.database
        .all<{ id: string }>(
          "SELECT id FROM conversations WHERE card_id = ? ORDER BY updated_at DESC, id",
          id,
        )
        .map((row) => row.id);
      const messageIds = conversationIds.flatMap((conversationId) =>
        this.database
          .all<{ id: string }>(
            "SELECT id FROM messages WHERE conversation_id = ? ORDER BY rowid",
            conversationId,
          )
          .map((row) => row.id),
      );
      const candidateWorldbookIds = Array.from(
        new Set(
          this.database
            .all<{ worldbook_id: string }>(
              `SELECT worldbook_id
               FROM worldbook_bindings
               WHERE (scope_type = 'card' AND scope_id = ?)
                  OR (scope_type = 'conversation' AND scope_id IN (
                    SELECT id FROM conversations WHERE card_id = ?
                  ))`,
              id,
              id,
            )
            .map((row) => row.worldbook_id),
        ),
      );

      this.database.run(
        `DELETE FROM artifacts
         WHERE (scope_type = 'card' AND scope_id = ?)
            OR (scope_type = 'conversation' AND scope_id IN (
              SELECT id FROM conversations WHERE card_id = ?
            ))
            OR (scope_type = 'message' AND scope_id IN (
              SELECT messages.id
              FROM messages
              JOIN conversations
                ON conversations.id = messages.conversation_id
              WHERE conversations.card_id = ?
            ))`,
        id,
        id,
        id,
      );
      this.database.run(
        `DELETE FROM worldbook_bindings
         WHERE (scope_type = 'card' AND scope_id = ?)
            OR (scope_type = 'conversation' AND scope_id IN (
              SELECT id FROM conversations WHERE card_id = ?
            ))`,
        id,
        id,
      );
      this.database.run(
        "DELETE FROM extension_settings WHERE extension_id = 'stn.regex' AND key = ?",
        `card:${id}`,
      );
      this.database.run(
        `DELETE FROM extension_settings
         WHERE extension_id = 'stn.tavern-helper'
           AND (
             key = ?
             OR key = ?
             OR key LIKE ?
           )`,
        `card:${id}`,
        `variables:card:${id}`,
        `variables:script:card:${id}:%`,
      );
      for (const conversationId of conversationIds) {
        this.database.run(
          `DELETE FROM extension_settings
           WHERE extension_id = 'stn.tavern-helper' AND key = ?`,
          `variables:conversation:${conversationId}`,
        );
      }
      for (const messageId of messageIds) {
        this.database.run(
          `DELETE FROM extension_settings
           WHERE extension_id = 'stn.tavern-helper' AND key = ?`,
          `variables:message:${messageId}`,
        );
      }
      this.database.run("DELETE FROM conversations WHERE card_id = ?", id);
      this.database.run("DELETE FROM participants WHERE card_id = ?", id);
      this.database.run(
        "DELETE FROM cards WHERE id = ? AND revision = ?",
        id,
        expectedRevision,
      );

      const worldbookIds = candidateWorldbookIds.filter((worldbookId) => {
        const bindingCount =
          this.database.get<{ count: number }>(
            "SELECT COUNT(*) AS count FROM worldbook_bindings WHERE worldbook_id = ?",
            worldbookId,
          )?.count ?? 0;
        if (bindingCount > 0) return false;
        this.database.run("DELETE FROM worldbooks WHERE id = ?", worldbookId);
        return true;
      });
      return { card, conversationIds, worldbookIds };
    });
  }

  listCardParticipants(cardId: string): Participant[] {
    this.getCard(cardId);
    return this.database
      .all<Row>(
        "SELECT * FROM participants WHERE card_id = ? ORDER BY created_at, id",
        cardId,
      )
      .map((row) => this.mapParticipant(row));
  }

  createParticipant(
    input: CreateParticipantInput & { cardId?: string | null },
  ): Participant {
    return this.database.transaction(() => {
      if (input.cardId) {
        this.getCard(input.cardId);
      }
      return this.createParticipantInternal(input, timestamp());
    });
  }

  getParticipant(id: string): Participant {
    const row = this.database.get<Row>(
      "SELECT * FROM participants WHERE id = ?",
      id,
    );
    if (!row) {
      throw new NotFoundError("participant", id);
    }
    return this.mapParticipant(row);
  }

  listParticipants(): Participant[] {
    return this.database
      .all<Row>("SELECT * FROM participants ORDER BY updated_at DESC, id")
      .map((row) => this.mapParticipant(row));
  }

  createPersona(input: CreatePersonaInput): Persona {
    return this.database.transaction(() => {
      const now = timestamp();
      const id = input.id ?? identifier();
      if (input.isDefault) {
        this.database.run(
          "UPDATE personas SET is_default = 0 WHERE is_default = 1",
        );
      }
      this.database.run(
        `INSERT INTO personas(
           id, name, description, title, is_default, revision, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
        id,
        input.name,
        input.description ?? "",
        input.title ?? "",
        input.isDefault ? 1 : 0,
        now,
        now,
      );
      return this.getPersona(id);
    });
  }

  listPersonas(): Persona[] {
    return this.database
      .all<Row>(
        "SELECT * FROM personas ORDER BY is_default DESC, updated_at DESC, id",
      )
      .map((row) => this.mapPersona(row));
  }

  getPersona(id: string): Persona {
    const row = this.database.get<Row>(
      "SELECT * FROM personas WHERE id = ?",
      id,
    );
    if (!row) {
      throw new NotFoundError("persona", id);
    }
    return this.mapPersona(row);
  }

  getDefaultPersona(): Persona | null {
    const row = this.database.get<Row>(
      "SELECT * FROM personas WHERE is_default = 1 LIMIT 1",
    );
    return row ? this.mapPersona(row) : null;
  }

  updatePersona(input: {
    id: string;
    expectedRevision: number;
    patch: {
      name?: string;
      description?: string;
      title?: string;
      isDefault?: boolean;
    };
  }): Persona {
    return this.database.transaction(() => {
      const current = this.getPersona(input.id);
      this.assertRevision(
        "persona",
        current.id,
        current.revision,
        input.expectedRevision,
      );
      if (input.patch.isDefault === true) {
        this.database.run(
          "UPDATE personas SET is_default = 0 WHERE is_default = 1 AND id <> ?",
          current.id,
        );
      }
      const next = { ...current, ...input.patch };
      this.database.run(
        `UPDATE personas
         SET name = ?, description = ?, title = ?, is_default = ?,
             revision = revision + 1, updated_at = ?
         WHERE id = ? AND revision = ?`,
        next.name,
        next.description,
        next.title,
        next.isDefault ? 1 : 0,
        timestamp(),
        current.id,
        input.expectedRevision,
      );
      const changed = this.database.get<{ count: number }>(
        "SELECT changes() AS count",
      );
      if ((changed?.count ?? 0) !== 1) {
        throw new ConflictError(
          `Persona '${current.id}' changed concurrently.`,
        );
      }
      return this.getPersona(current.id);
    });
  }

  deletePersona(id: string, expectedRevision: number): Persona {
    return this.database.transaction(() => {
      const current = this.getPersona(id);
      this.assertRevision("persona", id, current.revision, expectedRevision);
      this.database.run(
        "DELETE FROM personas WHERE id = ? AND revision = ?",
        id,
        expectedRevision,
      );
      return current;
    });
  }

  createConversation(input: {
    id?: string;
    title: string;
    cardId: string;
    personaId?: string | null;
  }): Conversation {
    return this.database.transaction(() => {
      this.getCard(input.cardId);
      const now = timestamp();
      const id = input.id ?? identifier();
      const personaId =
        input.personaId === undefined
          ? (this.getDefaultPersona()?.id ?? null)
          : input.personaId;
      if (personaId !== null) {
        this.getPersona(personaId);
      }
      this.database.run(
        `INSERT INTO conversations(
           id, title, card_id, persona_id, revision, created_at, updated_at
         ) VALUES (?, ?, ?, ?, 1, ?, ?)`,
        id,
        input.title,
        input.cardId,
        personaId,
        now,
        now,
      );
      return this.getConversation(id);
    });
  }

  setConversationPersona(input: {
    id: string;
    personaId: string | null;
    expectedRevision: number;
  }): Conversation {
    return this.database.transaction(() => {
      const current = this.getConversation(input.id);
      this.assertRevision(
        "conversation",
        input.id,
        current.revision,
        input.expectedRevision,
      );
      if (input.personaId !== null) {
        this.getPersona(input.personaId);
      }
      this.database.run(
        `UPDATE conversations
         SET persona_id = ?, revision = revision + 1, updated_at = ?
         WHERE id = ? AND revision = ?`,
        input.personaId,
        timestamp(),
        input.id,
        input.expectedRevision,
      );
      const changed = this.database.get<{ count: number }>(
        "SELECT changes() AS count",
      );
      if ((changed?.count ?? 0) !== 1) {
        throw new ConflictError(
          `Conversation '${input.id}' changed concurrently.`,
        );
      }
      return this.getConversation(input.id);
    });
  }

  listConversations(): Conversation[] {
    return this.database
      .all<Row>("SELECT * FROM conversations ORDER BY updated_at DESC, id")
      .map((row) => this.mapConversation(row));
  }

  listConversationsPage(input: {
    cardId?: string;
    limit: number;
    before?: ConversationPageCursor;
  }): PageResult<Conversation> {
    const params: Array<string | number> = [];
    const predicates: string[] = [];
    if (input.cardId !== undefined) {
      this.getCard(input.cardId);
      predicates.push("card_id = ?");
      params.push(input.cardId);
    }
    if (input.before !== undefined) {
      predicates.push("(updated_at < ? OR (updated_at = ? AND id > ?))");
      params.push(
        input.before.updatedAt,
        input.before.updatedAt,
        input.before.id,
      );
    }
    params.push(input.limit + 1);
    const rows = this.database.all<Row>(
      `SELECT * FROM conversations
       ${predicates.length === 0 ? "" : `WHERE ${predicates.join(" AND ")}`}
       ORDER BY updated_at DESC, id
       LIMIT ?`,
      ...params,
    );
    return {
      items: rows.slice(0, input.limit).map((row) => this.mapConversation(row)),
      hasMore: rows.length > input.limit,
    };
  }

  listCardConversations(cardId: string): Conversation[] {
    this.getCard(cardId);
    return this.database
      .all<Row>(
        `SELECT * FROM conversations
         WHERE card_id = ?
         ORDER BY updated_at DESC, id`,
        cardId,
      )
      .map((row) => this.mapConversation(row));
  }

  getConversation(id: string): Conversation {
    const row = this.database.get<Row>(
      "SELECT * FROM conversations WHERE id = ?",
      id,
    );
    if (!row) {
      throw new NotFoundError("conversation", id);
    }
    return this.mapConversation(row);
  }

  renameConversation(
    id: string,
    title: string,
    expectedRevision: number,
  ): Conversation {
    return this.database.transaction(() => {
      const current = this.getConversation(id);
      this.assertRevision(
        "conversation",
        id,
        current.revision,
        expectedRevision,
      );
      this.database.run(
        `UPDATE conversations
         SET title = ?, revision = revision + 1, updated_at = ?
         WHERE id = ? AND revision = ?`,
        title,
        timestamp(),
        id,
        expectedRevision,
      );
      return this.getConversation(id);
    });
  }

  deleteConversation(id: string, expectedRevision: number): Conversation {
    return this.database.transaction(() => {
      const current = this.getConversation(id);
      this.assertRevision(
        "conversation",
        id,
        current.revision,
        expectedRevision,
      );

      const candidateWorldbookIds = Array.from(
        new Set(
          this.database
            .all<{ worldbook_id: string }>(
              `SELECT worldbook_id
               FROM worldbook_bindings
               WHERE scope_type = 'conversation' AND scope_id = ?`,
              id,
            )
            .map((row) => row.worldbook_id),
        ),
      );

      // Artifacts and extension settings intentionally do not have foreign
      // keys to conversations/messages, so remove their conversation-owned
      // rows explicitly before the relational cascade runs.
      this.database.run(
        `DELETE FROM artifacts
         WHERE (scope_type = 'conversation' AND scope_id = ?)
            OR (scope_type = 'message' AND scope_id IN (
              SELECT id FROM messages WHERE conversation_id = ?
            ))`,
        id,
        id,
      );
      this.database.run(
        "DELETE FROM worldbook_bindings WHERE scope_type = 'conversation' AND scope_id = ?",
        id,
      );

      this.database.run(
        `DELETE FROM extension_settings
         WHERE extension_id = 'stn.tavern-helper'
           AND (
             key = ?
             OR key IN (
               SELECT 'variables:message:' || id
               FROM messages
               WHERE conversation_id = ?
             )
           )`,
        `variables:conversation:${id}`,
        id,
      );
      this.database.run(
        "DELETE FROM conversations WHERE id = ? AND revision = ?",
        id,
        expectedRevision,
      );

      // A worldbook bound only to this conversation is conversation-owned.
      // Keep books that are still referenced by a card, global scope, or
      // another conversation.
      for (const worldbookId of candidateWorldbookIds) {
        const bindingCount =
          this.database.get<{ count: number }>(
            "SELECT COUNT(*) AS count FROM worldbook_bindings WHERE worldbook_id = ?",
            worldbookId,
          )?.count ?? 0;
        if (bindingCount === 0) {
          this.database.run("DELETE FROM worldbooks WHERE id = ?", worldbookId);
        }
      }
      return current;
    });
  }

  listConversationParticipants(conversationId: string): Participant[] {
    const conversation = this.getConversation(conversationId);
    return this.listCardParticipants(conversation.cardId);
  }

  addUserMessage(input: {
    id?: string;
    conversationId: string;
    parentMessageId?: string | null;
    content: string;
  }): Message {
    return this.insertMessage({
      ...input,
      role: "user",
      participantId: null,
      allowInternalParent: false,
    });
  }

  addAssistantMessage(input: {
    id?: string;
    conversationId: string;
    parentMessageId?: string | null;
    participantId?: string | null;
    content: string;
  }): Message {
    if (input.participantId) {
      const conversation = this.getConversation(input.conversationId);
      const participant = this.getParticipant(input.participantId);
      if (
        participant.cardId !== conversation.cardId ||
        participant.role === "user"
      ) {
        throw new StorageError(
          "invalid_assistant_attribution",
          "Assistant attribution must reference a non-user participant on the conversation card.",
          400,
        );
      }
    }
    return this.insertMessage({
      ...input,
      role: "assistant",
      participantId: input.participantId ?? null,
      allowInternalParent: false,
    });
  }

  addInternalMessage(input: {
    id?: string;
    conversationId: string;
    parentMessageId?: string | null;
    role: InternalMessageRole;
    content: string;
  }): Message {
    return this.insertMessage({
      ...input,
      participantId: null,
      allowInternalParent: true,
    });
  }

  private insertMessage(input: {
    id?: string;
    conversationId: string;
    parentMessageId?: string | null;
    role: "system" | "user" | "assistant" | "tool";
    participantId: string | null;
    content: string;
    allowInternalParent: boolean;
  }): Message {
    return this.database.transaction(() => {
      const conversation = this.getConversation(input.conversationId);
      if (input.parentMessageId) {
        const parent = this.getMessage(input.parentMessageId);
        if (parent.conversationId !== conversation.id) {
          throw new StorageError(
            "invalid_parent",
            "A message parent must belong to the same conversation.",
            400,
          );
        }
        if (
          !input.allowInternalParent &&
          parent.role !== "user" &&
          parent.role !== "assistant"
        ) {
          throw new StorageError(
            "invalid_parent",
            "A chat message parent must be a user or assistant message.",
            400,
          );
        }
      }
      const id = input.id ?? identifier();
      const now = timestamp();
      this.database.run(
        `INSERT INTO messages(
           id, conversation_id, parent_message_id, role, participant_id, content,
           revision, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        id,
        input.conversationId,
        input.parentMessageId ?? null,
        input.role,
        input.participantId ?? null,
        input.content,
        now,
        now,
      );
      this.database.run(
        "UPDATE conversations SET revision = revision + 1, updated_at = ? WHERE id = ?",
        now,
        input.conversationId,
      );
      return this.getMessage(id);
    });
  }

  getMessage(id: string): Message {
    const row = this.database.get<Row>(
      "SELECT * FROM messages WHERE id = ?",
      id,
    );
    if (!row) {
      throw new NotFoundError("message", id);
    }
    return this.mapMessage(row);
  }

  getChatMessage(id: string): Message {
    const message = this.getMessage(id);
    this.assertChatMessage(message);
    return message;
  }

  updateMessage(input: {
    id: string;
    expectedRevision: number;
    content: string;
  }): Message {
    return this.database.transaction(() => {
      const current = this.getMessage(input.id);
      this.assertChatMessage(current);
      this.assertRevision(
        "message",
        current.id,
        current.revision,
        input.expectedRevision,
      );
      const now = timestamp();
      this.database.run(
        `UPDATE messages
         SET content = ?, revision = revision + 1, updated_at = ?
         WHERE id = ? AND revision = ?`,
        input.content,
        now,
        current.id,
        input.expectedRevision,
      );
      this.database.run(
        `UPDATE swipes
         SET content = ?, revision = revision + 1, updated_at = ?
         WHERE message_id = ? AND selected = 1`,
        input.content,
        now,
        current.id,
      );
      this.database.run(
        `UPDATE artifacts SET stale = 1, updated_at = ?
         WHERE kind = 'chat_summary'
           AND scope_type = 'conversation'
           AND scope_id = ?`,
        now,
        current.conversationId,
      );
      this.touchConversation(current.conversationId, now);
      return this.getMessage(current.id);
    });
  }

  deleteMessage(id: string, expectedRevision: number): Message {
    return this.database.transaction(() => {
      const current = this.getMessage(id);
      this.assertChatMessage(current);
      this.assertRevision("message", id, current.revision, expectedRevision);
      const now = timestamp();
      this.database.run(
        "DELETE FROM messages WHERE id = ? AND revision = ?",
        id,
        expectedRevision,
      );
      this.database.run(
        `UPDATE conversations
         SET revision = revision + 1, updated_at = ? WHERE id = ?`,
        now,
        current.conversationId,
      );
      this.database.run(
        `UPDATE artifacts SET stale = 1, updated_at = ?
         WHERE kind = 'chat_summary'
           AND scope_type = 'conversation'
           AND scope_id = ?`,
        now,
        current.conversationId,
      );
      return current;
    });
  }

  listMessages(conversationId: string): Array<Message & { swipes: Swipe[] }> {
    this.getConversation(conversationId);
    return this.attachConversationSwipes(
      this.database.all<Row>(
        `SELECT * FROM messages
         WHERE conversation_id = ?
         ORDER BY rowid`,
        conversationId,
      ),
      conversationId,
    );
  }

  listChatMessages(
    conversationId: string,
  ): Array<Message & { swipes: Swipe[] }> {
    this.getConversation(conversationId);
    return this.attachConversationSwipes(
      this.database.all<Row>(
        `SELECT * FROM messages
         WHERE conversation_id = ? AND role IN ('user', 'assistant')
         ORDER BY rowid`,
        conversationId,
      ),
      conversationId,
    );
  }

  listChatMessagesPage(input: {
    conversationId: string;
    limit: number;
    before?: MessagePageCursor;
  }): PageResult<Message & { swipes: Swipe[] }> {
    this.getConversation(input.conversationId);
    const params: Array<string | number> = [input.conversationId];
    let cursorPredicate = "";
    if (input.before !== undefined) {
      cursorPredicate = "AND (created_at < ? OR (created_at = ? AND id < ?))";
      params.push(
        input.before.createdAt,
        input.before.createdAt,
        input.before.id,
      );
    }
    params.push(input.limit + 1);
    const rows = this.database.all<Row>(
      `SELECT * FROM messages
       WHERE conversation_id = ? AND role IN ('user', 'assistant')
       ${cursorPredicate}
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
      ...params,
    );
    const pageRows = rows.slice(0, input.limit);
    const messages = pageRows.map((row) => this.mapMessage(row));
    const swipesByMessage = new Map<string, Swipe[]>();
    if (messages.length > 0) {
      const placeholders = messages.map(() => "?").join(",");
      for (const row of this.database.all<Row>(
        `SELECT * FROM swipes
         WHERE message_id IN (${placeholders})
         ORDER BY message_id, position, id`,
        ...messages.map((message) => message.id),
      )) {
        const swipe = this.mapSwipe(row);
        const current = swipesByMessage.get(swipe.messageId) ?? [];
        current.push(swipe);
        swipesByMessage.set(swipe.messageId, current);
      }
    }
    return {
      items: messages
        .map((message) => ({
          ...message,
          swipes: swipesByMessage.get(message.id) ?? [],
        }))
        .reverse(),
      hasMore: rows.length > input.limit,
    };
  }

  addSwipe(input: {
    id?: string;
    messageId: string;
    content: string;
    selected?: boolean;
  }): Swipe {
    return this.database.transaction(() => {
      const message = this.getMessage(input.messageId);
      const next = this.database.get<{ position: number }>(
        "SELECT COALESCE(MAX(position), -1) + 1 AS position FROM swipes WHERE message_id = ?",
        input.messageId,
      );
      const position = next?.position ?? 0;
      const now = timestamp();
      const id = input.id ?? identifier();
      if (input.selected) {
        this.database.run(
          "UPDATE swipes SET selected = 0 WHERE message_id = ?",
          input.messageId,
        );
      }
      this.database.run(
        `INSERT INTO swipes(id, message_id, position, content, selected, revision, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
        id,
        input.messageId,
        position,
        input.content,
        input.selected ? 1 : 0,
        now,
        now,
      );
      this.database.run(
        input.selected
          ? `UPDATE messages
             SET content = ?, revision = revision + 1, updated_at = ?
             WHERE id = ?`
          : "UPDATE messages SET revision = revision + 1, updated_at = ? WHERE id = ?",
        ...(input.selected
          ? [input.content, now, message.id]
          : [now, message.id]),
      );
      this.touchConversation(message.conversationId, now);
      if (input.selected) {
        this.invalidateConversationSummary(message.conversationId, now);
      }
      return this.getSwipe(id);
    });
  }

  persistAssistantGeneration(
    input: PersistAssistantGenerationInput,
  ): PersistAssistantGenerationResult {
    return this.database.transaction(() => {
      const conversation = this.getConversation(input.conversationId);
      const alternatives = (input.alternatives ?? []).filter(
        (content) => content.length > 0,
      );
      const choices = [input.content, ...alternatives];
      if (input.content.length === 0) {
        throw new StorageError(
          "generation_content_empty",
          "Generated assistant content cannot be empty.",
          400,
        );
      }
      const now = timestamp();

      if (input.targetMessageId !== undefined) {
        if (input.expectedMessageRevision === undefined) {
          throw new StorageError(
            "generation_revision_required",
            "Regeneration requires the expected message revision.",
            400,
          );
        }
        const target = this.getMessage(input.targetMessageId);
        if (
          target.conversationId !== conversation.id ||
          target.role !== "assistant"
        ) {
          throw new NotFoundError("assistant message", input.targetMessageId);
        }
        this.assertRevision(
          "message",
          target.id,
          target.revision,
          input.expectedMessageRevision,
        );
        const next = this.database.get<{ position: number }>(
          "SELECT COALESCE(MAX(position), -1) + 1 AS position FROM swipes WHERE message_id = ?",
          target.id,
        );
        const startPosition = next?.position ?? 0;
        this.database.run(
          "UPDATE swipes SET selected = 0 WHERE message_id = ?",
          target.id,
        );
        choices.forEach((content, index) => {
          this.insertSwipe({
            messageId: target.id,
            content,
            position: startPosition + index,
            selected: index === 0,
            now,
          });
        });
        this.database.run(
          `UPDATE messages
           SET content = ?, generation_status = ?, finish_reason = ?,
               provider_error_code = ?, revision = revision + 1, updated_at = ?
           WHERE id = ? AND revision = ?`,
          input.content,
          input.status,
          input.finishReason,
          input.providerErrorCode ?? null,
          now,
          target.id,
          input.expectedMessageRevision,
        );
        const changed = this.database.get<{ count: number }>(
          "SELECT changes() AS count",
        );
        if ((changed?.count ?? 0) !== 1) {
          throw new ConflictError(
            `Message '${target.id}' changed concurrently.`,
          );
        }
        this.touchConversation(conversation.id, now);
        this.invalidateConversationSummary(conversation.id, now);
        return {
          message: this.getMessage(target.id),
          swipes: this.listSwipes(target.id),
        };
      }

      const messageId = identifier();
      this.database.run(
        `INSERT INTO messages(
           id, conversation_id, parent_message_id, role, participant_id,
           content, generation_status, finish_reason, provider_error_code,
           revision, created_at, updated_at
         ) VALUES (?, ?, NULL, 'assistant', NULL, ?, ?, ?, ?, 1, ?, ?)`,
        messageId,
        conversation.id,
        input.content,
        input.status,
        input.finishReason,
        input.providerErrorCode ?? null,
        now,
        now,
      );
      choices.forEach((content, index) => {
        this.insertSwipe({
          messageId,
          content,
          position: index,
          selected: index === 0,
          now,
        });
      });
      this.touchConversation(conversation.id, now);
      this.invalidateConversationSummary(conversation.id, now);
      return {
        message: this.getMessage(messageId),
        swipes: this.listSwipes(messageId),
      };
    });
  }

  listSwipes(messageId: string): Swipe[] {
    return this.database
      .all<Row>(
        "SELECT * FROM swipes WHERE message_id = ? ORDER BY position, id",
        messageId,
      )
      .map((row) => this.mapSwipe(row));
  }

  selectSwipe(input: {
    messageId: string;
    swipeId: string;
    expectedMessageRevision: number;
  }): { message: Message; swipe: Swipe } {
    return this.database.transaction(() => {
      const message = this.getMessage(input.messageId);
      this.assertRevision(
        "message",
        message.id,
        message.revision,
        input.expectedMessageRevision,
      );
      const swipe = this.getSwipe(input.swipeId);
      if (swipe.messageId !== message.id) {
        throw new NotFoundError("swipe", input.swipeId);
      }
      const now = timestamp();
      this.database.run(
        "UPDATE swipes SET selected = 0 WHERE message_id = ? AND selected = 1",
        message.id,
      );
      this.database.run(
        "UPDATE swipes SET selected = 1 WHERE id = ? AND message_id = ?",
        swipe.id,
        message.id,
      );
      this.database.run(
        `UPDATE messages
         SET content = ?, revision = revision + 1, updated_at = ?
         WHERE id = ? AND revision = ?`,
        swipe.content,
        now,
        message.id,
        input.expectedMessageRevision,
      );
      this.touchConversation(message.conversationId, now);
      this.invalidateConversationSummary(message.conversationId, now);
      return {
        message: this.getMessage(message.id),
        swipe: this.getSwipe(swipe.id),
      };
    });
  }

  createWorldbook(input: CreateWorldbookInput): Worldbook {
    return this.database.transaction(() => {
      const now = timestamp();
      const id = input.id ?? identifier();
      // Imports never carry authorization into the new system.
      const editable =
        input.source === "import" ? false : (input.agentEditable ?? false);
      this.database.run(
        `INSERT INTO worldbooks(
          id, name, agent_editable, revision, legacy_payload_json, created_at, updated_at
        ) VALUES (?, ?, ?, 1, ?, ?, ?)`,
        id,
        input.name,
        editable ? 1 : 0,
        encode(input.legacyPayload ?? {}),
        now,
        now,
      );
      for (const entry of input.entries ?? []) {
        this.insertWorldbookEntry(
          id,
          {
            ...entry,
            position: entry.position ?? this.nextWorldbookEntryPosition(id),
          },
          now,
        );
      }
      return this.getWorldbook(id);
    });
  }

  listWorldbooks(): Worldbook[] {
    return this.database
      .all<Row>("SELECT * FROM worldbooks ORDER BY updated_at DESC, id")
      .map((row) => this.mapWorldbook(row));
  }

  getWorldbook(id: string): Worldbook {
    const row = this.database.get<Row>(
      "SELECT * FROM worldbooks WHERE id = ?",
      id,
    );
    if (!row) {
      throw new NotFoundError("worldbook", id);
    }
    return this.mapWorldbook(row);
  }

  getWorldbookWithEntries(
    id: string,
  ): Worldbook & { entries: WorldbookEntry[] } {
    return { ...this.getWorldbook(id), entries: this.listWorldbookEntries(id) };
  }

  /**
   * @deprecated Retained for compatibility metadata only. Agent write
   * authorization is evaluated per worldbook entry.
   */
  setWorldbookPermission(input: {
    worldbookId: string;
    agentEditable: boolean;
    expectedRevision: number;
    actorKind: ActorKind;
    actorId: string;
  }): Worldbook {
    return this.database.transaction(() => {
      if (input.actorKind !== "human") {
        throw new PermissionError(
          "Only a human actor may change Agent edit permission.",
          {
            actorKind: input.actorKind,
          },
        );
      }
      const current = this.getWorldbook(input.worldbookId);
      this.assertRevision(
        "worldbook",
        current.id,
        current.revision,
        input.expectedRevision,
      );
      const now = timestamp();
      this.database.run(
        `UPDATE worldbooks
         SET agent_editable = ?, revision = revision + 1, updated_at = ?,
             permission_updated_by = ?, permission_updated_at = ?
         WHERE id = ? AND revision = ?`,
        input.agentEditable ? 1 : 0,
        now,
        input.actorId,
        now,
        input.worldbookId,
        input.expectedRevision,
      );
      const after = this.getWorldbook(input.worldbookId);
      this.insertAudit({
        actorKind: "human",
        actorId: input.actorId,
        action: "worldbook.permission.update",
        resourceType: "worldbook",
        resourceId: input.worldbookId,
        before: current,
        after,
        inversePatch: {
          operation: "worldbook.permission.restore",
          agentEditable: current.agentEditable,
          expectedRevision: after.revision,
        },
      });
      return after;
    });
  }

  bindWorldbook(input: {
    id?: string;
    worldbookId: string;
    scopeType: BindingScope;
    scopeId?: string | null;
  }): WorldbookBinding {
    return this.database.transaction(() => {
      this.getWorldbook(input.worldbookId);
      const id = input.id ?? identifier();
      const now = timestamp();
      this.database.run(
        `INSERT INTO worldbook_bindings(id, worldbook_id, scope_type, scope_id, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        id,
        input.worldbookId,
        input.scopeType,
        input.scopeId ?? null,
        now,
      );
      return this.getWorldbookBinding(id);
    });
  }

  listWorldbookBindings(worldbookId: string): WorldbookBinding[] {
    this.getWorldbook(worldbookId);
    return this.database
      .all<Row>(
        "SELECT * FROM worldbook_bindings WHERE worldbook_id = ? ORDER BY created_at, id",
        worldbookId,
      )
      .map((row) => this.mapWorldbookBinding(row));
  }

  listWorldbookBindingsBatch(
    worldbookIds: readonly string[],
  ): WorldbookBinding[] {
    if (worldbookIds.length === 0) return [];
    const placeholders = worldbookIds.map(() => "?").join(", ");
    return this.database
      .all<Row>(
        `SELECT * FROM worldbook_bindings WHERE worldbook_id IN (${placeholders}) ORDER BY worldbook_id, created_at, id`,
        ...worldbookIds,
      )
      .map((row) => this.mapWorldbookBinding(row));
  }

  getWorldbookBinding(id: string): WorldbookBinding {
    const row = this.database.get<Row>(
      "SELECT * FROM worldbook_bindings WHERE id = ?",
      id,
    );
    if (!row) {
      throw new NotFoundError("worldbook binding", id);
    }
    return this.mapWorldbookBinding(row);
  }

  listWorldbookEntries(worldbookId: string): WorldbookEntry[] {
    this.getWorldbook(worldbookId);
    return this.database
      .all<Row>(
        "SELECT * FROM worldbook_entries WHERE worldbook_id = ? ORDER BY position, id",
        worldbookId,
      )
      .map((row) => this.mapWorldbookEntry(row));
  }

  listWorldbookEntriesBatch(worldbookIds: readonly string[]): WorldbookEntry[] {
    if (worldbookIds.length === 0) return [];
    const placeholders = worldbookIds.map(() => "?").join(", ");
    return this.database
      .all<Row>(
        `SELECT * FROM worldbook_entries WHERE worldbook_id IN (${placeholders}) ORDER BY worldbook_id, position, id`,
        ...worldbookIds,
      )
      .map((row) => this.mapWorldbookEntry(row));
  }

  getWorldbookEntry(id: string): WorldbookEntry {
    const row = this.database.get<Row>(
      "SELECT * FROM worldbook_entries WHERE id = ?",
      id,
    );
    if (!row) {
      throw new NotFoundError("worldbook entry", id);
    }
    return this.mapWorldbookEntry(row);
  }

  setWorldbookEntryPermission(input: {
    worldbookId: string;
    entryId: string;
    expectedWorldbookRevision: number;
    expectedEntryRevision: number;
    agentEditable: boolean;
    actorKind: ActorKind;
    actorId: string;
  }): { worldbook: Worldbook; entry: WorldbookEntry } {
    return this.database.transaction(() => {
      if (input.actorKind !== "human") {
        throw new PermissionError(
          "Only a human actor may change Agent edit permission.",
          {
            actorKind: input.actorKind,
            worldbookId: input.worldbookId,
            entryId: input.entryId,
          },
        );
      }
      const worldbook = this.getWorldbook(input.worldbookId);
      const entry = this.getWorldbookEntry(input.entryId);
      if (entry.worldbookId !== worldbook.id) {
        throw new NotFoundError("worldbook entry", input.entryId);
      }
      this.assertRevision(
        "worldbook",
        worldbook.id,
        worldbook.revision,
        input.expectedWorldbookRevision,
      );
      this.assertRevision(
        "worldbook entry",
        entry.id,
        entry.revision,
        input.expectedEntryRevision,
      );

      const now = timestamp();
      this.database.run(
        `UPDATE worldbook_entries
         SET agent_editable = ?, revision = revision + 1, updated_at = ?,
             permission_updated_by = ?, permission_updated_at = ?
         WHERE id = ? AND worldbook_id = ? AND revision = ?`,
        input.agentEditable ? 1 : 0,
        now,
        input.actorId,
        now,
        entry.id,
        worldbook.id,
        input.expectedEntryRevision,
      );
      this.bumpWorldbook(worldbook.id, input.expectedWorldbookRevision, now);

      const after = {
        worldbook: this.getWorldbook(worldbook.id),
        entry: this.getWorldbookEntry(entry.id),
      };
      this.insertAudit({
        actorKind: "human",
        actorId: input.actorId,
        action: "worldbook.entry.permission.update",
        resourceType: "worldbook-entry",
        resourceId: entry.id,
        before: entry,
        after: after.entry,
        inversePatch: {
          operation: "worldbook.entry.permission.restore",
          agentEditable: entry.agentEditable,
          expectedWorldbookRevision: after.worldbook.revision,
          expectedEntryRevision: after.entry.revision,
        },
      });
      return after;
    });
  }

  createWorldbookEntryHuman(input: {
    worldbookId: string;
    expectedWorldbookRevision: number;
    entry: {
      id?: string;
      legacyUid?: number | null;
      keys?: string[];
      content: string;
      enabled?: boolean;
      position?: number;
      metadata?: JsonObject;
    };
  }): { worldbook: Worldbook; entry: WorldbookEntry } {
    return this.database.transaction(() => {
      const worldbook = this.getWorldbook(input.worldbookId);
      this.assertRevision(
        "worldbook",
        worldbook.id,
        worldbook.revision,
        input.expectedWorldbookRevision,
      );
      const now = timestamp();
      const entry = this.insertWorldbookEntry(
        input.worldbookId,
        {
          ...input.entry,
          position:
            input.entry.position ??
            this.nextWorldbookEntryPosition(input.worldbookId),
        },
        now,
      );
      this.bumpWorldbook(
        input.worldbookId,
        input.expectedWorldbookRevision,
        now,
      );
      return { worldbook: this.getWorldbook(input.worldbookId), entry };
    });
  }

  updateWorldbookEntryHuman(input: {
    worldbookId: string;
    entryId: string;
    expectedWorldbookRevision: number;
    expectedEntryRevision: number;
    patch: {
      keys?: string[];
      content?: string;
      enabled?: boolean;
      position?: number;
      metadata?: JsonObject;
    };
  }): { worldbook: Worldbook; entry: WorldbookEntry } {
    return this.database.transaction(() => {
      const worldbook = this.getWorldbook(input.worldbookId);
      const entry = this.getWorldbookEntry(input.entryId);
      if (entry.worldbookId !== worldbook.id) {
        throw new NotFoundError("worldbook entry", input.entryId);
      }
      this.assertRevision(
        "worldbook",
        worldbook.id,
        worldbook.revision,
        input.expectedWorldbookRevision,
      );
      this.assertRevision(
        "worldbook entry",
        entry.id,
        entry.revision,
        input.expectedEntryRevision,
      );
      const next = { ...entry, ...input.patch };
      const now = timestamp();
      this.database.run(
        `UPDATE worldbook_entries SET
           keys_json = ?, content = ?, enabled = ?, position = ?, metadata_json = ?,
           revision = revision + 1, updated_at = ?
         WHERE id = ? AND revision = ?`,
        encode(next.keys),
        next.content,
        next.enabled ? 1 : 0,
        next.position,
        encode(next.metadata),
        now,
        entry.id,
        input.expectedEntryRevision,
      );
      this.bumpWorldbook(worldbook.id, input.expectedWorldbookRevision, now);
      return {
        worldbook: this.getWorldbook(worldbook.id),
        entry: this.getWorldbookEntry(entry.id),
      };
    });
  }

  deleteWorldbookEntryHuman(input: {
    worldbookId: string;
    entryId: string;
    expectedWorldbookRevision: number;
    expectedEntryRevision: number;
    confirmed: boolean;
  }): { worldbook: Worldbook; deleted: WorldbookEntry } {
    return this.database.transaction(() => {
      if (!input.confirmed) {
        throw new StorageError(
          "confirmation_required",
          "Deleting a worldbook entry requires confirmation.",
          409,
        );
      }
      const worldbook = this.getWorldbook(input.worldbookId);
      const entry = this.getWorldbookEntry(input.entryId);
      if (entry.worldbookId !== worldbook.id) {
        throw new NotFoundError("worldbook entry", input.entryId);
      }
      this.assertRevision(
        "worldbook",
        worldbook.id,
        worldbook.revision,
        input.expectedWorldbookRevision,
      );
      this.assertRevision(
        "worldbook entry",
        entry.id,
        entry.revision,
        input.expectedEntryRevision,
      );
      this.database.run("DELETE FROM worldbook_entries WHERE id = ?", entry.id);
      this.bumpWorldbook(
        worldbook.id,
        input.expectedWorldbookRevision,
        timestamp(),
      );
      return { worldbook: this.getWorldbook(worldbook.id), deleted: entry };
    });
  }

  searchWorldbookEntries(input: {
    query: string;
    worldbookId?: string;
    limit?: number;
  }): WorldbookEntry[] {
    const query = `%${input.query.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    const limit = Math.max(1, Math.min(input.limit ?? 20, 100));
    const rows = input.worldbookId
      ? this.database.all<Row>(
          `SELECT * FROM worldbook_entries
           WHERE worldbook_id = ? AND enabled = 1
             AND (content LIKE ? ESCAPE '\\' OR keys_json LIKE ? ESCAPE '\\')
           ORDER BY position, id LIMIT ?`,
          input.worldbookId,
          query,
          query,
          limit,
        )
      : this.database.all<Row>(
          `SELECT * FROM worldbook_entries
           WHERE enabled = 1 AND (content LIKE ? ESCAPE '\\' OR keys_json LIKE ? ESCAPE '\\')
           ORDER BY updated_at DESC, id LIMIT ?`,
          query,
          query,
          limit,
        );
    return rows.map((row) => this.mapWorldbookEntry(row));
  }

  createPreset(input: {
    id?: string;
    name: string;
    kind: string;
    payload?: JsonObject;
    legacyPayload?: JsonObject;
  }): Preset {
    const id = input.id ?? identifier();
    const now = timestamp();
    this.database.run(
      `INSERT INTO presets(
        id, name, kind, payload_json, legacy_payload_json, revision, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      id,
      input.name,
      input.kind,
      encode(input.payload ?? {}),
      encode(input.legacyPayload ?? {}),
      now,
      now,
    );
    return this.getPreset(id);
  }

  listPresets(): Preset[] {
    return this.database
      .all<Row>("SELECT * FROM presets ORDER BY updated_at DESC, id")
      .map((row) => this.mapPreset(row));
  }

  getPreset(id: string): Preset {
    const row = this.database.get<Row>(
      "SELECT * FROM presets WHERE id = ?",
      id,
    );
    if (!row) {
      throw new NotFoundError("preset", id);
    }
    return this.mapPreset(row);
  }

  createProviderConnection(input: {
    id?: string;
    name: string;
    protocol: ProviderConnection["protocol"];
    baseUrl: string;
    model: string;
    headers?: Record<string, string>;
    apiKeyRef?: string | null;
    nativeToolCalling?: boolean;
  }): ProviderConnection {
    const id = input.id ?? identifier();
    const now = timestamp();
    this.database.run(
      `INSERT INTO provider_connections(
         id, name, protocol, base_url, model, headers_json, api_key_ref,
         native_tool_calling, revision, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      id,
      input.name,
      input.protocol,
      input.baseUrl,
      input.model,
      encode(input.headers ?? {}),
      input.apiKeyRef ?? null,
      input.nativeToolCalling ? 1 : 0,
      now,
      now,
    );
    return this.getProviderConnection(id);
  }

  listProviderConnections(): ProviderConnection[] {
    return this.database
      .all<Row>(
        "SELECT * FROM provider_connections ORDER BY updated_at DESC, id",
      )
      .map((row) => this.mapProviderConnection(row));
  }

  getProviderConnection(id: string): ProviderConnection {
    const row = this.database.get<Row>(
      "SELECT * FROM provider_connections WHERE id = ?",
      id,
    );
    if (!row) throw new NotFoundError("provider connection", id);
    return this.mapProviderConnection(row);
  }

  updateProviderConnection(input: {
    id: string;
    expectedRevision: number;
    patch: Partial<
      Pick<
        ProviderConnection,
        | "name"
        | "protocol"
        | "baseUrl"
        | "model"
        | "headers"
        | "apiKeyRef"
        | "nativeToolCalling"
      >
    >;
  }): ProviderConnection {
    return this.database.transaction(() => {
      const current = this.getProviderConnection(input.id);
      this.assertRevision(
        "provider connection",
        current.id,
        current.revision,
        input.expectedRevision,
      );
      const next = { ...current, ...input.patch };
      this.database.run(
        `UPDATE provider_connections
         SET name = ?, protocol = ?, base_url = ?, model = ?,
             headers_json = ?, api_key_ref = ?, native_tool_calling = ?,
             revision = revision + 1, updated_at = ?
         WHERE id = ? AND revision = ?`,
        next.name,
        next.protocol,
        next.baseUrl,
        next.model,
        encode(next.headers),
        next.apiKeyRef,
        next.nativeToolCalling ? 1 : 0,
        timestamp(),
        current.id,
        input.expectedRevision,
      );
      return this.getProviderConnection(current.id);
    });
  }

  updatePreset(input: {
    id: string;
    expectedRevision: number;
    patch: { name?: string; kind?: string; payload?: JsonObject };
  }): Preset {
    return this.database.transaction(() => {
      const current = this.getPreset(input.id);
      this.assertRevision(
        "preset",
        current.id,
        current.revision,
        input.expectedRevision,
      );
      const next = { ...current, ...input.patch };
      this.database.run(
        `UPDATE presets SET name = ?, kind = ?, payload_json = ?,
         revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?`,
        next.name,
        next.kind,
        encode(next.payload),
        timestamp(),
        input.id,
        input.expectedRevision,
      );
      return this.getPreset(input.id);
    });
  }

  deletePreset(id: string, expectedRevision: number): Preset {
    return this.database.transaction(() => {
      const current = this.getPreset(id);
      this.assertRevision(
        "preset",
        current.id,
        current.revision,
        expectedRevision,
      );
      this.database.run(
        "DELETE FROM artifacts WHERE scope_type = 'preset' AND scope_id = ?",
        id,
      );
      this.database.run(
        `DELETE FROM extension_settings
         WHERE extension_id = 'stn.regex' AND key = ?`,
        `preset:${id}`,
      );
      this.database.run(
        `DELETE FROM extension_settings
         WHERE extension_id = 'stn.tavern-helper'
           AND (
             key = ?
             OR key = ?
             OR key LIKE ?
           )`,
        `preset:${id}`,
        `variables:preset:${id}`,
        `variables:script:preset:${id}:%`,
      );
      this.database.run(
        "DELETE FROM presets WHERE id = ? AND revision = ?",
        id,
        expectedRevision,
      );
      return current;
    });
  }

  createArtifact(input: CreateArtifactInput): Artifact {
    const id = input.id ?? identifier();
    const now = timestamp();
    this.database.run(
      `INSERT INTO artifacts(
         id, kind, scope_type, scope_id, title, content, metadata_json,
         revision, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      id,
      input.kind,
      input.scopeType,
      input.scopeId,
      input.title ?? "",
      input.content,
      encode(input.metadata ?? {}),
      now,
      now,
    );
    return this.getArtifact(id);
  }

  listArtifacts(
    filter: {
      kind?: string;
      scopeType?: string;
      scopeId?: string;
    } = {},
  ): Artifact[] {
    const clauses: string[] = [];
    const params: string[] = [];
    if (filter.kind) {
      clauses.push("kind = ?");
      params.push(filter.kind);
    }
    if (filter.scopeType) {
      clauses.push("scope_type = ?");
      params.push(filter.scopeType);
    }
    if (filter.scopeId) {
      clauses.push("scope_id = ?");
      params.push(filter.scopeId);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    return this.database
      .all<Row>(
        `SELECT * FROM artifacts ${where} ORDER BY updated_at DESC, id`,
        ...params,
      )
      .map((row) => this.mapArtifact(row));
  }

  getArtifact(id: string): Artifact {
    const row = this.database.get<Row>(
      "SELECT * FROM artifacts WHERE id = ?",
      id,
    );
    if (!row) {
      throw new NotFoundError("artifact", id);
    }
    return this.mapArtifact(row);
  }

  getLatestArtifact(
    kind: string,
    scopeType: string,
    scopeId: string,
  ): Artifact | null {
    const row = this.database.get<Row>(
      `SELECT * FROM artifacts
       WHERE kind = ? AND scope_type = ? AND scope_id = ?
       ORDER BY updated_at DESC, id DESC LIMIT 1`,
      kind,
      scopeType,
      scopeId,
    );
    return row ? this.mapArtifact(row) : null;
  }

  updateArtifact(input: {
    id: string;
    expectedRevision: number;
    patch: { title?: string; content?: string; metadata?: JsonObject };
  }): Artifact {
    return this.database.transaction(() => {
      const current = this.getArtifact(input.id);
      this.assertRevision(
        "artifact",
        current.id,
        current.revision,
        input.expectedRevision,
      );
      const next = { ...current, ...input.patch };
      this.database.run(
        `UPDATE artifacts
         SET title = ?, content = ?, metadata_json = ?, revision = revision + 1, updated_at = ?
         WHERE id = ? AND revision = ?`,
        next.title,
        next.content,
        encode(next.metadata),
        timestamp(),
        input.id,
        input.expectedRevision,
      );
      return this.getArtifact(input.id);
    });
  }

  setExtensionSetting(
    extensionId: string,
    key: string,
    value: JsonValue,
  ): ExtensionSetting {
    const now = timestamp();
    this.database.run(
      `INSERT INTO extension_settings(extension_id, key, value_json, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(extension_id, key)
       DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      extensionId,
      key,
      encode(value),
      now,
    );
    return this.getExtensionSetting(extensionId, key);
  }

  getExtensionSetting(extensionId: string, key: string): ExtensionSetting {
    const row = this.database.get<Row>(
      "SELECT * FROM extension_settings WHERE extension_id = ? AND key = ?",
      extensionId,
      key,
    );
    if (!row) {
      throw new NotFoundError("extension setting", `${extensionId}:${key}`);
    }
    return this.mapExtensionSetting(row);
  }

  getLatestMessageExtensionSettingForCard(
    extensionId: string,
    cardId: string,
  ): ExtensionSetting | undefined {
    const row = this.database.get<Row>(
      `SELECT settings.*
       FROM extension_settings AS settings
       JOIN messages AS message
         ON settings.key = 'variables:message:' || message.id
       JOIN conversations AS conversation
         ON conversation.id = message.conversation_id
       WHERE settings.extension_id = ?
         AND conversation.card_id = ?
       ORDER BY settings.updated_at DESC, message.updated_at DESC, message.id DESC
       LIMIT 1`,
      extensionId,
      cardId,
    );
    return row ? this.mapExtensionSetting(row) : undefined;
  }

  insertAudit(input: {
    id?: string;
    runId?: string | null;
    toolCallId?: string | null;
    actorKind: ActorKind;
    actorId: string;
    action: string;
    resourceType: string;
    resourceId: string;
    before: unknown;
    after: unknown;
    inversePatch: JsonObject;
  }): string {
    const id = input.id ?? identifier();
    this.database.run(
      `INSERT INTO audit_log(
         id, run_id, tool_call_id, actor_kind, actor_id, action, resource_type, resource_id,
         before_json, after_json, inverse_patch_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.runId ?? null,
      input.toolCallId ?? null,
      input.actorKind,
      input.actorId,
      input.action,
      input.resourceType,
      input.resourceId,
      input.before === null ? null : encode(input.before),
      input.after === null ? null : encode(input.after),
      encode(input.inversePatch),
      timestamp(),
    );
    return id;
  }

  getAuditRecord(id: string): AuditRecord {
    const row = this.database.get<Row>(
      "SELECT * FROM audit_log WHERE id = ?",
      id,
    );
    if (!row) {
      throw new NotFoundError("audit record", id);
    }
    return this.mapAudit(row);
  }

  listAuditRecords(
    filter: {
      runId?: string;
      resourceType?: string;
      resourceId?: string;
    } = {},
  ): AuditRecord[] {
    const clauses: string[] = [];
    const params: string[] = [];
    if (filter.runId) {
      clauses.push("run_id = ?");
      params.push(filter.runId);
    }
    if (filter.resourceType) {
      clauses.push("resource_type = ?");
      params.push(filter.resourceType);
    }
    if (filter.resourceId) {
      clauses.push("resource_id = ?");
      params.push(filter.resourceId);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    return this.database
      .all<Row>(
        `SELECT * FROM audit_log ${where} ORDER BY created_at DESC, id DESC`,
        ...params,
      )
      .map((row) => this.mapAudit(row));
  }

  assertRevision(
    resource: string,
    id: string,
    actualRevision: number,
    expectedRevision: number,
  ): void {
    if (actualRevision !== expectedRevision) {
      throw new ConflictError(
        `${resource} '${id}' revision changed from ${expectedRevision} to ${actualRevision}.`,
        { resource, id, expectedRevision, actualRevision },
      );
    }
  }

  private createParticipantInternal(
    input: CreateParticipantInput & { cardId?: string | null },
    now: string,
  ): Participant {
    const id = input.id ?? identifier();
    this.database.run(
      `INSERT INTO participants(
         id, card_id, name, role, profile_json, legacy_payload_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.cardId ?? null,
      input.name,
      input.role ?? "participant",
      encode(input.profile ?? {}),
      encode(input.legacyPayload ?? {}),
      now,
      now,
    );
    return this.getParticipant(id);
  }

  private insertWorldbookEntry(
    worldbookId: string,
    input: {
      id?: string;
      legacyUid?: number | null;
      keys?: string[];
      content: string;
      enabled?: boolean;
      position: number;
      metadata?: JsonObject;
    },
    now: string,
  ): WorldbookEntry {
    const id = input.id ?? identifier();
    this.database.run(
      `INSERT INTO worldbook_entries(
         id, worldbook_id, legacy_uid, keys_json, content, enabled, position,
         agent_editable, revision, metadata_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?, ?)`,
      id,
      worldbookId,
      input.legacyUid ?? null,
      encode(input.keys ?? []),
      input.content,
      input.enabled === false ? 0 : 1,
      input.position,
      encode(input.metadata ?? {}),
      now,
      now,
    );
    return this.getWorldbookEntry(id);
  }

  private nextWorldbookEntryPosition(worldbookId: string): number {
    const row = this.database.get<{ position: number }>(
      "SELECT COALESCE(MAX(position), -1) + 1 AS position FROM worldbook_entries WHERE worldbook_id = ?",
      worldbookId,
    );
    return row?.position ?? 0;
  }

  private bumpWorldbook(
    worldbookId: string,
    expectedRevision: number,
    now: string,
  ): void {
    this.database.run(
      `UPDATE worldbooks SET revision = revision + 1, updated_at = ?
       WHERE id = ? AND revision = ?`,
      now,
      worldbookId,
      expectedRevision,
    );
    const changes = this.database.get<{ count: number }>(
      "SELECT changes() AS count",
    );
    if ((changes?.count ?? 0) !== 1) {
      const current = this.getWorldbook(worldbookId);
      this.assertRevision(
        "worldbook",
        worldbookId,
        current.revision,
        expectedRevision,
      );
    }
  }

  private getSwipe(id: string): Swipe {
    const row = this.database.get<Row>("SELECT * FROM swipes WHERE id = ?", id);
    if (!row) {
      throw new NotFoundError("swipe", id);
    }
    return this.mapSwipe(row);
  }

  private mapCard(row: Row): Card {
    return {
      id: String(row.id),
      kind: String(row.kind) as CardKind,
      name: String(row.name),
      description: String(row.description),
      revision: Number(row.revision ?? 1),
      legacyPayload: decodeObject(String(row.legacy_payload_json)),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapExtensionSetting(row: Row): ExtensionSetting {
    return {
      extensionId: String(row.extension_id),
      key: String(row.key),
      value: decodeValue(String(row.value_json)),
      updatedAt: String(row.updated_at),
    };
  }

  private mapParticipant(row: Row): Participant {
    return {
      id: String(row.id),
      cardId: row.card_id === null ? null : String(row.card_id),
      name: String(row.name),
      role: String(row.role),
      profile: decodeObject(String(row.profile_json)),
      legacyPayload: decodeObject(String(row.legacy_payload_json)),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapPersona(row: Row): Persona {
    return {
      id: String(row.id),
      name: String(row.name),
      description: String(row.description),
      title: String(row.title),
      isDefault: asBoolean(row.is_default),
      revision: Number(row.revision),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapConversation(row: Row): Conversation {
    if (row.card_id === null) {
      throw new StorageError(
        "invalid_conversation_card",
        `Conversation '${String(row.id)}' is not bound to a card.`,
        500,
        { conversationId: String(row.id) },
      );
    }
    return {
      id: String(row.id),
      title: String(row.title),
      cardId: String(row.card_id),
      personaId:
        row.persona_id === null || row.persona_id === undefined
          ? null
          : String(row.persona_id),
      revision: Number(row.revision),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapMessage(row: Row): Message {
    return {
      id: String(row.id),
      conversationId: String(row.conversation_id),
      parentMessageId:
        row.parent_message_id === null ? null : String(row.parent_message_id),
      role: String(row.role) as MessageRole,
      participantId:
        row.participant_id === null ? null : String(row.participant_id),
      content: String(row.content),
      generationStatus: String(
        row.generation_status ?? "complete",
      ) as GenerationStatus,
      finishReason:
        row.finish_reason === null || row.finish_reason === undefined
          ? null
          : (String(row.finish_reason) as GenerationFinishReason),
      providerErrorCode:
        row.provider_error_code === null ||
        row.provider_error_code === undefined
          ? null
          : String(row.provider_error_code),
      revision: Number(row.revision),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private attachConversationSwipes(
    rows: Row[],
    conversationId: string,
  ): Array<Message & { swipes: Swipe[] }> {
    const messages = rows.map((row) => this.mapMessage(row));
    if (messages.length === 0) return [];
    const swipesByMessage = new Map<string, Swipe[]>();
    for (const row of this.database.all<Row>(
      `SELECT swipes.*
       FROM swipes
       JOIN messages ON messages.id = swipes.message_id
       WHERE messages.conversation_id = ?
       ORDER BY swipes.message_id, swipes.position, swipes.id`,
      conversationId,
    )) {
      const swipe = this.mapSwipe(row);
      const current = swipesByMessage.get(swipe.messageId) ?? [];
      current.push(swipe);
      swipesByMessage.set(swipe.messageId, current);
    }
    return messages.map((message) => ({
      ...message,
      swipes: swipesByMessage.get(message.id) ?? [],
    }));
  }

  private insertSwipe(input: {
    messageId: string;
    content: string;
    position: number;
    selected: boolean;
    now: string;
  }): void {
    this.database.run(
      `INSERT INTO swipes(
         id, message_id, position, content, selected, revision, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      identifier(),
      input.messageId,
      input.position,
      input.content,
      input.selected ? 1 : 0,
      input.now,
      input.now,
    );
  }

  private touchConversation(conversationId: string, now: string): void {
    this.database.run(
      `UPDATE conversations
       SET revision = revision + 1, updated_at = ?
       WHERE id = ?`,
      now,
      conversationId,
    );
  }

  private invalidateConversationSummary(
    conversationId: string,
    now: string,
  ): void {
    this.database.run(
      `UPDATE artifacts SET stale = 1, updated_at = ?
       WHERE kind = 'chat_summary'
         AND scope_type = 'conversation'
         AND scope_id = ?`,
      now,
      conversationId,
    );
  }

  private assertChatMessage(message: Message): void {
    if (message.role !== "user" && message.role !== "assistant") {
      throw new StorageError(
        "internal_message_not_editable",
        "System and tool messages are internal and cannot be edited as chat messages.",
        400,
      );
    }
  }

  private mapSwipe(row: Row): Swipe {
    return {
      id: String(row.id),
      messageId: String(row.message_id),
      position: Number(row.position),
      content: String(row.content),
      selected: asBoolean(row.selected),
      revision: Number(row.revision),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapWorldbook(row: Row): Worldbook {
    return {
      id: String(row.id),
      name: String(row.name),
      agentEditable: asBoolean(row.agent_editable),
      revision: Number(row.revision),
      agentWriteMode:
        row.agent_write_mode === "auto-create-update"
          ? "auto-create-update"
          : "confirm",
      permissionUpdatedBy:
        row.permission_updated_by === null ||
        row.permission_updated_by === undefined
          ? null
          : String(row.permission_updated_by),
      permissionUpdatedAt:
        row.permission_updated_at === null ||
        row.permission_updated_at === undefined
          ? null
          : String(row.permission_updated_at),
      legacyPayload: decodeObject(String(row.legacy_payload_json)),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapWorldbookEntry(row: Row): WorldbookEntry {
    return {
      id: String(row.id),
      worldbookId: String(row.worldbook_id),
      legacyUid: row.legacy_uid === null ? null : Number(row.legacy_uid),
      keys: decodeStringArray(String(row.keys_json)),
      content: String(row.content),
      enabled: asBoolean(row.enabled),
      position: Number(row.position),
      agentEditable: asBoolean(row.agent_editable),
      permissionUpdatedBy:
        row.permission_updated_by === null ||
        row.permission_updated_by === undefined
          ? null
          : String(row.permission_updated_by),
      permissionUpdatedAt:
        row.permission_updated_at === null ||
        row.permission_updated_at === undefined
          ? null
          : String(row.permission_updated_at),
      revision: Number(row.revision),
      metadata: decodeObject(String(row.metadata_json)),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapWorldbookBinding(row: Row): WorldbookBinding {
    return {
      id: String(row.id),
      worldbookId: String(row.worldbook_id),
      scopeType: String(row.scope_type) as BindingScope,
      scopeId: row.scope_id === null ? null : String(row.scope_id),
      createdAt: String(row.created_at),
    };
  }

  private mapPreset(row: Row): Preset {
    return {
      id: String(row.id),
      name: String(row.name),
      kind: String(row.kind),
      payload: decodeObject(String(row.payload_json)),
      legacyPayload: decodeObject(String(row.legacy_payload_json)),
      revision: Number(row.revision),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapProviderConnection(row: Row): ProviderConnection {
    const headers = decodeObject(String(row.headers_json));
    const stringHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      if (typeof value === "string") stringHeaders[key] = value;
    }
    return {
      id: String(row.id),
      name: String(row.name),
      protocol: String(row.protocol) as ProviderConnection["protocol"],
      baseUrl: String(row.base_url),
      model: String(row.model),
      headers: stringHeaders,
      apiKeyRef: row.api_key_ref === null ? null : String(row.api_key_ref),
      nativeToolCalling: asBoolean(row.native_tool_calling),
      revision: Number(row.revision),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapArtifact(row: Row): Artifact {
    return {
      id: String(row.id),
      kind: String(row.kind),
      scopeType: String(row.scope_type),
      scopeId: String(row.scope_id),
      title: String(row.title),
      content: String(row.content),
      metadata: decodeObject(String(row.metadata_json)),
      sourceFromMessageId:
        row.source_from_message_id === null ||
        row.source_from_message_id === undefined
          ? null
          : String(row.source_from_message_id),
      sourceToMessageId:
        row.source_to_message_id === null ||
        row.source_to_message_id === undefined
          ? null
          : String(row.source_to_message_id),
      stale: row.stale === undefined ? false : asBoolean(row.stale),
      lockedFields:
        row.locked_fields_json === undefined
          ? []
          : decodeStringArray(String(row.locked_fields_json)),
      revision: Number(row.revision),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapAudit(row: Row): AuditRecord {
    return {
      id: String(row.id),
      runId: row.run_id === null ? null : String(row.run_id),
      toolCallId: row.tool_call_id === null ? null : String(row.tool_call_id),
      actorKind: String(row.actor_kind) as ActorKind,
      actorId: String(row.actor_id),
      action: String(row.action),
      resourceType: String(row.resource_type),
      resourceId: String(row.resource_id),
      before: decodeValue(
        row.before_json === null ? null : String(row.before_json),
      ),
      after: decodeValue(
        row.after_json === null ? null : String(row.after_json),
      ),
      inversePatch: decodeObject(String(row.inverse_patch_json)),
      undoneAt: row.undone_at === null ? null : String(row.undone_at),
      undoAuditId:
        row.undo_audit_id === null ? null : String(row.undo_audit_id),
      createdAt: String(row.created_at),
    };
  }
}
