import type { Diagnostic } from "@stn/contracts";

export const REGEX_SCRIPT_FIELDS = [
  "id",
  "scriptName",
  "findRegex",
  "replaceString",
  "trimStrings",
  "placement",
  "disabled",
  "markdownOnly",
  "promptOnly",
  "runOnEdit",
  "substituteRegex",
  "minDepth",
  "maxDepth",
] as const;

export const REGEX_PLACEMENTS = [1, 2, 3, 5, 6] as const;

export type RegexPlacement = (typeof REGEX_PLACEMENTS)[number];

export const REGEX_SUBSTITUTE_MODES = [0, 1, 2] as const;

export type RegexSubstituteMode = (typeof REGEX_SUBSTITUTE_MODES)[number];

export type RegexScriptSource = "global" | "preset" | "card";

export type RegexExecutionTarget = "stored" | "markdown" | "prompt";

export type RegexScript = {
  id: string;
  scriptName: string;
  findRegex: string;
  replaceString: string;
  trimStrings: string[];
  placement: RegexPlacement[];
  disabled: boolean;
  markdownOnly: boolean;
  promptOnly: boolean;
  runOnEdit: boolean;
  substituteRegex: RegexSubstituteMode;
  minDepth: number | null;
  maxDepth: number | null;
  source: RegexScriptSource;
  sourceIndex: number;
};

export type ParseRegexScriptsOptions = {
  source: RegexScriptSource;
  path?: string;
};

export type RegexScriptParseResult = {
  scripts: RegexScript[];
  diagnostics: Diagnostic[];
};

/**
 * Values can be an entity with an `extensions` object or the extensions
 * object itself. Sources are collected in compatibility execution order:
 * global settings, the selected preset, then the current card.
 */
export type CollectRegexScriptsInput = {
  global?: unknown;
  card?: unknown;
  preset?: unknown;
};

export type ApplyRegexScriptsOptions = {
  placement: RegexPlacement;
  target?: RegexExecutionTarget;
  depth?: number;
  edited?: boolean;
  substitutions?: Readonly<Record<string, string>>;
  onDiagnostic?: (diagnostic: Diagnostic) => void;
};

export type RegexApplyResult = {
  text: string;
  diagnostics: Diagnostic[];
  appliedScriptIds: string[];
};
