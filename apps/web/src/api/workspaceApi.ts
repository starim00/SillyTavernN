import {
  GenerationSettingsSchema,
  type GenerationSettings,
} from "@stn/contracts";
import {
  parseLegacyRpcResponse,
  type LegacyActor,
  type LegacyRpcRequest,
  type LegacyRpcResponse,
} from "@stn/legacy-compat/protocol";
import {
  getLegacyPluginProfile,
  type LegacyCapability,
  type LegacyExecutionOwner,
  type LegacyRealmRole,
} from "@stn/legacy-compat/profiles";

import type {
  AgentProposal,
  AgentRun,
  ApiEnvelope,
  ConversationSpace,
  Participant,
  Persona,
  PortableProviderConnection,
  PromptPreset,
  PromptPresetEntry,
  ProviderConnection,
  ProviderConnectionInput,
  ProviderModel,
  RegexDiagnostic,
  RegexPlacement,
  RegexScope,
  RegexScopeKind,
  RegexScriptDefinition,
  RoleCard,
  WorkspaceMessage,
  WorkspaceState,
  Worldbook,
  WorldbookEntry,
  WorldbookEntryUpdate,
} from "../domain/workspace";
import type {
  TavernHelperContext,
  TavernHelperScript,
  TavernHelperSettings,
  TavernHelperScope,
  TavernHelperStateNamespace,
} from "../compat/tavernHelperTypes";
import { LEGACY_REALM_ORIGIN } from "../legacy/origin";
import { notifyAuthenticationRequired } from "./authApi";

type ApiParticipant = {
  id: string;
  name: string;
  role: string;
  cardId?: string | null;
};

type ApiConversation = {
  id: string;
  title: string;
  cardId: string;
  personaId?: string | null;
  participants?: ApiParticipant[];
  worldbookIds?: string[];
  revision?: number;
  subtitle?: string;
  updatedAt?: string;
};

type ApiPersona = {
  id: string;
  name: string;
  description?: string;
  title?: string;
  isDefault?: boolean;
  revision?: number;
  createdAt?: string;
  updatedAt?: string;
};

type ApiCard = {
  id: string;
  name: string;
  description?: string;
  revision?: number;
  participants?: ApiParticipant[];
  worldbookIds?: string[];
  imageUrl?: string;
};

type ApiSwipe = {
  id: string;
  content: string;
  reasoningText?: string | null;
  providerConnectionId?: string | null;
  providerName?: string | null;
  selected?: boolean;
  position?: number;
};

type ApiMessage = {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  displayContent?: string;
  appliedRegexScriptIds?: string[];
  revision?: number;
  createdAt?: string;
  generationStatus?: "complete" | "partial" | "cancelled" | "error";
  state?: "complete" | "partial" | "cancelled" | "error";
  finishReason?: WorkspaceMessage["finishReason"] | null;
  providerErrorCode?: string | null;
  providerRawFinishReason?: string | null;
  providerSawDone?: boolean | null;
  providerLastFrameType?: string | null;
  providerUpstreamRequestId?: string | null;
  swipes?: ApiSwipe[];
};

type ApiWorldbookEntry = {
  id: string;
  title?: string;
  keys?: string[];
  primaryKeys?: string[];
  secondaryKeys?: string[];
  secondaryLogic?: string;
  selective?: boolean;
  content?: string;
  enabled?: boolean;
  constant?: boolean;
  caseSensitive?: boolean;
  matchWholeWords?: boolean;
  useRegex?: boolean;
  scanDepth?: number | null;
  recursion?: boolean;
  preventRecursion?: boolean;
  excludeRecursion?: boolean;
  delayUntilRecursion?: boolean;
  insertionPosition?: string;
  outletName?: string | null;
  insertionDepth?: number | null;
  insertionRole?: string;
  order?: number;
  priority?: number;
  probability?: number;
  agentEditable?: boolean;
  revision?: number;
};

type ApiWorldbook = {
  id: string;
  name: string;
  agentEditable: boolean;
  revision: number;
  description?: string;
  imported?: boolean;
  entries?: ApiWorldbookEntry[];
};

type ApiPreset = {
  id: string;
  name: string;
  description?: string;
  kind?: string;
  revision?: number;
  payload?: {
    mode?: string;
    prompts?: ApiPresetPrompt[];
    generation?: unknown;
    [key: string]: unknown;
  };
};

type ApiPresetPrompt = {
  id?: string;
  identifier?: string;
  name?: string;
  role?: string;
  content?: string;
  enabled?: boolean;
  order?: number;
  systemPrompt?: boolean;
  marker?: string;
  metadata?: {
    dynamicMarker?: boolean;
    promptOrderMember?: boolean;
  };
};

type ApiProviderConnection = ProviderConnection;

type ApiProviderModel = {
  id: string;
  name?: string;
};

type ApiRegexScript = {
  id: string;
  scriptName: string;
  findRegex: string;
  replaceString: string;
  trimStrings: string[];
  placement: number[];
  disabled: boolean;
  markdownOnly: boolean;
  promptOnly: boolean;
  runOnEdit: boolean;
  substituteRegex: number;
  minDepth: number | null;
  maxDepth: number | null;
};

type ApiRegexDiagnostic = {
  severity: string;
  code: string;
  message: string;
  path?: string;
};

type ApiRegexScope = {
  scope: string;
  id: string;
  name: string;
  enabled: boolean;
  revision: number;
  ownerRevision: number | null;
  scripts: ApiRegexScript[];
  diagnostics: ApiRegexDiagnostic[];
  updatedAt: string | null;
};

type ApiAgentRun = {
  id: string;
  conversationId: string;
  status:
    | "queued"
    | "running"
    | "waiting_confirmation"
    | "completed"
    | "failed"
    | "cancelled";
  objective: string;
  updatedAt: string;
};

type AgentToolResult = {
  call: {
    id: string;
    status:
      | "proposed"
      | "awaiting_confirmation"
      | "running"
      | "succeeded"
      | "rejected"
      | "cancelled"
      | "failed";
  };
  result?: {
    auditId?: string;
    revision?: number;
    [key: string]: unknown;
  };
  replayed: boolean;
};

export type ApiAgentToolCall = {
  id: string;
  runId: string;
  idempotencyKey: string;
  toolName: string;
  arguments: Record<string, unknown>;
  status:
    | "proposed"
    | "awaiting_confirmation"
    | "running"
    | "succeeded"
    | "rejected"
    | "cancelled"
    | "failed";
};

export type ApiBootstrap = {
  conversations: ConversationSpace[];
  cards: RoleCard[];
  personas?: Persona[];
  participants: Participant[];
  messagesByConversation: Record<string, WorkspaceMessage[]>;
  conversationNextCursor?: string | null;
  messageNextCursorByConversation?: Record<string, string | null>;
  worldbooks: Worldbook[];
  presets: PromptPreset[];
  regexScopes: RegexScope[];
  providerConnections: ProviderConnection[];
  selectedPresetId?: string;
  selectedProviderId?: string;
};

export type WorkspacePreferences = {
  selectedPresetId: string;
  selectedProviderId: string;
};

type ApiPage<T> = {
  items: T[];
  nextCursor: string | null;
};

export type GenerationReceipt =
  | {
      generationId: string;
      messageId: string;
      revision: number;
      content: string;
      alternatives?: string[];
      incomplete?: boolean;
      reason?: "length" | "cancelled" | "error" | "limit";
      errorCode?: string;
      errorMessage?: string;
      providerRawFinishReason?: string;
      providerSawDone?: boolean;
      providerLastFrameType?: string;
      providerUpstreamRequestId?: string;
    }
  | {
      generationId: string;
      toolProposalOnly: true;
    };

export type BackgroundGeneration =
  | {
      id: string;
      conversationId: string;
      mode: "send" | "regenerate";
      targetMessageId?: string;
      status: "running";
      startedAt: string;
    }
  | {
      id: string;
      conversationId: string;
      mode: "send" | "regenerate";
      targetMessageId?: string;
      status: "finished";
      startedAt: string;
      finishedAt: string;
      messageId?: string;
      revision?: number;
      incompleteReason?: "length" | "cancelled" | "error" | "limit";
      errorCode?: string;
      errorMessage?: string;
      toolProposalOnly?: boolean;
    };

export type GenerationToolProposal = {
  run: AgentRun;
  toolCall: ApiAgentToolCall;
  text: string;
};

export type GenerationCallbacks = {
  onGenerationId?: (generationId: string) => void;
  onTextDelta?: (delta: string) => void;
  onReasoningDelta?: (delta: string) => void;
  onToolProposal?: (proposal: GenerationToolProposal) => void;
  onToolResult?: (result: unknown) => void;
};

export type PortableImportKind =
  "card" | "worldbook" | "conversation" | "preset";

export type PortableImportResult = {
  kind: PortableImportKind;
  result: unknown;
};

export type ConversationVariableRestoreSummary = {
  chat: boolean;
  messages: number;
  swipes: number;
};

export type ConversationArchive = {
  spec: "sillytavern_n_conversation";
  version: 1;
  title: string;
  exportedAt: string;
  messages: unknown[];
  variables: Record<string, unknown>;
  [key: string]: unknown;
};

export type RegexGrantScope = "card" | "preset";

export type { LegacyActor, LegacyRpcRequest, LegacyRpcResponse };

export type LegacyCapabilityGrant = {
  pluginId: string;
  actor: LegacyActor;
  capability: string;
  granted: boolean;
  grantedBy: string;
  updatedAt: string;
};

export type LegacyHostPluginStatus = {
  id: string;
  uiId: string;
  name: string;
  version: string;
  repository: string;
  commit: string;
  executionOwner: LegacyExecutionOwner;
  legacyRealmRole: LegacyRealmRole;
  capabilities: LegacyCapability[];
  description: string;
  installed: boolean;
  verified: boolean;
  enabled: boolean;
  reason?: string;
};

export type LegacyHostHealth = {
  ok: boolean;
  service: string;
  safeMode: boolean;
  plugins: LegacyHostPluginStatus[];
};

export type LegacyPluginInstallResult = {
  outcome: "installed" | "already-installed";
  plugin: LegacyHostPluginStatus;
  receipt?: {
    pluginId: string;
    repository: string;
    commit: string;
    installedAt: string;
  };
};

export class WorkspaceApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "WorkspaceApiError";
  }
}

export class GenerationInterruptedError extends Error {
  constructor(message = "Generation was interrupted.") {
    super(message);
    this.name = "GenerationInterruptedError";
  }
}

type JsonRequestInit = RequestInit & { timeoutMs?: number };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

async function errorFromResponse(
  response: Response,
  path: string,
): Promise<WorkspaceApiError> {
  if (response.status === 401) notifyAuthenticationRequired();
  let message = `API request failed: ${path}`;
  let code: string | undefined;
  try {
    const body: unknown = await response.json();
    if (isRecord(body) && isRecord(body.error)) {
      if (typeof body.error.message === "string") message = body.error.message;
      if (typeof body.error.code === "string") code = body.error.code;
    }
  } catch {
    // Keep the route-based fallback when an upstream returned no JSON body.
  }
  return new WorkspaceApiError(message, response.status, code);
}

