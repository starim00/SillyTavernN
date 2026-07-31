import type { Diagnostic } from "@stn/contracts";

import {
  REGEX_PLACEMENTS,
  REGEX_SUBSTITUTE_MODES,
  type ApplyRegexScriptsOptions,
  type CollectRegexScriptsInput,
  type ParseRegexScriptsOptions,
  type RegexApplyResult,
  type RegexExecutionTarget,
  type RegexPlacement,
  type RegexScript,
  type RegexScriptParseResult,
  type RegexScriptSource,
  type RegexSubstituteMode,
} from "./types.js";

type UnknownRecord = Record<string, unknown>;

type LocatedValue = {
  value: unknown;
  path: string;
};

const placementSet = new Set<number>(REGEX_PLACEMENTS);
const substituteModeSet = new Set<number>(REGEX_SUBSTITUTE_MODES);

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function diagnostic(
  severity: Diagnostic["severity"],
  code: string,
  message: string,
  path?: string,
): Diagnostic {
  return {
    severity,
    code,
    message,
    ...(path === undefined ? {} : { path }),
  };
}

function stringValue(value: unknown, fallback: string): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return fallback;
}

function booleanValue(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1" || value === "true") return true;
  if (value === 0 || value === "0" || value === "false") return false;
  return fallback;
}

function integerValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/u.test(value.trim())) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return undefined;
}

function trimStringsOf(
  value: unknown,
  diagnostics: Diagnostic[],
  path: string,
): string[] {
  if (value === undefined || value === null) return [];
  if (typeof value === "string") {
    return value.split(/\r?\n/u).filter((item) => item.length > 0);
  }
  if (!Array.isArray(value)) {
    diagnostics.push(
      diagnostic(
        "warning",
        "REGEX_TRIM_STRINGS_INVALID",
        "trimStrings must be a string or an array of strings; the field was ignored.",
        path,
      ),
    );
    return [];
  }

  const strings = value.filter(
    (item): item is string => typeof item === "string" && item.length > 0,
  );
  if (strings.length !== value.length) {
    diagnostics.push(
      diagnostic(
        "warning",
        "REGEX_TRIM_STRING_INVALID",
        "Non-string or empty trimStrings entries were ignored.",
        path,
      ),
    );
  }
  return strings;
}

function placementsOf(
  value: unknown,
  diagnostics: Diagnostic[],
  path: string,
): RegexPlacement[] {
  if (value === undefined || value === null) return [];
  const values = Array.isArray(value) ? value : [value];
  const placements: RegexPlacement[] = [];
  let invalid = false;

  for (const item of values) {
    const parsed = integerValue(item);
    if (parsed === undefined || !placementSet.has(parsed)) {
      invalid = true;
      continue;
    }
    const placement = parsed as RegexPlacement;
    if (!placements.includes(placement)) placements.push(placement);
  }

  if (invalid) {
    diagnostics.push(
      diagnostic(
        "warning",
        "REGEX_PLACEMENT_INVALID",
        "Unsupported regex placements were ignored. Supported values are 1, 2, 3, 5, and 6.",
        path,
      ),
    );
  }
  return placements;
}

function substituteModeOf(
  value: unknown,
  diagnostics: Diagnostic[],
  path: string,
): RegexSubstituteMode {
  if (value === undefined || value === null) return 0;
  const parsed = integerValue(value);
  if (parsed !== undefined && substituteModeSet.has(parsed)) {
    return parsed as RegexSubstituteMode;
  }
  diagnostics.push(
    diagnostic(
      "warning",
      "REGEX_SUBSTITUTE_MODE_INVALID",
      "substituteRegex must be 0, 1, or 2; it defaulted to 0.",
      path,
    ),
  );
  return 0;
}

function depthOf(
  value: unknown,
  diagnostics: Diagnostic[],
  path: string,
): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = integerValue(value);
  if (parsed === -1) return null;
  if (parsed !== undefined && parsed >= 0) return parsed;
  diagnostics.push(
    diagnostic(
      "warning",
      "REGEX_DEPTH_INVALID",
      "Regex depth must be a non-negative integer, -1, or empty; it defaulted to unlimited.",
      path,
    ),
  );
  return null;
}

