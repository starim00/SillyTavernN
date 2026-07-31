import {
  assemblePrompt,
  isJsonObject,
  renderChatPrompt,
  renderTextPrompt,
  type PromptAssemblyTrace,
} from "@stn/core";
import {
  CardSchema,
  GenerationSettingsSchema,
  ParticipantSchema,
  PromptPresetSchema,
  WorldbookSchema,
  type Card,
  type Conversation,
  type GenerationSettings,
  type Message,
  type Participant,
  type PromptPreset,
  type PromptSegment,
  type Worldbook,
  type WorldbookEntry,
} from "@stn/contracts";
import type { ProviderMessage } from "@stn/providers";
import type {
  AppStore,
  Card as StoredCard,
  JsonObject as StoredJsonObject,
  Message as StoredMessage,
  Participant as StoredParticipant,
  Preset as StoredPreset,
  Swipe as StoredSwipe,
  Worldbook as StoredWorldbook,
  WorldbookBinding as StoredWorldbookBinding,
  WorldbookEntry as StoredWorldbookEntry,
} from "@stn/storage";

import { collectAuthorizedConversationRegex } from "./regex-service.js";

export const DEFAULT_MAX_CONTEXT_TOKENS = 32_768;
export const DEFAULT_RESERVED_OUTPUT_TOKENS = 1_024;

const generationKeys = [
  "temperature",
  "topP",
  "topK",
  "minP",
  "typicalP",
  "topA",
  "tfs",
  "repetitionPenalty",
  "repetitionPenaltyRange",
  "frequencyPenalty",
  "presencePenalty",
  "maxOutputTokens",
  "n",
  "seed",
  "stop",
  "samplerOrder",
  "mirostatMode",
  "mirostatTau",
  "mirostatEta",
  "stream",
  "additional",
] as const satisfies readonly (keyof GenerationSettings)[];

const promptPositionValues = new Set<WorldbookEntry["position"]>([
  "before-card",
  "after-card",
  "before-examples",
  "after-examples",
  "before-history",
  "after-history",
]);

const secondaryLogicValues = new Set<WorldbookEntry["secondaryLogic"]>([
  "any",
  "all",
  "not-any",
  "not-all",
]);

const insertionPositionValues = new Set<
  NonNullable<WorldbookEntry["insertionPosition"]>
>([
  "before-card",
  "after-card",
  "author-note-top",
  "author-note-bottom",
  "at-depth",
  "examples-top",
  "examples-bottom",
  "outlet",
]);

const insertionRoleValues = new Set<
  NonNullable<WorldbookEntry["insertionRole"]>
>(["system", "user", "assistant"]);

type StoredMessageWithSwipes = StoredMessage & {
  readonly swipes: StoredSwipe[];
};
type WorldbookBinding = Worldbook["bindings"][number];

export interface PrepareConversationPromptInput {
  readonly conversationId: string;
  readonly presetId?: string;
  readonly settings?: Readonly<Record<string, unknown>>;
  readonly maxContextTokens?: number;
}

export interface PreparedConversationPrompt {
  readonly presetId?: string;
  readonly mode: PromptPreset["mode"];
  readonly generation: Partial<GenerationSettings>;
  readonly segments: readonly PromptSegment[];
  readonly trace: PromptAssemblyTrace;
  readonly messages: readonly ProviderMessage[];
  readonly textPrompt: string;
}

function normalizedCandidate(value: StoredJsonObject): unknown {
  return value.normalized;
}

function participantKind(role: string): Participant["kind"] {
  if (
    role === "character" ||
    role === "narrator" ||
    role === "user" ||
    role === "entity"
  ) {
    return role;
  }
  return "entity";
}

