import type { GenerationSettings } from "@stn/contracts";

export type ParticipantKind = "person" | "character" | "narrator" | "system";

export type Participant = {
  id: string;
  name: string;
  kind: ParticipantKind;
  accent: "blue" | "coral" | "mint" | "slate" | "violet";
  sourceCardId?: string;
};

export type ConversationSpace = {
  id: string;
  title: string;
  subtitle: string;
  cardId: string;
  personaId?: string | null;
  revision?: number;
  worldbookIds: string[];
  updatedLabel: string;
  unreadCount: number;
  pinned: boolean;
};

export type Persona = {
  id: string;
  name: string;
  description: string;
  title: string;
  isDefault: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type RoleCard = {
  id: string;
  name: string;
  description: string;
  revision: number;
  conversationCount: number;
  worldbookIds: string[];
  imageUrl?: string;
};

export type MessageRole = "user" | "assistant";

export type WorkspaceMessage = {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  displayContent?: string;
  appliedRegexScriptIds?: string[];
  createdLabel: string;
  revision: number;
  state?: "complete" | "partial" | "cancelled" | "error";
  finishReason?:
    "stop" | "length" | "tool-calls" | "cancelled" | "limit" | "provider-error";
  providerErrorCode?: string;
  providerRawFinishReason?: string;
  providerSawDone?: boolean;
  providerLastFrameType?: string;
  providerUpstreamRequestId?: string;
  swipes?: MessageSwipe[];
  activeSwipeIndex?: number;
};

export type MessageSwipe = {
  id: string;
  content: string;
};

export type ProviderProtocol =
  "openai-compatible" | "openai-responses" | "text-completion" | "fake";

export type ProviderConnection = {
  id: string;
  name: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  model: string;
  headers: Record<string, string>;
  hasApiKey: boolean;
  nativeToolCalling: boolean;
  revision: number;
};

export type ProviderConnectionInput = {
  name: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  model: string;
  headers: Record<string, string>;
  nativeToolCalling: boolean;
  apiKey?: string;
};

export type GenerationMode = "send" | "continue" | "regenerate";

export type GenerationState = {
  status: "idle" | "streaming" | "stopping";
  mode: GenerationMode | null;
  conversationId: string | null;
  generationId: string | null;
  targetMessageId: string | null;
  preview: string;
};

export type WorldbookHit = {
  id: string;
  title: string;
  keys: string[];
  excerpt: string;
  score: number;
};

export type WorldbookEntry = {
  id: string;
  title: string;
  keys: string[];
  primaryKeys: string[];
  secondaryKeys: string[];
  secondaryLogic: "any" | "all" | "not-any" | "not-all";
  selective: boolean;
  content: string;
  enabled: boolean;
  constant: boolean;
  caseSensitive: boolean;
  matchWholeWords: boolean;
  useRegex: boolean;
  scanDepth: number | null;
  recursion: boolean;
  preventRecursion: boolean;
  excludeRecursion: boolean;
  delayUntilRecursion: boolean;
  insertionPosition:
    | "before-card"
    | "after-card"
    | "author-note-top"
    | "author-note-bottom"
    | "at-depth"
    | "examples-top"
    | "examples-bottom"
    | "outlet"
    | null;
  outletName: string | null;
  insertionDepth: number | null;
  insertionRole: "system" | "user" | "assistant";
  order: number;
  priority: number;
  probability: number;
  agentEditable: boolean;
  revision: number;
};

export type WorldbookEntryUpdate = Pick<
  WorldbookEntry,
  | "title"
  | "primaryKeys"
  | "secondaryKeys"
  | "secondaryLogic"
  | "selective"
  | "content"
  | "enabled"
  | "constant"
  | "caseSensitive"
  | "matchWholeWords"
  | "useRegex"
  | "scanDepth"
  | "recursion"
  | "preventRecursion"
  | "excludeRecursion"
  | "delayUntilRecursion"
  | "insertionPosition"
  | "outletName"
  | "insertionDepth"
  | "insertionRole"
  | "order"
  | "priority"
> & {
  probability?: number;
};

export type Worldbook = {
  id: string;
  name: string;
  description: string;
  agentEditable: boolean;
  revision: number;
  imported: boolean;
  hitCount: number;
  hits: WorldbookHit[];
  entries: WorldbookEntry[];
};

export type PromptPreset = {
  id: string;
  name: string;
  description: string;
  revision: number;
  mode: "chat-completion" | "text-generation" | "native";
  prompts: PromptPresetEntry[];
  generation: GenerationSettings;
};

export type PromptPresetEntry = {
  id: string;
  name: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  enabled: boolean;
  inserted?: boolean;
  order: number;
  systemPrompt: boolean;
  dynamicMarker: boolean;
  marker?:
    | "main"
    | "world-before"
    | "world-after"
    | "persona-description"
    | "character-description"
    | "character-personality"
    | "scenario"
    | "examples"
    | "history"
    | "post-history"
    | "custom";
};

export type RegexScopeKind = "global" | "card" | "preset";
export type RegexPlacement = 1 | 2 | 3 | 5 | 6;
export type RegexSubstituteMode = 0 | 1 | 2;

export type RegexScriptDefinition = {
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
};

export type RegexDiagnostic = {
  severity: "info" | "warning" | "error";
  code: string;
  message: string;
  path?: string;
};

export type RegexScope = {
  scope: RegexScopeKind;
  id: string;
  name: string;
  enabled: boolean;
  revision: number;
  ownerRevision: number | null;
  scripts: RegexScriptDefinition[];
  diagnostics: RegexDiagnostic[];
  updatedAt: string | null;
};

export type PluginStatus = "enabled" | "disabled" | "attention";

export type LegacyPlugin = {
  id: string;
  name: string;
  version: string;
  repository: string;
  commit: string;
  status: PluginStatus;
  trust: "trusted" | "untrusted";
  host: "legacy";
  description: string;
};

export type AgentProposalStatus =
  "blocked" | "awaiting_confirmation" | "applied" | "undone";

export type AgentProposalTargetKind = "worldbook" | "artifact";
export type AgentProposalArtifactKind = "chat_summary" | "character_profile";

export type AgentProposal = {
  id: string;
  idempotencyKey: string;
  runId: string;
  targetKind: AgentProposalTargetKind;
  worldbookId?: string;
  worldbookName?: string;
  artifactKind?: AgentProposalArtifactKind;
  artifactId?: string;
  participantId?: string;
  targetLabel?: string;
  toolName:
    | "worldbook.entry.create"
    | "worldbook.entry.update"
    | "worldbook.entry.delete"
    | "chat.summary.create"
    | "chat.summary.update"
    | "character.profile.create"
    | "character.profile.update";
  toolArguments: Record<string, unknown>;
  title: string;
  rationale: string;
  beforeRevision: number;
  targetEntryId?: string;
  targetEntryTitle?: string;
  beforeEntryRevision?: number;
  afterRevision: number | null;
  diffLines: string[];
  status: AgentProposalStatus;
  auditId: string | null;
};

export type AgentRun = {
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

export type PanelId = "preset" | "regex" | "worldbooks";

export type ModalState =
  | { kind: "closed" }
  | { kind: "import" }
  | { kind: "plugins" }
  | { kind: "extensions" }
  | { kind: "regex" }
  | { kind: "worldbooks" }
  | { kind: "agent_proposal" }
  | { kind: "providers" }
  | { kind: "personas" }
  | { kind: "library" }
  | { kind: "create_conversation"; cardId: string }
  | { kind: "permission"; worldbookId: string; entryId: string };

export type ToastState = {
  id: number;
  tone: "success" | "info" | "warning";
  message: string;
} | null;

export type WorkspaceAvailability = "loading" | "api" | "error" | "demo";

export type WorkspaceState = {
  availability: WorkspaceAvailability;
  bootstrapError: string | null;
  conversations: ConversationSpace[];
  cards: RoleCard[];
  personas: Persona[];
  participants: Participant[];
  messagesByConversation: Record<string, WorkspaceMessage[]>;
  conversationNextCursor: string | null;
  messageNextCursorByConversation: Record<string, string | null>;
  messageHistoryLoading: Record<string, boolean>;
  worldbooks: Worldbook[];
  presets: PromptPreset[];
  regexScopes: RegexScope[];
  providerConnections: ProviderConnection[];
  selectedProviderId: string;
  plugins: LegacyPlugin[];
  agentProposal: AgentProposal | null;
  agentRun: AgentRun | null;
  generation: GenerationState;
  selectedCardId: string;
  selectedConversationId: string;
  selectedPresetId: string;
  expandedPanels: Record<PanelId, boolean>;
  draftByConversation: Record<string, string>;
  navOpen: boolean;
  modal: ModalState;
  toast: ToastState;
};

export type PersistedWorkspaceState = Pick<
  WorkspaceState,
  | "selectedCardId"
  | "selectedConversationId"
  | "selectedPresetId"
  | "selectedProviderId"
  | "draftByConversation"
>;

export type ApiEnvelope<T> = {
  data: T;
};
