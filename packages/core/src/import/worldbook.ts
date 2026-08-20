import {
  WorldbookSchema,
  type JsonObject,
  type JsonValue,
  type Worldbook,
  type WorldbookEntry,
} from "@stn/contracts";

import { isJsonObject, parseSafeJson, pickUnknownFields } from "./safe-json.js";
import {
  asObject,
  readBoolean,
  readNumber,
  readObject,
  readString,
  readStringArray,
} from "./value-readers.js";
import {
  createImportContext,
  type ImportContext,
  type ImportOptions,
  type WorldbookImportResult,
} from "./types.js";

const knownWorldbookFields = [
  "id",
  "name",
  "description",
  "entries",
  "scanDepth",
  "scan_depth",
  "recursive",
  "recursionLimit",
  "recursion_limit",
  "extensions",
  "agentEditable",
  "agent_editable",
] as const;

const knownEntryFields = [
  "id",
  "uid",
  "comment",
  "name",
  "label",
  "content",
  "key",
  "keys",
  "keysecondary",
  "secondary_keys",
  "secondaryKeys",
  "selective",
  "selectiveLogic",
  "secondary_logic",
  "constant",
  "disable",
  "disabled",
  "enabled",
  "agentEditable",
  "agent_editable",
  "caseSensitive",
  "case_sensitive",
  "matchWholeWords",
  "match_whole_words",
  "scanDepth",
  "scan_depth",
  "recursive",
  "preventRecursion",
  "prevent_recursion",
  "position",
  "outletName",
  "outlet_name",
  "order",
  "insertion_order",
  "priority",
  "probability",
  "useProbability",
  "use_probability",
  "use_regex",
  "useRegex",
  "extensions",
] as const;

function insertionPositionOf(
  value: JsonValue | undefined,
): WorldbookEntry["insertionPosition"] {
  if (typeof value === "number") {
    return (
      (
        [
          "before-card",
          "after-card",
          "author-note-top",
          "author-note-bottom",
          "at-depth",
          "examples-top",
          "examples-bottom",
          "outlet",
        ] as const
      )[value] ?? undefined
    );
  }
  if (typeof value !== "string") return undefined;
  const normalized = value.toLowerCase().replaceAll("_", "-");
  if (normalized === "before" || normalized === "before-char") {
    return "before-card";
  }
  if (normalized === "after" || normalized === "after-char") {
    return "after-card";
  }
  if (
    normalized === "before-card" ||
    normalized === "after-card" ||
    normalized === "author-note-top" ||
    normalized === "author-note-bottom" ||
    normalized === "at-depth" ||
    normalized === "examples-top" ||
    normalized === "examples-bottom" ||
    normalized === "outlet"
  ) {
    return normalized;
  }
  return undefined;
}

function insertionRoleOf(
  value: JsonValue | undefined,
): WorldbookEntry["insertionRole"] {
  if (value === 0 || value === "0" || value === "system") return "system";
  if (value === 1 || value === "1" || value === "user") return "user";
  if (value === 2 || value === "2" || value === "assistant") {
    return "assistant";
  }
  return undefined;
}

function positionOf(value: JsonValue | undefined): WorldbookEntry["position"] {
  if (typeof value === "string") {
    const normalized = value.toLowerCase().replaceAll("_", "-");
    if (
      normalized === "before-card" ||
      normalized === "after-card" ||
      normalized === "before-examples" ||
      normalized === "after-examples" ||
      normalized === "before-history" ||
      normalized === "after-history"
    ) {
      return normalized;
    }
    if (normalized === "before-char") return "before-card";
    if (normalized === "after-char") return "after-card";
  }
  if (typeof value === "number") {
    return (
      (
        [
          "before-card",
          "after-card",
          "before-examples",
          "after-examples",
          "before-history",
          "after-history",
        ] as const
      )[value] ?? "before-history"
    );
  }
  return "before-history";
}

function secondaryLogicOf(
  value: JsonValue | undefined,
): WorldbookEntry["secondaryLogic"] {
  if (typeof value === "string") {
    const normalized = value.toLowerCase().replaceAll("_", "-");
    if (
      normalized === "any" ||
      normalized === "all" ||
      normalized === "not-any" ||
      normalized === "not-all"
    ) {
      return normalized;
    }
  }
  if (value === 1) return "not-all";
  if (value === 2) return "not-any";
  if (value === 3) return "all";
  return "any";
}