function participantContract(value: StoredParticipant): Participant {
  let baseline: Participant | undefined;
  for (const candidate of [
    value.profile,
    normalizedCandidate(value.legacyPayload),
  ]) {
    const parsed = ParticipantSchema.safeParse(candidate);
    if (parsed.success && parsed.data.id === value.id) {
      baseline = parsed.data;
      break;
    }
  }
  return ParticipantSchema.parse({
    id: value.id,
    name: value.name,
    kind: participantKind(value.role),
    aliases: baseline?.aliases ?? [],
    description: baseline?.description ?? "",
    personality: baseline?.personality ?? "",
    scenario: baseline?.scenario ?? "",
    firstMessage: baseline?.firstMessage ?? "",
    alternateGreetings: baseline?.alternateGreetings ?? [],
    exampleDialogue: baseline?.exampleDialogue ?? "",
    systemPrompt: baseline?.systemPrompt ?? "",
    postHistoryInstructions: baseline?.postHistoryInstructions ?? "",
    tags: baseline?.tags ?? [],
    ...(baseline?.avatarAssetId === undefined
      ? {}
      : { avatarAssetId: baseline.avatarAssetId }),
    extensions: baseline?.extensions ?? {},
    ...(baseline?.compatibility === undefined
      ? {}
      : { compatibility: baseline.compatibility }),
  });
}

function cardContract(
  value: StoredCard,
  storedParticipants: readonly StoredParticipant[],
  worldbookIds: readonly string[],
): Card {
  const parsed = CardSchema.safeParse(normalizedCandidate(value.legacyPayload));
  const baseline =
    parsed.success && parsed.data.id === value.id ? parsed.data : undefined;
  const participants = storedParticipants.map(participantContract);
  const baselineNarratorId = baseline?.narrator?.id;
  const narrator =
    participants.find((participant) => participant.id === baselineNarratorId) ??
    participants.find((participant) => participant.kind === "narrator");
  const ordinaryParticipants = participants.filter(
    (participant) => participant.id !== narrator?.id,
  );

  return CardSchema.parse({
    id: value.id,
    kind: value.kind,
    name: value.name,
    description: value.description,
    scenario: baseline?.scenario ?? "",
    worldDescription: baseline?.worldDescription ?? "",
    participants: ordinaryParticipants,
    ...(narrator === undefined ? {} : { narrator }),
    greeting: baseline?.greeting ?? "",
    alternateGreetings: baseline?.alternateGreetings ?? [],
    exampleDialogue: baseline?.exampleDialogue ?? "",
    systemPrompt: baseline?.systemPrompt ?? "",
    postHistoryInstructions: baseline?.postHistoryInstructions ?? "",
    creator: baseline?.creator ?? "",
    creatorNotes: baseline?.creatorNotes ?? "",
    version: baseline?.version ?? "",
    tags: baseline?.tags ?? [],
    assets: baseline?.assets ?? [],
    worldbookIds: [...worldbookIds],
    extensions: baseline?.extensions ?? {},
    ...(baseline?.compatibility === undefined
      ? {}
      : { compatibility: baseline.compatibility }),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  });
}

