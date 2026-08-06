import type {
  JsonObject,
  ProviderCapabilities,
  ProviderEvent,
} from "@stn/contracts";

import type {
  ConnectionTestResult,
  ModelProvider,
  ProviderConnection,
  ProviderModel,
  ProviderRequest,
} from "./types.js";
import {
  asJsonObject,
  createRequestSignal,
  estimateTokens,
  joinUrl,
  readSseJson,
  responseError,
  safeHeaders,
} from "./utils.js";

type Fetch = typeof globalThis.fetch;

export class TextCompletionProvider implements ModelProvider {
  readonly id = "text-completion";

  constructor(
    private readonly connection: ProviderConnection,
    private readonly fetchImpl: Fetch = globalThis.fetch,
  ) {}

  capabilities(): ProviderCapabilities {
    return {
      streaming: true,
      nativeToolCalling: false,
      reasoning: false,
      vision: false,
    };
  }

  async testConnection(signal?: AbortSignal): Promise<ConnectionTestResult> {
    const started = Date.now();
    try {
      const response = await this.fetchImpl(
        joinUrl(this.connection.baseUrl, "/health"),
        {
          headers: safeHeaders(this.connection),
          ...(signal === undefined ? {} : { signal }),
        },
      );
      return {
        ok: response.ok,
        model: this.connection.model,
        latencyMs: Date.now() - started,
        ...(response.ok
          ? {}
          : { error: `${response.status} ${response.statusText}` }),
      };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async listModels(): Promise<readonly ProviderModel[]> {
    return [
      {
        id: this.connection.model,
        name: this.connection.model,
        metadata: { protocol: "text-completion" },
      },
    ];
  }

  async countTokens(
    input: string | readonly { content: string }[],
  ): Promise<number> {
    return estimateTokens(
      typeof input === "string"
        ? input
        : input.map((message) => message.content).join("\n"),
    );
  }

  async *generate(
    request: ProviderRequest,
    signal?: AbortSignal,
  ): AsyncIterable<ProviderEvent> {
    let sequence = 0;
    const emit = <T extends Omit<ProviderEvent, "requestId" | "sequence">>(
      value: T,
    ): ProviderEvent =>
      ({
        ...value,
        requestId: request.requestId,
        sequence: sequence++,
      }) as unknown as ProviderEvent;
    yield emit({
      type: "start",
      model: this.connection.model,
      capabilities: this.capabilities(),
    });
    if (request.tools && request.tools.length > 0) {
      yield emit({
        type: "error",
        code: "PROVIDER_TOOL_CALLING_NOT_SUPPORTED",
        message: "Text completion providers cannot run structured tools.",
        retryable: false,
      });
      return;
    }

    const requestSignal = createRequestSignal(
      signal,
      this.connection.timeoutMs ?? 60_000,
    );
    const prompt =
      request.textPrompt ??
      request.messages
        .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
        .join("\n");
    const settings = request.settings ?? {};
    const payload: JsonObject = {
      model: this.connection.model,
      prompt,
      stream: true,
    };
    if (settings.maxOutputTokens !== undefined)
      payload.max_tokens = settings.maxOutputTokens;
    if (settings.temperature !== undefined)
      payload.temperature = settings.temperature;
    if (settings.topP !== undefined) payload.top_p = settings.topP;
    if (settings.topK !== undefined) payload.top_k = settings.topK;
    if (settings.minP !== undefined) payload.min_p = settings.minP;
    if (settings.repetitionPenalty !== undefined) {
      payload.repetition_penalty = settings.repetitionPenalty;
    }
    if (settings.stop && settings.stop.length > 0) payload.stop = settings.stop;

    try {
      const response = await this.fetchImpl(
        joinUrl(this.connection.baseUrl, "/completions"),
        {
          method: "POST",
          headers: safeHeaders(this.connection),
          body: JSON.stringify(payload),
          signal: requestSignal.signal,
        },
      );
      if (!response.ok) throw await responseError(response);
      for await (const frame of readSseJson(response)) {
        if (frame === "[DONE]") break;
        const choices = Array.isArray(frame.choices) ? frame.choices : [];
        const choice = asJsonObject(choices[0]);
        const delta = asJsonObject(choice?.delta);
        const text =
          typeof choice?.text === "string"
            ? choice.text
            : typeof delta?.content === "string"
              ? delta.content
              : "";
        if (text) yield emit({ type: "text-delta", delta: text });
      }
      yield emit({ type: "finish", reason: "stop" });
    } catch (error) {
      if (requestSignal.signal.aborted) {
        yield emit({ type: "finish", reason: "cancelled" });
      } else {
        yield emit({
          type: "error",
          code: "PROVIDER_REQUEST_FAILED",
          message: error instanceof Error ? error.message : String(error),
          retryable: true,
        });
      }
    } finally {
      requestSignal.cleanup();
    }
  }
}