function normalizeEntry(
  raw: JsonObject,
  context: ImportContext,
  index: number,
): WorldbookEntry {
  const enabled = readBoolean(raw, "enabled");
  const disabled = readBoolean(raw, "disabled", "disable") ?? enabled === false;
  const extensions = readObject(raw, "extensions") ?? {};
  const sourceEntryId =
    typeof raw.id === "string" || typeof raw.id === "number"
      ? raw.id
      : undefined;
  const legacyUidValue = raw.uid ?? sourceEntryId;
  const legacyUid =
    typeof legacyUidValue === "string" || typeof legacyUidValue === "number"
      ? legacyUidValue
      : undefined;
  const scanDepth =
    readNumber(raw, "scanDepth", "scan_depth") ??
    readNumber(extensions, "scanDepth", "scan_depth");
  const insertionDepth =
    readNumber(raw, "depth") ?? readNumber(extensions, "depth");
  const insertionOrder = readNumber(raw, "insertion_order", "order") ?? index;
  const insertionPosition = insertionPositionOf(
    extensions.position ?? raw.position,
  );
  const outletName =
    readString(raw, "outletName", "outlet_name") ??
    readString(extensions, "outletName", "outlet_name");
  const insertionRole = insertionRoleOf(extensions.role ?? raw.role);
  const useProbability =
    readBoolean(raw, "useProbability", "use_probability") ??
    readBoolean(extensions, "useProbability", "use_probability") ??
    true;
  const importedProbability =
    readNumber(raw, "probability") ?? readNumber(extensions, "probability");
  const probability =
    useProbability && importedProbability !== undefined
      ? Math.max(0, Math.min(100, importedProbability))
      : 100;

  return {
    // Entry ids in portable worldbooks are local to that book and commonly
    // repeat (for example, every embedded book may start at id 0). Generate a
    // canonical id for storage and retain the source id as compatibility data.
    id: context.id("worldbook-entry"),
    ...(legacyUid === undefined ? {} : { legacyUid }),
    label: readString(raw, "comment", "label", "name") ?? `Entry ${index + 1}`,
    content: readString(raw, "content") ?? "",
    primaryKeys: readStringArray(raw, "key", "keys"),
    secondaryKeys: readStringArray(
      raw,
      "keysecondary",
      "secondary_keys",
      "secondaryKeys",
    ),
    secondaryLogic: secondaryLogicOf(
      raw.selectiveLogic ??
        raw.secondary_logic ??
        extensions.selectiveLogic ??
        extensions.secondary_logic,
    ),
    selective: readBoolean(raw, "selective") ?? false,
    constant: readBoolean(raw, "constant") ?? false,
    disabled,
    // Portable metadata never grants Agent write permission.
    agentEditable: false,
    caseSensitive:
      readBoolean(raw, "caseSensitive", "case_sensitive") ??
      readBoolean(extensions, "caseSensitive", "case_sensitive") ??
      false,
    matchWholeWords:
      readBoolean(raw, "matchWholeWords", "match_whole_words") ??
      readBoolean(extensions, "matchWholeWords", "match_whole_words") ??
      false,
    ...(scanDepth === undefined || scanDepth <= 0
      ? {}
      : { scanDepth: Math.min(10_000, Math.floor(scanDepth)) }),
    recursion: readBoolean(raw, "recursive") ?? true,
    preventRecursion:
      readBoolean(raw, "preventRecursion", "prevent_recursion") ??
      readBoolean(extensions, "preventRecursion", "prevent_recursion") ??
      false,
    excludeRecursion:
      readBoolean(raw, "excludeRecursion", "exclude_recursion") ??
      readBoolean(extensions, "excludeRecursion", "exclude_recursion") ??
      false,
    delayUntilRecursion:
      readBoolean(raw, "delayUntilRecursion", "delay_until_recursion") ??
      readBoolean(extensions, "delayUntilRecursion", "delay_until_recursion") ??
      false,
    useRegex: readBoolean(raw, "useRegex", "use_regex") ?? true,
    legacyInsertionOrder: insertionOrder,
    ...(insertionPosition === undefined ? {} : { insertionPosition }),
    ...(outletName === undefined || outletName.trim().length === 0
      ? {}
      : { outletName: outletName.trim() }),
    ...(insertionDepth === undefined || insertionDepth < 0
      ? {}
      : {
          insertionDepth: Math.min(10_000, Math.floor(insertionDepth)),
        }),
    ...(insertionRole === undefined ? {} : { insertionRole }),
    position: positionOf(raw.position),
    order: insertionOrder,
    priority: readNumber(raw, "priority") ?? insertionOrder,
    extensions: {
      ...extensions,
      probability,
    },
    compatibility: {
      sourceFormat: "sillytavern-worldbook-entry",
      unknownFields: {
        ...pickUnknownFields(raw, knownEntryFields),
        ...(sourceEntryId === undefined ? {} : { sourceEntryId }),
      },
    },
    revision: 0,
  };
}

