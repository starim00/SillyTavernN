import {
  CardSchema,
  type Card,
  type JsonObject,
  type Participant,
} from "@stn/contracts";

import { normalizeWorldbook } from "./worldbook.js";
import { isJsonObject, parseSafeJson, pickUnknownFields } from "./safe-json.js";
import {
  asObject,
  readArray,
  readObject,
  readString,
  readStringArray,
} from "./value-readers.js";
import {
  createImportContext,
  type CardImportResult,
  type ImportContext,
  type ImportOptions,
} from "./types.js";

const knownCardRootFields = [
  "spec",
  "spec_version",
  "data",
  "name",
  "description",
  "personality",
  "scenario",
  "first_mes",
  "mes_example",
  "creator_notes",
  "system_prompt",
  "post_history_instructions",
  "alternate_greetings",
  "tags",
  "creator",
  "character_version",
  "extensions",
  "character_book",
  "participants",
  "narrator",
  "kind",
  "world",
  "world_description",
  "assets",
] as const;

const knownParticipantFields = [
  "id",
  "name",
  "kind",
  "aliases",
  "description",
  "personality",
  "scenario",
  "first_mes",
  "firstMessage",
  "alternate_greetings",
  "alternateGreetings",
  "mes_example",
  "exampleDialogue",
  "system_prompt",
  "systemPrompt",
  "post_history_instructions",
  "postHistoryInstructions",
  "tags",
  "avatarAssetId",
  "extensions",
] as const;

function normalizeParticipant(
  raw: JsonObject,
  context: ImportContext,
  fallbackName: string,
  fallbackKind: Participant["kind"] = "character",
): Participant {
  const kindValue = readString(raw, "kind");
  const kind: Participant["kind"] =
    kindValue === "narrator" ||
    kindValue === "user" ||
    kindValue === "entity" ||
    kindValue === "character"
      ? kindValue
      : fallbackKind;
  const avatarAssetId = readString(raw, "avatarAssetId");
  return {
    id: readString(raw, "id") || context.id("participant"),
    name: readString(raw, "name")?.trim() || fallbackName,
    kind,
    aliases: readStringArray(raw, "aliases"),
    description: readString(raw, "description") ?? "",
    personality: readString(raw, "personality") ?? "",
    scenario: readString(raw, "scenario") ?? "",
    firstMessage: readString(raw, "first_mes", "firstMessage") ?? "",
    alternateGreetings:
      readStringArray(raw, "alternate_greetings", "alternateGreetings") ?? [],
    exampleDialogue: readString(raw, "mes_example", "exampleDialogue") ?? "",
    systemPrompt: readString(raw, "system_prompt", "systemPrompt") ?? "",
    postHistoryInstructions:
      readString(raw, "post_history_instructions", "postHistoryInstructions") ??
      "",
    tags: readStringArray(raw, "tags"),
    ...(avatarAssetId === undefined ? {} : { avatarAssetId }),
    extensions: readObject(raw, "extensions") ?? {},
    compatibility: {
      sourceFormat: "portable-card-participant",
      unknownFields: pickUnknownFields(raw, knownParticipantFields),
    },
  };
}

function inferKind(
  data: JsonObject,
  participants: Participant[],
): Card["kind"] {
  const explicit = readString(data, "kind");
  if (
    explicit === "character" ||
    explicit === "ensemble" ||
    explicit === "scenario" ||
    explicit === "world"
  ) {
    return explicit;
  }
  if (participants.length > 1) return "ensemble";
  if (participants.length === 0) {
    return readString(data, "world", "world_description")
      ? "world"
      : "scenario";
  }
  return "character";
}

function participantRecords(data: JsonObject): JsonObject[] {
  const records = readArray(data, "participants");
  if (!records) return [];
  return records
    .map((value) => asObject(value))
    .filter((value): value is JsonObject => value !== undefined);
}