async function request<T>(
  path: string,
  { timeoutMs = 5_000, ...init }: JsonRequestInit = {},
): Promise<T> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`/api${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init.body === undefined || init.body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
        ...init.headers,
      },
      signal: controller.signal,
    });

    if (!response.ok) throw await errorFromResponse(response, path);
    return (await response.json()) as T;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

const timeLabel = (value?: string): string => {
  if (!value) return "刚刚";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

const normalizeParticipantKind = (role: string): Participant["kind"] => {
  if (role === "user" || role === "person") return "person";
  if (role === "narrator") return "narrator";
  if (role === "system") return "system";
  return "character";
};

const participantAccents: Participant["accent"][] = [
  "blue",
  "coral",
  "mint",
  "violet",
  "slate",
];

const normalizeParticipant = (
  item: ApiParticipant,
  index: number,
): Participant => ({
  id: item.id,
  name: item.name,
  kind: normalizeParticipantKind(item.role),
  accent: participantAccents[index % participantAccents.length] ?? "slate",
  ...(item.cardId ? { sourceCardId: item.cardId } : {}),
});

const normalizeConversation = (item: ApiConversation): ConversationSpace => {
  if (typeof item.cardId !== "string" || item.cardId.trim().length === 0) {
    throw new WorkspaceApiError(
      "Conversation is missing its required card binding.",
      502,
      "INVALID_CONVERSATION_CARD",
    );
  }
  return {
    id: item.id,
    title: item.title,
    subtitle: item.subtitle ?? "来自本地工作区的会话",
    cardId: item.cardId,
    personaId: item.personaId ?? null,
    revision: item.revision ?? 1,
    worldbookIds: item.worldbookIds ?? [],
    updatedLabel: timeLabel(item.updatedAt),
    unreadCount: 0,
    pinned: false,
  };
};

const normalizePersona = (item: ApiPersona): Persona => ({
  id: item.id,
  name: item.name,
  description: item.description ?? "",
  title: item.title ?? "",
  isDefault: item.isDefault ?? false,
  revision: item.revision ?? 1,
  createdAt: item.createdAt ?? new Date(0).toISOString(),
  updatedAt: item.updatedAt ?? new Date(0).toISOString(),
});

const normalizeCard = (
  item: ApiCard,
  conversations: ApiConversation[],
): RoleCard => ({
  id: item.id,
  name: item.name,
  description: item.description ?? "",
  revision: item.revision ?? 1,
  conversationCount: conversations.filter(
    (conversation) => conversation.cardId === item.id,
  ).length,
  worldbookIds: item.worldbookIds ?? [],
  ...(item.imageUrl ? { imageUrl: item.imageUrl } : {}),
});

const normalizeMessage = (item: ApiMessage): WorkspaceMessage => {
  if (item.role !== "user" && item.role !== "assistant") {
    throw new WorkspaceApiError(
      "Internal messages cannot be rendered in the conversation stream.",
      502,
    );
  }
  const swipes = (item.swipes ?? []).map(
    ({ id, content, reasoningText, providerConnectionId, providerName }) => ({
      id,
      content,
      ...(reasoningText ? { reasoningText } : {}),
      ...(providerConnectionId ? { providerConnectionId } : {}),
      ...(providerName ? { providerName } : {}),
    }),
  );
  const selectedIndex = (item.swipes ?? []).findIndex(
    (swipe) => swipe.selected,
  );
  const selectedContent =
    selectedIndex >= 0 ? swipes[selectedIndex]?.content : undefined;

  return {
    id: item.id,
    conversationId: item.conversationId,
    role: item.role,
    content: selectedContent ?? item.content,
    displayContent: item.displayContent ?? selectedContent ?? item.content,
    ...(selectedIndex >= 0 && swipes[selectedIndex]?.reasoningText
      ? { reasoningText: swipes[selectedIndex].reasoningText }
      : {}),
    appliedRegexScriptIds: item.appliedRegexScriptIds ?? [],
    createdLabel: timeLabel(item.createdAt),
    revision: item.revision ?? 1,
    state: item.state ?? item.generationStatus ?? "complete",
    ...(item.finishReason ? { finishReason: item.finishReason } : {}),
    ...(item.providerErrorCode
      ? { providerErrorCode: item.providerErrorCode }
      : {}),
    ...(item.providerRawFinishReason
      ? { providerRawFinishReason: item.providerRawFinishReason }
      : {}),
    ...(typeof item.providerSawDone === "boolean"
      ? { providerSawDone: item.providerSawDone }
      : {}),
    ...(item.providerLastFrameType
      ? { providerLastFrameType: item.providerLastFrameType }
      : {}),
    ...(item.providerUpstreamRequestId
      ? { providerUpstreamRequestId: item.providerUpstreamRequestId }
      : {}),
    ...(selectedIndex >= 0 && swipes[selectedIndex]?.providerName
      ? { providerName: swipes[selectedIndex].providerName }
      : {}),
    ...(swipes.length > 0
      ? { swipes, activeSwipeIndex: Math.max(0, selectedIndex) }
      : {}),
  };
};

const worldbookSecondaryLogic = (
  value: string | undefined,
): WorldbookEntry["secondaryLogic"] =>
  value === "all" || value === "not-any" || value === "not-all" ? value : "any";

const worldbookInsertionPosition = (
  value: string | undefined,
): WorldbookEntry["insertionPosition"] => {
  switch (value) {
    case "before-card":
    case "after-card":
    case "author-note-top":
    case "author-note-bottom":
    case "at-depth":
    case "examples-top":
    case "examples-bottom":
    case "outlet":
      return value;
    default:
      return null;
  }
};

const worldbookInsertionRole = (
  value: string | undefined,
): WorldbookEntry["insertionRole"] =>
  value === "user" || value === "assistant" ? value : "system";

const normalizeWorldbookEntry = (entry: ApiWorldbookEntry): WorldbookEntry => {
  const primaryKeys = entry.primaryKeys ?? entry.keys ?? [];
  const secondaryKeys = entry.secondaryKeys ?? [];
  return {
    id: entry.id,
    title: entry.title ?? "未命名条目",
    keys: [...primaryKeys, ...secondaryKeys],
    primaryKeys,
    secondaryKeys,
    secondaryLogic: worldbookSecondaryLogic(entry.secondaryLogic),
    selective: entry.selective ?? secondaryKeys.length > 0,
    content: entry.content ?? "",
    enabled: entry.enabled ?? true,
    constant: entry.constant ?? false,
    caseSensitive: entry.caseSensitive ?? false,
    matchWholeWords: entry.matchWholeWords ?? false,
    useRegex: entry.useRegex ?? true,
    scanDepth: entry.scanDepth ?? null,
    recursion: entry.recursion ?? true,
    preventRecursion: entry.preventRecursion ?? false,
    excludeRecursion: entry.excludeRecursion ?? false,
    delayUntilRecursion: entry.delayUntilRecursion ?? false,
    insertionPosition: worldbookInsertionPosition(entry.insertionPosition),
    outletName: entry.outletName?.trim() || null,
    insertionDepth: entry.insertionDepth ?? null,
    insertionRole: worldbookInsertionRole(entry.insertionRole),
    order: entry.order ?? 0,
    priority: entry.priority ?? entry.order ?? 0,
    probability:
      typeof entry.probability === "number" &&
      Number.isFinite(entry.probability)
        ? Math.max(0, Math.min(100, entry.probability))
        : 100,
    agentEditable: entry.agentEditable ?? false,
    revision: entry.revision ?? 1,
  };
};

const normalizeWorldbook = (item: ApiWorldbook): Worldbook => ({
  id: item.id,
  name: item.name,
  description:
    item.description ?? (item.imported ? "从便携内容导入" : "本地世界书"),
  agentEditable: item.agentEditable,
  revision: item.revision,
  imported: item.imported ?? false,
  hitCount: 0,
  hits: [],
  entries: (item.entries ?? []).map(normalizeWorldbookEntry),
});

const presetModes: PromptPreset["mode"][] = [
  "chat-completion",
  "text-generation",
  "native",
];

const presetRoles: PromptPresetEntry["role"][] = [
  "system",
  "user",
  "assistant",
  "tool",
];

const presetMarkers: NonNullable<PromptPresetEntry["marker"]>[] = [
  "main",
  "world-before",
  "world-after",
  "persona-description",
  "character-description",
  "character-personality",
  "scenario",
  "examples",
  "history",
  "post-history",
  "custom",
];

const defaultPresetGeneration = (): GenerationSettings => ({
  temperature: 1,
  topP: 1,
  frequencyPenalty: 0,
  presencePenalty: 0,
  maxOutputTokens: 300,
  n: 1,
  stream: true,
  stop: [],
  samplerOrder: [],
  additional: {
    maxContextTokens: 32_768,
    maxContextUnlocked: false,
  },
});

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function normalizePresetGeneration(item: ApiPreset): GenerationSettings {
  const defaults = defaultPresetGeneration();
  const payload = item.payload ?? {};
  const raw = isRecord(payload.generation) ? payload.generation : payload;
  const additional = isRecord(raw.additional) ? raw.additional : {};
  const candidate = {
    ...defaults,
    temperature:
      numberValue(raw.temperature) ??
      numberValue(raw.temp) ??
      defaults.temperature,
    topP: numberValue(raw.topP) ?? numberValue(raw.top_p) ?? defaults.topP,
    topK: numberValue(raw.topK) ?? numberValue(raw.top_k),
    minP: numberValue(raw.minP) ?? numberValue(raw.min_p),
    typicalP:
      numberValue(raw.typicalP) ??
      numberValue(raw.typical_p) ??
      numberValue(raw.typical),
    topA: numberValue(raw.topA) ?? numberValue(raw.top_a),
    tfs: numberValue(raw.tfs) ?? numberValue(raw.tail_free_sampling),
    repetitionPenalty:
      numberValue(raw.repetitionPenalty) ?? numberValue(raw.repetition_penalty),
    repetitionPenaltyRange:
      numberValue(raw.repetitionPenaltyRange) ??
      numberValue(raw.repetition_penalty_range),
    frequencyPenalty:
      numberValue(raw.frequencyPenalty) ??
      numberValue(raw.frequency_penalty) ??
      numberValue(raw.freq_pen),
    presencePenalty:
      numberValue(raw.presencePenalty) ??
      numberValue(raw.presence_penalty) ??
      numberValue(raw.presence_pen),
    maxOutputTokens:
      numberValue(raw.maxOutputTokens) ??
      numberValue(raw.openai_max_tokens) ??
      numberValue(raw.max_length) ??
      defaults.maxOutputTokens,
    n: numberValue(raw.n) ?? defaults.n,
    seed: numberValue(raw.seed),
    mirostatMode:
      numberValue(raw.mirostatMode) ?? numberValue(raw.mirostat_mode),
    mirostatTau: numberValue(raw.mirostatTau) ?? numberValue(raw.mirostat_tau),
    mirostatEta: numberValue(raw.mirostatEta) ?? numberValue(raw.mirostat_eta),
    stream:
      booleanValue(raw.stream) ??
      booleanValue(raw.stream_openai) ??
      defaults.stream,
    stop: Array.isArray(raw.stop)
      ? raw.stop.filter((value): value is string => typeof value === "string")
      : defaults.stop,
    samplerOrder: Array.isArray(raw.samplerOrder)
      ? raw.samplerOrder
      : Array.isArray(raw.sampler_order)
        ? raw.sampler_order
        : defaults.samplerOrder,
    additional: {
      ...defaults.additional,
      ...additional,
      maxContextTokens:
        numberValue(additional.maxContextTokens) ??
        numberValue(raw.openai_max_context) ??
        defaults.additional.maxContextTokens,
      maxContextUnlocked:
        booleanValue(additional.maxContextUnlocked) ??
        booleanValue(raw.max_context_unlocked) ??
        defaults.additional.maxContextUnlocked,
    },
  };
  const parsed = GenerationSettingsSchema.safeParse(candidate);
  return parsed.success ? parsed.data : defaults;
}

const normalizePreset = (item: ApiPreset): PromptPreset => {
  const candidateMode = item.payload?.mode ?? item.kind;
  const mode = presetModes.includes(candidateMode as PromptPreset["mode"])
    ? (candidateMode as PromptPreset["mode"])
    : "native";
  const prompts = (item.payload?.prompts ?? []).flatMap(
    (prompt, index): PromptPresetEntry[] => {
      const id = prompt.id ?? prompt.identifier;
      if (!id) return [];
      const role = presetRoles.includes(
        prompt.role as PromptPresetEntry["role"],
      )
        ? (prompt.role as PromptPresetEntry["role"])
        : "system";
      const marker = presetMarkers.includes(
        prompt.marker as NonNullable<PromptPresetEntry["marker"]>,
      )
        ? (prompt.marker as NonNullable<PromptPresetEntry["marker"]>)
        : undefined;
      return [
        {
          id,
          name: prompt.name?.trim() || id,
          role,
          content: prompt.content ?? "",
          enabled: prompt.enabled ?? true,
          inserted: prompt.metadata?.promptOrderMember !== false,
          order: prompt.order ?? index,
          systemPrompt: prompt.systemPrompt ?? role === "system",
          dynamicMarker: prompt.metadata?.dynamicMarker === true,
          ...(marker ? { marker } : {}),
        },
      ];
    },
  );
  return {
    id: item.id,
    name: item.name,
    description:
      item.description ??
      `${prompts.filter((prompt) => prompt.enabled).length}/${prompts.length} 个条目已启用`,
    revision: item.revision ?? 0,
    mode,
    prompts,
    generation: normalizePresetGeneration(item),
  };
};

const regexPlacements: RegexPlacement[] = [1, 2, 3, 5, 6];
const regexScopeKinds: RegexScopeKind[] = ["global", "card", "preset"];
const regexDiagnosticSeverities: RegexDiagnostic["severity"][] = [
  "info",
  "warning",
  "error",
];

const normalizeRegexScript = (
  script: ApiRegexScript,
): RegexScriptDefinition => ({
  id: script.id,
  scriptName: script.scriptName,
  findRegex: script.findRegex,
  replaceString: script.replaceString,
  trimStrings: [...script.trimStrings],
  placement: script.placement.filter((placement): placement is RegexPlacement =>
    regexPlacements.includes(placement as RegexPlacement),
  ),
  disabled: script.disabled,
  markdownOnly: script.markdownOnly,
  promptOnly: script.promptOnly,
  runOnEdit: script.runOnEdit,
  substituteRegex:
    script.substituteRegex === 1 || script.substituteRegex === 2
      ? script.substituteRegex
      : 0,
  minDepth: script.minDepth,
  maxDepth: script.maxDepth,
});

const normalizeRegexDiagnostic = (
  diagnostic: ApiRegexDiagnostic,
): RegexDiagnostic => ({
  severity: regexDiagnosticSeverities.includes(
    diagnostic.severity as RegexDiagnostic["severity"],
  )
    ? (diagnostic.severity as RegexDiagnostic["severity"])
    : "warning",
  code: diagnostic.code,
  message: diagnostic.message,
  ...(diagnostic.path ? { path: diagnostic.path } : {}),
});

const normalizeRegexScope = (scope: ApiRegexScope): RegexScope => {
  if (!regexScopeKinds.includes(scope.scope as RegexScopeKind)) {
    throw new WorkspaceApiError("Regex scope has an invalid kind.", 502);
  }
  return {
    scope: scope.scope as RegexScopeKind,
    id: scope.id,
    name: scope.name,
    enabled: scope.enabled,
    revision: scope.revision,
    ownerRevision: scope.ownerRevision,
    scripts: scope.scripts.map(normalizeRegexScript),
    diagnostics: scope.diagnostics.map(normalizeRegexDiagnostic),
    updatedAt: scope.updatedAt,
  };
};

const agentRunStatuses: ApiAgentRun["status"][] = [
  "queued",
  "running",
  "waiting_confirmation",
  "completed",
  "failed",
  "cancelled",
];

const normalizeAgentRun = (value: unknown): AgentRun => {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.conversationId !== "string" ||
    typeof value.status !== "string" ||
    !agentRunStatuses.includes(value.status as ApiAgentRun["status"]) ||
    typeof value.objective !== "string" ||
    typeof value.updatedAt !== "string"
  ) {
    throw new WorkspaceApiError("Model tool run is invalid.", 502);
  }
  return {
    id: value.id,
    conversationId: value.conversationId,
    status: value.status as ApiAgentRun["status"],
    objective: value.objective,
    updatedAt: value.updatedAt,
  };
};

export async function loadConversationMessages(
  conversationId: string,
  presetId?: string,
): Promise<WorkspaceMessage[]> {
  return (await loadConversationMessagePage(conversationId, presetId)).items;
}

export async function loadConversationMessagePage(
  conversationId: string,
  presetId?: string,
  cursor?: string,
): Promise<{ items: WorkspaceMessage[]; nextCursor: string | null }> {
  const query = new URLSearchParams({ limit: "50" });
  if (presetId) query.set("presetId", presetId);
  if (cursor) query.set("cursor", cursor);
  const result = await request<ApiEnvelope<ApiPage<ApiMessage>>>(
    `/conversations/${encodeURIComponent(conversationId)}/messages?${query.toString()}`,
  );
  return {
    items: result.data.items
      .filter(
        (message) => message.role === "user" || message.role === "assistant",
      )
      .map(normalizeMessage),
    nextCursor: result.data.nextCursor,
  };
}

export async function loadTavernHelperContext(input: {
  conversationId: string;
  presetId?: string;
}): Promise<TavernHelperContext> {
  const query = new URLSearchParams({ conversationId: input.conversationId });
  if (input.presetId) query.set("presetId", input.presetId);
  const result = await request<ApiEnvelope<TavernHelperContext>>(
    `/compatibility/tavern-helper?${query.toString()}`,
  );
  return result.data;
}

export async function loadTavernHelperMessageHistory(
  conversationId: string,
): Promise<WorkspaceMessage[]> {
  const query = new URLSearchParams({ conversationId });
  const result = await request<ApiEnvelope<ApiMessage[]>>(
    `/compatibility/tavern-helper/history?${query.toString()}`,
  );
  return result.data
    .filter(
      (message) => message.role === "user" || message.role === "assistant",
    )
    .map(normalizeMessage);
}

export async function updateTavernHelperGrant(input: {
  scope: TavernHelperScope;
  id: string;
  granted: boolean;
}): Promise<void> {
  await request<ApiEnvelope<unknown>>("/compatibility/tavern-helper/grants", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function saveTavernHelperSettings(
  settings: TavernHelperSettings,
): Promise<TavernHelperSettings> {
  const result = await request<ApiEnvelope<{ settings: TavernHelperSettings }>>(
    "/compatibility/tavern-helper/settings",
    {
      method: "PUT",
      body: JSON.stringify(settings),
    },
  );
  return result.data.settings;
}

export async function saveTavernHelperScripts(input: {
  scope: TavernHelperScope;
  id: string;
  scripts: TavernHelperScript[];
}): Promise<void> {
  await request<ApiEnvelope<unknown>>("/compatibility/tavern-helper/scripts", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function saveTavernHelperState(input: {
  conversationId: string;
  presetId?: string;
  namespace: TavernHelperStateNamespace;
  variables: Record<string, unknown>;
  messageId?: string;
  sourceScope?: TavernHelperScope;
  sourceId?: string;
  scriptId?: string;
  extensionId?: string;
}): Promise<void> {
  await request<ApiEnvelope<unknown>>("/compatibility/tavern-helper/state", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function replaceTavernHelperPreset(input: {
  presetId: string;
  expectedRevision: number;
  preset: Record<string, unknown>;
}): Promise<{
  id: string;
  name: string;
  revision: number;
  value: Record<string, unknown>;
  workspacePreset: PromptPreset;
}> {
  const result = await request<
    ApiEnvelope<{
      id: string;
      name: string;
      revision: number;
      value: Record<string, unknown>;
      workspacePreset: ApiPreset;
    }>
  >("/compatibility/tavern-helper/preset", {
    method: "PUT",
    body: JSON.stringify(input),
  });
  return {
    ...result.data,
    workspacePreset: normalizePreset(result.data.workspacePreset),
  };
}

export async function generateWithTavernHelper(input: {
  conversationId: string;
  connectionId: string;
  presetId?: string;
  userInput?: string;
  settings?: Record<string, unknown>;
  messagesOverride?: PreparedPromptMessage[];
  injects?: Array<{
    role: "system" | "assistant" | "user";
    content: string;
    depth: number;
  }>;
}): Promise<string> {
  const result = await request<ApiEnvelope<{ content: string }>>(
    "/compatibility/tavern-helper/generate",
    {
      method: "POST",
      body: JSON.stringify(input),
      timeoutMs: 300_000,
    },
  );
  return result.data.content;
}

export type PreparedPromptMessage = {
  role: "system" | "assistant" | "user" | "tool";
  content: string;
};

export type PromptTemplateDirective = {
  id: string;
  worldbookId: string;
  title: string;
  content: string;
  enabled: boolean;
  order: number;
  probability?: number;
};

export async function preparePromptTemplate(input: {
  conversationId: string;
  connectionId: string;
  presetId?: string;
  historyBeforeMessageId?: string;
}): Promise<{
  enabled: boolean;
  messages: PreparedPromptMessage[];
  directives: PromptTemplateDirective[];
  templateCount: number;
}> {
  const result = await request<
    ApiEnvelope<{
      enabled: boolean;
      messages: PreparedPromptMessage[];
      directives: PromptTemplateDirective[];
      templateCount: number;
    }>
  >("/compatibility/prompt-template/prepare", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return result.data;
}

export async function countPreparedPromptTokens(input: {
  connectionId: string;
  messages: PreparedPromptMessage[];
}): Promise<{ total: number; messages: number[] }> {
  const result = await request<
    ApiEnvelope<{ total: number; messages: number[] }>
  >("/compatibility/prompt-template/token-count", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return result.data;
}

export async function loadWorldbooksFromApi(): Promise<Worldbook[]> {
  const result = await request<ApiEnvelope<ApiWorldbook[]>>("/worldbooks");
  return result.data.map(normalizeWorldbook);
}

export async function updateCardWorldbooks(
  card: RoleCard,
  worldbookIds: string[],
): Promise<{ card: RoleCard; conversations: ConversationSpace[] }> {
  const result = await request<
    ApiEnvelope<{ card: ApiCard; conversations: ApiConversation[] }>
  >(`/cards/${encodeURIComponent(card.id)}/worldbooks`, {
    method: "PUT",
    body: JSON.stringify({
      expectedWorldbookIds: card.worldbookIds,
      worldbookIds,
    }),
  });
  return {
    card: normalizeCard(result.data.card, result.data.conversations),
    conversations: result.data.conversations.map(normalizeConversation),
  };
}

export async function loadWorkspaceFromApi(
  selectedPresetId?: string,
  selectedConversationId?: string,
  selectedProviderId?: string,
): Promise<ApiBootstrap> {
  await request<ApiEnvelope<{ ok?: boolean }>>("/health", {
    timeoutMs: 1_600,
  });
  const [
    conversationResult,
    cardResult,
    personaResult,
    worldbookResult,
    presetResult,
    regexResult,
    providerResult,
    preferencesResult,
  ] = await Promise.all([
    request<ApiEnvelope<ApiPage<ApiConversation>>>("/conversations?limit=50"),
    request<ApiEnvelope<ApiCard[]>>("/cards"),
    request<ApiEnvelope<ApiPersona[]>>("/personas"),
    request<ApiEnvelope<ApiWorldbook[]>>("/worldbooks"),
    request<ApiEnvelope<ApiPreset[]>>("/presets"),
    request<ApiEnvelope<ApiRegexScope[]>>("/regex/scopes"),
    request<ApiEnvelope<ApiProviderConnection[]>>("/providers/connections"),
    request<ApiEnvelope<WorkspacePreferences>>(
      "/workspace/preferences/resolve",
      {
        method: "POST",
        body: JSON.stringify({
          ...(selectedPresetId ? { selectedPresetId } : {}),
          ...(selectedProviderId ? { selectedProviderId } : {}),
        }),
      },
    ),
  ]);

  const conversationItems = [...conversationResult.data.items];
  if (
    selectedConversationId &&
    !conversationItems.some(
      (conversation) => conversation.id === selectedConversationId,
    )
  ) {
    const selected = await request<ApiEnvelope<ApiConversation>>(
      `/conversations/${encodeURIComponent(selectedConversationId)}`,
    ).catch(() => undefined);
    if (selected !== undefined) conversationItems.push(selected.data);
  }
  const conversations = conversationItems.map(normalizeConversation);
  const activePresetId =
    presetResult.data.find(
      (preset) => preset.id === preferencesResult.data.selectedPresetId,
    )?.id ?? presetResult.data[0]?.id;
  const activeConversation =
    conversations.find(
      (conversation) => conversation.id === selectedConversationId,
    ) ?? conversations[0];
  const activeMessages =
    activeConversation === undefined
      ? undefined
      : await loadConversationMessagePage(
          activeConversation.id,
          activePresetId,
        );
  const participantMap = new Map<string, Participant>();
  cardResult.data.forEach((card) => {
    card.participants?.forEach((participant) => {
      if (!participantMap.has(participant.id)) {
        participantMap.set(
          participant.id,
          normalizeParticipant(participant, participantMap.size),
        );
      }
    });
  });
  conversationItems.forEach((conversation) => {
    conversation.participants?.forEach((participant) => {
      if (!participantMap.has(participant.id)) {
        participantMap.set(
          participant.id,
          normalizeParticipant(participant, participantMap.size),
        );
      }
    });
  });

  return {
    conversations,
    cards: cardResult.data.map((card) =>
      normalizeCard(card, conversationItems),
    ),
    personas: personaResult.data.map(normalizePersona),
    participants: [...participantMap.values()],
    messagesByConversation:
      activeConversation === undefined || activeMessages === undefined
        ? {}
        : { [activeConversation.id]: activeMessages.items },
    conversationNextCursor: conversationResult.data.nextCursor,
    messageNextCursorByConversation:
      activeConversation === undefined || activeMessages === undefined
        ? {}
        : { [activeConversation.id]: activeMessages.nextCursor },
    worldbooks: worldbookResult.data.map(normalizeWorldbook),
    presets: presetResult.data.map(normalizePreset),
    regexScopes: regexResult.data.map(normalizeRegexScope),
    providerConnections: providerResult.data,
    selectedPresetId: preferencesResult.data.selectedPresetId,
    selectedProviderId: preferencesResult.data.selectedProviderId,
  };
}

export async function saveWorkspacePreferences(
  input: Partial<WorkspacePreferences>,
): Promise<WorkspacePreferences> {
  const result = await request<ApiEnvelope<WorkspacePreferences>>(
    "/workspace/preferences",
    { method: "PATCH", body: JSON.stringify(input) },
  );
  return result.data;
}

export async function createMessage(
  conversationId: string,
  input: {
    content: string;
    parentMessageId?: string;
    role?: "user" | "assistant";
  },
): Promise<WorkspaceMessage> {
  const result = await request<ApiEnvelope<ApiMessage>>(
    `/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return normalizeMessage(result.data);
}

