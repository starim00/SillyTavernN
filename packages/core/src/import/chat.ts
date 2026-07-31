import {
  ConversationSchema,
  MessageSchema,
  type JsonObject,
  type JsonValue,
  type Message,
} from "@stn/contracts";

import { isJsonObject, parseSafeJson, pickUnknownFields } from "./safe-json.js";
import {
  readArray,
  readBoolean,
  readObject,
  readString,
} from "./value-readers.js";
import {
  createImportContext,
  type ConversationImportResult,
  type ImportOptions,
} from "./types.js";

const knownMetadataFields = [
  "user_name",
  "character_name",
  "create_date",
  "chat_metadata",
  "messages",
] as const;
const knownMessageFields = [
  "name",
  "is_user",
  "is_system",
  "mes",
  "send_date",
  "swipes",
  "swipe_id",
  "extra",
  "force_avatar",
  "gen_started",
  "gen_finished",
] as const;

function importedRole(raw: JsonObject): Message["role"] {
  const nativeRole = readString(raw, "role");
  if (nativeRole !== undefined) {
    if (
      nativeRole === "user" ||
      nativeRole === "assistant" ||
      nativeRole === "system" ||
      nativeRole === "tool"
    ) {
      return nativeRole;
    }
    throw new Error(`Unsupported native message role: ${nativeRole}`);
  }
  if (readBoolean(raw, "is_system") === true) return "system";
  return readBoolean(raw, "is_user") === true ? "user" : "assistant";
}

function importedDisplayName(raw: JsonObject): string | undefined {
  const author = readObject(raw, "author");
  return (
    (author ? readString(author, "displayName")?.trim() : undefined) ??
    readString(raw, "name")?.trim()
  );
}

function importedSwipeContent(value: JsonValue): string {
  if (typeof value === "string") return value;
  if (isJsonObject(value)) {
    const content = readString(value, "content");
    if (content !== undefined) return content;
  }
  return JSON.stringify(value);
}

function parseRecords(
  source: string | Uint8Array | JsonValue,
  options: ImportOptions,
): { metadata: JsonObject; messages: JsonObject[]; format: string } {
  if (typeof source !== "string" && !(source instanceof Uint8Array)) {
    if (Array.isArray(source)) {
      const objects = source.filter(isJsonObject);
      const first = objects[0];
      const metadata =
        first && typeof first.mes !== "string"
          ? first
          : (Object.create(null) as JsonObject);
      return {
        metadata,
        messages: metadata === first ? objects.slice(1) : objects,
        format: "json-chat",
      };
    }
    if (isJsonObject(source)) {
      const messages = readArray(source, "messages") ?? [];
      return {
        metadata: source,
        messages: messages.filter(isJsonObject),
        format: "native-conversation",
      };
    }
    throw new Error("Chat import requires JSON records");
  }

  const text =
    typeof source === "string"
      ? source
      : new TextDecoder("utf-8", { fatal: true }).decode(source);
  try {
    return parseRecords(parseSafeJson(text, options.jsonLimits), options);
  } catch (jsonError) {
    const records = text
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => parseSafeJson(line, options.jsonLimits))
      .filter(isJsonObject);
    if (records.length === 0) {
      throw jsonError;
    }
    const first = records[0];
    const metadata =
      first && typeof first.mes !== "string"
        ? first
        : (Object.create(null) as JsonObject);
    return {
      metadata,
      messages: metadata === first ? records.slice(1) : records,
      format: "sillytavern-jsonl-chat",
    };
  }
}

