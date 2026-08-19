import type {
  JsonObject,
  ProviderCapabilities,
  ProviderEvent,
} from "@stn/contracts";

import { createToolNameAliases, type ToolNameAliases } from "./tool-aliases.js";
import type {
  ConnectionTestResult,
  ModelProvider,
  ProviderConnection,
  ProviderContextEvent,
  ProviderDiagnosticsEvent,
  ProviderMessage,
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

type Fetch = typeof globalThis.fetch;

const internalGenerationFields = new Set([
  "maxContextTokens",
  "maxContextUnlocked",
  "sourceFormat",
]);

const protectedResponseFields = new Set([
  "model",
  "input",
  "tools",
  "stream",
  "store",
  "previous_response_id",
  "conversation",
  "metadata",
]);

interface FunctionCallAccumulator {
  readonly key: string;
  id: string;
  name: string;
  argumentsText: string;
  started: boolean;
  completed: boolean;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function itemKey(item: JsonObject, fallback: string): string {
  return (
    stringValue(item.id) ??
    stringValue(item.item_id) ??
    stringValue(item.call_id) ??
    (typeof item.output_index === "number"
      ? `output-${String(item.output_index)}`
      : fallback)
  );
}

function outputItemsFrom(value: unknown): JsonObject[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => asJsonObject(item))
    .filter((item): item is JsonObject => item !== undefined);
}

function responseObject(frame: JsonObject): JsonObject | undefined {
  return (
    asJsonObject(frame.response) ??
    (Array.isArray(frame.output) || typeof frame.status === "string"
      ? frame
      : undefined)
  );
}

function outputItemText(item: JsonObject, kind: "text" | "reasoning"): string {
  const values: string[] = [];
  const collect = (value: unknown): void => {
    if (typeof value === "string") {
      values.push(value);
      return;
    }
    if (!Array.isArray(value)) return;
    for (const rawPart of value) {
      const part = asJsonObject(rawPart);
      if (!part) continue;
      const type = stringValue(part.type) ?? "";
      const text = stringValue(part.text);
      if (!text) continue;
      if (
        kind === "text"
          ? type === "output_text" || type === "text" || type.length === 0
          : type.includes("reasoning") || type === "summary_text"
      ) {
        values.push(text);
      }
    }
  };

  collect(item.content);
  if (kind === "reasoning") collect(item.summary);
  if (kind === "text" && values.length === 0) collect(item.output_text);
  return values.join("");
}

function functionCallFromItem(
  item: JsonObject,
  aliases: ToolNameAliases,
  fallbackKey: string,
): FunctionCallAccumulator | undefined {
  if (stringValue(item.type) !== "function_call") return undefined;
  const key = itemKey(item, fallbackKey);
  return {
    key,
    id: stringValue(item.call_id) ?? stringValue(item.id) ?? key,
    name: aliases.toInternal(stringValue(item.name) ?? ""),
    argumentsText: stringValue(item.arguments) ?? "",
    started: false,
    completed: false,
  };
}

function inputItems(
  messages: readonly ProviderMessage[],
  aliases: ToolNameAliases,
  includeEmptyAssistantReasoningText = false,
): JsonObject[] {
  const result: JsonObject[] = [];
  for (const message of messages) {
    if (
      message.role === "assistant" &&
      message.providerContextItems !== undefined &&
      message.providerContextItems.length > 0
    ) {
      result.push(...message.providerContextItems);
      continue;
    }

    if (message.role === "tool") {
      result.push({
        type: "function_call_output",
        call_id: message.toolCallId ?? message.name ?? "unknown-call",
        output: message.content,
      });
      continue;
    }

    if (message.role === "assistant" && message.toolCalls !== undefined) {
      if (message.content.length > 0) {
        result.push({
          type: "message",
          role: "assistant",
          content: message.content,
        });
      }
      for (const toolCall of message.toolCalls) {
        result.push({
          type: "function_call",
          call_id: toolCall.id,
          name: aliases.toProvider(toolCall.name),
          arguments: JSON.stringify(toolCall.arguments),
        });
      }
      continue;
    }

    result.push({
      type: "message",
      role: message.role,
      content: message.content,
      ...(includeEmptyAssistantReasoningText && message.role === "assistant"
        ? { reasoning_text: message.reasoningContent ?? "" }
        : {}),
      ...(message.name === undefined ? {} : { name: message.name }),
    });
  }
  return result;
}

function generationPayload(
  connection: ProviderConnection,
  request: ProviderRequest,
  aliases: ToolNameAliases,
): JsonObject {
  const generation = request.settings ?? {};
  const payload: JsonObject = {
    model: connection.model,
    input: inputItems(
      request.messages,
      aliases,
      connection.model.toLowerCase().startsWith("deepseek"),
    ),
    stream: generation.stream !== false,
    store: false,
  };
  if (generation.temperature !== undefined)
    payload.temperature = generation.temperature;
  if (generation.topP !== undefined) payload.top_p = generation.topP;
  if (generation.maxOutputTokens !== undefined) {
    payload.max_output_tokens = generation.maxOutputTokens;
  }
  if (request.tools && request.tools.length > 0) {
    payload.tools = request.tools.map((tool) => ({
      type: "function",
      name: aliases.toProvider(tool.name),
      description: tool.description,
      parameters: tool.inputSchema,
    }));
  }
  for (const [key, value] of Object.entries(generation.additional ?? {})) {
    if (
      internalGenerationFields.has(key) ||
      protectedResponseFields.has(key) ||
      key in payload
    ) {
      continue;
    }
    payload[key] = value;
  }
  return payload;
}

function usageFrom(value: unknown):
  | {
      inputTokens: number;
      outputTokens: number;
      cachedTokens?: number;
    }
  | undefined {
  const usage = asJsonObject(value);
  if (!usage) return undefined;
  const inputTokens =
    numberValue(usage.input_tokens) ?? numberValue(usage.prompt_tokens);
  const outputTokens =
    numberValue(usage.output_tokens) ?? numberValue(usage.completion_tokens);
  if (inputTokens === undefined && outputTokens === undefined) return undefined;
  const inputDetails =
    asJsonObject(usage.input_tokens_details) ??
    asJsonObject(usage.prompt_tokens_details);
  const cachedTokens =
    numberValue(usage.cached_tokens) ??
    numberValue(inputDetails?.cached_tokens);
  return {
    inputTokens: inputTokens ?? 0,
    outputTokens: outputTokens ?? 0,
    ...(cachedTokens === undefined ? {} : { cachedTokens }),
  };
}

function incompleteReason(response: JsonObject | undefined): string {
  const details = asJsonObject(response?.incomplete_details);
  return (
    stringValue(details?.reason) ??
    stringValue(response?.incomplete_reason) ??
    "unknown"
  );
}

function isOutputLimitReason(response: JsonObject | undefined): boolean {
  return new Set([
    "max_output_tokens",
    "max_output_tokens_reached",
    "max_output_tokens_exceeded",
    "length",
  ]).has(incompleteReason(response));
}

export class OpenAIResponsesProvider implements ModelProvider {
  readonly id = "openai-responses";

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
    const requestSignal = createRequestSignal(
      signal,
      this.connection.timeoutMs ?? 30_000,
    );
    try {
      const response = await this.fetchImpl(
        joinUrl(this.connection.baseUrl, "/responses"),
        {
          method: "POST",
          headers: safeHeaders(this.connection),
          body: JSON.stringify({
            model: this.connection.model,
            input: [
              {
                type: "message",
                role: "user",
                content: "Respond with OK.",
              },
            ],
            max_output_tokens: 1,
            stream: false,
            store: false,
          }),
          signal: requestSignal.signal,
        },
      );
      if (!response.ok) throw await responseError(response);
      return {
        ok: true,
        model: this.connection.model,
        latencyMs: Date.now() - started,
      };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      requestSignal.cleanup();
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
      const payload = asJsonObject(await response.json());
      const data = Array.isArray(payload?.data) ? payload.data : [];
      return data
        .map((item) => asJsonObject(item))
        .filter((item): item is JsonObject => item !== undefined)
        .map((item) => ({
          id: stringValue(item.id) ?? "",
          name: stringValue(item.name) ?? stringValue(item.id) ?? "",
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
    const emitContext = (
      items: readonly JsonObject[],
    ): ProviderContextEvent => ({
      type: "provider-context",
      requestId: request.requestId,
      sequence: sequence++,
      items,
    });
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
      this.connection.timeoutMs ?? 600_000,
    );
    const aliases = createToolNameAliases(request.tools);
    const calls = new Map<string, FunctionCallAccumulator>();
    const callKeysByOutputIndex = new Map<number, string>();
    const callKeysByCallId = new Map<string, string>();
    const callKeysByItemId = new Map<string, string>();
    const outputItems = new Map<string, JsonObject>();
    let outputItemOrder: string[] = [];
    let sawTerminal = false;
    let sawTextDelta = false;
    let sawReasoningDelta = false;
    let usageEmitted = false;
    let finishReason: "stop" | "length" | "tool-calls" = "stop";
    let terminalOutput: JsonObject[] = [];
    let diagnosticsEmitted = false;

    const addOutputItem = (
      item: JsonObject,
      fallback: string,
      outputIndex?: number,
    ): void => {
      const mappedKey =
        (stringValue(item.id) === undefined
          ? undefined
          : callKeysByItemId.get(item.id as string)) ??
        (stringValue(item.call_id) === undefined
          ? undefined
          : callKeysByCallId.get(item.call_id as string));
      const key = mappedKey ?? itemKey(item, fallback);
      if (stringValue(item.id)) callKeysByItemId.set(item.id as string, key);
      if (stringValue(item.call_id)) {
        callKeysByCallId.set(item.call_id as string, key);
      }
      if (typeof item.output_index === "number") {
        callKeysByOutputIndex.set(item.output_index, key);
      }
      if (outputIndex !== undefined) {
        callKeysByOutputIndex.set(outputIndex, key);
      }
      if (!outputItems.has(key)) outputItemOrder.push(key);
      outputItems.set(key, item);
      const call = functionCallFromItem(item, aliases, key);
      if (call) {
        const current = calls.get(key);
        calls.set(key, {
          ...call,
          started: current?.started ?? false,
          completed: current?.completed ?? false,
          argumentsText: call.argumentsText || current?.argumentsText || "",
        });
      }
    };

    const ensureCall = (
      frame: JsonObject,
      fallback: string,
    ): FunctionCallAccumulator => {
      const indexedKey =
        typeof frame.output_index === "number"
          ? callKeysByOutputIndex.get(frame.output_index)
          : undefined;
      const mappedKey =
        (stringValue(frame.item_id) === undefined
          ? undefined
          : callKeysByItemId.get(frame.item_id as string)) ??
        (stringValue(frame.call_id) === undefined
          ? undefined
          : callKeysByCallId.get(frame.call_id as string));
      const key =
        mappedKey ??
        stringValue(frame.item_id) ??
        stringValue(frame.call_id) ??
        indexedKey ??
        (typeof frame.output_index === "number"
          ? `output-${String(frame.output_index)}`
          : fallback);
      const current = calls.get(key) ?? {
        key,
        id: stringValue(frame.call_id) ?? stringValue(frame.item_id) ?? key,
        name: "",
        argumentsText: "",
        started: false,
        completed: false,
      };
      if (stringValue(frame.call_id)) current.id = frame.call_id as string;
      if (stringValue(frame.name))
        current.name = aliases.toInternal(frame.name as string);
      if (stringValue(frame.item_id)) {
        callKeysByItemId.set(frame.item_id as string, key);
      }
      if (stringValue(frame.call_id)) {
        callKeysByCallId.set(frame.call_id as string, key);
      }
      if (typeof frame.output_index === "number") {
        callKeysByOutputIndex.set(frame.output_index, key);
      }
      calls.set(key, current);
      return current;
    };

    const completeCalls = async function* (): AsyncIterable<ProviderEvent> {
      for (const call of calls.values()) {
        if (call.name.length === 0) call.name = "unknown-tool";
        if (!call.started) {
          call.started = true;
          yield emit({
            type: "tool-call-start",
            callId: call.id,
            name: call.name,
          });
        }
        if (call.completed) continue;
        let argumentsValue: JsonObject;
        try {
          argumentsValue =
            call.argumentsText.length === 0
              ? {}
              : (asJsonObject(JSON.parse(call.argumentsText) as unknown) ??
                (() => {
                  throw new Error("Function arguments must be a JSON object.");
                })());
        } catch {
          yield emit({
            type: "error",
            code: "TOOL_ARGUMENT_INVALID",
            message: `Provider returned invalid JSON arguments for '${call.name}'.`,
            retryable: false,
          });
          call.completed = true;
          continue;
        }
        call.completed = true;
        yield emit({
          type: "tool-call-complete",
          callId: call.id,
          name: call.name,
          arguments: argumentsValue,
        });
      }
    };

    const emitUsage = (value: unknown): void => {
      if (usageEmitted) return;
      const usage = usageFrom(value);
      if (!usage) return;
      usageEmitted = true;
      pendingEvents.push(emit({ type: "usage", ...usage }));
    };
    const pendingEvents: ProviderEvent[] = [];

    const processOutput = async function* (
      response: JsonObject | undefined,
      allowTextFallback: boolean,
    ): AsyncIterable<ProviderEvent> {
      const items = outputItemsFrom(response?.output);
      if (items.length > 0) {
        terminalOutput = items;
        outputItemOrder = [];
        outputItems.clear();
        for (const [index, item] of items.entries()) {
          addOutputItem(item, `output-${String(index)}`);
        }
      } else if (outputItemOrder.length > 0) {
        terminalOutput = outputItemOrder
          .map((key) => outputItems.get(key))
          .filter((item): item is JsonObject => item !== undefined);
      }
      if (allowTextFallback && !sawTextDelta) {
        const text =
          stringValue(response?.output_text) ??
          terminalOutput
            .filter((item) => stringValue(item.type) === "message")
            .map((item) => outputItemText(item, "text"))
            .join("");
        if (text) yield emit({ type: "text-delta", delta: text });
      }
      if (allowTextFallback && !sawReasoningDelta) {
        const reasoning = terminalOutput
          .filter((item) => stringValue(item.type) === "reasoning")
          .map((item) => outputItemText(item, "reasoning"))
          .join("");
        if (reasoning)
          yield emit({ type: "reasoning-delta", delta: reasoning });
      }
    };

    const processTerminal = async function* (
      frameType: string,
      frame: JsonObject,
    ): AsyncIterable<ProviderStreamEvent> {
      const response = responseObject(frame);
      sawTerminal = true;
      emitUsage(response?.usage ?? frame.usage);
      yield* pendingEvents.splice(0);
      // Some proxies send only the terminal response object. The fallback is
      // guarded by the delta flags, so normal delta streams are not duplicated.
      for await (const event of processOutput(response, true)) yield event;

      if (
        frameType === "response.failed" ||
        frameType === "error" ||
        response?.status === "failed" ||
        response?.status === "error"
      ) {
        const error =
          asJsonObject(frame.error) ?? asJsonObject(response?.error);
        yield emit({
          type: "error",
          code: stringValue(error?.code) ?? "PROVIDER_RESPONSE_FAILED",
          message:
            stringValue(error?.message) ??
            "The Responses provider reported a failed response.",
          retryable: false,
          ...(error === undefined ? {} : { detail: error }),
        });
        return;
      }

      if (
        frameType === "response.incomplete" ||
        response?.status === "incomplete"
      ) {
        if (isOutputLimitReason(response)) {
          finishReason = "length";
        } else {
          yield emit({
            type: "error",
            code: "PROVIDER_RESPONSE_INCOMPLETE",
            message: `The Responses provider returned an incomplete response (${incompleteReason(response)}).`,
            retryable: true,
          });
          return;
        }
      }
      if (calls.size > 0) finishReason = "tool-calls";
      if (terminalOutput.length > 0) yield emitContext(terminalOutput);
      for await (const event of completeCalls()) yield event;
      yield emit({ type: "finish", reason: finishReason });
    };

    try {
      const response = await this.fetchImpl(
        joinUrl(this.connection.baseUrl, "/responses"),
        {
          method: "POST",
          headers: safeHeaders(this.connection),
          body: JSON.stringify(
            generationPayload(this.connection, request, aliases),
          ),
          signal: requestSignal.signal,
        },
      );
      upstreamRequestId = upstreamRequestIdFromHeaders(response.headers);
      if (!response.ok) throw await responseError(response);
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
          continue;
        }
        const frameType = stringValue(frame.type) ?? "";
        lastFrameType = providerFrameType(frame, "response.frame");
        upstreamRequestId ??= upstreamRequestIdFromFrame(frame);
        const response = responseObject(frame);
        if (
          frameType === "response.completed" ||
          frameType === "response.incomplete" ||
          frameType === "response.failed" ||
          frameType === "error" ||
          (frameType === "" && response !== undefined)
        ) {
          rawFinishReason =
            (frameType === "response.incomplete" ||
            response?.status === "incomplete"
              ? diagnosticString(incompleteReason(response))
              : (diagnosticString(response?.status) ??
                diagnosticString(frameType))) ?? rawFinishReason;
        }
        if (frameType === "response.output_item.added") {
          const item = asJsonObject(frame.item);
          if (item) {
            addOutputItem(
              item,
              `output-${String(outputItemOrder.length)}`,
              typeof frame.output_index === "number"
                ? frame.output_index
                : undefined,
            );
          }
          continue;
        }
        if (frameType === "response.output_item.done") {
          const item = asJsonObject(frame.item);
          if (item) {
            addOutputItem(
              item,
              `output-${String(outputItemOrder.length)}`,
              typeof frame.output_index === "number"
                ? frame.output_index
                : undefined,
            );
          }
          continue;
        }
        if (frameType === "response.output_text.delta") {
          const delta = stringValue(frame.delta);
          if (delta) {
            sawTextDelta = true;
            yield emit({ type: "text-delta", delta });
          }
          continue;
        }
        if (
          frameType === "response.reasoning_text.delta" ||
          frameType === "response.reasoning_summary_text.delta" ||
          frameType === "response.reasoning_summary.delta"
        ) {
          const delta = stringValue(frame.delta) ?? stringValue(frame.text);
          if (delta) {
            sawReasoningDelta = true;
            yield emit({ type: "reasoning-delta", delta });
          }
          continue;
        }
        if (frameType === "response.function_call_arguments.delta") {
          const call = ensureCall(frame, `call-${String(calls.size)}`);
          const delta = stringValue(frame.delta) ?? "";
          if (delta) {
            call.argumentsText += delta;
            if (!call.started && call.name.length > 0) {
              call.started = true;
              yield emit({
                type: "tool-call-start",
                callId: call.id,
                name: call.name,
              });
            }
            yield emit({
              type: "tool-call-delta",
              callId: call.id,
              argumentsDelta: delta,
            });
          }
          continue;
        }
        if (frameType === "response.function_call_arguments.done") {
          const call = ensureCall(frame, `call-${String(calls.size)}`);
          const argumentsText = stringValue(frame.arguments);
          if (argumentsText !== undefined) {
            if (call.argumentsText.length === 0) {
              call.argumentsText = argumentsText;
              if (argumentsText.length > 0) {
                yield emit({
                  type: "tool-call-delta",
                  callId: call.id,
                  argumentsDelta: argumentsText,
                });
              }
            } else if (argumentsText.startsWith(call.argumentsText)) {
              call.argumentsText = argumentsText;
            }
          }
          continue;
        }
        if (frameType === "response.usage") {
          emitUsage(frame.usage ?? frame);
          for (const event of pendingEvents.splice(0)) yield event;
          continue;
        }
        if (
          frameType === "response.completed" ||
          frameType === "response.incomplete" ||
          frameType === "response.failed" ||
          frameType === "error"
        ) {
          yield emitDiagnostics();
          diagnosticsEmitted = true;
          for await (const event of processTerminal(frameType, frame))
            yield event;
          continue;
        }

        // A non-streaming response has no event type and is returned as the
        // response object itself. Treat it as a completed response.
        if (
          (frameType === "" || frameType === "response") &&
          (Array.isArray(frame.output) || frame.status !== undefined)
        ) {
          yield emitDiagnostics();
          diagnosticsEmitted = true;
          if (frame.status === "failed" || frame.status === "error") {
            for await (const event of processTerminal("response.failed", frame))
              yield event;
            continue;
          }
          for await (const event of processOutput(frame, true)) yield event;
          emitUsage(frame.usage);
          for (const event of pendingEvents.splice(0)) yield event;
          sawTerminal = true;
          if (frame.status === "incomplete") {
            if (isOutputLimitReason(frame)) finishReason = "length";
            else {
              yield emit({
                type: "error",
                code: "PROVIDER_RESPONSE_INCOMPLETE",
                message: `The Responses provider returned an incomplete response (${incompleteReason(frame)}).`,
                retryable: true,
              });
              continue;
            }
          }
          if (calls.size > 0) finishReason = "tool-calls";
          if (terminalOutput.length > 0) yield emitContext(terminalOutput);
          for await (const event of completeCalls()) yield event;
          yield emit({ type: "finish", reason: finishReason });
        }
      }

      if (sawDone || !diagnosticsEmitted) yield emitDiagnostics();
      if (!sawTerminal) {
        yield emit({
          type: "error",
          code: "PROVIDER_STREAM_INCOMPLETE",
          message:
            "Provider closed the Responses stream before sending a terminal response event.",
          retryable: true,
        });
      }
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
