import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { applyRegexScriptsWithDiagnostics } from "@stn/core";
import { CardSchema, type JsonObject, type JsonValue } from "@stn/contracts";

import { envelope, type ServerContext } from "../context.js";
import { collectAuthorizedConversationRegex } from "../regex-service.js";

const entityId = z.string().trim().min(1).max(256);

const conversationCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(1024),
    cardId: entityId,
    personaId: entityId.nullish(),
  })
  .strict();

const cardConversationCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(1024),
  })
  .strict();

const conversationListQuerySchema = z
  .object({
    cardId: entityId.optional(),
  })
  .strict();

const messageCreateSchema = z
  .object({
    content: z.string().max(2_000_000),
    parentMessageId: entityId.nullish(),
    role: z.enum(["user", "assistant"]).default("user"),
  })
  .strict();

const tavernHelperMessageCreateSchema = messageCreateSchema;

const messageListQuerySchema = z
  .object({
    presetId: entityId.optional(),
  })
  .strict();

const worldbookInsertionPositions = [
  "before-card",
  "after-card",
  "author-note-top",
  "author-note-bottom",
  "at-depth",
  "examples-top",
  "examples-bottom",
  "outlet",
] as const;

const worldbookEntryUpdateSchema = z
  .object({
    expectedWorldbookRevision: z.number().int().nonnegative(),
    expectedEntryRevision: z.number().int().nonnegative(),
    title: z.string().trim().min(1).max(1_024).optional(),
    primaryKeys: z.array(z.string().max(1_024)).max(1_024).optional(),
    secondaryKeys: z.array(z.string().max(1_024)).max(1_024).optional(),
    secondaryLogic: z.enum(["any", "all", "not-any", "not-all"]).optional(),
    selective: z.boolean().optional(),
    content: z.string().max(2_000_000).optional(),
    enabled: z.boolean().optional(),
    constant: z.boolean().optional(),
    caseSensitive: z.boolean().optional(),
    matchWholeWords: z.boolean().optional(),
    useRegex: z.boolean().optional(),
    scanDepth: z.number().int().min(1).max(10_000).nullable().optional(),
    recursion: z.boolean().optional(),
    preventRecursion: z.boolean().optional(),
    excludeRecursion: z.boolean().optional(),
    delayUntilRecursion: z.boolean().optional(),
    insertionPosition: z
      .enum(worldbookInsertionPositions)
      .nullable()
      .optional(),
    outletName: z.string().trim().max(1_024).nullable().optional(),
    insertionDepth: z.number().int().min(0).max(10_000).nullable().optional(),
    insertionRole: z.enum(["system", "user", "assistant"]).optional(),
    order: z.number().finite().min(-1_000_000).max(1_000_000).optional(),
    priority: z.number().finite().min(-1_000_000).max(1_000_000).optional(),
    probability: z.number().finite().min(0).max(100).optional(),
  })
  .strict();

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function metadataString(
  metadata: JsonObject,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function metadataStrings(
  metadata: JsonObject,
  key: string,
): string[] | undefined {
  const value = metadata[key];
  return Array.isArray(value) &&
    value.every((item): item is string => typeof item === "string")
    ? value
    : undefined;
}

function metadataBoolean(
  metadata: JsonObject,
  key: string,
  fallback: boolean,
): boolean {
  const value = metadata[key];
  return typeof value === "boolean" ? value : fallback;
}

function metadataNumber(metadata: JsonObject, key: string): number | undefined {
  const value = metadata[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function setMetadata(
  metadata: JsonObject,
  key: string,
  value: JsonValue | undefined,
): void {
  if (value === undefined) return;
  if (value === null) {
    delete metadata[key];
  } else {
    metadata[key] = value;
  }
}

function conversationDto(context: ServerContext, id: string) {
  const conversation = context.store.getConversation(id);
  const effectivePersonaId =
    conversation.personaId ?? context.store.getDefaultPersona()?.id ?? null;
  const participants = context.store.listConversationParticipants(id);
  const bindings = context.store.database.all<{
    worldbook_id: string;
    scope_type: "card" | "conversation";
  }>(
    `SELECT worldbook_id, scope_type
     FROM worldbook_bindings
     WHERE (scope_type = 'card' AND scope_id = ?)
        OR (scope_type = 'conversation' AND scope_id = ?)
     ORDER BY
       CASE scope_type WHEN 'card' THEN 0 ELSE 1 END,
       created_at,
       id`,
    conversation.cardId,
    id,
  );
  const worldbookIds = Array.from(
    new Set(bindings.map((binding) => binding.worldbook_id)),
  );
  return {
    ...conversation,
    personaId: effectivePersonaId,
    participantIds: participants.map((participant) => participant.id),
    participants,
    worldbookIds,
  };
}

function personaDto(context: ServerContext, id: string) {
  return context.store.getPersona(id);
}

function messageDto(context: ServerContext, id: string) {
  const message = context.store.getMessage(id);
  return {
    ...message,
    swipes: context.store.listSwipes(message.id),
  };
}

function cardDto(context: ServerContext, id: string) {
  const card = context.store.getCard(id);
  const parsed = CardSchema.safeParse(card.legacyPayload.normalized);
  const worldbookIds = context.store.database
    .all<{ worldbook_id: string }>(
      `SELECT worldbook_id
       FROM worldbook_bindings
       WHERE scope_type = 'card' AND scope_id = ?
       ORDER BY created_at, id`,
      card.id,
    )
    .map((binding) => binding.worldbook_id);
  const imageUrl = parsed.success
    ? parsed.data.assets.find(
        (asset) =>
          asset.mediaType === "image/png" &&
          asset.path.startsWith("/api/assets/cards/"),
      )?.path
    : undefined;
  return {
    ...card,
    participants: context.store.listCardParticipants(card.id),
    worldbookIds,
    ...(imageUrl === undefined ? {} : { imageUrl }),
  };
}

function worldbookDto(context: ServerContext, id: string) {
  const worldbook = context.store.getWorldbook(id);
  const normalized = isJsonObject(worldbook.legacyPayload.normalized)
    ? worldbook.legacyPayload.normalized
    : undefined;
  const compatibility =
    normalized && isJsonObject(normalized.compatibility)
      ? normalized.compatibility
      : undefined;
  return {
    ...worldbook,
    description:
      normalized && typeof normalized.description === "string"
        ? normalized.description
        : "",
    imported:
      typeof compatibility?.sourceFormat === "string" &&
      compatibility.sourceFormat !== "native-storage",
    entries: context.store.listWorldbookEntries(id).map((entry) => {
      const metadataPrimary = metadataStrings(entry.metadata, "primaryKeys");
      const metadataSecondary =
        metadataStrings(entry.metadata, "secondaryKeys") ?? [];
      const canPreserveSplit =
        metadataPrimary !== undefined &&
        [...metadataPrimary, ...metadataSecondary].length ===
          entry.keys.length &&
        [...metadataPrimary, ...metadataSecondary].every(
          (key, index) => key === entry.keys[index],
        );
      const primaryKeys = canPreserveSplit ? metadataPrimary : entry.keys;
      const secondaryKeys = canPreserveSplit ? metadataSecondary : [];
      const secondaryLogic = metadataString(entry.metadata, "secondaryLogic");
      const insertionPosition = metadataString(
        entry.metadata,
        "insertionPosition",
      );
      const outletName = metadataString(entry.metadata, "outletName");
      const insertionRole = metadataString(entry.metadata, "insertionRole");
      const extensions = isJsonObject(entry.metadata.extensions)
        ? entry.metadata.extensions
        : undefined;
      return {
        ...entry,
        title:
          metadataString(entry.metadata, "label", "title", "name") ?? entry.id,
        keys: [...primaryKeys, ...secondaryKeys],
        primaryKeys,
        secondaryKeys,
        secondaryLogic:
          secondaryLogic === "all" ||
          secondaryLogic === "not-any" ||
          secondaryLogic === "not-all"
            ? secondaryLogic
            : "any",
        selective:
          canPreserveSplit &&
          metadataBoolean(entry.metadata, "selective", false),
        constant: metadataBoolean(entry.metadata, "constant", false),
        caseSensitive: metadataBoolean(entry.metadata, "caseSensitive", false),
        matchWholeWords: metadataBoolean(
          entry.metadata,
          "matchWholeWords",
          false,
        ),
        useRegex: metadataBoolean(entry.metadata, "useRegex", false),
        scanDepth: metadataNumber(entry.metadata, "scanDepth") ?? null,
        recursion: metadataBoolean(entry.metadata, "recursion", true),
        preventRecursion: metadataBoolean(
          entry.metadata,
          "preventRecursion",
          false,
        ),
        excludeRecursion: metadataBoolean(
          entry.metadata,
          "excludeRecursion",
          false,
        ),
        delayUntilRecursion: metadataBoolean(
          entry.metadata,
          "delayUntilRecursion",
          false,
        ),
        insertionPosition: worldbookInsertionPositions.includes(
          insertionPosition as (typeof worldbookInsertionPositions)[number],
        )
          ? insertionPosition
          : null,
        outletName: outletName ?? null,
        insertionDepth:
          metadataNumber(entry.metadata, "insertionDepth") ?? null,
        insertionRole:
          insertionRole === "user" || insertionRole === "assistant"
            ? insertionRole
            : "system",
        order: entry.position,
        priority: metadataNumber(entry.metadata, "priority") ?? 0,
        probability:
          extensions === undefined
            ? 100
            : Math.max(
                0,
                Math.min(100, metadataNumber(extensions, "probability") ?? 100),
              ),
      };
    }),
  };
}

function cardGreeting(
  context: ServerContext,
  cardId: string,
): { content: string; swipes: string[] } | undefined {
  const card = context.store.getCard(cardId);
  const parsed = CardSchema.safeParse(card.legacyPayload.normalized);
  if (!parsed.success) return undefined;
  const choices = [
    parsed.data.greeting,
    ...parsed.data.alternateGreetings,
  ].filter((content) => content.length > 0);
  const content = choices[0];
  return content === undefined ? undefined : { content, swipes: choices };
}

function createCardConversation(
  context: ServerContext,
  input: { cardId: string; title: string },
) {
  return context.store.database.transaction(() => {
    const created = context.store.createConversation(input);
    const greeting = cardGreeting(context, input.cardId);
    if (greeting) {
      const message = context.store.addAssistantMessage({
        conversationId: created.id,
        participantId: null,
        content: greeting.content,
      });
      greeting.swipes.forEach((content, index) => {
        context.store.addSwipe({
          messageId: message.id,
          content,
          selected: index === 0,
        });
      });
    }
    return context.store.getConversation(created.id);
  });
}

function extractMultipartFile(
  body: Buffer,
  contentType: string,
): { bytes: Uint8Array; filename?: string } {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/iu.exec(contentType);
  const boundary = boundaryMatch?.[1] ?? boundaryMatch?.[2]?.trim();
  if (!boundary) throw new Error("Multipart upload has no boundary.");
  const marker = Buffer.from(`--${boundary}`);
  let cursor = body.indexOf(marker);
  while (cursor >= 0) {
    const headersEnd = body.indexOf(Buffer.from("\r\n\r\n"), cursor);
    if (headersEnd < 0) break;
    const headerText = body
      .subarray(cursor + marker.length + 2, headersEnd)
      .toString("utf8");
    const nextBoundary = body.indexOf(marker, headersEnd + 4);
    if (nextBoundary < 0) break;
    if (/name="file"/iu.test(headerText)) {
      const filename = /filename="([^"]*)"/iu.exec(headerText)?.[1];
      const end = Math.max(headersEnd + 4, nextBoundary - 2);
      return {
        bytes: body.subarray(headersEnd + 4, end),
        ...(filename ? { filename } : {}),
      };
    }
    cursor = nextBoundary;
  }
  throw new Error("Multipart upload has no file field.");
}

export async function registerWorkspaceRoutes(
  app: FastifyInstance,
  context: ServerContext,
): Promise<void> {
  app.get("/api/health", async () =>
    envelope({
      ok: true,
      service: "sillytavern-n",
      phases: "0-7-active-development",
    }),
  );

  app.get("/api/personas", async () =>
    envelope(
      context.store
        .listPersonas()
        .map((persona) => personaDto(context, persona.id)),
    ),
  );

  app.post("/api/personas", async (request, reply) => {
    const input = z
      .object({
        name: z.string().trim().min(1).max(512),
        description: z.string().max(100_000).default(""),
        title: z.string().max(512).default(""),
        isDefault: z.boolean().default(false),
      })
      .strict()
      .parse(request.body);
    const persona = context.store.createPersona(input);
    return reply.code(201).send(envelope(personaDto(context, persona.id)));
  });

  app.patch<{ Params: { id: string } }>(
    "/api/personas/:id",
    async (request) => {
      const input = z
        .object({
          expectedRevision: z.number().int().nonnegative(),
          name: z.string().trim().min(1).max(512).optional(),
          description: z.string().max(100_000).optional(),
          title: z.string().max(512).optional(),
          isDefault: z.boolean().optional(),
        })
        .strict()
        .parse(request.body);
      const persona = context.store.updatePersona({
        id: request.params.id,
        expectedRevision: input.expectedRevision,
        patch: {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.description === undefined
            ? {}
            : { description: input.description }),
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.isDefault === undefined
            ? {}
            : { isDefault: input.isDefault }),
        },
      });
      return envelope(personaDto(context, persona.id));
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/personas/:id",
    async (request) => {
      const input = z
        .object({ expectedRevision: z.number().int().nonnegative() })
        .strict()
        .parse(request.body);
      return envelope(
        context.store.deletePersona(request.params.id, input.expectedRevision),
      );
    },
  );

  app.get("/api/cards", async () =>
    envelope(
      context.store.listCards().map((card) => cardDto(context, card.id)),
    ),
  );

  app.post("/api/cards", async (request, reply) => {
    const input = z
      .object({
        name: z.string().trim().min(1).max(512),
        description: z.string().max(100_000).default(""),
        participants: z
          .array(
            z
              .object({
                name: z.string().trim().min(1).max(512),
                role: z.string().max(128).default("character"),
              })
              .strict(),
          )
          .max(128)
          .default([]),
      })
      .strict()
      .parse(request.body);
    const created = context.store.createCard({
      ...input,
      kind: "character",
    });
    return reply.code(201).send(envelope(created));
  });

  app.patch<{ Params: { id: string } }>("/api/cards/:id", async (request) => {
    const input = z
      .object({
        expectedRevision: z.number().int().nonnegative(),
        name: z.string().trim().min(1).max(512).optional(),
        description: z.string().max(100_000).optional(),
      })
      .strict()
      .parse(request.body);
    return envelope(
      context.store.updateCard({
        id: request.params.id,
        expectedRevision: input.expectedRevision,
        patch: {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.description === undefined
            ? {}
            : { description: input.description }),
        },
      }),
    );
  });

  app.delete<{ Params: { id: string } }>("/api/cards/:id", async (request) => {
    const input = z
      .object({ expectedRevision: z.number().int().nonnegative() })
      .strict()
      .parse(request.body);
    const conversationIds = new Set(
      context.store
        .listCardConversations(request.params.id)
        .map((conversation) => conversation.id),
    );
    for (const generation of context.generations.values()) {
      if (conversationIds.has(generation.conversationId)) {
        generation.controller.abort();
      }
    }
    return envelope(
      context.store.deleteCardCascade(
        request.params.id,
        input.expectedRevision,
      ),
    );
  });

  app.post("/api/cards/import", async (request, reply) => {
    const contentType = request.headers["content-type"] ?? "";
    const body = request.body;
    let bytes: Uint8Array;
    let filename: string | undefined;
    if (
      Buffer.isBuffer(body) &&
      contentType.startsWith("multipart/form-data")
    ) {
      const extracted = extractMultipartFile(body, contentType);
      bytes = extracted.bytes;
      filename = extracted.filename;
    } else if (Buffer.isBuffer(body)) {
      bytes = body;
      const headerName = request.headers["x-file-name"];
      filename = Array.isArray(headerName) ? headerName[0] : headerName;
    } else {
      throw new Error("Card import requires a binary or multipart body.");
    }
    const imported = context.imports.importCard(bytes, {
      ...(filename === undefined ? {} : { filename }),
    });
    return reply.code(201).send(envelope(imported));
  });

  app.get<{ Querystring: { cardId?: string } }>(
    "/api/conversations",
    async (request) => {
      const query = conversationListQuerySchema.parse(request.query);
      const conversations =
        query.cardId === undefined
          ? context.store.listConversations()
          : context.store.listCardConversations(query.cardId);
      return envelope(
        conversations.map((conversation) =>
          conversationDto(context, conversation.id),
        ),
      );
    },
  );

  app.get<{ Params: { cardId: string } }>(
    "/api/cards/:cardId/conversations",
    async (request) =>
      envelope(
        context.store
          .listCardConversations(entityId.parse(request.params.cardId))
          .map((conversation) => conversationDto(context, conversation.id)),
      ),
  );

  app.post("/api/conversations", async (request, reply) => {
    const input = conversationCreateSchema.parse(request.body);
    const conversation = createCardConversation(context, input);
    return reply
      .code(201)
      .send(envelope(conversationDto(context, conversation.id)));
  });

  app.post<{ Params: { cardId: string } }>(
    "/api/cards/:cardId/conversations",
    async (request, reply) => {
      const input = cardConversationCreateSchema.parse(request.body);
      const conversation = createCardConversation(context, {
        cardId: entityId.parse(request.params.cardId),
        title: input.title,
      });
      return reply
        .code(201)
        .send(envelope(conversationDto(context, conversation.id)));
    },
  );

  app.patch<{ Params: { id: string } }>(
    "/api/conversations/:id",
    async (request) => {
      const input = z
        .object({
          title: z.string().trim().min(1).max(1024),
          expectedRevision: z.number().int().nonnegative(),
        })
        .strict()
        .parse(request.body);
      const conversation = context.store.renameConversation(
        request.params.id,
        input.title,
        input.expectedRevision,
      );
      return envelope(conversationDto(context, conversation.id));
    },
  );

  app.patch<{ Params: { id: string } }>(
    "/api/conversations/:id/persona",
    async (request) => {
      const input = z
        .object({
          personaId: entityId.nullable(),
          expectedRevision: z.number().int().nonnegative(),
        })
        .strict()
        .parse(request.body);
      const conversation = context.store.setConversationPersona({
        id: request.params.id,
        personaId: input.personaId,
        expectedRevision: input.expectedRevision,
      });
      return envelope(conversationDto(context, conversation.id));
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/conversations/:id",
    async (request) => {
      const input = z
        .object({ expectedRevision: z.number().int().nonnegative() })
        .strict()
        .parse(request.body);
      for (const generation of context.generations.values()) {
        if (generation.conversationId === request.params.id) {
          generation.controller.abort(
            new Error("The conversation was deleted."),
          );
        }
      }
      return envelope(
        context.store.deleteConversation(
          request.params.id,
          input.expectedRevision,
        ),
      );
    },
  );

  app.get<{ Params: { id: string }; Querystring: { presetId?: string } }>(
    "/api/conversations/:id/messages",
    async (request) => {
      const query = messageListQuerySchema.parse(request.query);
      const messages = context.store.listChatMessages(request.params.id);
      const regex = collectAuthorizedConversationRegex(context.store, {
        conversationId: request.params.id,
        ...(query.presetId === undefined ? {} : { presetId: query.presetId }),
      });
      return envelope(
        messages.map((message, index) => {
          const selectedSwipe = message.swipes.find((swipe) => swipe.selected);
          const rawDisplayContent = selectedSwipe?.content ?? message.content;
          const display = applyRegexScriptsWithDiagnostics(
            rawDisplayContent,
            regex.scripts,
            {
              placement: message.role === "user" ? 1 : 2,
              target: "markdown",
              depth: messages.length - index - 1,
              substitutions: regex.substitutions,
            },
          );
          return {
            ...messageDto(context, message.id),
            displayContent: display.text,
            appliedRegexScriptIds: display.appliedScriptIds,
          };
        }),
      );
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/conversations/:id/messages",
    async (request, reply) => {
      const input = messageCreateSchema.parse(request.body);
      const message =
        input.role === "assistant"
          ? context.store.addAssistantMessage({
              conversationId: request.params.id,
              content: input.content,
              ...(input.parentMessageId
                ? { parentMessageId: input.parentMessageId }
                : {}),
            })
          : context.store.addUserMessage({
              conversationId: request.params.id,
              content: input.content,
              ...(input.parentMessageId
                ? { parentMessageId: input.parentMessageId }
                : {}),
            });
      return reply.code(201).send(envelope(messageDto(context, message.id)));
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/compatibility/tavern-helper/conversations/:id/messages",
    async (request, reply) => {
      const input = tavernHelperMessageCreateSchema.parse(request.body);
      const message =
        input.role === "assistant"
          ? context.store.addAssistantMessage({
              conversationId: request.params.id,
              content: input.content,
              ...(input.parentMessageId
                ? { parentMessageId: input.parentMessageId }
                : {}),
            })
          : context.store.addUserMessage({
              conversationId: request.params.id,
              content: input.content,
              ...(input.parentMessageId
                ? { parentMessageId: input.parentMessageId }
                : {}),
            });
      return reply.code(201).send(envelope(messageDto(context, message.id)));
    },
  );

  app.patch<{ Params: { id: string } }>(
    "/api/messages/:id",
    async (request) => {
      const input = z
        .object({
          content: z.string().max(2_000_000),
          expectedRevision: z.number().int().nonnegative(),
        })
        .strict()
        .parse(request.body);
      const message = context.store.updateMessage({
        id: request.params.id,
        content: input.content,
        expectedRevision: input.expectedRevision,
      });
      return envelope(messageDto(context, message.id));
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/messages/:id",
    async (request) => {
      const input = z
        .object({ expectedRevision: z.number().int().nonnegative() })
        .strict()
        .parse(request.body);
      return envelope(
        context.store.deleteMessage(request.params.id, input.expectedRevision),
      );
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/messages/:id/swipes",
    async (request, reply) => {
      const input = z
        .object({
          content: z.string().max(2_000_000),
          selected: z.boolean().default(false),
        })
        .strict()
        .parse(request.body);
      context.store.getChatMessage(request.params.id);
      return reply.code(201).send(
        envelope(
          context.store.addSwipe({
            messageId: request.params.id,
            content: input.content,
            selected: input.selected,
          }),
        ),
      );
    },
  );

  app.patch<{ Params: { messageId: string; swipeId: string } }>(
    "/api/messages/:messageId/swipes/:swipeId/select",
    async (request) => {
      const input = z
        .object({ expectedMessageRevision: z.number().int().nonnegative() })
        .strict()
        .parse(request.body);
      context.store.getChatMessage(request.params.messageId);
      return envelope(
        context.store.selectSwipe({
          messageId: request.params.messageId,
          swipeId: request.params.swipeId,
          expectedMessageRevision: input.expectedMessageRevision,
        }),
      );
    },
  );

  app.get("/api/worldbooks", async () =>
    envelope(
      context.store
        .listWorldbooks()
        .map((worldbook) => worldbookDto(context, worldbook.id)),
    ),
  );

  app.patch<{ Params: { worldbookId: string; entryId: string } }>(
    "/api/worldbooks/:worldbookId/entries/:entryId/permission",
    async (request) => {
      const input = z
        .object({
          agentEditable: z.boolean(),
          expectedWorldbookRevision: z.number().int().nonnegative(),
          expectedEntryRevision: z.number().int().nonnegative(),
        })
        .strict()
        .parse(request.body);
      // Actor type is created by the server. A client header cannot impersonate
      // either the model tool actor or a legacy script actor.
      context.store.setWorldbookEntryPermission({
        worldbookId: request.params.worldbookId,
        entryId: request.params.entryId,
        agentEditable: input.agentEditable,
        expectedWorldbookRevision: input.expectedWorldbookRevision,
        expectedEntryRevision: input.expectedEntryRevision,
        actorKind: "human",
        actorId: "local-user",
      });
      return envelope({
        worldbook: worldbookDto(context, request.params.worldbookId),
      });
    },
  );

  app.patch<{ Params: { worldbookId: string; entryId: string } }>(
    "/api/worldbooks/:worldbookId/entries/:entryId",
    async (request) => {
      const input = worldbookEntryUpdateSchema.parse(request.body);
      const entry = context.store.getWorldbookEntry(request.params.entryId);
      const metadata: JsonObject = { ...entry.metadata };
      const currentPrimary =
        metadataStrings(metadata, "primaryKeys") ?? entry.keys;
      const currentSecondary = metadataStrings(metadata, "secondaryKeys") ?? [];
      const primaryKeys = input.primaryKeys ?? currentPrimary;
      const secondaryKeys = input.secondaryKeys ?? currentSecondary;

      if (input.title !== undefined) {
        setMetadata(metadata, "label", input.title);
        setMetadata(metadata, "title", input.title);
      }
      setMetadata(metadata, "primaryKeys", input.primaryKeys);
      setMetadata(metadata, "secondaryKeys", input.secondaryKeys);
      setMetadata(metadata, "secondaryLogic", input.secondaryLogic);
      setMetadata(metadata, "selective", input.selective);
      setMetadata(metadata, "constant", input.constant);
      setMetadata(metadata, "caseSensitive", input.caseSensitive);
      setMetadata(metadata, "matchWholeWords", input.matchWholeWords);
      setMetadata(metadata, "useRegex", input.useRegex);
      if ("scanDepth" in input) {
        metadata.scanDepth = input.scanDepth ?? null;
      }
      setMetadata(metadata, "recursion", input.recursion);
      setMetadata(metadata, "preventRecursion", input.preventRecursion);
      setMetadata(metadata, "excludeRecursion", input.excludeRecursion);
      setMetadata(metadata, "delayUntilRecursion", input.delayUntilRecursion);
      setMetadata(metadata, "insertionPosition", input.insertionPosition);
      setMetadata(metadata, "outletName", input.outletName);
      if ("insertionDepth" in input) {
        setMetadata(metadata, "insertionDepth", input.insertionDepth);
      }
      setMetadata(metadata, "insertionRole", input.insertionRole);
      if (input.order !== undefined) {
        setMetadata(metadata, "legacyInsertionOrder", input.order);
      }
      setMetadata(metadata, "priority", input.priority);
      if (input.probability !== undefined) {
        const extensions = isJsonObject(metadata.extensions)
          ? { ...metadata.extensions }
          : {};
        extensions.probability = input.probability;
        metadata.extensions = extensions;
      }

      context.store.updateWorldbookEntryHuman({
        worldbookId: request.params.worldbookId,
        entryId: request.params.entryId,
        expectedWorldbookRevision: input.expectedWorldbookRevision,
        expectedEntryRevision: input.expectedEntryRevision,
        patch: {
          ...(input.primaryKeys === undefined &&
          input.secondaryKeys === undefined
            ? {}
            : { keys: [...primaryKeys, ...secondaryKeys] }),
          ...(input.content === undefined ? {} : { content: input.content }),
          ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
          ...(input.order === undefined ? {} : { position: input.order }),
          metadata,
        },
      });
      return envelope({
        worldbook: worldbookDto(context, request.params.worldbookId),
      });
    },
  );

  app.get("/api/presets", async () => envelope(context.store.listPresets()));
}
