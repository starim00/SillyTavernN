import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  isJsonObject,
  readTavernHelperBundle,
  sanitizeJsonValue,
} from "@stn/core";
import type { JsonObject } from "@stn/contracts";
import type { ProviderMessage } from "@stn/providers";
import { StorageError } from "@stn/storage";

import { envelope, type ServerContext } from "../context.js";
import { prepareConversationPrompt } from "../prompt-service.js";
import { resolveRegexScope, updateRegexScope } from "../regex-service.js";

const regexGrantSchema = z
  .object({
    scope: z.enum(["card", "preset"]),
    id: z.string().trim().min(1).max(256),
    granted: z.boolean(),
  })
  .strict();

const tavernHelperScopeSchema = z.enum(["global", "card", "preset"]);

const tavernHelperGrantSchema = z
  .object({
    scope: tavernHelperScopeSchema,
    id: z.string().trim().min(1).max(256),
    granted: z.boolean(),
  })
  .strict();

const tavernHelperButtonSchema = z
  .object({
    id: z.string().trim().min(1).max(512),
    name: z.string().trim().min(1).max(512),
    visible: z.boolean(),
  })
  .strict();

const tavernHelperScriptSchema = z
  .object({
    id: z.string().trim().min(1).max(512),
    name: z.string().trim().min(1).max(512),
    content: z.string().max(4_000_000),
    info: z.string().max(100_000),
    declaredEnabled: z.boolean(),
    enabled: z.boolean(),
    buttonEnabled: z.boolean(),
    buttons: z.array(tavernHelperButtonSchema).max(256),
    data: z.record(z.string(), z.unknown()),
    treeId: z.string().max(512).optional(),
    treeName: z.string().max(512).optional(),
    sourcePath: z.string().max(2_048),
  })
  .strict();

const tavernHelperScriptsSchema = z
  .object({
    scope: tavernHelperScopeSchema,
    id: z.string().trim().min(1).max(256),
    scripts: z.array(tavernHelperScriptSchema).max(2_000),
  })
  .strict();

const tavernHelperSettingsSchema = z
  .object({
    render: z
      .object({
        enabled: z.boolean(),
        depth: z.number().int().min(0).max(10_000),
        ignoreHiddenMessages: z.boolean(),
        collapseCodeBlocks: z.enum(["all", "frontend", "none"]),
        allowBlobUrls: z.boolean(),
        syntaxHighlighting: z.boolean(),
        cleanupProtection: z.boolean(),
        streaming: z.boolean(),
      })
      .strict(),
    optimize: z
      .object({
        limitRenderedMessages: z.boolean(),
        carryWorldbookOnCardUpdate: z.boolean(),
        exportLatestWorldbook: z.boolean(),
        recommendedWorldbookSettings: z.boolean(),
        maximizePresetContext: z.boolean(),
      })
      .strict(),
    developer: z
      .object({
        macrosEnabled: z.boolean(),
        liveListenerEnabled: z.boolean(),
        liveListenerUrl: z.string().max(4_096),
        liveListenerInterval: z.number().int().min(250).max(3_600_000),
        errorPopups: z.boolean(),
      })
      .strict(),
  })
  .strict();

const defaultTavernHelperSettings = {
  render: {
    enabled: true,
    depth: 0,
    ignoreHiddenMessages: true,
    collapseCodeBlocks: "none" as const,
    allowBlobUrls: true,
    syntaxHighlighting: true,
    cleanupProtection: true,
    streaming: false,
  },
  optimize: {
    limitRenderedMessages: false,
    carryWorldbookOnCardUpdate: true,
    exportLatestWorldbook: true,
    recommendedWorldbookSettings: true,
    maximizePresetContext: false,
  },
  developer: {
    macrosEnabled: true,
    liveListenerEnabled: false,
    liveListenerUrl: "",
    liveListenerInterval: 1_000,
    errorPopups: true,
  },
};

const tavernHelperContextQuerySchema = z
  .object({
    conversationId: z.string().trim().min(1).max(256),
    presetId: z.string().trim().min(1).max(256).optional(),
  })
  .strict();

const tavernHelperStateSchema = z
  .object({
    conversationId: z.string().trim().min(1).max(256),
    presetId: z.string().trim().min(1).max(256).optional(),
    namespace: z.enum([
      "global",
      "character",
      "preset",
      "chat",
      "message",
      "script",
      "extension",
    ]),
    messageId: z.string().trim().min(1).max(256).optional(),
    sourceScope: tavernHelperScopeSchema.optional(),
    sourceId: z.string().trim().min(1).max(256).optional(),
    scriptId: z.string().trim().min(1).max(512).optional(),
    extensionId: z.string().trim().min(1).max(512).optional(),
    variables: z.unknown(),
  })
  .strict();

