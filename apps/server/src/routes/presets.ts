import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  exportPromptPresetJson,
  findPresetConflict,
  inspectTavernHelperScripts,
  isJsonObject,
  previewPromptPreset,
  resolvePresetConflict,
  sanitizeJsonValue,
} from "@stn/core";
import {
  GenerationSettingsSchema,
  PromptPresetSchema,
  type JsonObject,
  type JsonValue,
  type PromptPreset,
} from "@stn/contracts";
import { NotFoundError, StorageError, type Preset } from "@stn/storage";

import { envelope, type ServerContext } from "../context.js";

const formatSchema = z.enum([
  "sillytavern-n",
  "openai",
  "text-generation",
  "kobold",
  "novelai",
  "instruct",
  "context",
  "system",
  "reasoning",
  "start-reply",
  "prompt-manager-full",
  "prompt-manager-character",
  "master",
]);

const conflictStrategySchema = z.enum([
  "replace",
  "keep-existing",
  "duplicate",
  "merge",
]);

const promptPatchSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    enabled: z.boolean().optional(),
    inserted: z.boolean().optional(),
    content: z.string().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.enabled !== undefined ||
      value.inserted !== undefined ||
      value.content !== undefined,
    {
      message: "At least one of enabled, inserted or content must be provided.",
    },
  )
  .refine((value) => !(value.inserted === false && value.enabled === true), {
    message: "A detached prompt cannot be enabled.",
  });

const promptOrderPatchSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    promptIds: z.array(z.string().trim().min(1)).min(1),
  })
  .strict()
  .refine((value) => new Set(value.promptIds).size === value.promptIds.length, {
    message: "Prompt order cannot contain duplicate identifiers.",
    path: ["promptIds"],
  });

const generationKeys = [
  "temperature",
  "topP",
  "topK",
  "minP",
  "typicalP",
  "topA",
  "tfs",
  "repetitionPenalty",
  "repetitionPenaltyRange",
  "frequencyPenalty",
  "presencePenalty",
  "maxOutputTokens",
  "seed",
  "mirostatMode",
  "mirostatTau",
  "mirostatEta",
  "stream",
] as const;

function jsonObject(value: unknown): JsonObject {
  const sanitized = sanitizeJsonValue(value);
  if (!isJsonObject(sanitized)) {
    throw new Error("Expected a JSON object.");
  }
  return sanitized;
}

function sourceValue(value: unknown): string | JsonObject {
  if (typeof value === "string") return value;
  return jsonObject(value);
}

function persistedPreset(value: Preset): PromptPreset {
  for (const candidate of [value.payload, value.legacyPayload.normalized]) {
    const parsed = PromptPresetSchema.safeParse(candidate);
    if (parsed.success) {
      return {
        ...parsed.data,
        id: value.id,
        name: value.name,
        updatedAt: value.updatedAt,
      };
    }
  }

  const generationSource: JsonObject = {};
  for (const key of generationKeys) {
    const field = value.payload[key];
    if (field !== undefined) generationSource[key] = field;
  }
  const generation = GenerationSettingsSchema.parse({
    ...generationSource,
    stop: Array.isArray(value.payload.stop) ? value.payload.stop : [],
    samplerOrder: Array.isArray(value.payload.samplerOrder)
      ? value.payload.samplerOrder
      : [],
    additional: isJsonObject(value.payload.additional)
      ? value.payload.additional
      : {},
  });
  return PromptPresetSchema.parse({
    id: value.id,
    name: value.name,
    mode:
      value.kind === "text-generation"
        ? "text-generation"
        : value.kind === "chat-completion"
          ? "chat-completion"
          : "native",
    prompts: [],
    generation,
    extensions: {},
    compatibility: {
      sourceFormat: "native-storage",
      unknownFields: value.legacyPayload,
    },
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  });
}