function entryRecords(root: JsonObject): JsonObject[] {
  const entries = root.entries;
  if (Array.isArray(entries)) {
    return entries
      .map((value) => asObject(value))
      .filter((value): value is JsonObject => value !== undefined);
  }
  if (isJsonObject(entries)) {
    return Object.entries(entries)
      .sort(([left], [right]) =>
        left.localeCompare(right, undefined, { numeric: true }),
      )
      .map(([, value]) => asObject(value))
      .filter((value): value is JsonObject => value !== undefined);
  }
  return [];
}

export function normalizeWorldbook(
  source: JsonObject,
  options: ImportOptions = {},
): WorldbookImportResult {
  const context = createImportContext(options);
  const nested =
    readObject(source, "character_book", "worldbook", "book") ?? source;
  const scanDepthRaw = readNumber(nested, "scanDepth", "scan_depth") ?? 4;
  const recursionLimitRaw =
    readNumber(nested, "recursionLimit", "recursion_limit") ?? 3;
  const entries = entryRecords(nested);
  const importedAgentPermission =
    readBoolean(nested, "agentEditable", "agent_editable") === true ||
    entries.some((entry) => {
      const extensions = readObject(entry, "extensions");
      return (
        readBoolean(entry, "agentEditable", "agent_editable") === true ||
        (extensions !== undefined &&
          readBoolean(extensions, "agentEditable", "agent_editable") === true)
      );
    });
  const now = context.now();

  const worldbook: Worldbook = {
    id: readString(nested, "id") || context.id("worldbook"),
    name:
      readString(nested, "name") ??
      options.filename?.replace(/\.[^.]+$/u, "") ??
      "Imported worldbook",
    description: readString(nested, "description") ?? "",
    entries: entries.map((entry, index) =>
      normalizeEntry(entry, context, index),
    ),
    bindings: [],
    scanDepth: Math.max(1, Math.min(10_000, Math.floor(scanDepthRaw))),
    recursionLimit: Math.max(0, Math.min(32, Math.floor(recursionLimitRaw))),
    // Permission metadata from portable files is intentionally ignored.
    agentEditable: false,
    revision: 0,
    extensions: readObject(nested, "extensions") ?? {},
    compatibility: {
      sourceFormat: "sillytavern-worldbook",
      ...(options.filename === undefined
        ? {}
        : { originalFilename: options.filename }),
      unknownFields: pickUnknownFields(nested, knownWorldbookFields),
    },
    createdAt: now,
    updatedAt: now,
  };

  return {
    value: WorldbookSchema.parse(worldbook),
    diagnostics: importedAgentPermission
      ? [
          {
            severity: "warning",
            code: "IMPORTED_AGENT_PERMISSION_IGNORED",
            message:
              "Imported worldbook and entry edit permissions were ignored; agentEditable is false.",
          },
        ]
      : [],
    sourceFormat: "sillytavern-worldbook",
  };
}

export function importWorldbookJson(
  source: string | Uint8Array | JsonObject,
  options: ImportOptions = {},
): WorldbookImportResult {
  const parsed =
    typeof source === "string" || source instanceof Uint8Array
      ? parseSafeJson(source, options.jsonLimits)
      : source;
  if (!isJsonObject(parsed)) {
    throw new Error("Worldbook import requires a JSON object");
  }
  return normalizeWorldbook(parsed, options);
}