export async function createTavernHelperMessage(
  conversationId: string,
  input: {
    content: string;
    parentMessageId?: string;
    role: "user" | "assistant";
  },
): Promise<WorkspaceMessage> {
  const result = await request<ApiEnvelope<ApiMessage>>(
    `/compatibility/tavern-helper/conversations/${encodeURIComponent(
      conversationId,
    )}/messages`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return normalizeMessage(result.data);
}

export async function updateWorkspaceMessage(
  message: WorkspaceMessage,
  content: string,
): Promise<WorkspaceMessage> {
  const result = await request<ApiEnvelope<ApiMessage>>(
    `/messages/${encodeURIComponent(message.id)}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        content,
        expectedRevision: message.revision,
      }),
    },
  );
  return normalizeMessage(result.data);
}

export async function deleteWorkspaceMessage(
  messageId: string,
  expectedRevision: number,
): Promise<void> {
  await request<ApiEnvelope<unknown>>(
    `/messages/${encodeURIComponent(messageId)}`,
    {
      method: "DELETE",
      body: JSON.stringify({ expectedRevision }),
    },
  );
}

export async function createMessageSwipe(
  messageId: string,
  content: string,
  selected = true,
): Promise<void> {
  await request<ApiEnvelope<ApiSwipe>>(
    `/messages/${encodeURIComponent(messageId)}/swipes`,
    {
      method: "POST",
      body: JSON.stringify({ content, selected }),
    },
  );
}

export async function selectMessageSwipe(
  message: WorkspaceMessage,
  swipeId: string,
): Promise<void> {
  await request<ApiEnvelope<unknown>>(
    `/messages/${encodeURIComponent(message.id)}/swipes/${encodeURIComponent(
      swipeId,
    )}/select`,
    {
      method: "PATCH",
      body: JSON.stringify({ expectedMessageRevision: message.revision }),
    },
  );
}

type StreamEvent = {
  type: string;
  [key: string]: unknown;
};

const MAX_GENERATION_SSE_FRAME_BYTES = 1024 * 1024;
const MAX_GENERATION_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_GENERATION_EVENTS = 100_000;
const generationTextEncoder = new TextEncoder();

function parseStreamEvent(data: string): StreamEvent {
  const parsed: unknown = JSON.parse(data);
  if (!isRecord(parsed) || typeof parsed.type !== "string") {
    throw new WorkspaceApiError("Provider returned an invalid SSE event.", 502);
  }
  return parsed as StreamEvent;
}

function streamFrames(buffer: string): {
  frames: string[];
  remainder: string;
} {
  const normalized = buffer.replaceAll("\r\n", "\n");
  const parts = normalized.split("\n\n");
  return {
    frames: parts.slice(0, -1),
    remainder: parts.at(-1) ?? "",
  };
}

function dataFromFrame(frame: string): string | null {
  const lines = frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());
  return lines.length > 0 ? lines.join("\n") : null;
}

export async function generateConversation(
  input: {
    conversationId: string;
    connectionId: string;
    presetId?: string;
    messagesOverride?: PreparedPromptMessage[];
    injects?: Array<{
      role: "system" | "assistant" | "user";
      content: string;
      depth: number;
    }>;
    targetMessage?: { id: string; revision: number };
    signal?: AbortSignal;
  },
  callbacks: GenerationCallbacks = {},
): Promise<GenerationReceipt> {
  let response: Response;
  const generationPath = input.targetMessage
    ? `/api/messages/${encodeURIComponent(input.targetMessage.id)}/regenerate`
    : `/api/conversations/${encodeURIComponent(input.conversationId)}/generate`;
  try {
    response = await fetch(generationPath, {
      method: "POST",
      headers: {
        Accept: "text/event-stream",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        connectionId: input.connectionId,
        ...(input.presetId ? { presetId: input.presetId } : {}),
        ...(input.messagesOverride
          ? { messagesOverride: input.messagesOverride }
          : {}),
        ...(input.injects?.length ? { injects: input.injects } : {}),
        ...(input.targetMessage
          ? {
              expectedMessageRevision: input.targetMessage.revision,
            }
          : {}),
      }),
      ...(input.signal ? { signal: input.signal } : {}),
    });
  } catch (error) {
    if (input.signal?.aborted) throw new GenerationInterruptedError();
    throw error;
  }

  if (!response.ok) {
    throw await errorFromResponse(response, generationPath);
  }
  if (!response.body) {
    throw new WorkspaceApiError("Provider stream has no response body.", 502);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let generationId: string | null = null;
  let messageId: string | null = null;
  let revision: number | null = null;
  let content = "";
  let alternatives: string[] | undefined;
  let toolProposalReceived = false;
  let incomplete = false;
  let incompleteReason: "length" | "cancelled" | "error" | "limit" | undefined;
  let errorCode: string | undefined;
  let errorMessage: string | undefined;
  let providerRawFinishReason: string | undefined;
  let providerSawDone: boolean | undefined;
  let providerLastFrameType: string | undefined;
  let providerUpstreamRequestId: string | undefined;
  let pendingError: WorkspaceApiError | undefined;
  let eventCount = 0;
  let outputBytes = 0;

  const consume = (frame: string) => {
    const data = dataFromFrame(frame);
    if (!data) return;
    if (
      generationTextEncoder.encode(data).byteLength >
      MAX_GENERATION_SSE_FRAME_BYTES
    ) {
      throw new WorkspaceApiError(
        "Provider SSE frame exceeded its byte budget.",
        502,
        "GENERATION_SSE_FRAME_LIMIT",
      );
    }
    eventCount += 1;
    if (eventCount > MAX_GENERATION_EVENTS) {
      throw new WorkspaceApiError(
        "Provider event count exceeded its budget.",
        502,
        "GENERATION_EVENT_LIMIT",
      );
    }
    const event = parseStreamEvent(data);
    if (event.type === "generation-id") {
      if (typeof event.generationId !== "string") {
        throw new WorkspaceApiError("Generation id is missing.", 502);
      }
      generationId = event.generationId;
      callbacks.onGenerationId?.(event.generationId);
      return;
    }
    if (event.type === "text-delta") {
      if (typeof event.delta !== "string") return;
      outputBytes += generationTextEncoder.encode(event.delta).byteLength;
      if (outputBytes > MAX_GENERATION_OUTPUT_BYTES) {
        throw new WorkspaceApiError(
          "Provider output exceeded its byte budget.",
          502,
          "GENERATION_OUTPUT_LIMIT",
        );
      }
      content += event.delta;
      callbacks.onTextDelta?.(event.delta);
      return;
    }
    if (event.type === "reasoning-delta") {
      if (typeof event.delta === "string") {
        callbacks.onReasoningDelta?.(event.delta);
      }
      return;
    }
    if (event.type === "message-persisted") {
      if (
        typeof event.messageId === "string" &&
        typeof event.revision === "number"
      ) {
        messageId = event.messageId;
        revision = event.revision;
        alternatives = Array.isArray(event.alternatives)
          ? event.alternatives.filter(
              (value): value is string => typeof value === "string",
            )
          : undefined;
        incomplete = event.incomplete === true;
        incompleteReason =
          event.reason === "length" ||
          event.reason === "cancelled" ||
          event.reason === "error" ||
          event.reason === "limit"
            ? event.reason
            : undefined;
        errorCode =
          typeof event.errorCode === "string" ? event.errorCode : undefined;
        errorMessage =
          typeof event.errorMessage === "string"
            ? event.errorMessage
            : undefined;
        providerRawFinishReason =
          typeof event.providerRawFinishReason === "string"
            ? event.providerRawFinishReason
            : undefined;
        providerSawDone =
          typeof event.providerSawDone === "boolean"
            ? event.providerSawDone
            : undefined;
        providerLastFrameType =
          typeof event.providerLastFrameType === "string"
            ? event.providerLastFrameType
            : undefined;
        providerUpstreamRequestId =
          typeof event.providerUpstreamRequestId === "string"
            ? event.providerUpstreamRequestId
            : undefined;
      }
      return;
    }
    if (event.type === "tool-proposal") {
      const payload = isRecord(event.payload) ? event.payload : event;
      const run = normalizeAgentRun(payload.run);
      const toolCall = normalizeConversationToolCall(payload.toolCall);
      toolProposalReceived = true;
      callbacks.onToolProposal?.({
        run,
        toolCall,
        text: typeof payload.text === "string" ? payload.text : run.objective,
      });
      return;
    }
    if (event.type === "tool-result") {
      callbacks.onToolResult?.(isRecord(event.payload) ? event.payload : event);
      return;
    }
    if (event.type === "error") {
      pendingError = new WorkspaceApiError(
        typeof event.message === "string"
          ? event.message
          : "Provider generation failed.",
        502,
        typeof event.code === "string" ? event.code : undefined,
      );
      return;
    }
    if (event.type === "generation-limit") {
      incomplete = true;
      incompleteReason = "limit";
      return;
    }
    if (event.type === "finish" && event.reason === "cancelled") {
      incomplete = true;
      incompleteReason = "cancelled";
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parsed = streamFrames(buffer);
      buffer = parsed.remainder;
      if (
        generationTextEncoder.encode(buffer).byteLength >
        MAX_GENERATION_SSE_FRAME_BYTES
      ) {
        throw new WorkspaceApiError(
          "Provider SSE buffer exceeded its byte budget.",
          502,
          "GENERATION_SSE_BUFFER_LIMIT",
        );
      }
      parsed.frames.forEach(consume);
    }
    buffer += decoder.decode();
    if (buffer.trim()) consume(buffer);
  } catch (error) {
    if (input.signal?.aborted) throw new GenerationInterruptedError();
    throw error;
  } finally {
    reader.releaseLock();
  }

  if (!generationId) {
    throw new WorkspaceApiError("Generation id is missing.", 502);
  }
  if (!messageId || revision === null || !content) {
    if (toolProposalReceived) {
      return { generationId, toolProposalOnly: true };
    }
    if (pendingError) throw pendingError;
    if (incompleteReason === "cancelled") {
      throw new GenerationInterruptedError();
    }
    throw new WorkspaceApiError(
      "Generation ended before a complete message was persisted.",
      502,
    );
  }
  return {
    generationId,
    messageId,
    revision,
    content,
    ...(alternatives === undefined ? {} : { alternatives }),
    ...(incomplete ? { incomplete: true } : {}),
    ...(incompleteReason ? { reason: incompleteReason } : {}),
    ...(errorCode ? { errorCode } : {}),
    ...(errorMessage ? { errorMessage } : {}),
    ...(providerRawFinishReason ? { providerRawFinishReason } : {}),
    ...(providerSawDone === undefined ? {} : { providerSawDone }),
    ...(providerLastFrameType ? { providerLastFrameType } : {}),
    ...(providerUpstreamRequestId ? { providerUpstreamRequestId } : {}),
  };
}

export async function abortGeneration(generationId: string): Promise<void> {
  await request<ApiEnvelope<{ id: string; stopped: boolean }>>(
    `/generations/${encodeURIComponent(generationId)}/abort`,
    { method: "POST" },
  );
}

export async function loadConversationGeneration(
  conversationId: string,
): Promise<BackgroundGeneration | null> {
  const result = await request<ApiEnvelope<BackgroundGeneration | null>>(
    `/conversations/${encodeURIComponent(conversationId)}/generation`,
  );
  return result.data;
}

export async function acknowledgeGeneration(
  generationId: string,
): Promise<void> {
  await request<ApiEnvelope<{ id: string; acknowledged: boolean }>>(
    `/generations/${encodeURIComponent(generationId)}/acknowledge`,
    { method: "POST" },
  );
}

export async function saveProviderConnection(
  input: ProviderConnectionInput,
  current?: ProviderConnection,
): Promise<ProviderConnection> {
  const result = await request<ApiEnvelope<ApiProviderConnection>>(
    current
      ? `/providers/connections/${encodeURIComponent(current.id)}`
      : "/providers/connections",
    {
      method: current ? "PATCH" : "POST",
      body: JSON.stringify({
        ...input,
        ...(current ? { expectedRevision: current.revision } : {}),
      }),
      timeoutMs: 10_000,
    },
  );
  return result.data;
}

export async function exportProviderConnection(
  connectionId: string,
  includeApiKey: boolean,
): Promise<PortableProviderConnection> {
  const result = await request<ApiEnvelope<PortableProviderConnection>>(
    `/providers/connections/${encodeURIComponent(connectionId)}/export`,
    {
      method: "POST",
      body: JSON.stringify({ includeApiKey }),
      timeoutMs: 10_000,
    },
  );
  return result.data;
}

export async function loadProviderModels(
  connectionId: string,
): Promise<ProviderModel[]> {
  const result = await request<ApiEnvelope<ApiProviderModel[]>>(
    `/providers/connections/${encodeURIComponent(connectionId)}/models`,
    { timeoutMs: 20_000 },
  );
  const seen = new Set<string>();
  const models: ProviderModel[] = [];
  for (const item of result.data) {
    const id = item.id.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    models.push({ id, name: item.name?.trim() || id });
  }
  return models;
}

export async function updateWorldbookEntryPermission(
  worldbook: Worldbook,
  entry: WorldbookEntry,
  agentEditable: boolean,
): Promise<{
  worldbook: Worldbook;
  entry: WorldbookEntry;
}> {
  const result = await request<
    ApiEnvelope<{
      worldbook: ApiWorldbook;
    }>
  >(
    `/worldbooks/${encodeURIComponent(
      worldbook.id,
    )}/entries/${encodeURIComponent(entry.id)}/permission`,
    {
      method: "PATCH",
      body: JSON.stringify({
        expectedWorldbookRevision: worldbook.revision,
        expectedEntryRevision: entry.revision,
        agentEditable,
      }),
    },
  );
  const updatedWorldbook = normalizeWorldbook(result.data.worldbook);
  const updatedEntry = updatedWorldbook.entries.find(
    (candidate) => candidate.id === entry.id,
  );
  if (!updatedEntry) {
    throw new WorkspaceApiError("Updated worldbook was not returned.", 502);
  }
  return {
    worldbook: updatedWorldbook,
    entry: updatedEntry,
  };
}

export async function updateWorldbookEntry(
  worldbook: Worldbook,
  entry: WorldbookEntry,
  patch: WorldbookEntryUpdate,
): Promise<Worldbook> {
  const result = await request<
    ApiEnvelope<{
      worldbook: ApiWorldbook;
    }>
  >(
    `/worldbooks/${encodeURIComponent(
      worldbook.id,
    )}/entries/${encodeURIComponent(entry.id)}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        expectedWorldbookRevision: worldbook.revision,
        expectedEntryRevision: entry.revision,
        ...patch,
      }),
    },
  );
  return normalizeWorldbook(result.data.worldbook);
}

