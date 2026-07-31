import type { JsonObject } from "@stn/contracts";

import { isJsonObject } from "../import/safe-json.js";
import type { PresetDetection, PresetFormat } from "./types.js";

function hasAll(value: JsonObject, fields: readonly string[]): boolean {
  return fields.every((field) => field in value);
}

function matching(value: JsonObject, fields: readonly string[]): string[] {
  return fields.filter((field) => field in value);
}

function result(
  format: PresetFormat,
  confidence: PresetDetection["confidence"],
  matchedFields: readonly string[],
  reason: string,
): PresetDetection {
  return { format, confidence, matchedFields, reason };
}

const MASTER_SECTIONS = [
  "instruct",
  "context",
  "sysprompt",
  "preset",
  "reasoning",
  "srw",
] as const;

export function detectPresetFormat(value: JsonObject): PresetDetection {
  if (
    value.spec === "sillytavern_n_prompt_preset" &&
    isJsonObject(value.data)
  ) {
    return result(
      "sillytavern-n",
      "certain",
      ["spec", "data"],
      "SillyTavern N preset envelope",
    );
  }

  if (
    (value.type === "full" || value.type === "character") &&
    isJsonObject(value.data) &&
    Array.isArray(value.data.prompts) &&
    Array.isArray(value.data.prompt_order)
  ) {
    return result(
      value.type === "full"
        ? "prompt-manager-full"
        : "prompt-manager-character",
      "certain",
      ["version", "type", "data"],
      "Prompt Manager export envelope",
    );
  }

  const masterFields = matching(value, MASTER_SECTIONS);
  if (
    masterFields.length >= 2 ||
    value.preset_format === "master" ||
    value.type === "master"
  ) {
    return result(
      "master",
      "certain",
      masterFields,
      "Master settings sections detected",
    );
  }

  if (hasAll(value, ["name", "input_sequence", "output_sequence"])) {
    return result(
      "instruct",
      "certain",
      ["name", "input_sequence", "output_sequence"],
      "Instruct template signature",
    );
  }
  if (hasAll(value, ["name", "story_string"])) {
    return result(
      "context",
      "certain",
      ["name", "story_string"],
      "Context template signature",
    );
  }
  if (hasAll(value, ["name", "prefix", "suffix", "separator"])) {
    return result(
      "reasoning",
      "certain",
      ["name", "prefix", "suffix", "separator"],
      "Reasoning formatting signature",
    );
  }
  if ("value" in value && "show" in value) {
    return result(
      "start-reply",
      "certain",
      ["value", "show"],
      "Start Reply With signature",
    );
  }
  if (hasAll(value, ["name", "content"])) {
    return result(
      "system",
      "certain",
      matching(value, ["name", "content", "post_history"]),
      "System prompt signature",
    );
  }

  const openAiFields = matching(value, [
    "prompts",
    "prompt_order",
    "chat_completion_source",
    "openai_max_context",
    "openai_max_tokens",
    "frequency_penalty",
    "presence_penalty",
    "stream_openai",
  ]);
  if (
    (Array.isArray(value.prompts) && Array.isArray(value.prompt_order)) ||
    openAiFields.length >= 3
  ) {
    return result(
      "openai",
      "certain",
      openAiFields,
      "OpenAI or Prompt Manager settings signature",
    );
  }

  const novelFields = matching(value, [
    "phrase_rep_pen",
    "tail_free_sampling",
    "repetition_penalty_frequency",
    "repetition_penalty_presence",
    "prefix",
    "order",
  ]);
  if (novelFields.length >= 2) {
    return result(
      "novelai",
      "certain",
      novelFields,
      "NovelAI sampler signature",
    );
  }

  const koboldFields = matching(value, [
    "use_default_badwordsids",
    "mirostat",
    "grammar",
    "rep_pen",
    "rep_pen_range",
    "sampler_order",
  ]);
  if (
    ("use_default_badwordsids" in value || "mirostat" in value) &&
    koboldFields.length >= 3
  ) {
    return result(
      "kobold",
      "certain",
      koboldFields,
      "Kobold sampler signature",
    );
  }

  const textFields = matching(value, [
    "temp",
    "temperature",
    "top_k",
    "top_p",
    "rep_pen",
    "repetition_penalty",
    "sampler_order",
    "samplers",
  ]);
  if (
    hasAll(value, ["temp", "top_k", "top_p", "rep_pen"]) ||
    textFields.length >= 3
  ) {
    return result(
      "text-generation",
      "likely",
      textFields,
      "Text-generation sampler fields detected",
    );
  }

  return result(
    "unknown",
    "possible",
    [],
    "No supported preset field signature was found",
  );
}

export { MASTER_SECTIONS };