function saveImportedPreset(
  context: ServerContext,
  preset: PromptPreset,
  legacyPayload: JsonObject,
): Preset {
  const stored = context.store.createPreset({
    id: preset.id,
    name: preset.name,
    kind: preset.mode,
    payload: jsonObject(preset),
    legacyPayload,
  });
  if (regexScriptCount(preset) > 0) {
    context.store.setExtensionSetting(
      "stn.regex",
      `preset:${stored.id}`,
      false,
    );
  }
  disableImportedTavernHelperScripts(context, preset, stored.id);
  return stored;
}

function disableImportedTavernHelperScripts(
  context: ServerContext,
  preset: PromptPreset,
  presetId: string,
): void {
  if (inspectTavernHelperScripts(preset).scriptCount > 0) {
    context.store.setExtensionSetting(
      "stn.tavern-helper",
      `preset:${presetId}`,
      false,
    );
  }
}

function tavernHelperCounts(preset: PromptPreset) {
  const summary = inspectTavernHelperScripts(preset);
  return {
    tavernHelperScriptCount: summary.scriptCount,
    enabledTavernHelperScriptCount: summary.enabledScriptCount,
  };
}

function importCounts(preset: PromptPreset) {
  return {
    regexScriptCount: regexScriptCount(preset),
    ...tavernHelperCounts(preset),
  };
}

function regexScriptCount(preset: PromptPreset): number {
  const direct = preset.extensions.regex_scripts;
  if (Array.isArray(direct)) return direct.length;
  const legacySource = preset.extensions.legacySource;
  if (!isJsonObject(legacySource)) return 0;
  const legacyDirect = legacySource.regex_scripts;
  if (Array.isArray(legacyDirect)) return legacyDirect.length;
  const legacyExtensions = legacySource.extensions;
  return isJsonObject(legacyExtensions) &&
    Array.isArray(legacyExtensions.regex_scripts)
    ? legacyExtensions.regex_scripts.length
    : 0;
}

