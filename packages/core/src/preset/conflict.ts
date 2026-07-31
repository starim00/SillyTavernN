import {
  PromptPresetSchema,
  type JsonObject,
  type PromptPreset,
  type PromptTemplate,
} from "@stn/contracts";

import { isJsonObject, sanitizeJsonValue } from "../import/safe-json.js";
import type {
  PresetConflict,
  PresetConflictOptions,
  PresetConflictResult,
  PresetConflictStrategy,
} from "./types.js";

function mergeJson(left: JsonObject, right: JsonObject): JsonObject {
  const output: JsonObject = {};
  for (const [key, value] of Object.entries(left)) {
    output[key] = value;
  }
  for (const [key, value] of Object.entries(right)) {
    const current = output[key];
    output[key] =
      isJsonObject(current) && isJsonObject(value)
        ? mergeJson(current, value)
        : sanitizeJsonValue(value);
  }
  return output;
}

function mergePrompts(
  existing: readonly PromptTemplate[],
  incoming: readonly PromptTemplate[],
): {
  prompts: PromptTemplate[];
  conflicts: PresetConflict[];
} {
  const prompts = [...existing];
  const indexById = new Map(prompts.map((prompt, index) => [prompt.id, index]));
  const conflicts: PresetConflict[] = [];
  for (const prompt of incoming) {
    const index = indexById.get(prompt.id);
    if (index === undefined) {
      indexById.set(prompt.id, prompts.length);
      prompts.push(prompt);
      continue;
    }
    conflicts.push({ kind: "prompt-id", key: prompt.id });
    prompts[index] = prompt;
  }
  return {
    prompts: prompts.sort(
      (left, right) =>
        left.order - right.order || left.id.localeCompare(right.id),
    ),
    conflicts,
  };
}

function presetConflicts(
  existing: PromptPreset,
  incoming: PromptPreset,
): PresetConflict[] {
  const conflicts: PresetConflict[] = [];
  if (existing.id === incoming.id) {
    conflicts.push({ kind: "preset-id", key: incoming.id });
  }
  if (
    existing.name.localeCompare(incoming.name, undefined, {
      sensitivity: "base",
    }) === 0
  ) {
    conflicts.push({ kind: "preset-name", key: incoming.name });
  }
  return conflicts;
}

export function resolvePresetConflict(
  existing: PromptPreset,
  incoming: PromptPreset,
  strategy: PresetConflictStrategy,
  options: PresetConflictOptions = {},
): PresetConflictResult {
  const now = options.now?.() ?? new Date().toISOString();
  const conflicts = presetConflicts(existing, incoming);

  if (strategy === "keep-existing") {
    return { action: strategy, preset: existing, conflicts };
  }
  if (strategy === "replace") {
    return {
      action: strategy,
      preset: PromptPresetSchema.parse({
        ...incoming,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: now,
      }),
      conflicts,
    };
  }
  if (strategy === "duplicate") {
    const idFactory =
      options.idFactory ??
      (() =>
        `prompt-preset-${typeof globalThis.crypto?.randomUUID === "function" ? globalThis.crypto.randomUUID() : Date.now().toString(36)}`);
    return {
      action: strategy,
      preset: PromptPresetSchema.parse({
        ...incoming,
        id: idFactory("prompt-preset"),
        name:
          options.duplicateName?.(incoming.name) ??
          `${incoming.name} (imported)`,
        createdAt: now,
        updatedAt: now,
      }),
      conflicts,
    };
  }

  const mergedPrompts = mergePrompts(existing.prompts, incoming.prompts);
  const existingUnknown = existing.compatibility?.unknownFields ?? {};
  const incomingUnknown = incoming.compatibility?.unknownFields ?? {};
  return {
    action: strategy,
    preset: PromptPresetSchema.parse({
      ...existing,
      name: incoming.name,
      mode: incoming.mode,
      prompts: mergedPrompts.prompts,
      generation: {
        ...existing.generation,
        ...incoming.generation,
        stop:
          incoming.generation.stop.length > 0
            ? incoming.generation.stop
            : existing.generation.stop,
        samplerOrder:
          incoming.generation.samplerOrder.length > 0
            ? incoming.generation.samplerOrder
            : existing.generation.samplerOrder,
        additional: mergeJson(
          existing.generation.additional,
          incoming.generation.additional,
        ),
      },
      extensions: mergeJson(existing.extensions, incoming.extensions),
      compatibility: {
        sourceFormat:
          incoming.compatibility?.sourceFormat ??
          existing.compatibility?.sourceFormat ??
          "merged",
        ...((incoming.compatibility?.sourceVersion ??
        existing.compatibility?.sourceVersion)
          ? {
              sourceVersion:
                incoming.compatibility?.sourceVersion ??
                existing.compatibility?.sourceVersion,
            }
          : {}),
        ...((incoming.compatibility?.originalFilename ??
        existing.compatibility?.originalFilename)
          ? {
              originalFilename:
                incoming.compatibility?.originalFilename ??
                existing.compatibility?.originalFilename,
            }
          : {}),
        unknownFields: mergeJson(existingUnknown, incomingUnknown),
      },
      updatedAt: now,
    }),
    conflicts: [...conflicts, ...mergedPrompts.conflicts],
  };
}

export function findPresetConflict(
  existing: readonly PromptPreset[],
  incoming: PromptPreset,
): PromptPreset | undefined {
  return existing.find(
    (preset) =>
      preset.id === incoming.id ||
      preset.name.localeCompare(incoming.name, undefined, {
        sensitivity: "base",
      }) === 0,
  );
}
