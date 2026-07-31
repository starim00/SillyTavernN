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

const internalGenerationFields = new Set(["maxContextTokens", "sourceFormat"]);

interface ToolAccumulator {
  id: string;
  name: string;
  argumentsText: string;
  started: boolean;
}

function generationPayload(
  connection: ProviderConnection,
  request: ProviderRequest,
): JsonObject {
  const generation = request.settings ?? {};
  const payload: JsonObject = {
    model: connection.model,
    messages: request.messages.map((message) => {
      const toolCalls = message.toolCalls?.map((toolCall) => ({
        id: toolCall.id,
        type: "function",
        function: {
          name: toolCall.name,
          arguments: JSON.stringify(toolCall.arguments),
        },
      }));
      return {
        role: message.role,
        content:
          message.role === "assistant" &&
          toolCalls !== undefined &&
          message.content.length === 0
            ? null
            : message.content,
        ...(message.name === undefined ? {} : { name: message.name }),
        ...(message.toolCallId === undefined
          ? {}
          : { tool_call_id: message.toolCallId }),
        ...(toolCalls === undefined ? {} : { tool_calls: toolCalls }),
      };
    }),
    stream: true,
  };
  if (generation.temperature !== undefined)
    payload.temperature = generation.temperature;
  if (generation.topP !== undefined) payload.top_p = generation.topP;
  if (generation.frequencyPenalty !== undefined) {
    payload.frequency_penalty = generation.frequencyPenalty;
  }
  if (generation.presencePenalty !== undefined) {
    payload.presence_penalty = generation.presencePenalty;
  }
  if (generation.maxOutputTokens !== undefined) {
    payload.max_tokens = generation.maxOutputTokens;
  }
  if (generation.seed !== undefined) payload.seed = generation.seed;
  if (generation.stop && generation.stop.length > 0)
    payload.stop = generation.stop;
  for (const [key, value] of Object.entries(generation.additional ?? {})) {
    if (!internalGenerationFields.has(key) && !(key in payload)) {
      payload[key] = value;
    }
  }
  if (request.tools && request.tools.length > 0) {
    payload.tools = request.tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));
  }
  return payload;
}

export class OpenAICompatibleProvider implements ModelProvider {
  readonly id = "openai-compatible";

  constructor(
    private readonly connection: ProviderConnection,
    private readonly fetchImpl: Fetch = globalThis.fetch,
  ) {}

  capabilities(): ProviderCapabilities {
    return {
      streaming: true,
      nativeToolCalling: this.connection.nativeToolCalling ?? true,
      reasoning: true,
      vision: false,
    };
  }