function conversationContract(
  value: ReturnType<AppStore["getConversation"]>,
  participants: readonly StoredParticipant[],
  worldbookIds: readonly string[],
  personaId: string | null,
): Conversation {
  return {
    id: value.id,
    title: value.title,
    sourceCardIds: [value.cardId],
    participants: participants.map((participant, index) => ({
      participantId: participant.id,
      ...(participant.cardId === null
        ? {}
        : { sourceCardId: participant.cardId }),
      displayName: participant.name,
      enabled: true,
      speakingOrder: index,
      metadata: {},
    })),
    worldbookIds: [...worldbookIds],
    ...(personaId === null ? {} : { personaId }),
    activeBranchId: `branch-${value.id}`,
    metadata: {},
    revision: value.revision,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function messageAuthorKind(
  value: StoredMessage["role"],
): Message["author"]["kind"] {
  switch (value) {
    case "assistant":
      return "assistant";
    case "system":
      return "system";
    case "tool":
      return "tool";
    case "user":
      return "user";
  }
}

function messageContract(
  value: StoredMessageWithSwipes,
  sequence: number,
  participantNames: ReadonlyMap<string, string>,
): Message {
  const selected =
    value.swipes.find((swipe) => swipe.selected) ??
    value.swipes.find((swipe) => swipe.content === value.content);
  const syntheticId = `${value.id}-current`;
  const swipes =
    value.swipes.length === 0
      ? [
          {
            id: syntheticId,
            content: value.content,
            createdAt: value.createdAt,
            metadata: {},
          },
        ]
      : value.swipes.map((swipe) => ({
          id: swipe.id,
          content: swipe.content,
          createdAt: swipe.createdAt,
          metadata: {},
        }));
  const activeSwipeId = selected?.id ?? swipes[0]?.id ?? syntheticId;
  const displayName =
    value.participantId === null
      ? undefined
      : participantNames.get(value.participantId);

  return {
    id: value.id,
    conversationId: value.conversationId,
    branchId: `branch-${value.conversationId}`,
    ...(value.parentMessageId === null
      ? {}
      : { parentMessageId: value.parentMessageId }),
    sequence,
    role: value.role,
    author: {
      kind: messageAuthorKind(value.role),
      ...(value.participantId === null
        ? {}
        : { participantId: value.participantId }),
      ...(displayName === undefined ? {} : { displayName }),
    },
    swipes,
    activeSwipeId,
    state: "complete",
    metadata: {},
    revision: value.revision,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) &&
    value.every((item): item is string => typeof item === "string")
    ? value
    : undefined;
}

function sameStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function worldbookEntryContract(
  value: StoredWorldbookEntry,
  baseline: WorldbookEntry | undefined,
): WorldbookEntry {
  const metadata = value.metadata;
  const metadataPrimary = stringArray(metadata.primaryKeys);
  const metadataSecondary = stringArray(metadata.secondaryKeys);
  const richPrimary = metadataPrimary ?? baseline?.primaryKeys ?? [];
  const richSecondary = metadataSecondary ?? baseline?.secondaryKeys ?? [];
  const canPreserveSplit = sameStrings(
    [...richPrimary, ...richSecondary],
    value.keys,
  );
  const positionValue = metadata.promptPosition;
  const position =
    typeof positionValue === "string" &&
    promptPositionValues.has(positionValue as WorldbookEntry["position"])
      ? (positionValue as WorldbookEntry["position"])
      : (baseline?.position ?? "before-history");
  const secondaryLogicValue = metadata.secondaryLogic;
  const secondaryLogic =
    typeof secondaryLogicValue === "string" &&
    secondaryLogicValues.has(
      secondaryLogicValue as WorldbookEntry["secondaryLogic"],
    )
      ? (secondaryLogicValue as WorldbookEntry["secondaryLogic"])
      : (baseline?.secondaryLogic ?? "any");
  const scanDepthValue = metadata.scanDepth;
  const hasStoredScanDepth = Object.prototype.hasOwnProperty.call(
    metadata,
    "scanDepth",
  );
  const scanDepth =
    hasStoredScanDepth && scanDepthValue === null
      ? undefined
      : typeof scanDepthValue === "number" &&
          Number.isInteger(scanDepthValue) &&
          scanDepthValue > 0
        ? Math.min(scanDepthValue, 10_000)
        : baseline?.scanDepth;
  const insertionPositionValue = metadata.insertionPosition;
  const insertionPosition =
    typeof insertionPositionValue === "string" &&
    insertionPositionValues.has(
      insertionPositionValue as NonNullable<
        WorldbookEntry["insertionPosition"]
      >,
    )
      ? (insertionPositionValue as NonNullable<
          WorldbookEntry["insertionPosition"]
        >)
      : baseline?.insertionPosition;
  const outletNameValue = metadata.outletName;
  const outletName =
    typeof outletNameValue === "string" && outletNameValue.trim().length > 0
      ? outletNameValue.trim()
      : baseline?.outletName;
  const insertionDepthValue = metadata.insertionDepth;
  const insertionDepth =
    typeof insertionDepthValue === "number" &&
    Number.isInteger(insertionDepthValue) &&
    insertionDepthValue >= 0
      ? Math.min(insertionDepthValue, 10_000)
      : baseline?.insertionDepth;
  const insertionRoleValue = metadata.insertionRole;
  const insertionRole =
    typeof insertionRoleValue === "string" &&
    insertionRoleValues.has(
      insertionRoleValue as NonNullable<WorldbookEntry["insertionRole"]>,
    )
      ? (insertionRoleValue as NonNullable<WorldbookEntry["insertionRole"]>)
      : baseline?.insertionRole;
  const legacyInsertionOrderValue = metadata.legacyInsertionOrder;
  const legacyInsertionOrder =
    typeof legacyInsertionOrderValue === "number" &&
    Number.isFinite(legacyInsertionOrderValue)
      ? legacyInsertionOrderValue
      : baseline?.legacyInsertionOrder;
  const extensions = isJsonObject(metadata.extensions)
    ? metadata.extensions
    : (baseline?.extensions ?? {});

  return {
    id: value.id,
    ...(value.legacyUid === null && baseline?.legacyUid === undefined
      ? {}
      : { legacyUid: value.legacyUid ?? baseline?.legacyUid }),
    label:
      (typeof metadata.label === "string" && metadata.label) ||
      (typeof metadata.title === "string" && metadata.title) ||
      baseline?.label ||
      value.id,
    content: value.content,
    primaryKeys: canPreserveSplit ? richPrimary : value.keys,
    secondaryKeys: canPreserveSplit ? richSecondary : [],
    secondaryLogic,
    selective:
      typeof metadata.selective === "boolean"
        ? metadata.selective
        : (baseline?.selective ?? false),
    constant:
      typeof metadata.constant === "boolean"
        ? metadata.constant
        : (baseline?.constant ?? false),
    disabled: !value.enabled,
    agentEditable: value.agentEditable,
    caseSensitive:
      typeof metadata.caseSensitive === "boolean"
        ? metadata.caseSensitive
        : (baseline?.caseSensitive ?? false),
    matchWholeWords:
      typeof metadata.matchWholeWords === "boolean"
        ? metadata.matchWholeWords
        : (baseline?.matchWholeWords ?? false),
    ...(scanDepth === undefined ? {} : { scanDepth }),
    recursion:
      typeof metadata.recursion === "boolean"
        ? metadata.recursion
        : (baseline?.recursion ?? true),
    preventRecursion:
      typeof metadata.preventRecursion === "boolean"
        ? metadata.preventRecursion
        : (baseline?.preventRecursion ?? false),
    ...(typeof metadata.excludeRecursion === "boolean"
      ? { excludeRecursion: metadata.excludeRecursion }
      : baseline?.excludeRecursion === undefined
        ? {}
        : { excludeRecursion: baseline.excludeRecursion }),
    ...(typeof metadata.delayUntilRecursion === "boolean"
      ? { delayUntilRecursion: metadata.delayUntilRecursion }
      : baseline?.delayUntilRecursion === undefined
        ? {}
        : { delayUntilRecursion: baseline.delayUntilRecursion }),
    ...(typeof metadata.useRegex === "boolean"
      ? { useRegex: metadata.useRegex }
      : baseline?.useRegex === undefined
        ? {}
        : { useRegex: baseline.useRegex }),
    ...(legacyInsertionOrder === undefined ? {} : { legacyInsertionOrder }),
    ...(insertionPosition === undefined ? {} : { insertionPosition }),
    ...(outletName === undefined ? {} : { outletName }),
    ...(insertionDepth === undefined ? {} : { insertionDepth }),
    ...(insertionRole === undefined ? {} : { insertionRole }),
    position,
    order: value.position,
    priority:
      typeof metadata.priority === "number" &&
      Number.isFinite(metadata.priority)
        ? metadata.priority
        : (baseline?.priority ?? 0),
    extensions,
    ...(baseline?.compatibility === undefined
      ? {}
      : { compatibility: baseline.compatibility }),
    revision: value.revision,
  };
}

function bindingContract(
  value: StoredWorldbookBinding,
): WorldbookBinding | undefined {
  if (value.scopeType === "global") {
    return { scope: "global" };
  }
  if (value.scopeId === null) {
    return undefined;
  }
  return { scope: value.scopeType, targetId: value.scopeId };
}

function worldbookContract(
  value: StoredWorldbook,
  entries: readonly StoredWorldbookEntry[],
  bindings: readonly StoredWorldbookBinding[],
): Worldbook {
  const parsed = WorldbookSchema.safeParse(
    normalizedCandidate(value.legacyPayload),
  );
  const baseline =
    parsed.success && parsed.data.id === value.id ? parsed.data : undefined;
  const baselineEntries = new Map(
    baseline?.entries.map((entry) => [entry.id, entry]) ?? [],
  );
  return WorldbookSchema.parse({
    id: value.id,
    name: value.name,
    description: baseline?.description ?? "",
    entries: entries.map((entry) =>
      worldbookEntryContract(entry, baselineEntries.get(entry.id)),
    ),
    bindings: bindings.flatMap((binding) => {
      const normalized = bindingContract(binding);
      return normalized === undefined ? [] : [normalized];
    }),
    scanDepth: baseline?.scanDepth ?? 4,
    recursionLimit: baseline?.recursionLimit ?? 3,
    agentEditable: value.agentEditable,
    revision: value.revision,
    extensions: baseline?.extensions ?? {},
    ...(baseline?.compatibility === undefined
      ? {}
      : { compatibility: baseline.compatibility }),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  });
}

function bindingApplies(
  binding: StoredWorldbookBinding,
  conversationId: string,
  cardId: string,
  participantIds: ReadonlySet<string>,
  personaId: string | null,
): boolean {
  switch (binding.scopeType) {
    case "global":
      return true;
    case "conversation":
      return binding.scopeId === conversationId;
    case "card":
      return binding.scopeId === cardId;
    case "participant":
      return binding.scopeId !== null && participantIds.has(binding.scopeId);
    case "persona":
      return personaId !== null && binding.scopeId === personaId;
  }
}

function generationSource(value: StoredJsonObject): StoredJsonObject {
  return isJsonObject(value.generation) ? value.generation : value;
}

function nativeGeneration(value: StoredJsonObject): GenerationSettings {
  const source = generationSource(value);
  const candidate: Record<string, unknown> = {
    stop: [],
    samplerOrder: [],
    additional: {},
  };
  for (const key of generationKeys) {
    if (source[key] !== undefined) {
      candidate[key] = source[key];
    }
  }
  const parsed = GenerationSettingsSchema.safeParse(candidate);
  return parsed.success
    ? parsed.data
    : { stop: [], samplerOrder: [], additional: {} };
}

function presetContract(value: StoredPreset): PromptPreset {
  for (const candidate of [
    value.payload,
    value.payload.normalized,
    normalizedCandidate(value.legacyPayload),
  ]) {
    const parsed = PromptPresetSchema.safeParse(candidate);
    if (parsed.success) {
      return {
        ...parsed.data,
        id: value.id,
        name: value.name,
        createdAt: value.createdAt,
        updatedAt: value.updatedAt,
      };
    }
  }
  return PromptPresetSchema.parse({
    id: value.id,
    name: value.name,
    mode:
      value.kind === "text-generation"
        ? "text-generation"
        : value.kind === "chat-completion"
          ? "chat-completion"
          : "native",
    prompts: [],
    generation: nativeGeneration(value.payload),
    extensions: {},
    compatibility: {
      sourceFormat: "native-storage",
      unknownFields: value.legacyPayload,
    },
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  });
}

function requestedGeneration(
  value: Readonly<Record<string, unknown>> | undefined,
): Partial<GenerationSettings> {
  if (value === undefined) {
    return {};
  }
  const parsed = GenerationSettingsSchema.partial().strip().parse(value);
  return Object.fromEntries(
    Object.entries(parsed).filter(([, field]) => field !== undefined),
  );
}

function mergeGeneration(
  preset: PromptPreset | undefined,
  overrides: Readonly<Record<string, unknown>> | undefined,
): Partial<GenerationSettings> {
  const base = preset?.generation;
  const request = requestedGeneration(overrides);
  return {
    ...(base ?? {}),
    ...request,
    stop: request.stop ?? base?.stop ?? [],
    samplerOrder: request.samplerOrder ?? base?.samplerOrder ?? [],
    additional: {
      ...(base?.additional ?? {}),
      ...(request.additional ?? {}),
    },
  };
}

function presetContextLimit(
  generation: Partial<GenerationSettings>,
): number | undefined {
  const value = generation.additional?.maxContextTokens;
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0 &&
    Number.isSafeInteger(value)
    ? value
    : undefined;
}

export function prepareConversationPrompt(
  store: AppStore,
  input: PrepareConversationPromptInput,
): PreparedConversationPrompt {
  const storedConversation = store.getConversation(input.conversationId);
  const storedParticipants = store.listConversationParticipants(
    storedConversation.id,
  );
  const storedPersona =
    storedConversation.personaId === null
      ? store.getDefaultPersona()
      : store.getPersona(storedConversation.personaId);
  const personaId = storedPersona?.id ?? null;
  const participantIds = new Set(
    storedParticipants.map((participant) => participant.id),
  );
  const boundWorldbooks = store.listWorldbooks().flatMap((worldbook) => {
    const bindings = store.listWorldbookBindings(worldbook.id);
    return bindings.some((binding) =>
      bindingApplies(
        binding,
        storedConversation.id,
        storedConversation.cardId,
        participantIds,
        personaId,
      ),
    )
      ? [
          worldbookContract(
            worldbook,
            store.listWorldbookEntries(worldbook.id),
            bindings,
          ),
        ]
      : [];
  });
  const worldbookIds = boundWorldbooks.map((worldbook) => worldbook.id);
  const cardWorldbookIds = store
    .listWorldbooks()
    .flatMap((worldbook) =>
      store
        .listWorldbookBindings(worldbook.id)
        .some(
          (binding) =>
            binding.scopeType === "card" &&
            binding.scopeId === storedConversation.cardId,
        )
        ? [worldbook.id]
        : [],
    );
  const card = cardContract(
    store.getCard(storedConversation.cardId),
    store.listCardParticipants(storedConversation.cardId),
    cardWorldbookIds,
  );
  const participants = storedParticipants.map(participantContract);
  const conversation = conversationContract(
    storedConversation,
    storedParticipants,
    worldbookIds,
    personaId,
  );
  const participantNames = new Map(
    storedParticipants.map((participant) => [participant.id, participant.name]),
  );
  const messages = store
    .listMessages(storedConversation.id)
    .map((message, sequence) =>
      messageContract(message, sequence, participantNames),
    );
  const preset =
    input.presetId === undefined
      ? undefined
      : presetContract(store.getPreset(input.presetId));
  const generation = mergeGeneration(preset, input.settings);
  const regex = collectAuthorizedConversationRegex(store, {
    conversationId: storedConversation.id,
    ...(preset === undefined ? {} : { presetId: preset.id }),
  });
  const presetMaximum = presetContextLimit(generation);
  const maxContextTokens =
    input.maxContextTokens === undefined
      ? (presetMaximum ?? DEFAULT_MAX_CONTEXT_TOKENS)
      : presetMaximum === undefined
        ? input.maxContextTokens
        : Math.min(input.maxContextTokens, presetMaximum);
  const reservedOutputTokens =
    generation.maxOutputTokens ?? DEFAULT_RESERVED_OUTPUT_TOKENS;
  const assembled = assemblePrompt({
    conversation,
    ...(card === undefined ? {} : { card }),
    participants: participants.filter(
      (participant) => participant.id !== card?.narrator?.id,
    ),
    messages,
    worldbooks: boundWorldbooks,
    ...(preset === undefined ? {} : { preset }),
    ...(storedPersona?.description
      ? { persona: storedPersona.description }
      : {}),
    ...(storedPersona === null
      ? {}
      : { userName: storedPersona.name, personaId: storedPersona.id }),
    regexScripts: regex.scripts,
    tokenBudget: {
      maxContextTokens,
      reservedOutputTokens,
    },
  });
  const renderedMessages = renderChatPrompt(assembled.segments).map(
    (message): ProviderMessage => ({
      role: message.role,
      content: message.content,
    }),
  );

  return {
    ...(preset === undefined ? {} : { presetId: preset.id }),
    mode: preset?.mode ?? "native",
    generation,
    segments: assembled.segments,
    trace: assembled.trace,
    messages: renderedMessages,
    textPrompt: renderTextPrompt(assembled.segments),
  };
}
