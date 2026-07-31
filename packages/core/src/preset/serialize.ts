import type {
  JsonObject,
  JsonValue,
  PromptPreset,
  PromptTemplate,
} from "@stn/contracts";

import { isJsonObject, sanitizeJsonValue } from "../import/safe-json.js";
import type { PresetExportOptions, PresetFormat } from "./types.js";

function objectOf(value: unknown): JsonObject {
  const sanitized = sanitizeJsonValue(value);
  if (!isJsonObject(sanitized)) {
    throw new Error("Expected a JSON object");
  }
  return sanitized;
}

function legacySource(preset: PromptPreset): JsonObject {
  const source = preset.extensions.legacySource;
  return isJsonObject(source) ? objectOf(source) : {};
}

function set(
  target: JsonObject,
  key: string,
  value: JsonValue | undefined,
): void {
  if (value !== undefined) {
    target[key] = value;
  }
}

function legacyPrompt(template: PromptTemplate): JsonObject {
  const legacy = isJsonObject(template.metadata.legacy)
    ? objectOf(template.metadata.legacy)
    : {};
  const identifier =
    typeof template.metadata.legacyIdentifier === "string"
      ? template.metadata.legacyIdentifier
      : template.id;
  const definitionEnabled =
    typeof template.metadata.legacyDefinitionEnabled === "boolean"
      ? template.metadata.legacyDefinitionEnabled
      : template.enabled;
  const output: JsonObject = {
    ...legacy,
    identifier,
    name: template.name,
    role: template.role,
    content: template.content,
    enabled: definitionEnabled,
    system_prompt: template.systemPrompt,
  };
  if (Object.hasOwn(template.metadata, "legacyMarker")) {
    output.marker = template.metadata.legacyMarker ?? null;
  } else if (template.marker !== undefined) {
    output.marker =
      template.metadata.dynamicMarker === true ? true : template.marker;
  }
  if (Object.hasOwn(template.metadata, "legacyInjectionPosition")) {
    output.injection_position =
      template.metadata.legacyInjectionPosition ?? null;
  }
  if (Object.hasOwn(template.metadata, "legacyInjectionDepth")) {
    output.injection_depth = template.metadata.legacyInjectionDepth ?? null;
  }
  if (Object.hasOwn(template.metadata, "legacyInjectionOrder")) {
    output.injection_order = template.metadata.legacyInjectionOrder ?? null;
  }
  if (Object.hasOwn(template.metadata, "legacyInjectionTrigger")) {
    output.injection_trigger = template.metadata.legacyInjectionTrigger ?? null;
  }
  return output;
}

function orderItems(preset: PromptPreset): JsonValue[] {
  return [...preset.prompts]
    .filter(
      (prompt) => prompt.metadata.promptOrderMember !== false || prompt.enabled,
    )
    .sort(
      (left, right) =>
        left.order - right.order || left.id.localeCompare(right.id),
    )
    .map((prompt) => ({
      identifier:
        typeof prompt.metadata.legacyIdentifier === "string"
          ? prompt.metadata.legacyIdentifier
          : prompt.id,
      enabled: prompt.enabled,
    }));
}

function promptByLegacyIdentifier(
  preset: PromptPreset,
  identifier: string,
): PromptTemplate | undefined {
  return preset.prompts.find(
    (prompt) =>
      (typeof prompt.metadata.legacyIdentifier === "string"
        ? prompt.metadata.legacyIdentifier
        : prompt.id) === identifier,
  );
}

function orderItemIdentifier(value: JsonValue): string | undefined {
  if (!isJsonObject(value)) {
    return undefined;
  }
  return typeof value.identifier === "string"
    ? value.identifier
    : typeof value.id === "string"
      ? value.id
      : undefined;
}

function mergeOriginalOrderItems(
  preset: PromptPreset,
  values: readonly JsonValue[],
  canonicalItems: readonly JsonValue[],
): JsonValue[] {
  const originalsByIdentifier = new Map<string, JsonObject>();
  const passthrough: JsonValue[] = [];
  for (const value of values) {
    if (!isJsonObject(value)) {
      passthrough.push(value);
      continue;
    }
    const identifier = orderItemIdentifier(value);
    if (identifier === undefined) {
      passthrough.push(value);
      continue;
    }
    const prompt = promptByLegacyIdentifier(preset, identifier);
    if (prompt === undefined) {
      passthrough.push(value);
      continue;
    }
    if (prompt.metadata.promptOrderMember !== false || prompt.enabled) {
      originalsByIdentifier.set(identifier, value);
    }
  }

  const ordered = canonicalItems.map((value) => {
    const identifier = orderItemIdentifier(value);
    const original =
      identifier === undefined
        ? undefined
        : originalsByIdentifier.get(identifier);
    return original === undefined || !isJsonObject(value)
      ? value
      : { ...original, ...value };
  });
  return [...ordered, ...passthrough];
}

function legacyPromptOrder(
  preset: PromptPreset,
  original: JsonValue | undefined,
): JsonValue[] {
  const items = orderItems(preset);
  if (!Array.isArray(original)) {
    return items;
  }
  let replaced = false;
  const nested = original.map((value) => {
    if (!isJsonObject(value) || !Array.isArray(value.order)) {
      return value;
    }
    replaced = true;
    return {
      ...value,
      order: mergeOriginalOrderItems(preset, value.order, items),
    };
  });
  return replaced ? nested : mergeOriginalOrderItems(preset, original, items);
}