export function importConversation(
  source: string | Uint8Array | JsonValue,
  options: ImportOptions = {},
): ConversationImportResult {
  const context = createImportContext(options);
  const records = parseRecords(source, options);
  const now = context.now();
  const conversationId = context.id("conversation");
  const branchId = context.id("branch");
  const userName = readString(records.metadata, "user_name")?.trim() || "User";
  const observedAssistantNames = Array.from(
    new Set(
      records.messages
        .filter((message) => importedRole(message) === "assistant")
        .map(importedDisplayName)
        .filter((name): name is string => Boolean(name)),
    ),
  );
  const metadataCharacterNameRaw = readString(
    records.metadata,
    "character_name",
  )?.trim();
  const metadataCharacterName =
    metadataCharacterNameRaw?.toLowerCase() === "unused"
      ? undefined
      : metadataCharacterNameRaw;
  const assistantNames = [...observedAssistantNames];
  if (
    metadataCharacterName &&
    !assistantNames.includes(metadataCharacterName)
  ) {
    assistantNames.unshift(metadataCharacterName);
  }
  const preserveAssistantNamesInContent = observedAssistantNames.length > 1;

  const messages: Message[] = records.messages.map((raw, sequence) => {
    const role = importedRole(raw);
    const isUser = role === "user";
    const isAssistant = role === "assistant";
    const rawName = importedDisplayName(raw);
    const displayName =
      rawName ??
      (isUser ? userName : isAssistant ? metadataCharacterName : undefined);
    const sourceSwipes = readArray(raw, "swipes");
    const rawContents =
      sourceSwipes && sourceSwipes.length > 0
        ? sourceSwipes.map(importedSwipeContent)
        : [readString(raw, "content") ?? readString(raw, "mes") ?? ""];
    const contents = rawContents.map((content) =>
      preserveAssistantNamesInContent && isAssistant && rawName
        ? `${rawName}: ${content}`
        : content,
    );
    const foldedSpeakerIntoContent =
      preserveAssistantNamesInContent && isAssistant && Boolean(rawName);
    const sourceSwipeIds =
      sourceSwipes?.map((value) =>
        isJsonObject(value) ? readString(value, "id") : undefined,
      ) ?? [];
    const nativeActiveSwipeId = readString(raw, "activeSwipeId");
    const swipes = contents.map((content) => ({
      id: context.id("swipe"),
      content,
      createdAt:
        readString(raw, "createdAt") ?? readString(raw, "send_date") ?? now,
      metadata: {},
    }));
    const nativeActiveIndex =
      nativeActiveSwipeId === undefined
        ? -1
        : sourceSwipeIds.indexOf(nativeActiveSwipeId);
    const activeIndexRaw =
      nativeActiveIndex >= 0
        ? nativeActiveIndex
        : typeof raw.swipe_id === "number"
          ? Math.floor(raw.swipe_id)
          : 0;
    const activeIndex = Math.max(
      0,
      Math.min(swipes.length - 1, activeIndexRaw),
    );
    const activeSwipe = swipes[activeIndex];
    if (!activeSwipe) {
      throw new Error("Imported message did not produce a swipe");
    }

    return MessageSchema.parse({
      id: context.id("message"),
      conversationId,
      branchId,
      sequence,
      role,
      author: {
        kind: role,
        ...(displayName === undefined ? {} : { displayName }),
      },
      swipes,
      activeSwipeId: activeSwipe.id,
      state: "complete",
      metadata: {
        ...(readObject(raw, "metadata") ?? readObject(raw, "extra") ?? {}),
        ...(foldedSpeakerIntoContent
          ? {
              stnImportCompatibility: {
                originalContents: rawContents,
                speakerName: rawName ?? "",
                speakerFoldedIntoContent: true,
              },
            }
          : {}),
      },
      compatibility: {
        sourceFormat: records.format,
        unknownFields: pickUnknownFields(raw, knownMessageFields),
      },
      revision: 0,
      createdAt:
        readString(raw, "createdAt") ?? readString(raw, "send_date") ?? now,
      updatedAt:
        readString(raw, "updatedAt") ??
        readString(raw, "createdAt") ??
        readString(raw, "send_date") ??
        now,
    });
  });

  const title =
    readString(records.metadata, "title") ??
    options.filename?.replace(/\.[^.]+$/u, "") ??
    (assistantNames.length > 0
      ? `Conversation with ${assistantNames.join(", ")}`
      : "Imported conversation");
  const conversation = ConversationSchema.parse({
    id: conversationId,
    title,
    sourceCardIds: [],
    participants: [],
    worldbookIds: [],
    activeBranchId: branchId,
    metadata: readObject(records.metadata, "chat_metadata") ?? {},
    compatibility: {
      sourceFormat: records.format,
      ...(options.filename === undefined
        ? {}
        : { originalFilename: options.filename }),
      unknownFields: pickUnknownFields(records.metadata, knownMetadataFields),
    },
    revision: 0,
    createdAt: readString(records.metadata, "create_date") ?? now,
    updatedAt: now,
  });

  return {
    value: { conversation, messages, participants: [] },
    diagnostics: [],
    sourceFormat: records.format,
  };
}
