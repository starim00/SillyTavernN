import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { JsonObject } from "@stn/contracts";
import { StorageError } from "@stn/storage";

import { envelope, type ServerContext } from "../context.js";
import { normalizedCard } from "../normalized-content.js";
import { receiveImportUpload } from "../upload.js";
import { collectAuthorizedConversationRegex } from "../regex-service.js";
import { regexWorkerPool } from "../regex-worker-pool.js";
import {
  setWorldbookMetadata,
  storedWorldbookDto,
  WORLD_BOOK_INSERTION_POSITIONS,
  worldbookMetadataStrings,
} from "../worldbook-codec.js";

const entityId = z.string().trim().min(1).max(256);

const workspacePreferencesSchema = z
  .object({
    selectedPresetId: entityId.optional(),
    selectedProviderId: z.union([entityId, z.literal("fake")]).optional(),
  })
  .strict();

const workspacePreferencesExtensionId = "stn.workspace";
const workspacePreferencesKey = "preferences:global";

type WorkspacePreferences = {
  selectedPresetId: string;
  selectedProviderId: string;
};

function workspacePreferences(
  context: ServerContext,
  candidates: Partial<WorkspacePreferences> = {},
): WorkspacePreferences {
  let stored: unknown;
  try {
    stored = context.store.getExtensionSetting(
      workspacePreferencesExtensionId,
      workspacePreferencesKey,
    ).value;
  } catch (error) {
    if (!(error instanceof StorageError) || error.code !== "not_found") {
      throw error;
    }
  }

  const storedRecord =
    stored !== null && typeof stored === "object" && !Array.isArray(stored)
      ? (stored as Record<string, unknown>)
      : {};
  const presets = context.store.listPresets();
  const presetIds = new Set(presets.map(({ id }) => id));
  const providerIds = new Set(
    context.store.listProviderConnections().map(({ id }) => id),
  );
  const requestedPresetId =
    typeof storedRecord.selectedPresetId === "string"
      ? storedRecord.selectedPresetId
      : candidates.selectedPresetId;
  const requestedProviderId =
    typeof storedRecord.selectedProviderId === "string"
      ? storedRecord.selectedProviderId
      : candidates.selectedProviderId;
  const resolved = {
    selectedPresetId:
      requestedPresetId && presetIds.has(requestedPresetId)
        ? requestedPresetId
        : (presets[0]?.id ?? ""),
    selectedProviderId:
      requestedProviderId === "fake" ||
      (requestedProviderId && providerIds.has(requestedProviderId))
        ? requestedProviderId
        : "fake",
  };

  if (
    storedRecord.selectedPresetId !== resolved.selectedPresetId ||
    storedRecord.selectedProviderId !== resolved.selectedProviderId
  ) {
    context.store.setExtensionSetting(
      workspacePreferencesExtensionId,
      workspacePreferencesKey,
      resolved,
    );
  }
  return resolved;
}

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
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().max(2_048).optional(),
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
    limit: z.coerce.number().int().min(1).max(200).default(100),
    cursor: z.string().max(2_048).optional(),
  })
  .strict();

const pageCursorSchema = z
  .object({
    v: z.literal(1),
    kind: z.enum(["conversations", "messages"]),
    scope: z.string(),
    timestamp: z.string(),
    id: z.string(),
    seen: z.number().int().nonnegative().default(0),
  })
  .strict();

type PageCursor = z.infer<typeof pageCursorSchema>;

function encodePageCursor(cursor: PageCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodePageCursor(
  value: string | undefined,
  expected: Pick<PageCursor, "kind" | "scope">,
): PageCursor | undefined {
  if (value === undefined) return undefined;
  try {
    const parsed = pageCursorSchema.parse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
    );
    if (parsed.kind !== expected.kind || parsed.scope !== expected.scope) {
      throw new Error("Cursor scope mismatch.");
    }
    return parsed;
  } catch {
    throw new StorageError(
      "INVALID_PAGE_CURSOR",
      "The page cursor is invalid for this request.",
      400,
    );
  }
}

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
      .enum(WORLD_BOOK_INSERTION_POSITIONS)
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
  const { generationStatus, ...rest } = message;
  return {
    ...rest,
    state: generationStatus,
    swipes: context.store.listSwipes(message.id),
  };
}

