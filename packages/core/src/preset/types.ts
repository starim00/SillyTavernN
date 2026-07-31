import type { Diagnostic, JsonObject, PromptPreset } from "@stn/contracts";

import type { SafeJsonLimits } from "../import/safe-json.js";

export type PresetFormat =
  | "sillytavern-n"
  | "openai"
  | "text-generation"
  | "kobold"
  | "novelai"
  | "instruct"
  | "context"
  | "system"
  | "reasoning"
  | "start-reply"
  | "prompt-manager-full"
  | "prompt-manager-character"
  | "master"
  | "unknown";

export interface PresetDetection {
  readonly format: PresetFormat;
  readonly confidence: "certain" | "likely" | "possible";
  readonly matchedFields: readonly string[];
  readonly reason: string;
}

export interface PresetParseOptions {
  readonly filename?: string;
  readonly name?: string;
  readonly now?: () => string;
  readonly idFactory?: (kind: string) => string;
  readonly formatHint?: Exclude<PresetFormat, "unknown">;
  readonly jsonLimits?: Partial<SafeJsonLimits>;
}

export interface PresetSectionPreview {
  readonly kind: string;
  readonly name: string;
  readonly promptCount: number;
  readonly fields: readonly string[];
}

export interface PromptPresetPreview {
  readonly detection: PresetDetection;
  readonly preset: PromptPreset;
  readonly sections: readonly PresetSectionPreview[];
  readonly diagnostics: readonly Diagnostic[];
  readonly unknownFields: JsonObject;
}

export type PresetExportTarget = "sillytavern-n" | "sillytavern";

export interface PresetExportOptions {
  readonly target: PresetExportTarget;
  readonly format?: Exclude<PresetFormat, "unknown" | "sillytavern-n">;
  readonly promptManagerType?: "full" | "character";
}

export type PresetConflictStrategy =
  "replace" | "keep-existing" | "duplicate" | "merge";

export interface PresetConflict {
  readonly kind: "preset-id" | "preset-name" | "prompt-id";
  readonly key: string;
}

export interface PresetConflictOptions {
  readonly now?: () => string;
  readonly idFactory?: (kind: string) => string;
  readonly duplicateName?: (name: string) => string;
}

export interface PresetConflictResult {
  readonly action: PresetConflictStrategy;
  readonly preset: PromptPreset;
  readonly conflicts: readonly PresetConflict[];
}
