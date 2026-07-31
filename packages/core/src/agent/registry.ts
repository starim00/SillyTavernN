import type { JsonObject, JsonValue } from "@stn/contracts";
import type { z } from "zod";

import { AgentRuntimeError } from "./errors.js";

export type ToolEffect = "read" | "write" | "destructive";

export interface AgentExecutionContext {
  readonly runId: string;
  readonly conversationId: string;
  readonly userId: string;
  readonly signal: AbortSignal;
}

export interface AgentToolDefinition<TInput extends JsonObject = JsonObject> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodType<TInput>;
  readonly jsonSchema: JsonObject;
  readonly effect: ToolEffect;
  readonly confirmation: "never" | "policy" | "always";
  readonly capability: string;
  readonly timeoutMs?: number;
  readonly maxResultBytes?: number;
  readonly execute: (
    input: TInput,
    context: AgentExecutionContext,
  ) => Promise<JsonValue> | JsonValue;
}

export interface RegisteredToolSummary {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonObject;
  readonly effect: ToolEffect;
  readonly confirmation: "never" | "policy" | "always";
  readonly capability: string;
}

const utf8 = new TextEncoder();

export class AgentToolRegistry {
  readonly #tools = new Map<string, AgentToolDefinition>();

  register<TInput extends JsonObject>(
    definition: AgentToolDefinition<TInput>,
  ): void {
    if (this.#tools.has(definition.name)) {
      throw new Error(`Agent tool '${definition.name}' is already registered.`);
    }
    this.#tools.set(
      definition.name,
      definition as unknown as AgentToolDefinition,
    );
  }

  unregister(name: string): boolean {
    return this.#tools.delete(name);
  }

  list(): readonly RegisteredToolSummary[] {
    return [...this.#tools.values()]
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.jsonSchema,
        effect: tool.effect,
        confirmation: tool.confirmation,
        capability: tool.capability,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  get(name: string): AgentToolDefinition | undefined {
    return this.#tools.get(name);
  }

  async execute(
    name: string,
    args: JsonObject,
    context: AgentExecutionContext,
  ): Promise<JsonValue> {
    const tool = this.#tools.get(name);
    if (!tool) {
      throw new AgentRuntimeError(
        "TOOL_NOT_FOUND",
        `Agent tool '${name}' is not registered.`,
        { toolName: name },
      );
    }
    if (context.signal.aborted) {
      throw new AgentRuntimeError(
        "AGENT_RUN_CANCELLED",
        `Agent run '${context.runId}' has been cancelled.`,
        { runId: context.runId },
      );
    }
    const parsed = tool.inputSchema.safeParse(args);
    if (!parsed.success) {
      throw new AgentRuntimeError(
        "TOOL_ARGUMENT_INVALID",
        `Arguments for '${name}' did not match its schema.`,
        {
          toolName: name,
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      );
    }

    const controller = new AbortController();
    const forwardAbort = () => controller.abort(context.signal.reason);
    context.signal.addEventListener("abort", forwardAbort, { once: true });
    const timeout = setTimeout(
      () =>
        controller.abort(
          new Error(
            `Agent tool '${name}' exceeded ${String(tool.timeoutMs ?? 10_000)} ms.`,
          ),
        ),
      tool.timeoutMs ?? 10_000,
    );
    try {
      const result = await tool.execute(parsed.data, {
        ...context,
        signal: controller.signal,
      });
      if (context.signal.aborted) {
        throw new AgentRuntimeError(
          "AGENT_RUN_CANCELLED",
          `Agent run '${context.runId}' has been cancelled.`,
          { runId: context.runId },
        );
      }
      const serialized = JSON.stringify(result);
      const maxBytes = tool.maxResultBytes ?? 128 * 1024;
      if (utf8.encode(serialized).byteLength > maxBytes) {
        return {
          truncated: true,
          code: "TOOL_RESULT_TRUNCATED",
          preview: serialized.slice(0, Math.max(0, maxBytes - 256)),
        };
      }
      return result;
    } finally {
      clearTimeout(timeout);
      context.signal.removeEventListener("abort", forwardAbort);
    }
  }
}