function cardDto(context: ServerContext, id: string) {
  const card = context.store.getCard(id);
  const normalized = normalizedCard(card);
  const worldbookIds = context.store.database
    .all<{ worldbook_id: string }>(
      `SELECT worldbook_id
       FROM worldbook_bindings
       WHERE scope_type = 'card' AND scope_id = ?
       ORDER BY created_at, id`,
      card.id,
    )
    .map((binding) => binding.worldbook_id);
  const imageUrl = normalized
    ? normalized.assets.find(
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

function cardGreeting(
  context: ServerContext,
  cardId: string,
): { content: string; swipes: string[] } | undefined {
  const card = context.store.getCard(cardId);
  const normalized = normalizedCard(card);
  if (!normalized) return undefined;
  const choices = [
    normalized.greeting,
    ...normalized.alternateGreetings,
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

  app.post("/api/workspace/preferences/resolve", (request) => {
    const input = workspacePreferencesSchema.parse(request.body);
    const candidates: Partial<WorkspacePreferences> = {
      ...(input.selectedPresetId === undefined
        ? {}
        : { selectedPresetId: input.selectedPresetId }),
      ...(input.selectedProviderId === undefined
        ? {}
        : { selectedProviderId: input.selectedProviderId }),
    };
    return envelope(workspacePreferences(context, candidates));
  });

  app.patch("/api/workspace/preferences", (request) => {
    const input = workspacePreferencesSchema
      .refine(
        (value) =>
          value.selectedPresetId !== undefined ||
          value.selectedProviderId !== undefined,
        { message: "At least one workspace preference is required." },
      )
      .parse(request.body);
    const current = workspacePreferences(context);
    if (
      input.selectedPresetId !== undefined &&
      !context.store
        .listPresets()
        .some(({ id }) => id === input.selectedPresetId)
    ) {
      throw new StorageError(
        "invalid_workspace_preference",
        `Preset '${input.selectedPresetId}' is not available.`,
        400,
      );
    }
    if (
      input.selectedProviderId !== undefined &&
      input.selectedProviderId !== "fake" &&
      !context.store
        .listProviderConnections()
        .some(({ id }) => id === input.selectedProviderId)
    ) {
      throw new StorageError(
        "invalid_workspace_preference",
        `Provider connection '${input.selectedProviderId}' is not available.`,
        400,
      );
    }
    const updated: WorkspacePreferences = {
      selectedPresetId: input.selectedPresetId ?? current.selectedPresetId,
      selectedProviderId:
        input.selectedProviderId ?? current.selectedProviderId,
    };
    context.store.setExtensionSetting(
      workspacePreferencesExtensionId,
      workspacePreferencesKey,
      updated,
    );
    return envelope(updated);
  });

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

  app.put<{ Params: { id: string } }>(
    "/api/cards/:id/worldbooks",
    async (request) => {
      const input = z
        .object({
          expectedWorldbookIds: z.array(entityId).max(10_000),
          worldbookIds: z.array(entityId).max(10_000),
        })
        .strict()
        .superRefine((value, refinement) => {
          for (const key of ["expectedWorldbookIds", "worldbookIds"] as const) {
            if (new Set(value[key]).size !== value[key].length) {
              refinement.addIssue({
                code: "custom",
                path: [key],
                message: "Worldbook ids must be unique.",
              });
            }
          }
        })
        .parse(request.body);
      const cardId = entityId.parse(request.params.id);
      context.store.replaceCardWorldbooks({ cardId, ...input });
      return envelope({
        card: cardDto(context, cardId),
        conversations: context.store
          .listCardConversations(cardId)
          .map((conversation) => conversationDto(context, conversation.id)),
      });
    },
  );

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
    for (const [id, generation] of context.generationResults) {
      if (conversationIds.has(generation.conversationId)) {
        context.generationResults.delete(id);
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
    const file = await receiveImportUpload(request);
    try {
      const imported = await context.imports.importCardFile(file.path, {
        ...(file.filename === undefined ? {} : { filename: file.filename }),
      });
      return reply.code(201).send(envelope(imported));
    } finally {
      await file.cleanup();
    }
  });

  app.post<{ Params: { id: string } }>(
    "/api/cards/:id/replace",
    async (request) => {
      const cardId = entityId.parse(request.params.id);
      const file = await receiveImportUpload(request);
      try {
        const input = z
          .object({
            expectedRevision: z.coerce.number().int().nonnegative(),
            preserveWorldbooks: z
              .enum(["true", "false"])
              .transform((value) => value === "true")
              .default(true),
          })
          .strict()
          .parse(file.fields);
        const conversationIds = new Set(
          context.store
            .listCardConversations(cardId)
            .map((conversation) => conversation.id),
        );
        if (
          Array.from(context.generations.values()).some((generation) =>
            conversationIds.has(generation.conversationId),
          )
        ) {
          throw new StorageError(
            "card_generation_active",
            "A card cannot be replaced while one of its conversations is generating.",
            409,
            { cardId },
          );
        }
        const replaced = await context.imports.replaceCardFile(file.path, {
          cardId,
          expectedRevision: input.expectedRevision,
          preserveWorldbooks: input.preserveWorldbooks,
          options: {
            ...(file.filename === undefined ? {} : { filename: file.filename }),
          },
        });
        return envelope({
          ...replaced,
          card: cardDto(context, cardId),
          conversations: context.store
            .listCardConversations(cardId)
            .map((conversation) => conversationDto(context, conversation.id)),
        });
      } finally {
        await file.cleanup();
      }
    },
  );

  app.get<{
    Querystring: { cardId?: string; limit?: string; cursor?: string };
  }>("/api/conversations", async (request) => {
    const query = conversationListQuerySchema.parse(request.query);
    const scope = query.cardId ?? "all";
    const cursor = decodePageCursor(query.cursor, {
      kind: "conversations",
      scope,
    });
    const page = context.store.listConversationsPage({
      ...(query.cardId === undefined ? {} : { cardId: query.cardId }),
      limit: query.limit,
      ...(cursor === undefined
        ? {}
        : { before: { updatedAt: cursor.timestamp, id: cursor.id } }),
    });
    const last = page.items.at(-1);
    return envelope({
      items: page.items.map((conversation) =>
        conversationDto(context, conversation.id),
      ),
      nextCursor:
        page.hasMore && last !== undefined
          ? encodePageCursor({
              v: 1,
              kind: "conversations",
              scope,
              timestamp: last.updatedAt,
              id: last.id,
              seen: (cursor?.seen ?? 0) + page.items.length,
            })
          : null,
    });
  });

  app.get<{
    Params: { cardId: string };
    Querystring: { limit?: string; cursor?: string };
  }>("/api/cards/:cardId/conversations", async (request) => {
    const cardId = entityId.parse(request.params.cardId);
    const query = conversationListQuerySchema.parse({
      ...request.query,
      cardId,
    });
    const cursor = decodePageCursor(query.cursor, {
      kind: "conversations",
      scope: cardId,
    });
    const page = context.store.listConversationsPage({
      cardId,
      limit: query.limit,
      ...(cursor === undefined
        ? {}
        : { before: { updatedAt: cursor.timestamp, id: cursor.id } }),
    });
    const last = page.items.at(-1);
    return envelope({
      items: page.items.map((conversation) =>
        conversationDto(context, conversation.id),
      ),
      nextCursor:
        page.hasMore && last !== undefined
          ? encodePageCursor({
              v: 1,
              kind: "conversations",
              scope: cardId,
              timestamp: last.updatedAt,
              id: last.id,
              seen: (cursor?.seen ?? 0) + page.items.length,
            })
          : null,
    });
  });

  app.get<{ Params: { id: string } }>(
    "/api/conversations/:id",
    async (request) =>
      envelope(conversationDto(context, entityId.parse(request.params.id))),
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
      for (const [id, generation] of context.generationResults) {
        if (generation.conversationId === request.params.id) {
          context.generationResults.delete(id);
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

  app.get<{
    Params: { id: string };
    Querystring: { presetId?: string; limit?: string; cursor?: string };
  }>("/api/conversations/:id/messages", async (request) => {
    const query = messageListQuerySchema.parse(request.query);
    const scope = `${request.params.id}:${query.presetId ?? ""}`;
    const cursor = decodePageCursor(query.cursor, {
      kind: "messages",
      scope,
    });
    const page = context.store.listChatMessagesPage({
      conversationId: request.params.id,
      limit: query.limit,
      ...(cursor === undefined
        ? {}
        : { before: { createdAt: cursor.timestamp, id: cursor.id } }),
    });
    const messages = page.items;
    const regex = collectAuthorizedConversationRegex(context.store, {
      conversationId: request.params.id,
      ...(query.presetId === undefined ? {} : { presetId: query.presetId }),
    });
    const items = await Promise.all(
      messages.map(async (message, index) => {
        const selectedSwipe = message.swipes.find((swipe) => swipe.selected);
        const rawDisplayContent = selectedSwipe?.content ?? message.content;
        const display = await regexWorkerPool.apply(
          rawDisplayContent,
          regex.scripts,
          {
            placement: message.role === "user" ? 1 : 2,
            target: "markdown",
            depth: (cursor?.seen ?? 0) + messages.length - index - 1,
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
    const oldest = messages[0];
    return envelope({
      items,
      nextCursor:
        page.hasMore && oldest !== undefined
          ? encodePageCursor({
              v: 1,
              kind: "messages",
              scope,
              timestamp: oldest.createdAt,
              id: oldest.id,
              seen: (cursor?.seen ?? 0) + messages.length,
            })
          : null,
    });
  });

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
        .map((worldbook) => storedWorldbookDto(context.store, worldbook.id)),
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
        worldbook: storedWorldbookDto(
          context.store,
          request.params.worldbookId,
        ),
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
        worldbookMetadataStrings(metadata, "primaryKeys") ?? entry.keys;
      const currentSecondary =
        worldbookMetadataStrings(metadata, "secondaryKeys") ?? [];
      const primaryKeys = input.primaryKeys ?? currentPrimary;
      const secondaryKeys = input.secondaryKeys ?? currentSecondary;

      if (input.title !== undefined) {
        setWorldbookMetadata(metadata, "label", input.title);
        setWorldbookMetadata(metadata, "title", input.title);
      }
      setWorldbookMetadata(metadata, "primaryKeys", input.primaryKeys);
      setWorldbookMetadata(metadata, "secondaryKeys", input.secondaryKeys);
      setWorldbookMetadata(metadata, "secondaryLogic", input.secondaryLogic);
      setWorldbookMetadata(metadata, "selective", input.selective);
      setWorldbookMetadata(metadata, "constant", input.constant);
      setWorldbookMetadata(metadata, "caseSensitive", input.caseSensitive);
      setWorldbookMetadata(metadata, "matchWholeWords", input.matchWholeWords);
      setWorldbookMetadata(metadata, "useRegex", input.useRegex);
      if ("scanDepth" in input) {
        metadata.scanDepth = input.scanDepth ?? null;
      }
      setWorldbookMetadata(metadata, "recursion", input.recursion);
      setWorldbookMetadata(
        metadata,
        "preventRecursion",
        input.preventRecursion,
      );
      setWorldbookMetadata(
        metadata,
        "excludeRecursion",
        input.excludeRecursion,
      );
      setWorldbookMetadata(
        metadata,
        "delayUntilRecursion",
        input.delayUntilRecursion,
      );
      setWorldbookMetadata(
        metadata,
        "insertionPosition",
        input.insertionPosition,
      );
      setWorldbookMetadata(metadata, "outletName", input.outletName);
      if ("insertionDepth" in input) {
        setWorldbookMetadata(metadata, "insertionDepth", input.insertionDepth);
      }
      setWorldbookMetadata(metadata, "insertionRole", input.insertionRole);
      if (input.order !== undefined) {
        setWorldbookMetadata(metadata, "legacyInsertionOrder", input.order);
      }
      setWorldbookMetadata(metadata, "priority", input.priority);
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
        worldbook: storedWorldbookDto(
          context.store,
          request.params.worldbookId,
        ),
      });
    },
  );

  app.get("/api/presets", async () => envelope(context.store.listPresets()));
}