const tavernHelperExtensionId = "stn.tavern-helper";

function groupByWorldbookId<T extends { worldbookId: string }>(
  values: readonly T[],
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const value of values) {
    const group = grouped.get(value.worldbookId) ?? [];
    group.push(value);
    grouped.set(value.worldbookId, group);
  }
  return grouped;
}
const tavernHelperGenerateSchema = z
  .object({
    conversationId: z.string().trim().min(1).max(256),
    connectionId: z.string().trim().min(1).max(256),
    presetId: z.string().trim().min(1).max(256).optional(),
    userInput: z.string().max(2_000_000).optional(),
    settings: z.record(z.string(), z.unknown()).optional(),
    messagesOverride: z
      .array(
        z
          .object({
            role: z.enum(["system", "assistant", "user", "tool"]),
            content: z.string().max(2_000_000),
          })
          .strict(),
      )
      .max(20_000)
      .optional(),
    injects: z
      .array(
        z
          .object({
            role: z.enum(["system", "assistant", "user"]),
            content: z.string().max(2_000_000),
            depth: z.number().int().min(0).max(10_000).default(0),
          })
          .strict(),
      )
      .max(512)
      .default([]),
  })
  .strict();
const promptTemplatePrepareSchema = z
  .object({
    conversationId: z.string().trim().min(1).max(256),
    connectionId: z.string().trim().min(1).max(256),
    presetId: z.string().trim().min(1).max(256).optional(),
  })
  .strict();

function invalidTavernHelperState(message: string): StorageError {
  return new StorageError("invalid_tavern_helper_state", message, 400);
}

function assertTarget(
  context: ServerContext,
  scope: "global" | "card" | "preset",
  id: string,
): void {
  if (scope === "global") {
    if (id !== "global") {
      throw invalidTavernHelperState(
        "The global helper source id must be global.",
      );
    }
    return;
  }
  if (scope === "card") context.store.getCard(id);
  else context.store.getPreset(id);
}

