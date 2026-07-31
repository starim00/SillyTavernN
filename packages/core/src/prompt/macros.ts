import type {
  MacroExpansionOptions,
  PromptMacroContext,
  PromptMacroRuntime,
} from "./types.js";

const MACRO_PATTERN = /(\\)?\{\{([\s\S]*?)\}\}/gu;
const MAX_DICE = 1_000;
const MAX_DIE_SIDES = 1_000_000_000;

function macroValues(context: PromptMacroContext): ReadonlyMap<string, string> {
  const participants = context.participantNames ?? [];
  const characterName =
    context.characterName ??
    (participants.length === 1 ? participants[0] : participants.join(", "));
  const values = new Map<string, string>([
    ["user", context.userName ?? "User"],
    ["char", characterName ?? context.narratorName ?? context.cardName ?? ""],
    [
      "character",
      characterName ?? context.narratorName ?? context.cardName ?? "",
    ],
    ["participants", participants.join(", ")],
    ["group", participants.join(", ")],
    ["narrator", context.narratorName ?? ""],
    ["card", context.cardName ?? ""],
    ["description", context.description ?? ""],
    ["personality", context.personality ?? ""],
    ["scenario", context.scenario ?? ""],
    ["world", context.worldDescription ?? ""],
    ["worlddescription", context.worldDescription ?? ""],
    ["persona", context.persona ?? ""],
    ["lastusermessage", context.lastUserMessage ?? ""],
  ]);
  for (const [key, value] of Object.entries(context.custom ?? {})) {
    values.set(key.toLowerCase(), value);
  }
  return values;
}

function boundedRandom(random: () => number): number {
  const value = random();
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1 - Number.EPSILON, Math.max(0, value));
}

function rollDice(formula: string, random: () => number): string {
  const match = formula.trim().match(/^(\d*)d(\d+)(?:\s*([+-])\s*(\d+))?$/iu);
  if (!match) {
    return "";
  }
  const count = Math.min(
    MAX_DICE,
    Math.max(1, Number.parseInt(match[1] || "1", 10)),
  );
  const sides = Math.min(
    MAX_DIE_SIDES,
    Math.max(1, Number.parseInt(match[2] ?? "0", 10)),
  );
  const adjustment =
    match[4] === undefined
      ? 0
      : Number.parseInt(match[4], 10) * (match[3] === "-" ? -1 : 1);
  let total = adjustment;
  for (let index = 0; index < count; index += 1) {
    total += Math.floor(boundedRandom(random) * sides) + 1;
  }
  return String(total);
}

function randomItems(value: string): string[] {
  const source = value.trim().replace(/^::?/u, "").trim();
  if (!source) {
    return [];
  }
  const colonItems = source.includes("::") ? source.split("::") : [source];
  const items =
    colonItems.length === 1
      ? (colonItems[0] ?? "")
          .split(/(?<!\\),/u)
          .map((item) => item.replaceAll("\\,", ","))
      : colonItems;
  return items.map((item) => item.trim()).filter(Boolean);
}

export function createPromptMacroRuntime(
  overrides: Partial<PromptMacroRuntime> = {},
): PromptMacroRuntime {
  return {
    variables: overrides.variables ?? new Map<string, string>(),
    random: overrides.random ?? Math.random,
    ...(overrides.roll === undefined ? {} : { roll: overrides.roll }),
  };
}

function resolveExtendedMacro(
  rawName: string,
  values: ReadonlyMap<string, string>,
  runtime: PromptMacroRuntime,
): string | undefined {
  const name = rawName.trim();
  const normalized = name.toLowerCase();
  if (normalized.startsWith("//") || normalized.startsWith("comment")) {
    return "";
  }

  const setVariable = name.match(/^setvar::([^:]+)::([\s\S]*)$/iu);
  if (setVariable) {
    runtime.variables.set((setVariable[1] ?? "").trim(), setVariable[2] ?? "");
    return "";
  }

  const getVariable = name.match(/^getvar(?:::|\s+)([\s\S]+)$/iu);
  if (getVariable) {
    return runtime.variables.get((getVariable[1] ?? "").trim()) ?? "";
  }

  const random = name.match(/^random(?:::|:|\s+)([\s\S]*)$/iu);
  if (random) {
    const items = randomItems(random[1] ?? "");
    if (items.length === 0) {
      return "";
    }
    return (
      items[Math.floor(boundedRandom(runtime.random) * items.length)] ?? ""
    );
  }

  const roll = name.match(/^roll(?:::|:|\s+)([\s\S]+)$/iu);
  if (roll) {
    const formula = (roll[1] ?? "").trim();
    const value = runtime.roll
      ? runtime.roll(formula)
      : rollDice(formula, runtime.random);
    return value === undefined ? "" : String(value);
  }

  if (normalized.startsWith("outlet::")) {
    return values.get(normalized) ?? "";
  }

  return values.get(normalized);
}

export function expandPromptMacros(
  template: string,
  context: PromptMacroContext,
  options: MacroExpansionOptions = {},
): string {
  const values = macroValues(context);
  const runtime = options.runtime ?? createPromptMacroRuntime();
  const unknown = options.unknown ?? "preserve";
  const maxPasses = Math.max(1, Math.min(options.maxPasses ?? 4, 16));
  const escapedMacros: string[] = [];
  let output = template.replace(
    MACRO_PATTERN,
    (match: string, escaped: string | undefined) => {
      if (!escaped) {
        return match;
      }
      const index = escapedMacros.push(match.slice(1)) - 1;
      return `\u{e000}stn-escaped-macro-${String(index)}\u{e001}`;
    },
  );

  for (let pass = 0; pass < maxPasses; pass += 1) {
    let changed = false;
    const next = output.replace(
      MACRO_PATTERN,
      (match: string, _escaped: string | undefined, rawName: string) => {
        const value = resolveExtendedMacro(rawName, values, runtime);
        if (value === undefined) {
          return unknown === "empty" ? "" : match;
        }
        if (value !== match) {
          changed = true;
        }
        return value;
      },
    );
    output = next;
    if (!changed) {
      break;
    }
  }

  return output.replace(
    /\u{e000}stn-escaped-macro-(\d+)\u{e001}/gu,
    (_match, rawIndex: string) =>
      escapedMacros[Number.parseInt(rawIndex, 10)] ?? "",
  );
}