function canonicalJson(value: JsonValue): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (isJsonObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) => `${JSON.stringify(key)}:${canonicalJson(value[key] ?? null)}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function regexBundle(preset: PromptPreset): JsonObject {
  const bundle: JsonObject = {};
  const extensions = preset.extensions;
  if (Object.hasOwn(extensions, "regex_scripts")) {
    bundle.extensions = extensions.regex_scripts ?? null;
  }
  const legacySource = extensions.legacySource;
  if (!isJsonObject(legacySource)) {
    return bundle;
  }
  if (Object.hasOwn(legacySource, "regex_scripts")) {
    bundle.legacySource = legacySource.regex_scripts ?? null;
  }
  if (
    isJsonObject(legacySource.extensions) &&
    Object.hasOwn(legacySource.extensions, "regex_scripts")
  ) {
    bundle.legacySourceExtensions =
      legacySource.extensions.regex_scripts ?? null;
  }
  return bundle;
}

const tavernHelperBundleKeys = [
  "tavern_helper",
  "TavernHelper_scripts",
  "TavernHelper_characterScriptVariables",
] as const;

function tavernHelperEnvelope(extensions: JsonObject): JsonObject | undefined {
  const envelope: JsonObject = {};
  for (const key of tavernHelperBundleKeys) {
    if (Object.hasOwn(extensions, key)) {
      envelope[key] = extensions[key] ?? null;
    }
  }
  return Object.keys(envelope).length > 0 ? envelope : undefined;
}

function tavernHelperBundle(preset: PromptPreset): JsonObject {
  const bundle: JsonObject = {};
  const direct = tavernHelperEnvelope(preset.extensions);
  if (direct) {
    bundle.extensions = direct;
  }
  const legacySource = preset.extensions.legacySource;
  if (!isJsonObject(legacySource)) {
    return bundle;
  }
  if (isJsonObject(legacySource.extensions)) {
    const legacyExtensions = tavernHelperEnvelope(legacySource.extensions);
    if (legacyExtensions) {
      bundle.legacySourceExtensions = legacyExtensions;
    }
  }
  if (
    isJsonObject(legacySource.data) &&
    isJsonObject(legacySource.data.extensions)
  ) {
    const legacyCardExtensions = tavernHelperEnvelope(
      legacySource.data.extensions,
    );
    if (legacyCardExtensions) {
      bundle.legacySourceDataExtensions = legacyCardExtensions;
    }
  }
  return bundle;
}

function resetChangedPresetSourceGrants(
  context: ServerContext,
  presetId: string,
  previous: PromptPreset,
  next: PromptPreset,
): void {
  const settingKey = `preset:${presetId}`;
  if (
    canonicalJson(regexBundle(previous)) !== canonicalJson(regexBundle(next))
  ) {
    context.store.setExtensionSetting("stn.regex", settingKey, false);
  }
  if (
    canonicalJson(tavernHelperBundle(previous)) !==
    canonicalJson(tavernHelperBundle(next))
  ) {
    context.store.setExtensionSetting("stn.tavern-helper", settingKey, false);
  }
}

function normalizeEnabledPromptOrder(preset: PromptPreset): PromptPreset {
  let nextOrder = preset.prompts.reduce(
    (maximum, prompt) =>
      prompt.metadata.promptOrderMember === false
        ? maximum
        : Math.max(maximum, prompt.order),
    -1,
  );
  let changed = false;
  const prompts = preset.prompts.map((prompt) => {
    if (!prompt.enabled || prompt.metadata.promptOrderMember !== false) {
      return prompt;
    }
    changed = true;
    nextOrder += 1;
    return {
      ...prompt,
      order: nextOrder,
      metadata: {
        ...prompt.metadata,
        promptOrderMember: true,
        promptOrderIndex: nextOrder,
      },
    };
  });
  return changed ? { ...preset, prompts } : preset;
}

function insertionOrderFor(preset: PromptPreset): number {
  const inserted = preset.prompts.filter(
    (prompt) => prompt.metadata.promptOrderMember !== false,
  );
  return inserted.length === 0
    ? 0
    : Math.max(...inserted.map((prompt) => prompt.order)) + 1;
}

function withoutPromptOrderIndex(metadata: JsonObject): JsonObject {
  const next = { ...metadata };
  delete next.promptOrderIndex;
  return next;
}

export async function registerPresetRoutes(
  app: FastifyInstance,
  context: ServerContext,
): Promise<void> {
  app.post("/api/presets/preview", (request) => {
    const input = z
      .object({
        source: z.unknown(),
        filename: z.string().trim().max(1024).optional(),
        formatHint: formatSchema.optional(),
      })
      .strict()
      .parse(request.body);
    return envelope(
      previewPromptPreset(sourceValue(input.source), {
        ...(input.filename === undefined ? {} : { filename: input.filename }),
        ...(input.formatHint === undefined
          ? {}
          : { formatHint: input.formatHint }),
      }),
    );
  });

  app.post("/api/presets/import", (request, reply) => {
    const input = z
      .object({
        source: z.unknown(),
        filename: z.string().trim().max(1024).optional(),
        formatHint: formatSchema.optional(),
        conflictStrategy: conflictStrategySchema.default("duplicate"),
      })
      .strict()
      .parse(request.body);
    const preview = previewPromptPreset(sourceValue(input.source), {
      ...(input.filename === undefined ? {} : { filename: input.filename }),
      ...(input.formatHint === undefined
        ? {}
        : { formatHint: input.formatHint }),
    });
    const normalizedExisting = context.store.listPresets().map(persistedPreset);
    const conflict = findPresetConflict(normalizedExisting, preview.preset);
    const legacyPayload = jsonObject({
      detection: preview.detection,
      sections: preview.sections,
      diagnostics: preview.diagnostics,
      unknownFields: preview.unknownFields,
      normalized: preview.preset,
    });

    if (!conflict) {
      return reply.code(201).send(
        envelope({
          preset: saveImportedPreset(context, preview.preset, legacyPayload),
          action: "created",
          conflicts: [],
          ...importCounts(preview.preset),
        }),
      );
    }

    const resolved = resolvePresetConflict(
      conflict,
      preview.preset,
      input.conflictStrategy,
    );
    if (resolved.action === "keep-existing") {
      return envelope({
        preset: context.store.getPreset(conflict.id),
        action: resolved.action,
        conflicts: resolved.conflicts,
        ...importCounts(persistedPreset(context.store.getPreset(conflict.id))),
      });
    }
    if (resolved.action === "duplicate") {
      return reply.code(201).send(
        envelope({
          preset: saveImportedPreset(context, resolved.preset, legacyPayload),
          action: resolved.action,
          conflicts: resolved.conflicts,
          ...importCounts(resolved.preset),
        }),
      );
    }
    const updated = context.store.database.transaction(() => {
      const current = context.store.getPreset(conflict.id);
      const previous = persistedPreset(current);
      const stored = context.store.updatePreset({
        id: current.id,
        expectedRevision: current.revision,
        patch: {
          name: resolved.preset.name,
          kind: resolved.preset.mode,
          payload: jsonObject(resolved.preset),
        },
      });
      resetChangedPresetSourceGrants(
        context,
        stored.id,
        previous,
        resolved.preset,
      );
      return stored;
    });
    return envelope({
      preset: updated,
      action: resolved.action,
      conflicts: resolved.conflicts,
      ...importCounts(resolved.preset),
    });
  });

  app.patch<{ Params: { id: string } }>("/api/presets/:id", (request) => {
    const input = z
      .object({
        expectedRevision: z.number().int().nonnegative(),
        preset: PromptPresetSchema,
      })
      .strict()
      .parse(request.body);
    const updated = context.store.database.transaction(() => {
      const current = context.store.getPreset(request.params.id);
      const previous = persistedPreset(current);
      const mergedExtensions = {
        ...previous.extensions,
        ...input.preset.extensions,
      };
      const nextPreset = normalizeEnabledPromptOrder(
        PromptPresetSchema.parse({
          ...input.preset,
          id: current.id,
          extensions: mergedExtensions,
        }),
      );
      const stored = context.store.updatePreset({
        id: current.id,
        expectedRevision: input.expectedRevision,
        patch: {
          name: nextPreset.name,
          kind: nextPreset.mode,
          payload: jsonObject(nextPreset),
        },
      });
      resetChangedPresetSourceGrants(context, stored.id, previous, nextPreset);
      return stored;
    });
    return envelope(updated);
  });

  app.delete<{ Params: { id: string } }>("/api/presets/:id", (request) => {
    const input = z
      .object({ expectedRevision: z.number().int().nonnegative() })
      .strict()
      .parse(request.body);
    return envelope(
      context.store.deletePreset(request.params.id, input.expectedRevision),
    );
  });

  app.patch<{ Params: { presetId: string; promptId: string } }>(
    "/api/presets/:presetId/prompts/:promptId",
    (request) => {
      const input = promptPatchSchema.parse(request.body);
      const updated = context.store.database.transaction(() => {
        const current = context.store.getPreset(request.params.presetId);
        const previous = persistedPreset(current);
        const promptIndex = previous.prompts.findIndex(
          (prompt) => prompt.id === request.params.promptId,
        );
        if (promptIndex < 0) {
          throw new NotFoundError("preset prompt", request.params.promptId);
        }
        const prompt = previous.prompts[promptIndex];
        if (!prompt) {
          throw new NotFoundError("preset prompt", request.params.promptId);
        }
        let nextPrompt = {
          ...prompt,
          ...(input.content === undefined ? {} : { content: input.content }),
        };
        if (input.inserted === false) {
          nextPrompt = {
            ...nextPrompt,
            enabled: false,
            metadata: {
              ...withoutPromptOrderIndex(nextPrompt.metadata),
              promptOrderMember: false,
            },
          };
        } else if (
          input.inserted === true &&
          nextPrompt.metadata.promptOrderMember === false
        ) {
          const order = insertionOrderFor(previous);
          nextPrompt = {
            ...nextPrompt,
            enabled: false,
            order,
            metadata: {
              ...nextPrompt.metadata,
              promptOrderMember: true,
              promptOrderIndex: order,
            },
          };
        }
        if (input.enabled !== undefined) {
          nextPrompt = { ...nextPrompt, enabled: input.enabled };
        }
        const prompts = [...previous.prompts];
        prompts[promptIndex] = nextPrompt;
        // A definition absent from legacy prompt_order is retained as a
        // disabled option. The compatibility normalization also handles older
        // clients that enable an uninserted definition in one request.
        const nextPreset = normalizeEnabledPromptOrder(
          PromptPresetSchema.parse({
            ...previous,
            prompts,
          }),
        );
        return context.store.updatePreset({
          id: current.id,
          expectedRevision: input.expectedRevision,
          patch: { payload: jsonObject(nextPreset) },
        });
      });
      return envelope(updated);
    },
  );

  app.patch<{ Params: { presetId: string } }>(
    "/api/presets/:presetId/prompt-order",
    (request) => {
      const input = promptOrderPatchSchema.parse(request.body);
      const updated = context.store.database.transaction(() => {
        const current = context.store.getPreset(request.params.presetId);
        const previous = persistedPreset(current);
        const insertedIds = previous.prompts
          .filter((prompt) => prompt.metadata.promptOrderMember !== false)
          .map((prompt) => prompt.id);
        const requestedIds = new Set(input.promptIds);
        if (
          input.promptIds.length !== insertedIds.length ||
          insertedIds.some((id) => !requestedIds.has(id))
        ) {
          throw new StorageError(
            "invalid_prompt_order",
            "Prompt order must contain every inserted prompt exactly once.",
            400,
            {
              insertedPromptIds: insertedIds,
              requestedPromptIds: input.promptIds,
            },
          );
        }

        const orderById = new Map(
          input.promptIds.map((promptId, index) => [promptId, index]),
        );
        const nextPreset = PromptPresetSchema.parse({
          ...previous,
          prompts: previous.prompts.map((prompt) => {
            const order = orderById.get(prompt.id);
            return order === undefined
              ? prompt
              : {
                  ...prompt,
                  order,
                  metadata: {
                    ...prompt.metadata,
                    promptOrderMember: true,
                    promptOrderIndex: order,
                  },
                };
          }),
        });
        return context.store.updatePreset({
          id: current.id,
          expectedRevision: input.expectedRevision,
          patch: { payload: jsonObject(nextPreset) },
        });
      });
      return envelope(updated);
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/presets/:id/export",
    (request, reply) => {
      const query = z
        .object({
          target: z
            .enum(["sillytavern-n", "sillytavern"])
            .default("sillytavern-n"),
          format: formatSchema.exclude(["sillytavern-n"]).optional(),
          promptManagerType: z.enum(["full", "character"]).optional(),
        })
        .strict()
        .parse(request.query);
      const preset = persistedPreset(
        context.store.getPreset(request.params.id),
      );
      const body = exportPromptPresetJson(preset, {
        target: query.target,
        ...(query.format === undefined ? {} : { format: query.format }),
        ...(query.promptManagerType === undefined
          ? {}
          : { promptManagerType: query.promptManagerType }),
      });
      return reply
        .type("application/json; charset=utf-8")
        .header(
          "content-disposition",
          `attachment; filename="${encodeURIComponent(preset.name)}.json"`,
        )
        .send(body);
    },
  );
}