export function parseRegexScripts(
  value: unknown,
  options: ParseRegexScriptsOptions,
): RegexScriptParseResult {
  const diagnostics: Diagnostic[] = [];
  const path = options.path ?? `${options.source}.extensions.regex_scripts`;
  if (value === undefined || value === null) {
    return { scripts: [], diagnostics };
  }
  if (!Array.isArray(value)) {
    return {
      scripts: [],
      diagnostics: [
        diagnostic(
          "warning",
          "REGEX_SCRIPTS_INVALID",
          "regex_scripts must be an array; the value was ignored.",
          path,
        ),
      ],
    };
  }

  const scripts: RegexScript[] = [];
  for (const [index, item] of value.entries()) {
    const scriptPath = `${path}[${String(index)}]`;
    if (!isRecord(item)) {
      diagnostics.push(
        diagnostic(
          "warning",
          "REGEX_SCRIPT_INVALID",
          "Regex script entries must be objects; the entry was ignored.",
          scriptPath,
        ),
      );
      continue;
    }

    const fallbackId = `${options.source}-regex-${String(index + 1)}`;
    const id = stringValue(item.id, fallbackId).trim() || fallbackId;
    const scriptName =
      stringValue(item.scriptName, id).trim() || `Regex ${String(index + 1)}`;
    const minDepth = depthOf(
      item.minDepth,
      diagnostics,
      `${scriptPath}.minDepth`,
    );
    const maxDepth = depthOf(
      item.maxDepth,
      diagnostics,
      `${scriptPath}.maxDepth`,
    );
    if (minDepth !== null && maxDepth !== null && minDepth > maxDepth) {
      diagnostics.push(
        diagnostic(
          "warning",
          "REGEX_DEPTH_RANGE_INVALID",
          `Regex script '${scriptName}' has minDepth greater than maxDepth and will not run at a message depth.`,
          scriptPath,
        ),
      );
    }

    scripts.push({
      id,
      scriptName,
      findRegex: stringValue(item.findRegex, ""),
      replaceString: stringValue(item.replaceString, ""),
      trimStrings: trimStringsOf(
        item.trimStrings,
        diagnostics,
        `${scriptPath}.trimStrings`,
      ),
      placement: placementsOf(
        item.placement,
        diagnostics,
        `${scriptPath}.placement`,
      ),
      disabled: booleanValue(item.disabled),
      markdownOnly: booleanValue(item.markdownOnly),
      promptOnly: booleanValue(item.promptOnly),
      runOnEdit: booleanValue(item.runOnEdit),
      substituteRegex: substituteModeOf(
        item.substituteRegex,
        diagnostics,
        `${scriptPath}.substituteRegex`,
      ),
      minDepth,
      maxDepth,
      source: options.source,
      sourceIndex: index,
    });
  }

  return { scripts, diagnostics };
}

function extensionsOf(value: unknown): LocatedValue | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) return { value, path: "extensions" };
  if ("extensions" in value) {
    return { value: value.extensions, path: "extensions" };
  }
  return { value, path: "extensions" };
}

function regexScriptsOf(
  value: unknown,
  source: RegexScriptSource,
): LocatedValue | undefined {
  const locatedExtensions = extensionsOf(value);
  if (locatedExtensions === undefined) return undefined;
  if (!isRecord(locatedExtensions.value)) {
    return {
      value: locatedExtensions.value,
      path: `${source}.${locatedExtensions.path}`,
    };
  }

  const extensions = locatedExtensions.value;
  const basePath = `${source}.${locatedExtensions.path}`;
  if ("regex_scripts" in extensions) {
    return {
      value: extensions.regex_scripts,
      path: `${basePath}.regex_scripts`,
    };
  }

  // Imported presets retain their clean-room source under legacySource.
  const legacySource = extensions.legacySource;
  if (!isRecord(legacySource)) return undefined;
  if ("regex_scripts" in legacySource) {
    return {
      value: legacySource.regex_scripts,
      path: `${basePath}.legacySource.regex_scripts`,
    };
  }
  if (
    isRecord(legacySource.extensions) &&
    "regex_scripts" in legacySource.extensions
  ) {
    return {
      value: legacySource.extensions.regex_scripts,
      path: `${basePath}.legacySource.extensions.regex_scripts`,
    };
  }
  return undefined;
}

export function collectRegexScripts(
  input: CollectRegexScriptsInput,
): RegexScriptParseResult {
  const scripts: RegexScript[] = [];
  const diagnostics: Diagnostic[] = [];
  const orderedSources: ReadonlyArray<readonly [RegexScriptSource, unknown]> = [
    ["global", input.global],
    ["preset", input.preset],
    ["card", input.card],
  ];

  for (const [source, container] of orderedSources) {
    const located = regexScriptsOf(container, source);
    if (located === undefined) continue;
    if (located.path.endsWith(".extensions") && !isRecord(located.value)) {
      diagnostics.push(
        diagnostic(
          "warning",
          "REGEX_EXTENSIONS_INVALID",
          "The extensions value must be an object; regex scripts were ignored.",
          located.path,
        ),
      );
      continue;
    }
    const parsed = parseRegexScripts(located.value, {
      source,
      path: located.path,
    });
    scripts.push(...parsed.scripts);
    diagnostics.push(...parsed.diagnostics);
  }

  return { scripts, diagnostics };
}

