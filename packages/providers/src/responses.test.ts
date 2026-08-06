import { describe, expect, it } from "vitest";

import { OpenAIResponsesProvider } from "./responses.js";
import type { ProviderStreamEvent } from "./types.js";

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of source) values.push(value);
  return values;
}

function sse(...frames: Record<string, unknown>[]): string {
  return frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("");
}

describe("OpenAI Responses provider", () => {
  it("records Responses terminal diagnostics and the DONE marker", async () => {
    const provider = new OpenAIResponsesProvider(
      { baseUrl: "https://example.invalid/v1", model: "test" },
      async () =>
        new Response(
          `${sse({
            type: "response.completed",
            response: { status: "completed", output: [] },
          })}data: [DONE]\n\n`,
          {
            status: 200,
            headers: {
              "content-type": "text/event-stream",
              "x-request-id": "responses-request-id",
            },
          },
        ),
    );

    const events = await collect(
      provider.generate({
        requestId: "responses-diagnostics",
        messages: [{ role: "user", content: "hello" }],
      }),
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "provider-diagnostics",
        rawFinishReason: "completed",
        sawDone: true,
        lastFrameType: "response.completed",
        upstreamRequestId: "responses-request-id",
      }),
    );
    expect(events.findLast((event) => event.type === "finish")).toMatchObject({
      type: "finish",
      reason: "stop",
    });
  });

  it("maps stateless input, flat tools, aliases, and Responses settings", async () => {
    let body: Record<string, unknown> | undefined;
    const provider = new OpenAIResponsesProvider(
      {
        baseUrl: "https://example.invalid/v1",
        model: "deepseek-v4-flash",
        nativeToolCalling: true,
      },
      async (_url, init) => {
        if (typeof init?.body !== "string") {
          throw new TypeError("Expected JSON body");
        }
        body = JSON.parse(init.body) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            status: "completed",
            output: [
              {
                type: "message",
                role: "assistant",
                content: [{ type: "output_text", text: "ok" }],
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    );

    await collect(
      provider.generate({
        requestId: "responses-payload",
        messages: [
          { role: "system", content: "You are concise." },
          { role: "user", content: "Read the lore." },
          {
            role: "assistant",
            content: "",
            toolCalls: [
              { id: "call-1", name: "worldbook.get", arguments: { id: "b1" } },
            ],
          },
          {
            role: "tool",
            content: '{"id":"b1"}',
            name: "worldbook.get",
            toolCallId: "call-1",
          },
        ],
        tools: [
          {
            name: "worldbook.get",
            description: "Read a worldbook",
            inputSchema: {
              type: "object",
              properties: { id: { type: "string" } },
            },
          },
        ],
        settings: {
          temperature: 0.2,
          topP: 0.8,
          maxOutputTokens: 128,
          stream: false,
          n: 3,
          additional: {
            reasoning: { effort: "high" },
            model: "must-not-win",
            store: true,
            input: "must-not-win",
            maxContextTokens: 123,
          },
        },
        metadata: { conversationId: "private" },
      }),
    );

    expect(body).toMatchObject({
      model: "deepseek-v4-flash",
      store: false,
      stream: false,
      temperature: 0.2,
      top_p: 0.8,
      max_output_tokens: 128,
      reasoning: { effort: "high" },
    });
    expect(body).not.toHaveProperty("n");
    expect(body).not.toHaveProperty("metadata");
    expect(body).not.toHaveProperty("maxContextTokens");
    expect(body).not.toHaveProperty("input", "must-not-win");
    const input = body?.input as Record<string, unknown>[];
    expect(input).toHaveLength(4);
    expect(input[2]).toMatchObject({
      type: "function_call",
      call_id: "call-1",
    });
    expect(input[2]?.name).toMatch(/^stn_[0-9a-f]+$/u);
    expect(input[3]).toEqual({
      type: "function_call_output",
      call_id: "call-1",
      output: '{"id":"b1"}',
    });
  });

  it("parses DeepSeek-style text, reasoning, parallel calls, usage, and no [DONE]", async () => {
    const provider = new OpenAIResponsesProvider(
      {
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-v4-flash",
        nativeToolCalling: true,
      },
      async () =>
        new Response(
          sse(
            { type: "response.created", response: { status: "in_progress" } },
            { type: "response.output_text.delta", delta: "I will " },
            { type: "response.reasoning_text.delta", delta: "think " },
            {
              type: "response.output_item.added",
              item: {
                id: "fc-item-1",
                type: "function_call",
                call_id: "call-1",
                name: "stn_776f726c64626f6f6b2e676574",
                arguments: "",
              },
            },
            {
              type: "response.function_call_arguments.delta",
              item_id: "fc-item-1",
              call_id: "call-1",
              delta: '{"id":"b1"}',
            },
            {
              type: "response.output_item.added",
              item: {
                id: "fc-item-2",
                type: "function_call",
                call_id: "call-2",
                name: "worldbook.list",
                arguments: "{}",
              },
            },
            {
              type: "response.completed",
              response: {
                status: "completed",
                output: [
                  {
                    id: "fc-item-1",
                    type: "function_call",
                    call_id: "call-1",
                    name: "stn_776f726c64626f6f6b2e676574",
                    arguments: '{"id":"b1"}',
                  },
                  {
                    id: "fc-item-2",
                    type: "function_call",
                    call_id: "call-2",
                    name: "worldbook.list",
                    arguments: "{}",
                  },
                ],
                usage: {
                  input_tokens: 44,
                  output_tokens: 12,
                  input_tokens_details: { cached_tokens: 9 },
                },
              },
            },
          ),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        ),
    );
    const events = await collect(
      provider.generate({
        requestId: "responses-stream",
        messages: [{ role: "user", content: "Read." }],
        tools: [
          {
            name: "worldbook.get",
            description: "Read",
            inputSchema: { type: "object" },
          },
          {
            name: "worldbook.list",
            description: "List",
            inputSchema: { type: "object" },
          },
        ],
      }),
    );

    expect(events).toContainEqual(
      expect.objectContaining({ type: "text-delta", delta: "I will " }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: "reasoning-delta", delta: "think " }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool-call-complete",
        callId: "call-1",
        name: "worldbook.get",
        arguments: { id: "b1" },
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool-call-complete",
        callId: "call-2",
        name: "worldbook.list",
        arguments: {},
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "usage",
        inputTokens: 44,
        outputTokens: 12,
        cachedTokens: 9,
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: "provider-context" }),
    );
    expect(events.at(-1)).toMatchObject({
      type: "finish",
      reason: "tool-calls",
    });
  });

  it("keeps raw output Items for a continuation and discards them from ordinary messages", async () => {
    const requests: Record<string, unknown>[] = [];
    const provider = new OpenAIResponsesProvider(
      {
        baseUrl: "https://example.invalid",
        model: "test",
        nativeToolCalling: true,
      },
      async (_url, init) => {
        if (typeof init?.body !== "string") {
          throw new TypeError("Expected JSON body");
        }
        requests.push(JSON.parse(init.body) as Record<string, unknown>);
        return new Response(
          JSON.stringify({
            status: "completed",
            output: [
              {
                type: "reasoning",
                id: "reason-1",
                summary: [{ type: "summary_text", text: "private thought" }],
              },
              {
                type: "function_call",
                id: "fc-1",
                call_id: "call-1",
                name: "worldbook.list",
                arguments: "{}",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    );
    const first = await collect(
      provider.generate({
        requestId: "context-1",
        messages: [{ role: "user", content: "List." }],
        tools: [
          {
            name: "worldbook.list",
            description: "List",
            inputSchema: { type: "object" },
          },
        ],
        settings: { stream: false },
      }),
    );
    const context = first.find(
      (
        event,
      ): event is Extract<ProviderStreamEvent, { type: "provider-context" }> =>
        event.type === "provider-context",
    );
    expect(context?.items).toHaveLength(2);
    await collect(
      provider.generate({
        requestId: "context-2",
        messages: [
          { role: "user", content: "List." },
          {
            role: "assistant",
            content: "",
            toolCalls: [
              { id: "call-1", name: "worldbook.list", arguments: {} },
            ],
            ...(context === undefined
              ? {}
              : { providerContextItems: context.items }),
          },
          {
            role: "tool",
            content: "[]",
            toolCallId: "call-1",
            name: "worldbook.list",
          },
        ],
        tools: [
          {
            name: "worldbook.list",
            description: "List",
            inputSchema: { type: "object" },
          },
        ],
        settings: { stream: false },
      }),
    );
    const nextInput = requests[1]?.input as Record<string, unknown>[];
    expect(nextInput).toHaveLength(4);
    expect(nextInput[1]).toMatchObject({ type: "reasoning" });
    expect(nextInput[2]).toMatchObject({
      type: "function_call",
      call_id: "call-1",
    });
    expect(nextInput[3]).toEqual({
      type: "function_call_output",
      call_id: "call-1",
      output: "[]",
    });
    expect(JSON.stringify(nextInput)).toContain("private thought");
  });

  it("maps incomplete, failed, invalid arguments, and truncated streams", async () => {
    const run = async (body: string) => {
      const provider = new OpenAIResponsesProvider(
        { baseUrl: "https://example.invalid", model: "test" },
        async () =>
          new Response(body, {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
      );
      return collect(
        provider.generate({
          requestId: "status",
          messages: [{ role: "user", content: "x" }],
        }),
      );
    };

    expect(
      (
        await run(
          sse({
            type: "response.incomplete",
            response: {
              status: "incomplete",
              incomplete_details: { reason: "max_output_tokens" },
            },
          }),
        )
      ).at(-1),
    ).toMatchObject({ type: "finish", reason: "length" });
    expect(
      (
        await run(
          sse({
            type: "response.incomplete",
            response: {
              status: "incomplete",
              incomplete_details: { reason: "content_filter" },
            },
          }),
        )
      ).at(-1),
    ).toMatchObject({ type: "error", code: "PROVIDER_RESPONSE_INCOMPLETE" });
    expect(
      (
        await run(
          sse({
            type: "response.failed",
            error: { code: "bad_gateway", message: "upstream failed" },
          }),
        )
      ).at(-1),
    ).toMatchObject({ type: "error", code: "bad_gateway" });
    expect(
      (
        await run(
          sse(
            {
              type: "response.output_item.added",
              item: {
                type: "function_call",
                id: "fc",
                call_id: "call",
                name: "worldbook.list",
                arguments: "{",
              },
            },
            { type: "response.completed", response: { status: "completed" } },
          ),
        )
      ).some(
        (event) =>
          event.type === "error" && event.code === "TOOL_ARGUMENT_INVALID",
      ),
    ).toBe(true);
    expect(
      (
        await run(
          'data: {"type":"response.output_text.delta","delta":"partial"}\n\n',
        )
      ).at(-1),
    ).toMatchObject({ type: "error", code: "PROVIDER_STREAM_INCOMPLETE" });
  });

  it("tests the Responses endpoint rather than only /models", async () => {
    let calledUrl = "";
    let body: Record<string, unknown> | undefined;
    const provider = new OpenAIResponsesProvider(
      { baseUrl: "https://example.invalid/v1", model: "test" },
      async (url, init) => {
        calledUrl =
          typeof url === "string"
            ? url
            : url instanceof URL
              ? url.href
              : url.url;
        if (typeof init?.body !== "string") {
          throw new TypeError("Expected JSON body");
        }
        body = JSON.parse(init.body) as Record<string, unknown>;
        return new Response(
          JSON.stringify({ status: "completed", output: [] }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      },
    );
    await expect(provider.testConnection()).resolves.toMatchObject({
      ok: true,
      model: "test",
    });
    expect(calledUrl).toBe("https://example.invalid/v1/responses");
    expect(body).toMatchObject({ model: "test", store: false, stream: false });
  });
});