export async function updatePresetPrompt(input: {
  presetId: string;
  promptId: string;
  expectedRevision: number;
  enabled?: boolean;
  inserted?: boolean;
  content?: string;
  role?: PromptPresetEntry["role"];
}): Promise<PromptPreset> {
  if (
    input.enabled === undefined &&
    input.inserted === undefined &&
    input.content === undefined &&
    input.role === undefined
  ) {
    throw new TypeError(
      "Preset prompt update requires enabled, inserted, content or role.",
    );
  }
  const result = await request<ApiEnvelope<ApiPreset>>(
    `/presets/${encodeURIComponent(input.presetId)}/prompts/${encodeURIComponent(
      input.promptId,
    )}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        expectedRevision: input.expectedRevision,
        ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
        ...(input.inserted === undefined ? {} : { inserted: input.inserted }),
        ...(input.content === undefined ? {} : { content: input.content }),
        ...(input.role === undefined ? {} : { role: input.role }),
      }),
    },
  );
  return normalizePreset(result.data);
}

export async function updatePresetGeneration(input: {
  presetId: string;
  expectedRevision: number;
  generation: Partial<GenerationSettings>;
}): Promise<PromptPreset> {
  if (Object.keys(input.generation).length === 0) {
    throw new TypeError("Preset generation update requires a setting.");
  }
  const result = await request<ApiEnvelope<ApiPreset>>(
    `/presets/${encodeURIComponent(input.presetId)}/generation`,
    {
      method: "PATCH",
      body: JSON.stringify({
        expectedRevision: input.expectedRevision,
        generation: input.generation,
      }),
    },
  );
  return normalizePreset(result.data);
}

export async function reorderPresetPrompts(input: {
  presetId: string;
  expectedRevision: number;
  promptIds: string[];
}): Promise<PromptPreset> {
  if (
    input.promptIds.length === 0 ||
    new Set(input.promptIds).size !== input.promptIds.length
  ) {
    throw new TypeError(
      "Preset prompt order requires unique inserted prompt identifiers.",
    );
  }
  const result = await request<ApiEnvelope<ApiPreset>>(
    `/presets/${encodeURIComponent(input.presetId)}/prompt-order`,
    {
      method: "PATCH",
      body: JSON.stringify({
        expectedRevision: input.expectedRevision,
        promptIds: input.promptIds,
      }),
    },
  );
  return normalizePreset(result.data);
}

async function loadAgentRun(runId: string): Promise<AgentRun> {
  const result = await request<
    ApiEnvelope<{ run: ApiAgentRun; toolCalls: unknown[]; audit: unknown[] }>
  >(`/agent/runs/${encodeURIComponent(runId)}`);
  return normalizeAgentRun(result.data.run);
}

export type AgentToolRecoveryResult = {
  run: AgentRun;
  proposal: AgentProposal | null;
  text: string;
};

function normalizeConversationToolCall(value: unknown): ApiAgentToolCall {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.runId !== "string" ||
    typeof value.idempotencyKey !== "string" ||
    typeof value.toolName !== "string" ||
    !isRecord(value.arguments) ||
    typeof value.status !== "string"
  ) {
    throw new WorkspaceApiError(
      "Conversation model tool returned an invalid tool call.",
      502,
    );
  }
  const statuses: ApiAgentToolCall["status"][] = [
    "proposed",
    "awaiting_confirmation",
    "running",
    "succeeded",
    "rejected",
    "cancelled",
    "failed",
  ];
  if (!statuses.includes(value.status as ApiAgentToolCall["status"])) {
    throw new WorkspaceApiError(
      "Conversation model tool returned an unknown tool-call status.",
      502,
    );
  }
  return {
    id: value.id,
    runId: value.runId,
    idempotencyKey: value.idempotencyKey,
    toolName: value.toolName,
    arguments: value.arguments,
    status: value.status as ApiAgentToolCall["status"],
  };
}

function worldbookProposalFromCall(
  state: WorkspaceState,
  run: AgentRun,
  call: ApiAgentToolCall,
  objective: string,
): AgentProposal {
  const worldbookId = call.arguments.worldbookId;
  const beforeRevision = call.arguments.expectedRevision;
  if (
    typeof worldbookId !== "string" ||
    typeof beforeRevision !== "number" ||
    !Number.isInteger(beforeRevision)
  ) {
    throw new WorkspaceApiError(
      "Model tool returned an invalid worldbook proposal.",
      502,
    );
  }
  const worldbook = state.worldbooks.find(
    (candidate) => candidate.id === worldbookId,
  );
  if (!worldbook) {
    throw new WorkspaceApiError(
      "Model tool proposal targets a worldbook outside the loaded workspace.",
      409,
    );
  }
  const shared = {
    id: call.id,
    idempotencyKey: call.idempotencyKey,
    runId: run.id,
    targetKind: "worldbook" as const,
    worldbookId,
    worldbookName: worldbook.name,
    toolArguments: call.arguments,
    rationale: objective,
    beforeRevision,
    afterRevision: null,
    auditId: null,
  } as const;

  if (call.toolName === "worldbook.entry.create") {
    const entry = call.arguments.entry;
    if (!isRecord(entry) || typeof entry.content !== "string") {
      throw new WorkspaceApiError(
        "Model tool returned an invalid create-entry proposal.",
        502,
      );
    }
    const entryTitle =
      typeof entry.title === "string" && entry.title.trim()
        ? entry.title.trim()
        : "新世界书条目";
    const keys = Array.isArray(entry.keys)
      ? entry.keys.filter((key): key is string => typeof key === "string")
      : [];
    return {
      ...shared,
      toolName: call.toolName,
      title: entryTitle,
      diffLines: [
        `+ 标题：${entryTitle}`,
        ...(keys.length > 0 ? [`+ 关键词：${keys.join("、")}`] : []),
        `+ 内容：${entry.content}`,
      ],
      status: "awaiting_confirmation",
    };
  }

  if (
    call.toolName !== "worldbook.entry.update" &&
    call.toolName !== "worldbook.entry.delete"
  ) {
    throw new WorkspaceApiError(
      "Model tool proposal is not supported by this workspace.",
      422,
    );
  }
  const entryId = call.arguments.entryId;
  const beforeEntryRevision = call.arguments.expectedEntryRevision;
  if (
    typeof entryId !== "string" ||
    typeof beforeEntryRevision !== "number" ||
    !Number.isInteger(beforeEntryRevision)
  ) {
    throw new WorkspaceApiError(
      "Model tool returned an invalid target entry revision.",
      502,
    );
  }
  const targetEntry = worldbook.entries.find((entry) => entry.id === entryId);
  if (!targetEntry) {
    throw new WorkspaceApiError(
      "Model tool proposal targets an entry outside the loaded worldbook.",
      409,
    );
  }
  const target = {
    targetEntryId: targetEntry.id,
    targetEntryTitle: targetEntry.title,
    beforeEntryRevision,
    status: targetEntry.agentEditable
      ? ("awaiting_confirmation" as const)
      : ("blocked" as const),
  };

  if (call.toolName === "worldbook.entry.delete") {
    return {
      ...shared,
      ...target,
      toolName: call.toolName,
      title: `删除条目：${targetEntry.title}`,
      diffLines: [
        `- 标题：${targetEntry.title}`,
        `- 条目 ID：${targetEntry.id}`,
        `- 内容：${targetEntry.content}`,
      ],
    };
  }

  const patch = call.arguments.patch;
  if (!isRecord(patch)) {
    throw new WorkspaceApiError(
      "Model tool returned an invalid update-entry patch.",
      502,
    );
  }
  const diffLines: string[] = [];
  if (typeof patch.title === "string") {
    diffLines.push(`~ 标题：${targetEntry.title} → ${patch.title}`);
  }
  if (Array.isArray(patch.keys)) {
    const keys = patch.keys.filter(
      (key): key is string => typeof key === "string",
    );
    diffLines.push(`~ 关键词：${keys.join("、") || "无"}`);
  }
  if (typeof patch.content === "string") {
    diffLines.push(`~ 内容：${patch.content}`);
  }
  if (typeof patch.enabled === "boolean") {
    diffLines.push(`~ 状态：${patch.enabled ? "启用" : "停用"}`);
  }
  if (typeof patch.position === "number") {
    diffLines.push(`~ 位置：${String(patch.position)}`);
  }
  if (isRecord(patch.metadata)) {
    diffLines.push("~ 元数据：更新");
  }
  return {
    ...shared,
    ...target,
    toolName: call.toolName,
    title: `更新条目：${targetEntry.title}`,
    diffLines:
      diffLines.length > 0 ? diffLines : [`~ 条目 ${targetEntry.id}：更新字段`],
  };
}

function artifactProposalFromCall(
  state: WorkspaceState,
  run: AgentRun,
  call: ApiAgentToolCall,
  objective: string,
): AgentProposal {
  const currentCardId = state.conversations.find(
    (conversation) => conversation.id === state.selectedConversationId,
  )?.cardId;
  const participantName = (participantId: unknown): string | undefined => {
    if (typeof participantId !== "string") return undefined;
    return state.participants.find(
      (participant) =>
        participant.id === participantId &&
        (participant.sourceCardId === undefined ||
          participant.sourceCardId === currentCardId),
    )?.name;
  };
  const shared = {
    id: call.id,
    idempotencyKey: call.idempotencyKey,
    runId: run.id,
    targetKind: "artifact" as const,
    toolArguments: call.arguments,
    rationale: objective,
    afterRevision: null,
    auditId: null,
    status: "awaiting_confirmation" as const,
  };

  if (
    call.toolName === "chat.summary.create" ||
    call.toolName === "chat.summary.update"
  ) {
    const content = call.arguments.content;
    if (
      call.toolName === "chat.summary.create" &&
      (typeof content !== "string" || content.trim().length === 0)
    ) {
      throw new WorkspaceApiError(
        "Model tool returned an invalid chat summary proposal.",
        502,
      );
    }
    const title =
      typeof call.arguments.title === "string" && call.arguments.title.trim()
        ? call.arguments.title.trim()
        : "聊天摘要";
    const artifactId = call.arguments.artifactId;
    const expectedRevision = call.arguments.expectedRevision;
    if (
      call.toolName === "chat.summary.update" &&
      (typeof artifactId !== "string" ||
        typeof expectedRevision !== "number" ||
        !Number.isInteger(expectedRevision))
    ) {
      throw new WorkspaceApiError(
        "Model tool returned an invalid summary revision.",
        502,
      );
    }
    const from = call.arguments.sourceFromMessageId;
    const to = call.arguments.sourceToMessageId;
    return {
      ...shared,
      artifactKind: "chat_summary",
      ...(typeof artifactId === "string" ? { artifactId } : {}),
      targetLabel: "当前对话摘要",
      toolName: call.toolName,
      title,
      beforeRevision:
        typeof expectedRevision === "number" &&
        Number.isInteger(expectedRevision)
          ? expectedRevision
          : 0,
      diffLines: [
        `${call.toolName.endsWith("create") ? "+" : "~"} 标题：${title}`,
        ...(typeof from === "string" && typeof to === "string"
          ? [`~ 来源消息：${from} → ${to}`]
          : []),
        ...(typeof content === "string"
          ? [`${call.toolName.endsWith("create") ? "+" : "~"} 内容：${content}`]
          : []),
      ],
    };
  }

  if (
    call.toolName === "character.profile.create" ||
    call.toolName === "character.profile.update"
  ) {
    const participantId = call.arguments.participantId;
    const name = participantName(participantId);
    if (!name || typeof participantId !== "string") {
      throw new WorkspaceApiError(
        "Model tool proposal targets a participant outside the current card.",
        409,
      );
    }
    const content = call.arguments.content;
    if (
      call.toolName === "character.profile.create" &&
      (typeof content !== "string" || content.trim().length === 0)
    ) {
      throw new WorkspaceApiError(
        "Model tool returned an invalid participant profile proposal.",
        502,
      );
    }
    const artifactId = call.arguments.artifactId;
    const expectedRevision = call.arguments.expectedRevision;
    if (
      call.toolName === "character.profile.update" &&
      (typeof artifactId !== "string" ||
        typeof expectedRevision !== "number" ||
        !Number.isInteger(expectedRevision))
    ) {
      throw new WorkspaceApiError(
        "Model tool returned an invalid profile revision.",
        502,
      );
    }
    const title =
      typeof call.arguments.title === "string" && call.arguments.title.trim()
        ? call.arguments.title.trim()
        : `${name}的参与者档案`;
    const diffLines = [
      `${call.toolName.endsWith("create") ? "+" : "~"} 参与者：${name}`,
      `${call.toolName.endsWith("create") ? "+" : "~"} 标题：${title}`,
      ...(typeof content === "string" ? [`~ 内容：${content}`] : []),
      ...(Array.isArray(call.arguments.traits)
        ? [
            `~ 特征：${call.arguments.traits.filter((item): item is string => typeof item === "string").join("、") || "无"}`,
          ]
        : []),
    ];
    return {
      ...shared,
      artifactKind: "character_profile",
      ...(typeof artifactId === "string" ? { artifactId } : {}),
      participantId,
      targetLabel: name,
      toolName: call.toolName,
      title,
      beforeRevision:
        typeof expectedRevision === "number" &&
        Number.isInteger(expectedRevision)
          ? expectedRevision
          : 0,
      diffLines,
    };
  }

  throw new WorkspaceApiError(
    "Conversation model tool proposal is not supported by this workspace.",
    422,
  );
}

export function proposalFromGenerationToolEvent(
  state: WorkspaceState,
  event: GenerationToolProposal,
): AgentProposal | null {
  if (
    ![
      "worldbook.entry.create",
      "worldbook.entry.update",
      "worldbook.entry.delete",
      "chat.summary.create",
      "chat.summary.update",
      "character.profile.create",
      "character.profile.update",
    ].includes(event.toolCall.toolName) ||
    !["proposed", "awaiting_confirmation"].includes(event.toolCall.status)
  ) {
    return null;
  }
  return event.toolCall.toolName.startsWith("worldbook.")
    ? worldbookProposalFromCall(
        state,
        event.run,
        event.toolCall,
        event.text || event.run.objective,
      )
    : artifactProposalFromCall(
        state,
        event.run,
        event.toolCall,
        event.text || event.run.objective,
      );
}

export async function loadPendingAgentToolProposal(
  state: WorkspaceState,
): Promise<AgentToolRecoveryResult | null> {
  const listed = await request<ApiEnvelope<ApiAgentRun[]>>(
    `/agent/runs?conversationId=${encodeURIComponent(
      state.selectedConversationId,
    )}`,
  );
  if (!Array.isArray(listed.data)) {
    throw new WorkspaceApiError("Agent run list is invalid.", 502);
  }
  const candidates = listed.data
    .filter((run) => run.status === "waiting_confirmation")
    .slice(0, 5);
  const snapshots = await Promise.all(
    candidates.map((run) =>
      request<
        ApiEnvelope<{
          run: ApiAgentRun;
          toolCalls: unknown[];
          audit: unknown[];
        }>
      >(`/agent/runs/${encodeURIComponent(run.id)}`),
    ),
  );
  for (const snapshot of snapshots) {
    if (!Array.isArray(snapshot.data.toolCalls)) continue;
    const run = normalizeAgentRun(snapshot.data.run);
    const call = snapshot.data.toolCalls
      .map(normalizeConversationToolCall)
      .find(
        (candidate) =>
          [
            "worldbook.entry.create",
            "worldbook.entry.update",
            "worldbook.entry.delete",
            "chat.summary.create",
            "chat.summary.update",
            "character.profile.create",
            "character.profile.update",
          ].includes(candidate.toolName) &&
          candidate.status === "awaiting_confirmation",
      );
    if (call) {
      return {
        run,
        proposal: call.toolName.startsWith("worldbook.")
          ? worldbookProposalFromCall(state, run, call, run.objective)
          : artifactProposalFromCall(state, run, call, run.objective),
        text: "",
      };
    }
  }
  return null;
}

async function executeAgentTool(
  runId: string,
  input: {
    idempotencyKey: string;
    toolName: string;
    arguments: Record<string, unknown>;
  },
): Promise<AgentToolResult> {
  const result = await request<ApiEnvelope<AgentToolResult>>(
    `/agent/runs/${encodeURIComponent(runId)}/tools`,
    {
      method: "POST",
      body: JSON.stringify({ ...input, confirmed: true }),
    },
  );
  return result.data;
}

export async function confirmAgentProposal(
  state: WorkspaceState,
  callbacks: { onRun?: (run: AgentRun) => void } = {},
): Promise<{
  auditId: string | null;
  revision: number | null;
  worldbooks?: Worldbook[];
  run: AgentRun;
}> {
  const proposal = state.agentProposal;
  if (!proposal) {
    throw new WorkspaceApiError(
      "No Agent proposal is awaiting confirmation.",
      409,
    );
  }
  const run = await loadAgentRun(proposal.runId);
  if (run.conversationId !== state.selectedConversationId) {
    throw new WorkspaceApiError(
      "The model tool proposal belongs to a different conversation.",
      409,
    );
  }
  callbacks.onRun?.(run);
  const result = await executeAgentTool(run.id, {
    idempotencyKey: proposal.idempotencyKey,
    toolName: proposal.toolName,
    arguments: proposal.toolArguments,
  });
  const [worldbooks, refreshedRun] = await Promise.all([
    proposal.targetKind === "worldbook" ? loadWorldbooksFromApi() : [],
    loadAgentRun(run.id),
  ]);
  const artifactRevision =
    result.result &&
    isRecord(result.result.artifact) &&
    typeof result.result.artifact.revision === "number"
      ? result.result.artifact.revision
      : null;
  return {
    auditId: result.result?.auditId ?? null,
    revision: result.result?.revision ?? artifactRevision,
    ...(proposal.targetKind === "worldbook" ? { worldbooks } : {}),
    run: refreshedRun,
  };
}

export async function undoAgentProposal(
  state: WorkspaceState,
): Promise<{ worldbooks?: Worldbook[]; run: AgentRun }> {
  const proposal = state.agentProposal;
  if (!proposal) {
    throw new WorkspaceApiError("No applied Agent change can be undone.", 409);
  }
  const { auditId } = proposal;
  if (!auditId) {
    throw new WorkspaceApiError("No applied Agent change can be undone.", 409);
  }
  await executeAgentTool(proposal.runId, {
    idempotencyKey: `${proposal.id}:undo:${auditId}`,
    toolName: "agent.change.undo",
    arguments: { auditId },
  });
  const [worldbooks, run] = await Promise.all([
    proposal.targetKind === "worldbook" ? loadWorldbooksFromApi() : [],
    loadAgentRun(proposal.runId),
  ]);
  return {
    ...(proposal.targetKind === "worldbook" ? { worldbooks } : {}),
    run,
  };
}

export async function cancelAgentRun(runId: string): Promise<AgentRun> {
  const result = await request<ApiEnvelope<ApiAgentRun>>(
    `/agent/runs/${encodeURIComponent(runId)}/cancel`,
    { method: "POST" },
  );
  return normalizeAgentRun(result.data);
}

const maxJsonSniffBytes = 32 * 1024 * 1024;

function portableFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  return lastDot < 0 ? "" : filename.slice(lastDot + 1).toLowerCase();
}

function hasConversationImportShape(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(
      (item) =>
        isRecord(item) &&
        (typeof item.mes === "string" ||
          typeof item.is_user === "boolean" ||
          Array.isArray(item.swipes)),
    );
  }
  return isRecord(value) && Array.isArray(value.messages);
}

function hasCardImportShape(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const data = isRecord(value.data) ? value.data : value;
  return (
    (typeof value.spec === "string" && value.spec.startsWith("chara_card_")) ||
    (typeof data.name === "string" &&
      (typeof data.description === "string" ||
        typeof data.first_mes === "string" ||
        Array.isArray(data.participants)))
  );
}

function hasPresetImportShape(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.spec === "sillytavern_n_prompt_preset") return true;
  if (
    Array.isArray(value.prompts) &&
    (Array.isArray(value.prompt_order) ||
      typeof value.temperature === "number" ||
      typeof value.top_p === "number" ||
      typeof value.openai_max_context === "number")
  ) {
    return true;
  }
  return (
    (value.type === "full" || value.type === "character") &&
    isRecord(value.data) &&
    Array.isArray(value.data.prompts)
  );
}

function hasWorldbookImportShape(value: unknown): boolean {
  if (!isRecord(value) || !("entries" in value)) return false;
  const entries = value.entries;
  const samples = Array.isArray(entries)
    ? entries.slice(0, 4)
    : isRecord(entries)
      ? Object.values(entries).slice(0, 4)
      : [];
  return samples.some(
    (entry) =>
      isRecord(entry) &&
      (typeof entry.content === "string" ||
        Array.isArray(entry.key) ||
        Array.isArray(entry.keys)),
  );
}

async function detectPortableImportKind(
  file: File,
): Promise<PortableImportKind> {
  const extension = portableFileExtension(file.name);
  if (extension === "png" || extension === "charx" || extension === "zip") {
    return "card";
  }
  if (extension === "jsonl") return "conversation";
  if (extension !== "json" || file.size > maxJsonSniffBytes) return "card";

  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text()) as unknown;
  } catch {
    return "card";
  }
  if (hasConversationImportShape(parsed)) return "conversation";
  if (hasPresetImportShape(parsed)) return "preset";
  if (hasCardImportShape(parsed)) return "card";
  if (hasWorldbookImportShape(parsed)) return "worldbook";
  return "card";
}

export async function importPortableFile(
  file: File,
  options: {
    conversationCardId?: string;
  } = {},
): Promise<PortableImportResult> {
  const kind = await detectPortableImportKind(file);
  if (kind === "preset") {
    const source = JSON.parse(await file.text()) as unknown;
    const response = await request<ApiEnvelope<unknown>>("/presets/import", {
      method: "POST",
      body: JSON.stringify({
        source,
        filename: file.name,
        conflictStrategy: "duplicate",
      }),
      timeoutMs: 20_000,
    });
    return { kind, result: response.data };
  }
  if (kind === "conversation" && !options.conversationCardId) {
    throw new WorkspaceApiError(
      "请先选择角色卡，再把聊天记录导入到该卡下。",
      400,
      "CONVERSATION_CARD_REQUIRED",
    );
  }
  const formData = new FormData();
  formData.set("file", file);
  if (kind === "conversation") {
    formData.set("cardId", options.conversationCardId!);
  }
  const route =
    kind === "worldbook"
      ? "/worldbooks/import"
      : kind === "conversation"
        ? "/conversations/import"
        : "/cards/import";
  const response = await request<ApiEnvelope<unknown>>(route, {
    method: "POST",
    body: formData,
    timeoutMs: 20_000,
  });
  return { kind, result: response.data };
}

export async function replaceRoleCard(input: {
  card: RoleCard;
  file: File;
  preserveWorldbooks: boolean;
}): Promise<{
  card: RoleCard;
  conversations: ConversationSpace[];
  regexScriptCount: number;
  tavernHelperScriptCount: number;
}> {
  const formData = new FormData();
  formData.set("file", input.file);
  formData.set("expectedRevision", String(input.card.revision));
  formData.set("preserveWorldbooks", String(input.preserveWorldbooks));
  const response = await request<
    ApiEnvelope<{
      card: ApiCard;
      conversations: ApiConversation[];
      regexScriptCount: number;
      tavernHelperScriptCount: number;
    }>
  >(`/cards/${encodeURIComponent(input.card.id)}/replace`, {
    method: "POST",
    body: formData,
    timeoutMs: 20_000,
  });
  return {
    card: normalizeCard(response.data.card, response.data.conversations),
    conversations: response.data.conversations.map(normalizeConversation),
    regexScriptCount: response.data.regexScriptCount,
    tavernHelperScriptCount: response.data.tavernHelperScriptCount,
  };
}

export async function exportConversationArchive(
  conversationId: string,
): Promise<ConversationArchive> {
  const response = await request<ApiEnvelope<ConversationArchive>>(
    `/conversations/${encodeURIComponent(conversationId)}/export`,
    { timeoutMs: 20_000 },
  );
  return response.data;
}

export async function updateRegexGrant(input: {
  scope: RegexGrantScope;
  id: string;
  granted: boolean;
}): Promise<void> {
  await request("/compatibility/regex-grants", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function saveRegexScope(input: {
  scope: RegexScope;
  enabled?: boolean;
  scripts?: RegexScriptDefinition[];
}): Promise<RegexScope> {
  const result = await request<ApiEnvelope<ApiRegexScope>>(
    `/regex/scopes/${encodeURIComponent(input.scope.scope)}/${encodeURIComponent(input.scope.id)}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        expectedRevision: input.scope.revision,
        ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
        ...(input.scripts === undefined ? {} : { scripts: input.scripts }),
      }),
    },
  );
  return normalizeRegexScope(result.data);
}