function sourceRank(source: RegexScriptSource): number {
  switch (source) {
    case "global":
      return 0;
    case "preset":
      return 1;
    case "card":
      return 2;
  }
}

function scriptsInExecutionOrder(
  scripts: readonly RegexScript[],
): RegexScript[] {
  return scripts
    .map((script, index) => ({ script, index }))
    .sort(
      (left, right) =>
        sourceRank(left.script.source) - sourceRank(right.script.source) ||
        left.script.sourceIndex - right.script.sourceIndex ||
        left.index - right.index,
    )
    .map(({ script }) => script);
}

function targetMatches(
  script: RegexScript,
  target: RegexExecutionTarget,
): boolean {
  if (script.markdownOnly && script.promptOnly) {
    return target === "markdown" || target === "prompt";
  }
  if (script.markdownOnly) return target === "markdown";
  if (script.promptOnly) return target === "prompt";
  // SillyTavern applies an unscoped rule to the stored text first. STN keeps
  // the imported/raw message intact, so every derived copy must receive that
  // same general transformation exactly once.
  return true;
}

function depthMatches(script: RegexScript, depth: number | undefined): boolean {
  if (depth === undefined) return true;
  if (script.minDepth !== null && depth < script.minDepth) return false;
  if (script.maxDepth !== null && depth > script.maxDepth) return false;
  return !(
    script.minDepth !== null &&
    script.maxDepth !== null &&
    script.minDepth > script.maxDepth
  );
}