  async testConnection(signal?: AbortSignal): Promise<ConnectionTestResult> {
    const started = Date.now();
    try {
      const models = await this.listModels(signal);
      return {
        ok:
          models.some((model) => model.id === this.connection.model) ||
          models.length > 0,
        model: this.connection.model,
        latencyMs: Date.now() - started,
      };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async listModels(signal?: AbortSignal): Promise<readonly ProviderModel[]> {
    const requestSignal = createRequestSignal(
      signal,
      this.connection.timeoutMs ?? 15_000,
    );
    try {
      const response = await this.fetchImpl(
        joinUrl(this.connection.baseUrl, "/models"),
        {
          headers: safeHeaders(this.connection),
          signal: requestSignal.signal,
        },
      );
      if (!response.ok) throw await responseError(response);
      const payload = (await response.json()) as { data?: unknown[] };
      return (payload.data ?? [])
        .map((item) => asJsonObject(item))
        .filter((item): item is JsonObject => item !== undefined)
        .map((item) => ({
          id: typeof item.id === "string" ? item.id : "",
          name:
            typeof item.name === "string"
              ? item.name
              : typeof item.id === "string"
                ? item.id
                : "",
          metadata: item,
        }))
        .filter((item) => item.id.length > 0);
    } finally {
      requestSignal.cleanup();
    }
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

    if (
      request.tools &&
      request.tools.length > 0 &&
      !this.capabilities().nativeToolCalling
    ) {
      yield emit({
        type: "error",
        code: "AGENT_NOT_SUPPORTED_BY_PROVIDER",
        message:
          "This provider connection does not support native structured tool calling.",
        retryable: false,
      });
      return;
    }

    const requestSignal = createRequestSignal(
      signal,
      this.connection.timeoutMs ?? 60_000,
    );
    const tools = new Map<number, ToolAccumulator>();
    try {
      const response = await this.fetchImpl(
        joinUrl(this.connection.baseUrl, "/chat/completions"),
        {
          method: "POST",
          headers: safeHeaders(this.connection),
          body: JSON.stringify(generationPayload(this.connection, request)),
          signal: requestSignal.signal,
        },
      );
      if (!response.ok) throw await responseError(response);

      let finishReason: "stop" | "length" | "tool-calls" = "stop";
      for await (const frame of readSseJson(response)) {
        if (frame === "[DONE]") break;
        const choices = Array.isArray(frame.choices) ? frame.choices : [];
        const choice = asJsonObject(choices[0]);
        if (!choice) {
          const usage = asJsonObject(frame.usage);
          if (usage) {
            yield emit({
              type: "usage",
              inputTokens: Number(usage.prompt_tokens ?? 0),
              outputTokens: Number(usage.completion_tokens ?? 0),
              ...(typeof usage.prompt_tokens_details === "object" ? {} : {}),
            });
          }
          continue;
        }
        const delta = asJsonObject(choice.delta);
        if (delta) {
          if (typeof delta.content === "string" && delta.content.length > 0) {
            yield emit({ type: "text-delta", delta: delta.content });
          }
          const reasoning =
            typeof delta.reasoning_content === "string"
              ? delta.reasoning_content
              : typeof delta.reasoning === "string"
                ? delta.reasoning
                : undefined;
          if (reasoning) {
            yield emit({ type: "reasoning-delta", delta: reasoning });
          }
          const toolDeltas = Array.isArray(delta.tool_calls)
            ? delta.tool_calls
            : [];
          for (const raw of toolDeltas) {
            const item = asJsonObject(raw);
            if (!item) continue;
            const index =
              typeof item.index === "number" ? item.index : tools.size;
            const functionData = asJsonObject(item.function);
            const current = tools.get(index) ?? {
              id:
                typeof item.id === "string"
                  ? item.id
                  : `${request.requestId}-tool-${String(index)}`,
              name: "",
              argumentsText: "",
              started: false,
            };
            if (typeof item.id === "string") current.id = item.id;
            if (typeof functionData?.name === "string") {
              current.name += functionData.name;
            }
            if (!current.started && current.name) {
              current.started = true;
              yield emit({
                type: "tool-call-start",
                callId: current.id,
                name: current.name,
              });
            }
            if (typeof functionData?.arguments === "string") {
              current.argumentsText += functionData.arguments;
              yield emit({
                type: "tool-call-delta",
                callId: current.id,
                argumentsDelta: functionData.arguments,
              });
            }
            tools.set(index, current);
          }
        }
        const rawFinish = choice.finish_reason;
        if (rawFinish === "length") finishReason = "length";
        if (rawFinish === "tool_calls") finishReason = "tool-calls";
      }

      for (const tool of [...tools.values()]) {
        let args: JsonObject;
        try {
          args = asJsonObject(JSON.parse(tool.argumentsText) as unknown) ?? {};
        } catch {
          yield emit({
            type: "error",
            code: "TOOL_ARGUMENT_INVALID",
            message: `Provider returned invalid JSON arguments for '${tool.name}'.`,
            retryable: false,
          });
          continue;
        }
        yield emit({
          type: "tool-call-complete",
          callId: tool.id,
          name: tool.name || "unknown-tool",
          arguments: args,
        });
      }
      yield emit({ type: "finish", reason: finishReason });
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
