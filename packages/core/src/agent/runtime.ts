import { randomUUID } from "node:crypto";

import type {
  JsonObject,
  JsonValue,
  ProviderCapabilities,
  ProviderEvent,
} from "@stn/contracts";

import { AgentRuntimeError } from "./errors.js";
import type { AgentToolRegistry, ToolEffect } from "./registry.js";

export type RuntimeRunStatus =
  | "queued"
  | "running"
  | "waiting_confirmation"
  | "completed"
  | "cancelled"
  | "failed";

export interface RuntimeLimits {
  readonly maxSteps: number;
  readonly maxToolCalls: number;
  readonly maxConsecutiveWrites: number;
}

export const defaultRuntimeLimits: RuntimeLimits = {
  maxSteps: 8,
  maxToolCalls: 16,
  maxConsecutiveWrites: 5,
};

export interface RuntimeRun {
  readonly id: string;
  readonly conversationId: string;
  readonly userId: string;
  status: RuntimeRunStatus;
  currentStep: number;
  toolCallCount: number;
  consecutiveWrites: number;
  readonly createdAt: string;
  updatedAt: string;
  error?: { code: string; message: string };
}

export interface AgentProviderMessage {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: string;
  readonly toolCallId?: string;
}

export interface AgentProviderRequest {
  readonly requestId: string;
  readonly messages: readonly AgentProviderMessage[];
  readonly tools: readonly {
    name: string;
    description: string;
    inputSchema: JsonObject;
  }[];
}

export interface AgentTurnProvider {
  readonly id: string;
  capabilities(): ProviderCapabilities;
  generate(
    request: AgentProviderRequest,
    signal?: AbortSignal,
  ): AsyncIterable<ProviderEvent>;
}

export interface AgentToolDecision {
  readonly confirmed?: boolean;
  readonly allowPolicyWrite?: boolean;
}

export interface AgentRuntimeOptions {
  readonly limits?: Partial<RuntimeLimits>;
  readonly decide?: (input: {
    run: Readonly<RuntimeRun>;
    toolName: string;
    effect: ToolEffect;
    arguments: JsonObject;
  }) => Promise<AgentToolDecision> | AgentToolDecision;
  readonly onToolResult?: (input: {
    run: Readonly<RuntimeRun>;
    callId: string;
    toolName: string;
    arguments: JsonObject;
    result: JsonValue;
  }) => Promise<void> | void;
}

export interface AgentRunResult {
  readonly run: Readonly<RuntimeRun>;
  readonly text: string;
  readonly messages: readonly AgentProviderMessage[];
  readonly toolResults: readonly {
    callId: string;
    toolName: string;
    arguments: JsonObject;
    result: JsonValue;
  }[];
}

export class AgentRuntime {
  readonly #runs = new Map<
    string,
    { run: RuntimeRun; controller: AbortController }
  >();
  readonly #limits: RuntimeLimits;

  constructor(
    private readonly registry: AgentToolRegistry,
    private readonly options: AgentRuntimeOptions = {},
  ) {
    this.#limits = { ...defaultRuntimeLimits, ...options.limits };
  }

  createRun(input: {
    id?: string;
    conversationId: string;
    userId: string;
  }): Readonly<RuntimeRun> {
    const now = new Date().toISOString();
    const run: RuntimeRun = {
      id: input.id ?? randomUUID(),
      conversationId: input.conversationId,
      userId: input.userId,
      status: "queued",
      currentStep: 0,
      toolCallCount: 0,
      consecutiveWrites: 0,
      createdAt: now,
      updatedAt: now,
    };
    if (this.#runs.has(run.id)) {
      throw new Error(`Agent run '${run.id}' already exists.`);
    }
    this.#runs.set(run.id, { run, controller: new AbortController() });
    return { ...run };
  }

  getRun(id: string): Readonly<RuntimeRun> | undefined {
    const current = this.#runs.get(id);
    return current ? { ...current.run } : undefined;
  }

  cancel(id: string): Readonly<RuntimeRun> {
    const current = this.#runs.get(id);
    if (!current) throw new Error(`Agent run '${id}' was not found.`);
    current.controller.abort(new Error("Agent run cancelled by the user."));
    current.run.status = "cancelled";
    current.run.updatedAt = new Date().toISOString();
    return { ...current.run };
  }

