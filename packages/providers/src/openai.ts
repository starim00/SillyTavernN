import { randomInt } from "node:crypto";

import type {
  JsonObject,
  ProviderCapabilities,
  ProviderEvent,
} from "@stn/contracts";

import type {
  ConnectionTestResult,
  ModelProvider,
  ProviderConnection,
  ProviderDiagnosticsEvent,
  ProviderModel,
  ProviderRequest,
  ProviderStreamEvent,
} from "./types.js";
import {
  asJsonObject,
  createRequestSignal,
  diagnosticString,
  estimateTokens,
  joinUrl,
  providerFrameType,
  readSseJson,
  responseError,
  safeHeaders,
  upstreamRequestIdFromFrame,
  upstreamRequestIdFromHeaders,
} from "./utils.js";
import { createToolNameAliases, type ToolNameAliases } from "./tool-aliases.js";

type Fetch = typeof globalThis.fetch;

const internalGenerationFields = new Set([
  "maxContextTokens",
  "maxContextUnlocked",
  "sourceFormat",
]);

interface ToolAccumulator {
  id: string;
  name: string;
  argumentsText: string;
  choiceIndex: number;
  started: boolean;
}

function generationPayload(
  connection: ProviderConnection,
  request: ProviderRequest,
  toolNameAliases: ToolNameAliases,
): JsonObject {
  const generation = request.settings ?? {};
  const payload: JsonObject = {
    model: connection.model,
    messages: request.messages.map((message) => {
      const toolCalls = message.toolCalls?.map((toolCall) => ({
        id: toolCall.id,
        type: "function",
        function: {
          name: toolNameAliases.toProvider(toolCall.name),
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
        ...(message.name === undefined
          ? {}
          : {
              name:
                message.role === "tool"
                  ? toolNameAliases.toProvider(message.name)
                  : message.name,
            }),
        ...(message.toolCallId === undefined
          ? {}
          : { tool_call_id: message.toolCallId }),
        ...(message.reasoningContent !== undefined
          ? { reasoning_content: message.reasoningContent }
          : {}),
        ...(toolCalls === undefined ? {} : { tool_calls: toolCalls }),
      };
    }),
    stream: generation.stream !== false,
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
  if (generation.n !== undefined) payload.n = generation.n;
  // SillyTavern-compatible presets use -1 as the "random seed" sentinel.
  // Preserve that behavior while resolving it to a valid unsigned seed at
  // request time; explicit non-negative seeds remain reproducible.
  if (generation.seed === -1) {
    payload.seed = randomInt(0, 0x1_0000_0000);
  } else if (
    generation.seed !== undefined &&
    Number.isSafeInteger(generation.seed) &&
    generation.seed >= 0
  ) {
    payload.seed = generation.seed;
  }
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
        name: toolNameAliases.toProvider(tool.name),
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
  ): AsyncIterable<ProviderStreamEvent> {
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
        code: "PROVIDER_TOOL_CALLING_NOT_SUPPORTED",
        message:
          "This provider connection does not support native structured tool calling.",
        retryable: false,
      });
      return;
    }

    const requestSignal = createRequestSignal(
      signal,
      // Reasoning models routed through an OpenAI-compatible proxy can spend
      // several minutes thinking and streaming a long reply. A one-minute
      // whole-request deadline cuts off otherwise healthy generations.
      this.connection.timeoutMs ?? 600_000,
    );
    const toolNameAliases = createToolNameAliases(request.tools);
    const tools = new Map<string, ToolAccumulator>();
    let rawFinishReason: string | undefined;
    let sawDone = false;
    let lastFrameType: string | undefined;
    let upstreamRequestId: string | undefined;
    const emitDiagnostics = (): ProviderDiagnosticsEvent => ({
      type: "provider-diagnostics",
      requestId: request.requestId,
      sequence: sequence++,
      ...(rawFinishReason === undefined ? {} : { rawFinishReason }),
      sawDone,
      ...(lastFrameType === undefined ? {} : { lastFrameType }),
      ...(upstreamRequestId === undefined ? {} : { upstreamRequestId }),
    });
    try {
      const response = await this.fetchImpl(
        joinUrl(this.connection.baseUrl, "/chat/completions"),
        {
          method: "POST",
          headers: safeHeaders(this.connection),
          body: JSON.stringify(
            generationPayload(this.connection, request, toolNameAliases),
          ),
          signal: requestSignal.signal,
        },
      );
      upstreamRequestId = upstreamRequestIdFromHeaders(response.headers);
      if (!response.ok) throw await responseError(response);

      let finishReason: "stop" | "length" | "tool-calls" = "stop";
      let sawFinishReason = false;
      const contentType =
        response.headers.get("content-type")?.toLowerCase() ?? "";
      const frames =
        contentType.includes("application/json") ||
        request.settings?.stream === false
          ? (async function* () {
              const object = asJsonObject(await response.json());
              if (object) yield object;
            })()
          : readSseJson(response);
      for await (const frame of frames) {
        if (frame === "[DONE]") {
          sawDone = true;
          break;
        }
        lastFrameType = providerFrameType(frame, "chat.completion.frame");
        upstreamRequestId ??= upstreamRequestIdFromFrame(frame);
        const usage = asJsonObject(frame.usage);
        if (usage) {
          yield emit({
            type: "usage",
            inputTokens: Number(usage.prompt_tokens ?? 0),
            outputTokens: Number(usage.completion_tokens ?? 0),
            ...(typeof usage.prompt_tokens_details === "object" ? {} : {}),
          });
        }
        const choices = Array.isArray(frame.choices) ? frame.choices : [];
        for (const [position, rawChoice] of choices.entries()) {
          const choice = asJsonObject(rawChoice);
          if (!choice) continue;
          const choiceIndex =
            typeof choice.index === "number" &&
            Number.isInteger(choice.index) &&
            choice.index >= 0
              ? choice.index
              : position;
          const delta =
            asJsonObject(choice.delta) ?? asJsonObject(choice.message);
          if (delta) {
            if (typeof delta.content === "string" && delta.content.length > 0) {
              yield emit({
                type: "text-delta",
                delta: delta.content,
                ...(choiceIndex === 0 ? {} : { choiceIndex }),
              });
            }
            const reasoning =
              typeof delta.reasoning_content === "string"
                ? delta.reasoning_content
                : typeof delta.reasoning === "string"
                  ? delta.reasoning
                  : undefined;
            if (reasoning) {
              yield emit({
                type: "reasoning-delta",
                delta: reasoning,
                ...(choiceIndex === 0 ? {} : { choiceIndex }),
              });
            }
            const toolDeltas = Array.isArray(delta.tool_calls)
              ? delta.tool_calls
              : [];
            for (const raw of toolDeltas) {
              const item = asJsonObject(raw);
              if (!item) continue;
              const index =
                typeof item.index === "number" &&
                Number.isInteger(item.index) &&
                item.index >= 0
                  ? item.index
                  : 0;
              const toolKey = `${String(choiceIndex)}:${String(index)}`;
              const functionData = asJsonObject(item.function);
              const current = tools.get(toolKey) ?? {
                id:
                  typeof item.id === "string"
                    ? item.id
                    : `${request.requestId}-choice-${String(choiceIndex)}-tool-${String(index)}`,
                name: "",
                argumentsText: "",
                choiceIndex,
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
                  name: toolNameAliases.toInternal(current.name),
                  ...(choiceIndex === 0 ? {} : { choiceIndex }),
                });
              }
              if (typeof functionData?.arguments === "string") {
                current.argumentsText += functionData.arguments;
                yield emit({
                  type: "tool-call-delta",
                  callId: current.id,
                  argumentsDelta: functionData.arguments,
                  ...(choiceIndex === 0 ? {} : { choiceIndex }),
                });
              }
              tools.set(toolKey, current);
            }
          }
          const rawFinish = choice.finish_reason;
          if (typeof rawFinish === "string" && rawFinish.length > 0) {
            sawFinishReason = true;
          }
          if (choiceIndex === 0) {
            rawFinishReason = diagnosticString(rawFinish) ?? rawFinishReason;
            if (rawFinish === "length") finishReason = "length";
            if (rawFinish === "tool_calls") finishReason = "tool-calls";
          }
        }
      }

      yield emitDiagnostics();
      if (!sawDone && !sawFinishReason) {
        yield emit({
          type: "error",
          code: "PROVIDER_STREAM_INCOMPLETE",
          message:
            "Provider closed the streaming response before sending a completion marker.",
          retryable: true,
        });
        return;
      }

      for (const tool of [...tools.values()]) {
        let args: JsonObject;
        try {
          args = asJsonObject(JSON.parse(tool.argumentsText) as unknown) ?? {};
        } catch {
          yield emit({
            type: "error",
            code: "TOOL_ARGUMENT_INVALID",
            message: `Provider returned invalid JSON arguments for '${toolNameAliases.toInternal(tool.name)}'.`,
            retryable: false,
          });
          continue;
        }
        yield emit({
          type: "tool-call-complete",
          callId: tool.id,
          name: toolNameAliases.toInternal(tool.name || "unknown-tool"),
          arguments: args,
          ...(tool.choiceIndex === 0 ? {} : { choiceIndex: tool.choiceIndex }),
        });
      }
      yield emit({ type: "finish", reason: finishReason });
    } catch (error) {
      yield emitDiagnostics();
      if (signal?.aborted) {
        yield emit({ type: "finish", reason: "cancelled" });
      } else {
        const reason: unknown = requestSignal.signal.aborted
          ? requestSignal.signal.reason
          : error;
        yield emit({
          type: "error",
          code: "PROVIDER_REQUEST_FAILED",
          message: reason instanceof Error ? reason.message : String(reason),
          retryable: true,
        });
      }
    } finally {
      requestSignal.cleanup();
    }
  }
}
