import type { ProviderCapabilities, ProviderEvent } from "@stn/contracts";
import { z } from "zod";
import { describe, expect, it } from "vitest";

import { AgentToolRegistry } from "./registry.js";
import {
  AgentRuntime,
  type AgentProviderRequest,
  type AgentTurnProvider,
} from "./runtime.js";

class ScriptedProvider implements AgentTurnProvider {
  readonly id = "scripted";
  private turn = 0;

  constructor(private readonly supportsTools = true) {}

  capabilities(): ProviderCapabilities {
    return {
      streaming: true,
      nativeToolCalling: this.supportsTools,
      reasoning: false,
      vision: false,
    };
  }

  async *generate(request: AgentProviderRequest): AsyncIterable<ProviderEvent> {
    const sequence = 0;
    if (this.turn++ === 0) {
      yield {
        type: "tool-call-complete",
        requestId: request.requestId,
        sequence,
        callId: "call-1",
        name: "worldbook.entry.create",
        arguments: { worldbookId: "book-1", content: "fact" },
      };
      yield {
        type: "finish",
        requestId: request.requestId,
        sequence: 1,
        reason: "tool-calls",
      };
      return;
    }
    yield {
      type: "text-delta",
      requestId: request.requestId,
      sequence,
      delta: "done",
    };
    yield {
      type: "finish",
      requestId: request.requestId,
      sequence: 1,
      reason: "stop",
    };
  }
}

describe("AgentRuntime", () => {
  it("executes a confirmed structured write and feeds its result back", async () => {
    const registry = new AgentToolRegistry();
    registry.register({
      name: "worldbook.entry.create",
      description: "Create an entry",
      inputSchema: z
        .object({
          worldbookId: z.string(),
          content: z.string(),
        })
        .strict(),
      jsonSchema: {
        type: "object",
        required: ["worldbookId", "content"],
      },
      effect: "write",
      confirmation: "policy",
      capability: "worldbook.write",
      execute: (input) => ({ id: "entry-1", ...input }),
    });
    const runtime = new AgentRuntime(registry, {
      decide: () => ({ allowPolicyWrite: true }),
    });
    const run = runtime.createRun({
      id: "run-1",
      conversationId: "conversation-1",
      userId: "user-1",
    });
    const result = await runtime.run(run.id, new ScriptedProvider(), [
      { role: "user", content: "remember this" },
    ]);
    expect(result.run.status).toBe("completed");
    expect(result.text).toBe("done");
    expect(result.toolResults).toHaveLength(1);
    expect(result.messages.some((message) => message.role === "tool")).toBe(
      true,
    );
  });

  it("rejects destructive calls without explicit confirmation", async () => {
    const registry = new AgentToolRegistry();
    registry.register({
      name: "worldbook.entry.create",
      description: "A confirmation test",
      inputSchema: z
        .object({ worldbookId: z.string(), content: z.string() })
        .strict(),
      jsonSchema: { type: "object" },
      effect: "destructive",
      confirmation: "always",
      capability: "worldbook.write",
      execute: () => ({ ok: true }),
    });
    const runtime = new AgentRuntime(registry);
    const run = runtime.createRun({
      id: "run-confirm",
      conversationId: "conversation-1",
      userId: "user-1",
    });
    await expect(
      runtime.run(run.id, new ScriptedProvider(), [
        { role: "user", content: "delete" },
      ]),
    ).rejects.toMatchObject({
      code: "CONFIRMATION_REQUIRED",
    });
    expect(runtime.getRun(run.id)?.status).toBe("waiting_confirmation");
  });

  it("refuses providers without native tool calling", async () => {
    const runtime = new AgentRuntime(new AgentToolRegistry());
    const run = runtime.createRun({
      id: "run-plain",
      conversationId: "conversation-1",
      userId: "user-1",
    });
    await expect(
      runtime.run(run.id, new ScriptedProvider(false), [
        { role: "user", content: "hello" },
      ]),
    ).rejects.toMatchObject({ code: "AGENT_NOT_SUPPORTED_BY_PROVIDER" });
  });
});
