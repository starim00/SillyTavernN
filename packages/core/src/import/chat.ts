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
  readNumber,
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
  "spec",
  "version",
  "exportedAt",
  "title",
  "card",
  "preset",
  "personaId",
  "variables",
] as const;
const knownMessageFields = [
  "id",
  "role",
  "content",
  "author",
  "participantId",
  "parentMessageId",
  "activeSwipeId",
  "createdAt",
  "updatedAt",
  "metadata",
  "variables",
  "name",
  "is_user",
  "is_system",
  "mes",
  "send_date",
  "swipes",
  "swipe_id",
  "swipe_info",
  "variables_initialized",
  "extra",
  "force_avatar",
  "gen_started",
  "gen_finished",
] as const;

function objectRecord(
  value: JsonObject | undefined,
): Record<string, JsonObject> {
  if (!value) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, JsonObject] =>
      isJsonObject(entry[1]),
    ),
  );
}

function portableProviderContext(
  raw: JsonObject,
): { connectionId: string; items: JsonObject[] } | undefined {
  const providerContext = readObject(raw, "providerContext");
  if (!providerContext) return undefined;
  const connectionId = readString(providerContext, "connectionId")?.trim();
  const items = (readArray(providerContext, "items") ?? []).filter(
    isJsonObject,
  );
  return connectionId && items.length > 0 ? { connectionId, items } : undefined;
}

function legacyMessageVariables(
  raw: JsonObject,
  activeSwipeIndex: number,
): JsonObject | undefined {
  const snapshots = readArray(raw, "variables");
  const selected = snapshots?.[activeSwipeIndex];
  if (isJsonObject(selected)) return selected;
  return readObject(raw, "variables");
}

