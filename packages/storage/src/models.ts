export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type CardKind = "character" | "ensemble" | "scenario" | "world";
export type ChatMessageRole = "user" | "assistant";
export type InternalMessageRole = "system" | "tool";
export type MessageRole = ChatMessageRole | InternalMessageRole;
export type GenerationStatus = "complete" | "partial" | "cancelled" | "error";
export type GenerationFinishReason =
  "stop" | "length" | "tool-calls" | "cancelled" | "limit" | "provider-error";
export type BindingScope =
  "global" | "card" | "conversation" | "participant" | "persona";
export type AgentRunStatus =
  | "queued"
  | "running"
  | "waiting_confirmation"
  | "completed"
  | "failed"
  | "cancelled";
export type ToolCallStatus =
  | "proposed"
  | "running"
  | "awaiting_confirmation"
  | "succeeded"
  | "rejected"
  | "cancelled"
  | "failed";
export type ActorKind = "human" | "agent" | "legacy_script" | "system";

export interface Card {
  id: string;
  kind: CardKind;
  name: string;
  description: string;
  revision: number;
  legacyPayload: JsonObject;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderConnection {
  id: string;
  name: string;
  protocol:
    "openai-compatible" | "openai-responses" | "text-completion" | "fake";
  baseUrl: string;
  model: string;
  headers: Record<string, string>;
  apiKeyRef: string | null;
  nativeToolCalling: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface Participant {
  id: string;
  cardId: string | null;
  name: string;
  role: string;
  profile: JsonObject;
  legacyPayload: JsonObject;
  createdAt: string;
  updatedAt: string;
}

export interface Conversation {
  id: string;
  title: string;
  cardId: string;
  personaId: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface Persona {
  id: string;
  name: string;
  description: string;
  title: string;
  isDefault: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  parentMessageId: string | null;
  role: MessageRole;
  participantId: string | null;
  content: string;
  generationStatus: GenerationStatus;
  finishReason: GenerationFinishReason | null;
  providerErrorCode: string | null;
  providerRawFinishReason: string | null;
  providerSawDone: boolean | null;
  providerLastFrameType: string | null;
  providerUpstreamRequestId: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface Swipe {
  id: string;
  messageId: string;
  position: number;
  content: string;
  reasoningText: string | null;
  selected: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface Worldbook {
  id: string;
  name: string;
  /** @deprecated Agent write authorization is evaluated per worldbook entry. */
  agentEditable: boolean;
  revision: number;
  agentWriteMode?: "confirm" | "auto-create-update";
  permissionUpdatedBy?: string | null;
  permissionUpdatedAt?: string | null;
  legacyPayload: JsonObject;
  createdAt: string;
  updatedAt: string;
}

export interface WorldbookEntry {
  id: string;
  worldbookId: string;
  legacyUid: number | null;
  keys: string[];
  content: string;
  enabled: boolean;
  position: number;
  agentEditable: boolean;
  permissionUpdatedBy?: string | null;
  permissionUpdatedAt?: string | null;
  revision: number;
  metadata: JsonObject;
  createdAt: string;
  updatedAt: string;
}

export interface WorldbookBinding {
  id: string;
  worldbookId: string;
  scopeType: BindingScope;
  scopeId: string | null;
  createdAt: string;
}

export interface Preset {
  id: string;
  name: string;
  kind: string;
  payload: JsonObject;
  legacyPayload: JsonObject;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export type ArtifactKind = string;

export interface Artifact {
  id: string;
  kind: ArtifactKind;
  scopeType: string;
  scopeId: string;
  title: string;
  content: string;
  metadata: JsonObject;
  sourceFromMessageId?: string | null;
  sourceToMessageId?: string | null;
  stale?: boolean;
  lockedFields?: string[];
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRun {
  id: string;
  conversationId: string;
  status: AgentRunStatus;
  requestedBy: string;
  provider: string;
  model: string;
  objective: string;
  maxSteps: number;
  currentStep: number;
  toolCallCount: number;
  writeCallCount: number;
  idempotencyKey: string;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ToolCall {
  id: string;
  runId: string;
  idempotencyKey: string;
  toolName: string;
  arguments: JsonObject;
  status: ToolCallStatus;
  effect: "read" | "write" | "destructive";
  result: JsonValue | null;
  error: JsonObject | null;
  requiresConfirmation: boolean;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuditRecord {
  id: string;
  runId: string | null;
  toolCallId: string | null;
  actorKind: ActorKind;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  before: JsonValue | null;
  after: JsonValue | null;
  inversePatch: JsonObject;
  undoneAt: string | null;
  undoAuditId: string | null;
  createdAt: string;
}

export interface ExtensionSetting {
  extensionId: string;
  key: string;
  value: JsonValue;
  updatedAt: string;
}

export interface AgentActor {
  kind: "agent";
  id: string;
  requestedBy: string;
}