function extensionObject(
  context: ServerContext,
  key: string,
  fallback: JsonObject = {},
): JsonObject {
  try {
    const value = context.store.getExtensionSetting(
      tavernHelperExtensionId,
      key,
    ).value;
    return isJsonObject(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function sanitizedObject(value: unknown): JsonObject {
  const sanitized = sanitizeJsonValue(value);
  return isJsonObject(sanitized) ? sanitized : {};
}

function extensionBoolean(context: ServerContext, key: string): boolean {
  try {
    return (
      context.store.getExtensionSetting(tavernHelperExtensionId, key).value ===
      true
    );
  } catch {
    return false;
  }
}

function tavernHelperSettings(context: ServerContext) {
  try {
    return tavernHelperSettingsSchema.parse(
      context.store.getExtensionSetting(
        tavernHelperExtensionId,
        "settings:global",
      ).value,
    );
  } catch {
    return defaultTavernHelperSettings;
  }
}

function scriptOverride(
  context: ServerContext,
  scope: "global" | "card" | "preset",
  id: string,
) {
  try {
    const value = context.store.getExtensionSetting(
      tavernHelperExtensionId,
      `scripts:${scope}:${id}`,
    ).value;
    if (!isJsonObject(value) || !Array.isArray(value.scripts)) return undefined;
    return tavernHelperScriptSchema.array().parse(value.scripts);
  } catch {
    return undefined;
  }
}

function stateKey(
  context: ServerContext,
  input: z.infer<typeof tavernHelperStateSchema>,
): string {
  const conversation = context.store.getConversation(input.conversationId);
  if (input.presetId !== undefined) {
    context.store.getPreset(input.presetId);
  }
  switch (input.namespace) {
    case "global":
      return "variables:global";
    case "character":
      return `variables:card:${conversation.cardId}`;
    case "preset":
      if (input.presetId === undefined) {
        throw invalidTavernHelperState(
          "Preset variables require a selected preset.",
        );
      }
      return `variables:preset:${input.presetId}`;
    case "chat":
      return `variables:conversation:${conversation.id}`;
    case "message": {
      if (input.messageId === undefined) {
        throw invalidTavernHelperState(
          "Message variables require a message id.",
        );
      }
      const message = context.store.getMessage(input.messageId);
      if (message.conversationId !== conversation.id) {
        throw invalidTavernHelperState(
          "Message variables must belong to this conversation.",
        );
      }
      return `variables:message:${message.id}`;
    }
    case "script":
      if (
        input.sourceScope === undefined ||
        input.sourceId === undefined ||
        input.scriptId === undefined
      ) {
        throw invalidTavernHelperState(
          "Script variables require a source scope, source id, and script id.",
        );
      }
      assertTarget(context, input.sourceScope, input.sourceId);
      if (input.sourceScope === "global" && input.sourceId !== "global") {
        throw invalidTavernHelperState(
          "The global script source id must be global.",
        );
      }
      if (
        input.sourceScope === "card" &&
        input.sourceId !== conversation.cardId
      ) {
        throw invalidTavernHelperState(
          "The script card is not active in this conversation.",
        );
      }
      if (input.sourceScope === "preset" && input.sourceId !== input.presetId) {
        throw invalidTavernHelperState(
          "The script preset is not active in this conversation.",
        );
      }
      return `variables:script:${input.sourceScope}:${input.sourceId}:${input.scriptId}`;
    case "extension":
      if (input.extensionId === undefined) {
        throw invalidTavernHelperState(
          "Extension variables require an extension id.",
        );
      }
      return `variables:extension:${input.extensionId}`;
  }
}

function tavernHelperContext(
  context: ServerContext,
  input: z.infer<typeof tavernHelperContextQuerySchema>,
) {
  const conversation = context.store.getConversation(input.conversationId);
  const card = context.store.getCard(conversation.cardId);
  const cardBundle = readTavernHelperBundle(
    isJsonObject(card.legacyPayload.normalized)
      ? card.legacyPayload.normalized
      : {},
  );
  const preset =
    input.presetId === undefined
      ? undefined
      : context.store.getPreset(input.presetId);
  const presetBundle =
    preset === undefined ? undefined : readTavernHelperBundle(preset.payload);
  const messages = context.store.listChatMessages(conversation.id);
  const globalScripts = scriptOverride(context, "global", "global") ?? [];
  const cardScripts = scriptOverride(context, "card", card.id);
  const presetScripts =
    preset === undefined
      ? undefined
      : scriptOverride(context, "preset", preset.id);
  const sources = [
    ...(globalScripts.length > 0
      ? [
          {
            scope: "global" as const,
            id: "global",
            name: "全局脚本",
            revision: 0,
            trusted: extensionBoolean(context, "global"),
            bundle: {
              present: true,
              sourcePath: "native:global",
              scripts: globalScripts,
              variables: {},
              diagnostics: [],
            },
          },
        ]
      : []),
    {
      scope: "card" as const,
      id: card.id,
      name: card.name,
      revision: card.revision,
      trusted: extensionBoolean(context, `card:${card.id}`),
      bundle:
        cardScripts === undefined
          ? cardBundle
          : {
              ...cardBundle,
              present: cardScripts.length > 0,
              scripts: cardScripts,
            },
    },
    ...(preset !== undefined
      ? [
          {
            scope: "preset" as const,
            id: preset.id,
            name: preset.name,
            revision: preset.revision,
            trusted: extensionBoolean(context, `preset:${preset.id}`),
            bundle:
              presetScripts === undefined
                ? (presetBundle ?? {
                    present: false,
                    scripts: [],
                    variables: {},
                    diagnostics: [],
                  })
                : {
                    ...(presetBundle ?? {
                      present: false,
                      variables: {},
                      diagnostics: [],
                    }),
                    present: presetScripts.length > 0,
                    scripts: presetScripts,
                  },
          },
        ]
      : []),
  ];
  const storedWorldbooks = context.store.listWorldbooks();
  const worldbookIds = storedWorldbooks.map((worldbook) => worldbook.id);
  const bindingsByWorldbook = groupByWorldbookId(
    context.store.listWorldbookBindingsBatch(worldbookIds),
  );
  const entriesByWorldbook = groupByWorldbookId(
    context.store.listWorldbookEntriesBatch(worldbookIds),
  );
  const worldbooks = storedWorldbooks.flatMap((worldbook) => {
    const bindings = bindingsByWorldbook.get(worldbook.id) ?? [];
    const applies = bindings.some(
      (binding) =>
        binding.scopeType === "global" ||
        (binding.scopeType === "card" &&
          binding.scopeId === conversation.cardId) ||
        (binding.scopeType === "conversation" &&
          binding.scopeId === conversation.id),
    );
    if (!applies) return [];
    return [
      {
        id: worldbook.id,
        name: worldbook.name,
        bindings: bindings.map((binding) => ({
          scopeType: binding.scopeType,
          scopeId: binding.scopeId,
        })),
        entries: (entriesByWorldbook.get(worldbook.id) ?? []).map((entry) => ({
          id: entry.id,
          legacyUid: entry.legacyUid,
          keys: entry.keys,
          content: entry.content,
          enabled: entry.enabled,
          position: entry.position,
          metadata: entry.metadata,
        })),
      },
    ];
  });
  return {
    conversation: {
      id: conversation.id,
      cardId: conversation.cardId,
      presetId: preset?.id ?? null,
    },
    settings: tavernHelperSettings(context),
    sources,
    worldbooks,
    variables: {
      global: extensionObject(context, "variables:global"),
      character: extensionObject(
        context,
        `variables:card:${conversation.cardId}`,
        cardBundle.variables,
      ),
      preset:
        preset === undefined
          ? {}
          : extensionObject(
              context,
              `variables:preset:${preset.id}`,
              presetBundle?.variables ?? {},
            ),
      chat: extensionObject(
        context,
        `variables:conversation:${conversation.id}`,
      ),
      messages: Object.fromEntries(
        messages.map((message) => [
          message.id,
          extensionObject(context, `variables:message:${message.id}`),
        ]),
      ),
      scripts: Object.fromEntries(
        sources.flatMap((source) =>
          source.bundle.scripts.map((script) => [
            `${source.scope}:${source.id}:${script.id}`,
            extensionObject(
              context,
              `variables:script:${source.scope}:${source.id}:${script.id}`,
              sanitizedObject(script.data),
            ),
          ]),
        ),
      ),
      extensions: {
        sillyTavern: extensionObject(
          context,
          "variables:extension:sillytavern",
        ),
      },
    },
  };
}

function injectCompatibilityMessages(
  messages: readonly ProviderMessage[],
  injects: readonly {
    role: "system" | "assistant" | "user";
    content: string;
    depth: number;
  }[],
  userInput?: string,
): ProviderMessage[] {
  const result = [...messages];
  for (const injection of injects) {
    const index = Math.max(0, result.length - injection.depth);
    result.splice(index, 0, {
      role: injection.role,
      content: injection.content,
    });
  }
  if (userInput !== undefined && userInput.length > 0) {
    result.push({ role: "user", content: userInput });
  }
  return result;
}

function promptTemplateDirectives(
  context: ServerContext,
  conversationId: string,
  cardId: string,
) {
  const worldbooks = context.store.listWorldbooks();
  const worldbookIds = worldbooks.map((worldbook) => worldbook.id);
  const bindingsByWorldbook = groupByWorldbookId(
    context.store.listWorldbookBindingsBatch(worldbookIds),
  );
  const entriesByWorldbook = groupByWorldbookId(
    context.store.listWorldbookEntriesBatch(worldbookIds),
  );
  return worldbooks.flatMap((worldbook) => {
    const applies = (bindingsByWorldbook.get(worldbook.id) ?? []).some(
      (binding) =>
        binding.scopeType === "global" ||
        (binding.scopeType === "card" && binding.scopeId === cardId) ||
        (binding.scopeType === "conversation" &&
          binding.scopeId === conversationId),
    );
    if (!applies) return [];
    return (entriesByWorldbook.get(worldbook.id) ?? []).flatMap((entry) => {
      const title =
        typeof entry.metadata.label === "string"
          ? entry.metadata.label.trim()
          : "";
      if (
        !/^(?:\[GENERATE(?::[^\]]+)?\]|\[InitialVariables\]|@INJECT\b)/iu.test(
          title,
        )
      ) {
        return [];
      }
      return [
        {
          id: entry.id,
          worldbookId: worldbook.id,
          title,
          content: entry.content,
          enabled: entry.enabled,
          order: entry.position,
        },
      ];
    });
  });
}

export async function registerCompatibilityRoutes(
  app: FastifyInstance,
  context: ServerContext,
): Promise<void> {
  app.put("/api/compatibility/regex-grants", (request) => {
    const input = regexGrantSchema.parse(request.body);
    assertTarget(context, input.scope, input.id);
    const current = resolveRegexScope(context.store, input.scope, input.id);
    const updated = updateRegexScope(context.store, {
      scope: input.scope,
      id: input.id,
      expectedRevision: current.revision,
      enabled: input.granted,
    });
    return envelope({
      scope: input.scope,
      id: input.id,
      granted: updated.enabled,
      updatedAt: updated.updatedAt,
    });
  });

  app.get("/api/compatibility/tavern-helper", (request) => {
    const input = tavernHelperContextQuerySchema.parse(request.query);
    return envelope(tavernHelperContext(context, input));
  });

  app.put("/api/compatibility/tavern-helper/settings", (request) => {
    const input = tavernHelperSettingsSchema.parse(request.body);
    const updated = context.store.setExtensionSetting(
      tavernHelperExtensionId,
      "settings:global",
      sanitizeJsonValue(input),
    );
    return envelope({
      settings: updated.value,
      updatedAt: updated.updatedAt,
    });
  });

  app.put("/api/compatibility/tavern-helper/scripts", (request) => {
    const input = tavernHelperScriptsSchema.parse(request.body);
    assertTarget(context, input.scope, input.id);
    const scripts = sanitizeJsonValue(input.scripts);
    const updated = context.store.setExtensionSetting(
      tavernHelperExtensionId,
      `scripts:${input.scope}:${input.id}`,
      { scripts },
    );
    return envelope({
      scope: input.scope,
      id: input.id,
      scripts: isJsonObject(updated.value) ? updated.value.scripts : [],
      updatedAt: updated.updatedAt,
    });
  });

  app.put("/api/compatibility/tavern-helper/grants", (request) => {
    const input = tavernHelperGrantSchema.parse(request.body);
    assertTarget(context, input.scope, input.id);
    const updated = context.store.setExtensionSetting(
      tavernHelperExtensionId,
      input.scope === "global" ? "global" : `${input.scope}:${input.id}`,
      input.granted,
    );
    return envelope({
      scope: input.scope,
      id: input.id,
      granted: updated.value === true,
      updatedAt: updated.updatedAt,
    });
  });

  app.put("/api/compatibility/tavern-helper/state", (request) => {
    const input = tavernHelperStateSchema.parse(request.body);
    const sanitized = sanitizeJsonValue(input.variables);
    if (!isJsonObject(sanitized)) {
      throw invalidTavernHelperState(
        "Tavern Helper variables must be a JSON object.",
      );
    }
    const updated = context.store.setExtensionSetting(
      tavernHelperExtensionId,
      stateKey(context, input),
      sanitized,
    );
    return envelope({
      namespace: input.namespace,
      variables: updated.value,
      updatedAt: updated.updatedAt,
    });
  });

  app.post("/api/compatibility/tavern-helper/generate", async (request) => {
    const input = tavernHelperGenerateSchema.parse(request.body);
    const provider = await context.providers.get(input.connectionId);
    const capabilities = provider.capabilities();
    const prompt = await prepareConversationPrompt(context.store, {
      conversationId: input.conversationId,
      ...(input.presetId === undefined ? {} : { presetId: input.presetId }),
      ...(input.settings === undefined ? {} : { settings: input.settings }),
      ...(capabilities.maxContextTokens === undefined
        ? {}
        : { maxContextTokens: capabilities.maxContextTokens }),
    });
    const messages = injectCompatibilityMessages(
      input.messagesOverride ?? prompt.messages,
      input.injects,
      input.userInput,
    );
    const requestId = `tavern-helper-${crypto.randomUUID()}`;
    let content = "";
    for await (const event of provider.generate(
      {
        requestId,
        messages,
        textPrompt: messages
          .map((message) => `${message.role}: ${message.content}`)
          .join("\n\n"),
        settings: prompt.generation,
        metadata: {
          conversationId: input.conversationId,
          compatibilityApi: "tavern-helper",
          ...(input.presetId === undefined ? {} : { presetId: input.presetId }),
        },
      },
      request.signal,
    )) {
      if (event.type === "text-delta") content += event.delta;
      if (event.type === "error") throw new Error(event.message);
    }
    return envelope({ content });
  });

  app.post("/api/compatibility/prompt-template/prepare", async (request) => {
    const input = promptTemplatePrepareSchema.parse(request.body);
    const conversation = context.store.getConversation(input.conversationId);
    const provider = await context.providers.get(input.connectionId);
    const capabilities = provider.capabilities();
    const prompt = await prepareConversationPrompt(context.store, {
      conversationId: conversation.id,
      ...(input.presetId === undefined ? {} : { presetId: input.presetId }),
      ...(capabilities.maxContextTokens === undefined
        ? {}
        : { maxContextTokens: capabilities.maxContextTokens }),
    });
    const cardTrusted = extensionBoolean(
      context,
      `card:${conversation.cardId}`,
    );
    const presetTrusted =
      input.presetId !== undefined &&
      extensionBoolean(context, `preset:${input.presetId}`);
    return envelope({
      enabled: cardTrusted || presetTrusted,
      messages: prompt.messages,
      directives: promptTemplateDirectives(
        context,
        conversation.id,
        conversation.cardId,
      ),
      templateCount: prompt.messages.filter((message) =>
        /<%[\s\S]*?%>/u.test(message.content),
      ).length,
    });
  });
}