function specFormat(root: JsonObject): string {
  const spec = readString(root, "spec");
  if (spec?.startsWith("chara_card_")) return spec;
  return "legacy-character-json";
}

export function normalizeCard(
  source: JsonObject,
  options: ImportOptions = {},
): CardImportResult {
  const context = createImportContext(options);
  const data = readObject(source, "data") ?? source;
  const name = readString(data, "name")?.trim() || "Imported card";
  const explicitParticipants = participantRecords(data);
  const explicitKind = readString(data, "kind");
  const classicCharacter =
    explicitParticipants.length === 0 &&
    explicitKind !== "world" &&
    explicitKind !== "scenario" &&
    (typeof data.name === "string" ||
      typeof data.description === "string" ||
      typeof data.first_mes === "string");
  const participants = explicitParticipants.map((participant, index) =>
    normalizeParticipant(participant, context, `Participant ${index + 1}`),
  );
  if (classicCharacter) {
    participants.push(normalizeParticipant(data, context, name));
  }

  const narratorRaw = readObject(data, "narrator");
  const narrator = narratorRaw
    ? normalizeParticipant(narratorRaw, context, "Narrator", "narrator")
    : undefined;
  const embeddedWorldbooks = [];
  const characterBook = readObject(data, "character_book");
  if (characterBook) {
    embeddedWorldbooks.push(
      normalizeWorldbook(characterBook, {
        ...options,
        filename: `${name} embedded worldbook`,
        now: context.now,
        idFactory: context.id,
      }).value,
    );
  }

  const format = specFormat(source);
  const now = context.now();
  const unknownRoot = pickUnknownFields(source, knownCardRootFields);
  const unknownData =
    data === source ? {} : pickUnknownFields(data, knownCardRootFields);
  const compatibilityUnknown: JsonObject = {
    root: unknownRoot,
    data: unknownData,
  };
  const card: Card = {
    id: readString(data, "id") || context.id("card"),
    kind: inferKind(data, participants),
    name,
    description: readString(data, "description") ?? "",
    scenario: readString(data, "scenario") ?? "",
    worldDescription:
      readString(data, "world", "world_description", "worldDescription") ?? "",
    participants,
    ...(narrator === undefined ? {} : { narrator }),
    greeting: readString(data, "first_mes", "greeting") ?? "",
    alternateGreetings: readStringArray(data, "alternate_greetings"),
    exampleDialogue: readString(data, "mes_example") ?? "",
    systemPrompt: readString(data, "system_prompt") ?? "",
    postHistoryInstructions:
      readString(data, "post_history_instructions") ?? "",
    creator: readString(data, "creator") ?? "",
    creatorNotes: readString(data, "creator_notes") ?? "",
    version: readString(data, "character_version", "version") ?? "",
    tags: readStringArray(data, "tags"),
    assets: [],
    worldbookIds: embeddedWorldbooks.map((worldbook) => worldbook.id),
    extensions: readObject(data, "extensions") ?? {},
    compatibility: {
      sourceFormat: format,
      ...(readString(source, "spec_version") === undefined
        ? {}
        : { sourceVersion: readString(source, "spec_version") }),
      ...(options.filename === undefined
        ? {}
        : { originalFilename: options.filename }),
      unknownFields: compatibilityUnknown,
    },
    createdAt: now,
    updatedAt: now,
  };

  return {
    value: CardSchema.parse(card),
    embeddedWorldbooks,
    diagnostics: [],
    sourceFormat: format,
  };
}

export function importCardJson(
  source: string | Uint8Array | JsonObject,
  options: ImportOptions = {},
): CardImportResult {
  const parsed =
    typeof source === "string" || source instanceof Uint8Array
      ? parseSafeJson(source, options.jsonLimits)
      : source;
  if (!isJsonObject(parsed)) {
    throw new Error("Card import requires a JSON object");
  }
  return normalizeCard(parsed, options);
}
