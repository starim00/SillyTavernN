import type {
  GenerationSettings,
  JsonObject,
  JsonValue,
  ProviderCapabilities,
  ProviderEvent,
} from "@stn/contracts";

export interface ProviderConnection {
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly model: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  readonly nativeToolCalling?: boolean;
}

export interface ProviderMessageToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: JsonObject;
}

export interface ProviderMessage {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: string;
  readonly name?: string;
  readonly toolCallId?: string;
  readonly toolCalls?: readonly ProviderMessageToolCall[];
  /**
   * Opaque Responses output items retained only while a tool continuation is
   * being assembled. The server must never persist or expose these items.
   */
  readonly providerContextItems?: readonly JsonObject[];
}

export interface ProviderTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonObject;
}

export interface ProviderRequest {
  readonly requestId: string;
  readonly messages: readonly ProviderMessage[];
  readonly textPrompt?: string;
  readonly settings?: Partial<GenerationSettings>;
  readonly tools?: readonly ProviderTool[];
  readonly metadata?: JsonObject;
}

/** Internal provider-only event; intentionally not part of the public SSE contract. */
export interface ProviderContextEvent {
  readonly type: "provider-context";
  readonly requestId: string;
  readonly sequence: number;
  readonly items: readonly JsonObject[];
}

/**
 * Internal terminal metadata used to persist the upstream stream outcome.
 * It intentionally contains no request headers, credentials, or response
 * content.
 */
export interface ProviderDiagnosticsEvent {
  readonly type: "provider-diagnostics";
  readonly requestId: string;
  readonly sequence: number;
  readonly rawFinishReason?: string;
  readonly sawDone: boolean;
  readonly lastFrameType?: string;
  readonly upstreamRequestId?: string;
}

export type ProviderStreamEvent =
  ProviderEvent | ProviderContextEvent | ProviderDiagnosticsEvent;

export interface ConnectionTestResult {
  readonly ok: boolean;
  readonly model?: string;
  readonly latencyMs: number;
  readonly error?: string;
}

export interface ProviderModel {
  readonly id: string;
  readonly name: string;
  readonly metadata: JsonObject;
}

export interface ModelProvider {
  readonly id: string;
  capabilities(): ProviderCapabilities;
  testConnection(signal?: AbortSignal): Promise<ConnectionTestResult>;
  listModels(signal?: AbortSignal): Promise<readonly ProviderModel[]>;
  countTokens(input: string | readonly ProviderMessage[]): Promise<number>;
  generate(
    request: ProviderRequest,
    signal?: AbortSignal,
  ): AsyncIterable<ProviderStreamEvent>;
}

export interface FakeProviderScript {
  readonly text?: string;
  readonly chunks?: readonly string[];
  readonly toolCalls?: readonly {
    id: string;
    name: string;
    arguments: JsonObject;
  }[];
  readonly delayMs?: number;
  readonly error?: {
    code: string;
    message: string;
    retryable?: boolean;
    detail?: JsonValue;
  };
}

export class ProviderConfigurationError extends Error {
  readonly code = "PROVIDER_CONFIGURATION_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "ProviderConfigurationError";
  }
}

export class ProviderToolCapabilityError extends Error {
  readonly code = "PROVIDER_TOOL_CALLING_NOT_SUPPORTED";

  constructor(providerId: string) {
    super(
      `Provider '${providerId}' does not support native structured tool calling.`,
    );
    this.name = "ProviderToolCapabilityError";
  }
}

export function assertToolCallingSupported(provider: ModelProvider): void {
  if (!provider.capabilities().nativeToolCalling) {
    throw new ProviderToolCapabilityError(provider.id);
  }
}