function isEscaped(value: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (value[cursor] !== "\\") break;
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

export function splitRegexPattern(value: string): {
  pattern: string;
  flags: string;
} {
  if (!value.startsWith("/")) return { pattern: value, flags: "" };
  for (let index = value.length - 1; index > 0; index -= 1) {
    if (value[index] === "/" && !isEscaped(value, index)) {
      return {
        pattern: value.slice(1, index),
        flags: value.slice(index + 1),
      };
    }
  }
  return { pattern: value, flags: "" };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function substituteFindMacros(
  pattern: string,
  mode: RegexSubstituteMode,
  substitutions: Readonly<Record<string, string>> | undefined,
): string {
  if (mode === 0 || substitutions === undefined) return pattern;
  const lowerCaseValues = new Map(
    Object.entries(substitutions).map(([key, value]) => [
      key.toLocaleLowerCase(),
      value,
    ]),
  );
  return pattern.replace(
    /\{\{\s*([A-Za-z][A-Za-z0-9_.-]*)\s*\}\}/gu,
    (token, name: string) => {
      const exact = Object.prototype.hasOwnProperty.call(substitutions, name)
        ? substitutions[name]
        : undefined;
      const value = exact ?? lowerCaseValues.get(name.toLocaleLowerCase());
      if (value === undefined) return token;
      return mode === 2 ? escapeRegex(value) : value;
    },
  );
}

function trimmedMatch(match: string, trimStrings: readonly string[]): string {
  let value = match;
  for (const trim of trimStrings) {
    if (trim.length > 0) value = value.split(trim).join("");
  }
  return value;
}

function numericCapture(
  token: string,
  digits: string,
  captures: readonly string[],
): string {
  const index = Number(digits);
  if (index === 0) return token;
  if (index <= captures.length) return captures[index - 1] ?? "";
  if (digits.length === 2) {
    const firstIndex = Number(digits[0]);
    if (firstIndex > 0 && firstIndex <= captures.length) {
      return `${captures[firstIndex - 1] ?? ""}${digits[1] ?? ""}`;
    }
  }
  return token;
}

function replacementFor(
  template: string,
  match: string,
  captures: readonly string[],
  groups: Readonly<Record<string, string | undefined>> | undefined,
  trimStrings: readonly string[],
): string {
  const visibleMatch = trimmedMatch(match, trimStrings);
  return template.replace(
    /\{\{\s*match\s*\}\}|\$\$|\$&|\$0|\$<([A-Za-z_$][A-Za-z0-9_$]*)>|\$(\d{1,2})/giu,
    (
      token,
      groupName: string | undefined,
      captureIndex: string | undefined,
    ) => {
      if (/^\{\{\s*match\s*\}\}$/iu.test(token) || token === "$&") {
        return visibleMatch;
      }
      if (token === "$$") return "$";
      if (token === "$0") return visibleMatch;
      if (groupName !== undefined) {
        if (groups === undefined) return token;
        return groups[groupName] ?? "";
      }
      if (captureIndex !== undefined) {
        return numericCapture(token, captureIndex, captures);
      }
      return token;
    },
  );
}

function replacementArguments(values: readonly unknown[]): {
  match: string;
  captures: string[];
  groups: Readonly<Record<string, string | undefined>> | undefined;
} {
  const match = typeof values[0] === "string" ? values[0] : "";
  const finalValue = values.at(-1);
  const hasGroups = isRecord(finalValue);
  const captureEnd = Math.max(1, values.length - (hasGroups ? 3 : 2));
  const captures = values
    .slice(1, captureEnd)
    .map((value) => (typeof value === "string" ? value : ""));
  const groups = hasGroups
    ? Object.fromEntries(
        Object.entries(finalValue).map(([key, value]) => [
          key,
          typeof value === "string" ? value : undefined,
        ]),
      )
    : undefined;
  return { match, captures, groups };
}

function emitDiagnostic(
  diagnostics: Diagnostic[],
  options: ApplyRegexScriptsOptions,
  value: Diagnostic,
): void {
  diagnostics.push(value);
  options.onDiagnostic?.(value);
}

export function applyRegexScriptsWithDiagnostics(
  text: string,
  scripts: readonly RegexScript[],
  options: ApplyRegexScriptsOptions,
): RegexApplyResult {
  let output = text;
  const diagnostics: Diagnostic[] = [];
  const appliedScriptIds: string[] = [];
  const target = options.target ?? "stored";

  for (const script of scriptsInExecutionOrder(scripts)) {
    if (
      script.disabled ||
      !script.placement.includes(options.placement) ||
      !targetMatches(script, target) ||
      (options.edited === true && !script.runOnEdit) ||
      !depthMatches(script, options.depth)
    ) {
      continue;
    }

    const split = splitRegexPattern(script.findRegex);
    const pattern = substituteFindMacros(
      split.pattern,
      script.substituteRegex,
      options.substitutions,
    );
    if (pattern.length === 0) {
      emitDiagnostic(
        diagnostics,
        options,
        diagnostic(
          "warning",
          "REGEX_PATTERN_EMPTY",
          `Regex script '${script.scriptName}' has an empty pattern and was skipped.`,
          `${script.source}.extensions.regex_scripts[${String(script.sourceIndex)}].findRegex`,
        ),
      );
      continue;
    }

    let expression: RegExp;
    try {
      expression = new RegExp(pattern, split.flags);
    } catch (error) {
      emitDiagnostic(
        diagnostics,
        options,
        diagnostic(
          "warning",
          "REGEX_PATTERN_INVALID",
          `Regex script '${script.scriptName}' was skipped: ${
            error instanceof Error
              ? error.message
              : "invalid regular expression"
          }.`,
          `${script.source}.extensions.regex_scripts[${String(script.sourceIndex)}].findRegex`,
        ),
      );
      continue;
    }

    const previous = output;
    let matched = false;
    try {
      output = output.replace(expression, (...values: unknown[]) => {
        matched = true;
        const replacement = replacementArguments(values);
        return replacementFor(
          script.replaceString,
          replacement.match,
          replacement.captures,
          replacement.groups,
          script.trimStrings,
        );
      });
    } catch (error) {
      output = previous;
      emitDiagnostic(
        diagnostics,
        options,
        diagnostic(
          "warning",
          "REGEX_APPLICATION_FAILED",
          `Regex script '${script.scriptName}' failed and was skipped: ${
            error instanceof Error ? error.message : "unknown replacement error"
          }.`,
          `${script.source}.extensions.regex_scripts[${String(script.sourceIndex)}]`,
        ),
      );
      continue;
    }
    if (matched) appliedScriptIds.push(script.id);
  }

  return { text: output, diagnostics, appliedScriptIds };
}

/**
 * Applies compatible scripts as a deterministic, plain-text transformation.
 * It does not evaluate JavaScript, parse HTML, or touch the DOM.
 */
export function applyRegexScripts(
  text: string,
  scripts: readonly RegexScript[],
  options: ApplyRegexScriptsOptions,
): string {
  return applyRegexScriptsWithDiagnostics(text, scripts, options).text;
}