function legacySwipeReasoning(
  raw: JsonObject,
  swipeIndex: number,
  activeSwipeIndex: number,
): string | undefined {
  const swipeInfo = readArray(raw, "swipe_info")?.[swipeIndex];
  const swipeExtra = isJsonObject(swipeInfo)
    ? readObject(swipeInfo, "extra")
    : undefined;
  const messageExtra =
    swipeIndex === activeSwipeIndex ? readObject(raw, "extra") : undefined;
  return (
    (swipeExtra ? readString(swipeExtra, "reasoning") : undefined) ??
    (messageExtra ? readString(messageExtra, "reasoning") : undefined)
  );
}

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
  const portable =
    readString(records.metadata, "spec") === "sillytavern_n_conversation" &&
    readNumber(records.metadata, "version") === 1;
  const portableVariables = portable
    ? readObject(records.metadata, "variables")
    : undefined;
  const legacyChatMetadata = readObject(records.metadata, "chat_metadata");
  const legacyChatVariables = legacyChatMetadata
    ? readObject(legacyChatMetadata, "variables")
    : undefined;
  const portableCard = portable
    ? readObject(records.metadata, "card")
    : undefined;
  const portablePreset = portable
    ? readObject(records.metadata, "preset")
    : undefined;
  const portableScripts = portableVariables
    ? readObject(portableVariables, "scripts")
    : undefined;
  const portableCharacterVariables = portableVariables
    ? readObject(portableVariables, "character")
    : undefined;
  const portableChatVariables = portableVariables
    ? readObject(portableVariables, "chat")
    : undefined;
  const portablePresetVariables = portableVariables
    ? readObject(portableVariables, "preset")
    : undefined;
  const portablePersonaId = portable
    ? readString(records.metadata, "personaId")
    : undefined;
  const originalCardId = portableCard
    ? readString(portableCard, "id")
    : undefined;
  const originalPresetId = portablePreset
    ? readString(portablePreset, "id")
    : undefined;
  const portableMessageVariables = objectRecord(
    portableVariables ? readObject(portableVariables, "messages") : undefined,
  );
  const portableSwipeVariables = objectRecord(
    portableVariables ? readObject(portableVariables, "swipes") : undefined,
  );
  const sourceMessageKeys = records.messages.map(
    (raw, sequence) => readString(raw, "id") ?? `#${String(sequence)}`,
  );
  const generatedMessageIds = records.messages.map(() => context.id("message"));
  const messageIdBySourceKey = new Map(
    sourceMessageKeys.map((sourceId, index) => [
      sourceId,
      generatedMessageIds[index]!,
    ]),
  );
  const importedMessageVariables: Record<string, JsonObject> = {};
  const importedSwipeVariables: Record<string, JsonObject> = {};
  const importedSwipeState: NonNullable<
    ConversationImportResult["value"]["portableState"]
  >["swipes"] = {};
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
    const rawAuthor = readObject(raw, "author");
    const participantId =
      (rawAuthor ? readString(rawAuthor, "participantId") : undefined) ??
      readString(raw, "participantId");
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
      Math.min(contents.length - 1, activeIndexRaw),
    );
    const swipes = contents.map((content, swipeIndex) => {
      const sourceSwipe = sourceSwipes?.[swipeIndex];
      const sourceSwipeObject = isJsonObject(sourceSwipe)
        ? sourceSwipe
        : undefined;
      const swipeId = context.id("swipe");
      const sourceSwipeId = sourceSwipeObject
        ? readString(sourceSwipeObject, "id")
        : undefined;
      const legacySnapshot = readArray(raw, "variables")?.[swipeIndex];
      const swipeVariables = portable
        ? sourceSwipeId
          ? portableSwipeVariables[sourceSwipeId]
          : undefined
        : isJsonObject(legacySnapshot)
          ? legacySnapshot
          : undefined;
      if (swipeVariables) importedSwipeVariables[swipeId] = swipeVariables;
      if (portable && sourceSwipeObject) {
        const reasoningText = readString(sourceSwipeObject, "reasoningText");
        const providerContext = portableProviderContext(sourceSwipeObject);
        if (reasoningText !== undefined || providerContext !== undefined) {
          importedSwipeState[swipeId] = {
            ...(reasoningText === undefined ? {} : { reasoningText }),
            ...(providerContext === undefined ? {} : { providerContext }),
          };
        }
      } else if (!portable) {
        const reasoningText = legacySwipeReasoning(
          raw,
          swipeIndex,
          activeIndex,
        );
        if (reasoningText !== undefined) {
          importedSwipeState[swipeId] = { reasoningText };
        }
      }
      return {
        id: swipeId,
        content,
        createdAt:
          (sourceSwipeObject
            ? readString(sourceSwipeObject, "createdAt")
            : undefined) ??
          readString(raw, "createdAt") ??
          readString(raw, "send_date") ??
          now,
        metadata: {},
      };
    });
    const activeSwipe = swipes[activeIndex];
    if (!activeSwipe) {
      throw new Error("Imported message did not produce a swipe");
    }

    const messageId = generatedMessageIds[sequence]!;
    const sourceMessageKey = sourceMessageKeys[sequence]!;
    {
      const variables = portable
        ? (readObject(raw, "variables") ??
          portableMessageVariables[sourceMessageKey])
        : legacyMessageVariables(raw, activeIndex);
      if (variables) importedMessageVariables[messageId] = variables;
    }
    const sourceParentMessageId = readString(raw, "parentMessageId");
    const parentMessageId = sourceParentMessageId
      ? messageIdBySourceKey.get(sourceParentMessageId)
      : undefined;

    return MessageSchema.parse({
      id: messageId,
      conversationId,
      branchId,
      ...(parentMessageId === undefined ? {} : { parentMessageId }),
      sequence,
      role,
      author: {
        kind: role,
        ...(isAssistant && participantId ? { participantId } : {}),
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
    ...(portablePersonaId ? { personaId: portablePersonaId } : {}),
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
    value: {
      conversation,
      messages,
      participants: [],
      ...(portable ||
      legacyChatVariables !== undefined ||
      Object.keys(importedMessageVariables).length > 0 ||
      Object.keys(importedSwipeState).length > 0
        ? {
            portableState: {
              spec: portable
                ? ("sillytavern_n_conversation" as const)
                : ("sillytavern_jsonl_chat" as const),
              version: 1 as const,
              ...(originalCardId ? { originalCardId } : {}),
              ...(originalPresetId ? { originalPresetId } : {}),
              ...(portablePersonaId ? { personaId: portablePersonaId } : {}),
              variables: {
                ...(portableCharacterVariables
                  ? { character: portableCharacterVariables }
                  : {}),
                ...(portableChatVariables
                  ? { chat: portableChatVariables }
                  : legacyChatVariables
                    ? { chat: legacyChatVariables }
                    : {}),
                ...(portablePresetVariables
                  ? { preset: portablePresetVariables }
                  : {}),
                messages: importedMessageVariables,
                swipes: importedSwipeVariables,
                scripts: {
                  card: objectRecord(
                    portableScripts
                      ? readObject(portableScripts, "card")
                      : undefined,
                  ),
                  preset: objectRecord(
                    portableScripts
                      ? readObject(portableScripts, "preset")
                      : undefined,
                  ),
                },
              },
              swipes: importedSwipeState,
            },
          }
        : {}),
    },
    diagnostics: [],
    sourceFormat: records.format,
  };
}
