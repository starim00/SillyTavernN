import type { JsonObject, JsonValue } from "@stn/contracts";
import type { AppStore, WorldbookEntry } from "@stn/storage";

import { normalizedWorldbook } from "./normalized-content.js";

export const WORLD_BOOK_INSERTION_POSITIONS = [
  "before-card",
  "after-card",
  "author-note-top",
  "author-note-bottom",
  "at-depth",
  "examples-top",
  "examples-bottom",
  "outlet",
] as const;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function metadataString(
  metadata: JsonObject,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

export function worldbookMetadataStrings(
  metadata: JsonObject,
  key: string,
): string[] | undefined {
  const value = metadata[key];
  return Array.isArray(value) &&
    value.every((item): item is string => typeof item === "string")
    ? value
    : undefined;
}

function metadataBoolean(
  metadata: JsonObject,
  key: string,
  fallback: boolean,
): boolean {
  const value = metadata[key];
  return typeof value === "boolean" ? value : fallback;
}

function metadataNumber(metadata: JsonObject, key: string): number | undefined {
  const value = metadata[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function setWorldbookMetadata(
  metadata: JsonObject,
  key: string,
  value: JsonValue | undefined,
): void {
  if (value === undefined) return;
  if (value === null) {
    delete metadata[key];
  } else {
    metadata[key] = value;
  }
}

function worldbookEntryDto(entry: WorldbookEntry) {
  const metadataPrimary = worldbookMetadataStrings(
    entry.metadata,
    "primaryKeys",
  );
  const metadataSecondary =
    worldbookMetadataStrings(entry.metadata, "secondaryKeys") ?? [];
  const combinedMetadataKeys = [
    ...(metadataPrimary ?? []),
    ...metadataSecondary,
  ];
  const canPreserveSplit =
    metadataPrimary !== undefined &&
    combinedMetadataKeys.length === entry.keys.length &&
    combinedMetadataKeys.every((key, index) => key === entry.keys[index]);
  const primaryKeys = canPreserveSplit ? metadataPrimary : entry.keys;
  const secondaryKeys = canPreserveSplit ? metadataSecondary : [];
  const secondaryLogic = metadataString(entry.metadata, "secondaryLogic");
  const insertionPosition = metadataString(entry.metadata, "insertionPosition");
  const outletName = metadataString(entry.metadata, "outletName");
  const insertionRole = metadataString(entry.metadata, "insertionRole");
  const extensions = isJsonObject(entry.metadata.extensions)
    ? entry.metadata.extensions
    : undefined;
  return {
    ...entry,
    title: metadataString(entry.metadata, "label", "title", "name") ?? entry.id,
    keys: [...primaryKeys, ...secondaryKeys],
    primaryKeys,
    secondaryKeys,
    secondaryLogic:
      secondaryLogic === "all" ||
      secondaryLogic === "not-any" ||
      secondaryLogic === "not-all"
        ? secondaryLogic
        : "any",
    selective:
      canPreserveSplit && metadataBoolean(entry.metadata, "selective", false),
    constant: metadataBoolean(entry.metadata, "constant", false),
    caseSensitive: metadataBoolean(entry.metadata, "caseSensitive", false),
    matchWholeWords: metadataBoolean(entry.metadata, "matchWholeWords", false),
    useRegex: metadataBoolean(entry.metadata, "useRegex", false),
    scanDepth: metadataNumber(entry.metadata, "scanDepth") ?? null,
    recursion: metadataBoolean(entry.metadata, "recursion", true),
    preventRecursion: metadataBoolean(
      entry.metadata,
      "preventRecursion",
      false,
    ),
    excludeRecursion: metadataBoolean(
      entry.metadata,
      "excludeRecursion",
      false,
    ),
    delayUntilRecursion: metadataBoolean(
      entry.metadata,
      "delayUntilRecursion",
      false,
    ),
    insertionPosition: WORLD_BOOK_INSERTION_POSITIONS.includes(
      insertionPosition as (typeof WORLD_BOOK_INSERTION_POSITIONS)[number],
    )
      ? insertionPosition
      : null,
    outletName: outletName ?? null,
    insertionDepth: metadataNumber(entry.metadata, "insertionDepth") ?? null,
    insertionRole:
      insertionRole === "user" || insertionRole === "assistant"
        ? insertionRole
        : "system",
    order: entry.position,
    priority: metadataNumber(entry.metadata, "priority") ?? 0,
    probability:
      extensions === undefined
        ? 100
        : Math.max(
            0,
            Math.min(100, metadataNumber(extensions, "probability") ?? 100),
          ),
  };
}

export function storedWorldbookDto(store: AppStore, id: string) {
  const worldbook = store.getWorldbook(id);
  const normalized = normalizedWorldbook(worldbook);
  const compatibility = normalized?.compatibility;
  return {
    ...worldbook,
    description: normalized?.description ?? "",
    imported:
      typeof compatibility?.sourceFormat === "string" &&
      compatibility.sourceFormat !== "native-storage",
    entries: store.listWorldbookEntries(id).map(worldbookEntryDto),
  };
}