export async function createConversationSpace(input: {
  title: string;
  cardId: string;
}): Promise<ConversationSpace> {
  const result = await request<ApiEnvelope<ApiConversation>>("/conversations", {
    method: "POST",
    body: JSON.stringify({
      title: input.title,
      cardId: input.cardId,
    }),
  });
  return normalizeConversation(result.data);
}

export async function deleteConversationSpace(input: {
  conversationId: string;
  expectedRevision: number;
}): Promise<void> {
  await request<ApiEnvelope<unknown>>(
    `/conversations/${encodeURIComponent(input.conversationId)}`,
    {
      method: "DELETE",
      body: JSON.stringify({ expectedRevision: input.expectedRevision }),
    },
  );
}

export type PersonaInput = {
  name: string;
  description: string;
  title: string;
  isDefault: boolean;
};

export async function createPersona(input: PersonaInput): Promise<Persona> {
  const result = await request<ApiEnvelope<ApiPersona>>("/personas", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return normalizePersona(result.data);
}

export async function updatePersona(
  persona: Persona,
  patch: Partial<PersonaInput>,
): Promise<Persona> {
  const result = await request<ApiEnvelope<ApiPersona>>(
    `/personas/${encodeURIComponent(persona.id)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ expectedRevision: persona.revision, ...patch }),
    },
  );
  return normalizePersona(result.data);
}

export async function deletePersona(input: {
  personaId: string;
  expectedRevision: number;
}): Promise<void> {
  await request<ApiEnvelope<unknown>>(
    `/personas/${encodeURIComponent(input.personaId)}`,
    {
      method: "DELETE",
      body: JSON.stringify({ expectedRevision: input.expectedRevision }),
    },
  );
}

export async function setConversationPersona(
  conversation: ConversationSpace,
  personaId: string | null,
): Promise<ConversationSpace> {
  const result = await request<ApiEnvelope<ApiConversation>>(
    `/conversations/${encodeURIComponent(conversation.id)}/persona`,
    {
      method: "PATCH",
      body: JSON.stringify({
        personaId,
        expectedRevision: conversation.revision ?? 1,
      }),
    },
  );
  return normalizeConversation(result.data);
}

export async function deleteRoleCard(input: {
  cardId: string;
  expectedRevision: number;
}): Promise<void> {
  await request(`/cards/${encodeURIComponent(input.cardId)}`, {
    method: "DELETE",
    body: JSON.stringify({ expectedRevision: input.expectedRevision }),
  });
}

export async function deletePromptPreset(input: {
  presetId: string;
  expectedRevision: number;
}): Promise<void> {
  await request(`/presets/${encodeURIComponent(input.presetId)}`, {
    method: "DELETE",
    body: JSON.stringify({ expectedRevision: input.expectedRevision }),
  });
}

export async function deleteWorldbook(input: {
  worldbookId: string;
  expectedRevision: number;
}): Promise<void> {
  await request(`/worldbooks/${encodeURIComponent(input.worldbookId)}`, {
    method: "DELETE",
    body: JSON.stringify({ expectedRevision: input.expectedRevision }),
  });
}

type ApiLegacyCapabilityGrant = {
  plugin_id?: unknown;
  pluginId?: unknown;
  actor?: unknown;
  capability?: unknown;
  granted?: unknown;
  granted_by?: unknown;
  grantedBy?: unknown;
  updated_at?: unknown;
  updatedAt?: unknown;
};

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new WorkspaceApiError(
      `Legacy host returned an invalid ${field}.`,
      502,
    );
  }
  return value;
}

function normalizeLegacyGrant(
  item: ApiLegacyCapabilityGrant,
): LegacyCapabilityGrant {
  const actor = requireString(item.actor, "grant actor");
  if (actor !== "legacy-plugin" && actor !== "embedded-script") {
    throw new WorkspaceApiError(
      "Legacy host returned an invalid grant actor.",
      502,
    );
  }
  return {
    pluginId: requireString(item.pluginId ?? item.plugin_id, "grant plugin id"),
    actor,
    capability: requireString(item.capability, "grant capability"),
    granted: item.granted === true || item.granted === 1,
    grantedBy: requireString(item.grantedBy ?? item.granted_by, "grant owner"),
    updatedAt: requireString(
      item.updatedAt ?? item.updated_at,
      "grant timestamp",
    ),
  };
}

export async function loadLegacyGrants(): Promise<LegacyCapabilityGrant[]> {
  const result =
    await request<ApiEnvelope<ApiLegacyCapabilityGrant[]>>("/legacy/grants");
  return result.data.map(normalizeLegacyGrant);
}

export async function updateLegacyGrant(input: {
  pluginId: string;
  actor?: LegacyActor;
  capability: string;
  granted: boolean;
}): Promise<LegacyCapabilityGrant> {
  const result = await request<ApiEnvelope<ApiLegacyCapabilityGrant>>(
    "/legacy/grants",
    {
      method: "PUT",
      body: JSON.stringify({
        ...input,
        actor: input.actor ?? "legacy-plugin",
      }),
    },
  );
  return normalizeLegacyGrant(result.data);
}

function normalizeLegacyRpcResponse(
  value: unknown,
  expectedId: string,
): LegacyRpcResponse {
  try {
    return parseLegacyRpcResponse(value, expectedId);
  } catch {
    throw new WorkspaceApiError(
      "Legacy broker returned an invalid RPC response.",
      502,
    );
  }
}

export async function callLegacyRpc(
  input: LegacyRpcRequest,
): Promise<LegacyRpcResponse> {
  const response = await fetch("/api/legacy/rpc", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  let body: unknown;
  try {
    body = (await response.json()) as unknown;
  } catch {
    throw new WorkspaceApiError(
      "Legacy broker returned a non-JSON RPC response.",
      response.status || 502,
    );
  }
  return normalizeLegacyRpcResponse(body, input.id);
}

function normalizeLegacyHostPlugin(value: unknown): LegacyHostPluginStatus {
  if (!isRecord(value)) {
    throw new WorkspaceApiError(
      "Legacy host returned an invalid plugin status.",
      502,
    );
  }
  const id = requireString(value.id, "plugin id");
  const profile = getLegacyPluginProfile(id);
  const capabilities = Array.isArray(value.capabilities)
    ? value.capabilities.filter(
        (capability): capability is string => typeof capability === "string",
      )
    : [];
  if (
    !profile ||
    value.uiId !== profile.uiId ||
    value.name !== profile.displayName ||
    value.version !== profile.manifestVersion ||
    value.repository !== profile.repository ||
    value.commit !== profile.commit ||
    value.executionOwner !== profile.executionOwner ||
    value.legacyRealmRole !== profile.legacyRealmRole ||
    value.description !== profile.nativeDescription ||
    capabilities.length !== profile.capabilities.length ||
    capabilities.some(
      (capability, index) => capability !== profile.capabilities[index],
    )
  ) {
    throw new WorkspaceApiError(
      "Legacy host plugin metadata does not match its pinned profile.",
      502,
    );
  }
  return {
    id,
    uiId: profile.uiId,
    name: profile.displayName,
    version: profile.manifestVersion,
    repository: profile.repository,
    commit: profile.commit,
    executionOwner: profile.executionOwner,
    legacyRealmRole: profile.legacyRealmRole,
    capabilities: [...profile.capabilities],
    description: profile.nativeDescription,
    installed: value.installed === true,
    verified: value.verified === true,
    enabled: value.enabled === true,
    ...(typeof value.reason === "string" ? { reason: value.reason } : {}),
  };
}

export async function installLegacyPlugin(
  pluginId: string,
  repository: string,
  origin = LEGACY_REALM_ORIGIN,
): Promise<LegacyPluginInstallResult> {
  const base = origin.replace(/\/+$/u, "");
  const path = `${base}/plugins/${encodeURIComponent(pluginId)}/install`;
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 300_000);
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ repository }),
      signal: controller.signal,
    });
    if (!response.ok) throw await errorFromResponse(response, path);
    const value: unknown = await response.json();
    if (
      !isRecord(value) ||
      (value.outcome !== "installed" &&
        value.outcome !== "already-installed") ||
      !isRecord(value.plugin)
    ) {
      throw new WorkspaceApiError(
        "Legacy host returned an invalid installation result.",
        502,
      );
    }
    const receipt = isRecord(value.receipt)
      ? {
          pluginId: requireString(value.receipt.pluginId, "receipt plugin id"),
          repository: requireString(
            value.receipt.repository,
            "receipt repository",
          ),
          commit: requireString(value.receipt.commit, "receipt commit"),
          installedAt: requireString(
            value.receipt.installedAt,
            "receipt timestamp",
          ),
        }
      : undefined;
    return {
      outcome: value.outcome,
      plugin: normalizeLegacyHostPlugin(value.plugin),
      ...(receipt === undefined ? {} : { receipt }),
    };
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

export async function setLegacyPluginEnabled(
  pluginId: string,
  enabled: boolean,
  origin = LEGACY_REALM_ORIGIN,
): Promise<LegacyHostPluginStatus> {
  const base = origin.replace(/\/+$/u, "");
  const requestPath = `${base}/plugins/${encodeURIComponent(pluginId)}/enabled`;
  const response = await fetch(requestPath, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ enabled }),
  });
  if (!response.ok) throw await errorFromResponse(response, requestPath);
  const value: unknown = await response.json();
  if (!isRecord(value) || !isRecord(value.plugin)) {
    throw new WorkspaceApiError(
      "Legacy host returned an invalid enablement result.",
      502,
    );
  }
  return normalizeLegacyHostPlugin(value.plugin);
}

export async function loadLegacyHostHealth(
  origin = LEGACY_REALM_ORIGIN,
): Promise<LegacyHostHealth> {
  const path = `${origin.replace(/\/+$/u, "")}/health`;
  const response = await fetch(path, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw await errorFromResponse(response, path);
  const value: unknown = await response.json();
  if (
    !isRecord(value) ||
    typeof value.ok !== "boolean" ||
    typeof value.service !== "string" ||
    typeof value.safeMode !== "boolean" ||
    !Array.isArray(value.plugins)
  ) {
    throw new WorkspaceApiError(
      "Legacy host returned an invalid health response.",
      502,
    );
  }
  return {
    ok: value.ok,
    service: value.service,
    safeMode: value.safeMode,
    plugins: value.plugins.map(normalizeLegacyHostPlugin),
  };
}
