import type { ProviderCapabilities, ProviderEvent } from "@stn/contracts";

import type {
  ConnectionTestResult,
  FakeProviderScript,
  ModelProvider,
  ProviderModel,
  ProviderRequest,
} from "./types.js";
import { estimateTokens } from "./utils.js";

const wait = async (
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> => {
  if (milliseconds <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, milliseconds);
    const abort = () => {
      clearTimeout(timeout);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
};

export class DeterministicFakeProvider implements ModelProvider {
  readonly id = "deterministic-fake";

  constructor(
    private readonly script: FakeProviderScript = {
      chunks: ["A deterministic response."],
    },
    private readonly supportsTools = true,
  ) {}

  capabilities(): ProviderCapabilities {
    return {
      streaming: true,
      nativeToolCalling: this.supportsTools,
      reasoning: false,
      vision: false,
      maxContextTokens: 32_768,
    };
  }

  async testConnection(): Promise<ConnectionTestResult> {
    return { ok: true, model: "fake-model", latencyMs: 0 };
  }

  async listModels(): Promise<readonly ProviderModel[]> {
    return [{ id: "fake-model", name: "Deterministic fake", metadata: {} }];
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
    const event = <T extends Omit<ProviderEvent, "requestId" | "sequence">>(
      value: T,
    ): ProviderEvent =>
      ({
        ...value,
        requestId: request.requestId,
        sequence: sequence++,
      }) as unknown as ProviderEvent;

    yield event({
      type: "start",
      model: "fake-model",
      capabilities: this.capabilities(),
    });

    try {
      if (this.script.error) {
        yield event({
          type: "error",
          code: this.script.error.code,
          message: this.script.error.message,
          retryable: this.script.error.retryable ?? false,
          ...(this.script.error.detail === undefined
            ? {}
            : { detail: this.script.error.detail }),
        });
        return;
      }

      for (const toolCall of this.script.toolCalls ?? []) {
        if (!this.supportsTools) {
          yield event({
            type: "error",
            code: "PROVIDER_TOOL_CALLING_NOT_SUPPORTED",
            message:
              "The deterministic provider was configured without tool calling.",
            retryable: false,
          });
          return;
        }
        await wait(this.script.delayMs ?? 0, signal);
        yield event({
          type: "tool-call-start",
          callId: toolCall.id,
          name: toolCall.name,
        });
        const serialized = JSON.stringify(toolCall.arguments);
        yield event({
          type: "tool-call-delta",
          callId: toolCall.id,
          argumentsDelta: serialized,
        });
        yield event({
          type: "tool-call-complete",
          callId: toolCall.id,
          name: toolCall.name,
          arguments: toolCall.arguments,
        });
      }

      const chunks =
        this.script.chunks ??
        (this.script.text === undefined ? [] : [this.script.text]);
      for (const chunk of chunks) {
        await wait(this.script.delayMs ?? 0, signal);
        if (signal?.aborted) {
          yield event({ type: "finish", reason: "cancelled" });
          return;
        }
        yield event({ type: "text-delta", delta: chunk });
      }
      const output = chunks.join("");
      yield event({
        type: "usage",
        inputTokens: await this.countTokens(request.messages),
        outputTokens: estimateTokens(output),
      });
      yield event({
        type: "finish",
        reason:
          (this.script.toolCalls?.length ?? 0) > 0 ? "tool-calls" : "stop",
      });
    } catch (error) {
      if (signal?.aborted) {
        yield event({ type: "finish", reason: "cancelled" });
        return;
      }
      yield event({
        type: "error",
        code: "FAKE_PROVIDER_ERROR",
        message: error instanceof Error ? error.message : String(error),
        retryable: false,
      });
    }
  }
}