function generationFields(
  preset: PromptPreset,
  format: PresetFormat,
): JsonObject {
  const generation = preset.generation;
  const output: JsonObject = {};
  const textLike =
    format === "text-generation" || format === "kobold" || format === "novelai";
  set(
    output,
    format === "openai" || format === "novelai"
      ? "temperature"
      : textLike
        ? "temp"
        : "temperature",
    generation.temperature,
  );
  set(output, "top_p", generation.topP);
  set(output, "top_k", generation.topK);
  set(output, "min_p", generation.minP);
  set(
    output,
    format === "kobold" ? "typical" : "typical_p",
    generation.typicalP,
  );
  set(output, "top_a", generation.topA);
  set(
    output,
    format === "novelai" ? "tail_free_sampling" : "tfs",
    generation.tfs,
  );
  set(
    output,
    format === "openai" || format === "novelai"
      ? "repetition_penalty"
      : "rep_pen",
    generation.repetitionPenalty,
  );
  set(
    output,
    format === "novelai" ? "repetition_penalty_range" : "rep_pen_range",
    generation.repetitionPenaltyRange,
  );
  set(
    output,
    format === "openai"
      ? "frequency_penalty"
      : format === "novelai"
        ? "repetition_penalty_frequency"
        : "freq_pen",
    generation.frequencyPenalty,
  );
  set(
    output,
    format === "openai"
      ? "presence_penalty"
      : format === "novelai"
        ? "repetition_penalty_presence"
        : "presence_pen",
    generation.presencePenalty,
  );
  set(
    output,
    format === "openai" ? "openai_max_tokens" : "max_length",
    generation.maxOutputTokens,
  );
  set(output, "seed", generation.seed);
  set(output, format === "novelai" ? "order" : "sampler_order", [
    ...generation.samplerOrder,
  ]);
  if (generation.stop.length > 0) {
    output.stop = [...generation.stop];
  }
  set(
    output,
    format === "kobold" ? "mirostat" : "mirostat_mode",
    generation.mirostatMode,
  );
  set(output, "mirostat_tau", generation.mirostatTau);
  set(output, "mirostat_eta", generation.mirostatEta);
  set(
    output,
    format === "openai" ? "stream_openai" : "stream",
    generation.stream,
  );
  return output;
}

function promptByMetadata(
  preset: PromptPreset,
  field: string,
): PromptTemplate | undefined {
  return preset.prompts.find((prompt) => prompt.metadata.field === field);
}

function exportSimple(preset: PromptPreset, format: PresetFormat): JsonObject {
  const output = legacySource(preset);
  output.name = preset.name;
  if (format === "system") {
    const prompt = preset.prompts[0];
    if (prompt) {
      output.content = prompt.content;
      output.post_history = prompt.marker === "post-history";
    }
  } else if (format === "context") {
    set(
      output,
      "story_string",
      promptByMetadata(preset, "story_string")?.content,
    );
    set(output, "chat_start", promptByMetadata(preset, "chat_start")?.content);
  } else if (format === "instruct") {
    for (const field of [
      "system_sequence",
      "input_sequence",
      "output_sequence",
      "stop_sequence",
    ]) {
      set(output, field, promptByMetadata(preset, field)?.content);
    }
  } else if (format === "start-reply") {
    const prompt = preset.prompts[0];
    if (prompt) {
      output.value = prompt.content;
      output.show =
        typeof prompt.metadata.show === "boolean"
          ? prompt.metadata.show
          : prompt.enabled;
    }
  }
  return output;
}

function sillyTavernFormat(
  preset: PromptPreset,
  options: PresetExportOptions,
): PresetFormat {
  if (options.format) {
    return options.format;
  }
  const source = preset.compatibility?.sourceFormat;
  if (
    source === "openai" ||
    source === "text-generation" ||
    source === "kobold" ||
    source === "novelai" ||
    source === "instruct" ||
    source === "context" ||
    source === "system" ||
    source === "reasoning" ||
    source === "start-reply" ||
    source === "prompt-manager-full" ||
    source === "prompt-manager-character" ||
    source === "master"
  ) {
    return source;
  }
  return preset.mode === "chat-completion" ? "openai" : "text-generation";
}

function exportSillyTavern(
  preset: PromptPreset,
  options: PresetExportOptions,
): JsonObject {
  const format = sillyTavernFormat(preset, options);
  if (
    format === "prompt-manager-full" ||
    format === "prompt-manager-character"
  ) {
    const source = legacySource(preset);
    const sourceData = isJsonObject(source.data) ? objectOf(source.data) : {};
    const type =
      options.promptManagerType ??
      (format === "prompt-manager-character" ? "character" : "full");
    return {
      ...source,
      version: preset.compatibility?.sourceVersion ?? source.version ?? 1,
      type,
      data: {
        ...sourceData,
        prompts: preset.prompts.map(legacyPrompt),
        prompt_order: legacyPromptOrder(preset, sourceData.prompt_order),
      },
    };
  }
  if (
    format === "system" ||
    format === "context" ||
    format === "instruct" ||
    format === "reasoning" ||
    format === "start-reply" ||
    format === "master"
  ) {
    return exportSimple(preset, format);
  }

  const source = legacySource(preset);
  const output: JsonObject = {
    ...source,
    ...generationFields(preset, format),
  };
  output.name = preset.name;
  if (format === "openai" || preset.prompts.length > 0) {
    output.prompts = preset.prompts.map(legacyPrompt);
    output.prompt_order = legacyPromptOrder(preset, source.prompt_order);
  }
  return output;
}

export function exportPromptPreset(
  preset: PromptPreset,
  options: PresetExportOptions,
): JsonObject {
  if (options.target === "sillytavern-n") {
    return objectOf({
      spec: "sillytavern_n_prompt_preset",
      spec_version: "1.0",
      data: preset,
    });
  }
  return objectOf(exportSillyTavern(preset, options));
}

export function exportPromptPresetJson(
  preset: PromptPreset,
  options: PresetExportOptions,
): string {
  return JSON.stringify(exportPromptPreset(preset, options), null, 2);
}