  async run(
    runId: string,
    provider: AgentTurnProvider,
    initialMessages: readonly AgentProviderMessage[],
  ): Promise<AgentRunResult> {
    const current = this.#runs.get(runId);
    if (!current) throw new Error(`Agent run '${runId}' was not found.`);
    if (!provider.capabilities().nativeToolCalling) {
      current.run.status = "failed";
      current.run.error = {
        code: "AGENT_NOT_SUPPORTED_BY_PROVIDER",
        message: "Agent mode requires native structured tool calling.",
      };
      throw Object.assign(new Error(current.run.error.message), {
        code: current.run.error.code,
      });
    }
    if (current.run.status !== "queued") {
      throw new Error(
        `Agent run '${runId}' cannot start from ${current.run.status}.`,
      );
    }

    const messages: AgentProviderMessage[] = [...initialMessages];
    const toolResults: Array<{
      callId: string;
      toolName: string;
      arguments: JsonObject;
      result: JsonValue;
    }> = [];
    let finalText = "";
    current.run.status = "running";
    current.run.updatedAt = new Date().toISOString();

    try {
      while (current.run.currentStep < this.#limits.maxSteps) {
        this.#throwIfCancelled(current.run, current.controller.signal);
        current.run.currentStep += 1;
        current.run.updatedAt = new Date().toISOString();
        const calls: Array<{
          callId: string;
          toolName: string;
          arguments: JsonObject;
        }> = [];
        let turnText = "";

        for await (const event of provider.generate(
          {
            requestId: `${runId}:${String(current.run.currentStep)}`,
            messages,
            tools: this.registry.list().map((tool) => ({
              name: tool.name,
              description: tool.description,
              inputSchema: tool.inputSchema,
            })),
          },
          current.controller.signal,
        )) {
          this.#throwIfCancelled(current.run, current.controller.signal);
          if (event.type === "text-delta") {
            turnText += event.delta;
          } else if (event.type === "tool-call-complete") {
            calls.push({
              callId: event.callId,
              toolName: event.name,
              arguments: event.arguments,
            });
          } else if (event.type === "error") {
            throw Object.assign(new Error(event.message), { code: event.code });
          }
        }

        if (turnText) {
          finalText += turnText;
          messages.push({ role: "assistant", content: turnText });
        }
        if (calls.length === 0) {
          current.run.status = "completed";
          current.run.updatedAt = new Date().toISOString();
          return {
            run: { ...current.run },
            text: finalText,
            messages,
            toolResults,
          };
        }

        for (const call of calls) {
          this.#throwIfCancelled(current.run, current.controller.signal);
          current.run.toolCallCount += 1;
          if (current.run.toolCallCount > this.#limits.maxToolCalls) {
            throw new AgentRuntimeError(
              "AGENT_TOOL_CALL_LIMIT_REACHED",
              `Agent run exceeded ${String(this.#limits.maxToolCalls)} tool calls.`,
            );
          }
          const tool = this.registry.get(call.toolName);
          if (!tool) {
            throw new AgentRuntimeError(
              "TOOL_NOT_FOUND",
              `Agent tool '${call.toolName}' is not registered.`,
            );
          }
          const decision =
            (await this.options.decide?.({
              run: { ...current.run },
              toolName: call.toolName,
              effect: tool.effect,
              arguments: call.arguments,
            })) ?? {};
          const requiresConfirmation =
            tool.confirmation === "always" ||
            (tool.confirmation === "policy" &&
              decision.allowPolicyWrite !== true);
          if (requiresConfirmation && decision.confirmed !== true) {
            current.run.status = "waiting_confirmation";
            current.run.updatedAt = new Date().toISOString();
            throw new AgentRuntimeError(
              "CONFIRMATION_REQUIRED",
              `Agent tool '${call.toolName}' requires human confirmation.`,
              { callId: call.callId, toolName: call.toolName },
            );
          }
          if (tool.effect === "read") {
            current.run.consecutiveWrites = 0;
          } else {
            current.run.consecutiveWrites += 1;
            if (
              current.run.consecutiveWrites > this.#limits.maxConsecutiveWrites
            ) {
              throw new AgentRuntimeError(
                "AGENT_WRITE_LIMIT_REACHED",
                `Agent run exceeded ${String(this.#limits.maxConsecutiveWrites)} consecutive writes.`,
              );
            }
          }
          const result = await this.registry.execute(
            call.toolName,
            call.arguments,
            {
              runId,
              conversationId: current.run.conversationId,
              userId: current.run.userId,
              signal: current.controller.signal,
            },
          );
          const recorded = { ...call, result };
          toolResults.push(recorded);
          await this.options.onToolResult?.({
            run: { ...current.run },
            ...recorded,
          });
          messages.push({
            role: "tool",
            toolCallId: call.callId,
            content: JSON.stringify(result),
          });
        }
      }
      throw new AgentRuntimeError(
        "AGENT_STEP_LIMIT_REACHED",
        `Agent run exceeded ${String(this.#limits.maxSteps)} steps.`,
      );
    } catch (error) {
      if (current.controller.signal.aborted) {
        current.run.status = "cancelled";
        current.run.error = {
          code: "AGENT_RUN_CANCELLED",
          message: "Agent run was cancelled.",
        };
      } else if (current.run.status !== "waiting_confirmation") {
        current.run.status = "failed";
        current.run.error = {
          code:
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            typeof error.code === "string"
              ? error.code
              : "AGENT_RUNTIME_FAILED",
          message: error instanceof Error ? error.message : String(error),
        };
      }
      current.run.updatedAt = new Date().toISOString();
      throw error;
    }
  }

  #throwIfCancelled(run: RuntimeRun, signal: AbortSignal): void {
    if (signal.aborted || run.status === "cancelled") {
      throw new AgentRuntimeError(
        "AGENT_RUN_CANCELLED",
        `Agent run '${run.id}' has been cancelled.`,
        { runId: run.id },
      );
    }
  }
}
