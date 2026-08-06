import { describe, expect, it } from "vitest";

import { DeterministicFakeProvider } from "./fake.js";
import { OpenAICompatibleProvider } from "./openai.js";
import { TextCompletionProvider } from "./text.js";
import { assertToolCallingSupported } from "./types.js";

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of source) values.push(value);
  return values;
}

describe("providers", () => {
  it("streams deterministic text and structured tool calls", async () => {
    const provider = new DeterministicFakeProvider({
      chunks: ["hello", " world"],
      toolCalls: [
        {
          id: "call-1",
          name: "worldbook.list",
          arguments: { conversationId: "conversation-1" },
        },
      ],
    });
    const events = await collect(
      provider.generate({
        requestId: "request-1",
        messages: [{ role: "user", content: "hello" }],
      }),
    );
    expect(events.filter((event) => event.type === "text-delta")).toHaveLength(
      2,
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool-call-complete",
        name: "worldbook.list",
      }),
    );
    expect(events.at(-1)).toMatchObject({
      type: "finish",
      reason: "tool-calls",
    });
  });

  it("cancels without emitting text that was not delivered", async () => {
    const provider = new DeterministicFakeProvider({
      chunks: ["late"],
      delayMs: 100,
    });
    const controller = new AbortController();
    const pending = collect(
      provider.generate(
        {
          requestId: "request-abort",
          messages: [{ role: "user", content: "stop" }],
        },
        controller.signal,
      ),
    );
    controller.abort();
    const events = await pending;
    expect(events.some((event) => event.type === "text-delta")).toBe(false);
    expect(events.at(-1)).toMatchObject({
      type: "finish",
      reason: "cancelled",
    });
  });

  it("reports when a text completion provider lacks structured tool calling", () => {
    const provider = new TextCompletionProvider({
      baseUrl: "http://localhost:5001/v1",
      model: "local",
    });
    expect(() => assertToolCallingSupported(provider)).toThrowError(
      expect.objectContaining({ code: "PROVIDER_TOOL_CALLING_NOT_SUPPORTED" }),
    );
  });

  it("parses OpenAI-compatible streaming deltas and tool calls", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            [
              'data: {"choices":[{"delta":{"content":"Hi "}}]}',
              "",
              'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-x","function":{"name":"worldbook.get","arguments":"{\\"id\\":"}}]}}]}',
              "",
              'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"book-1\\"}"}}]},"finish_reason":"tool_calls"}]}',
              "",
              "data: [DONE]",
              "",
            ].join("\n"),
          ),
        );
        controller.close();
      },
    });
    const provider = new OpenAICompatibleProvider(
      {
        baseUrl: "https://example.invalid/v1",
        model: "test",
        nativeToolCalling: true,
      },
      async () =>
        new Response(body, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
    );
    const events = await collect(
      provider.generate({
        requestId: "request-openai",
        messages: [{ role: "user", content: "hello" }],
        tools: [
          {
            name: "worldbook.get",
            description: "Get a worldbook",
            inputSchema: { type: "object" },
          },
        ],
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: "text-delta", delta: "Hi " }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool-call-complete",
        name: "worldbook.get",
        arguments: { id: "book-1" },
      }),
    );
    expect(events.at(-1)).toMatchObject({
      type: "finish",
      reason: "tool-calls",
    });
  });

  it("maps preset controls and accepts non-streaming OpenAI responses", async () => {
    let body: Record<string, unknown> | undefined;
    const provider = new OpenAICompatibleProvider(
      {
        baseUrl: "https://example.invalid/v1",
        model: "test",
      },
      async (_url, init) => {
        if (typeof init?.body !== "string") {
          throw new TypeError("Expected the provider body to be JSON text.");
        }
        body = JSON.parse(init.body) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: { role: "assistant", content: "one shot" },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 12, completion_tokens: 2 },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      },
    );

    const events = await collect(
      provider.generate({
        requestId: "request-non-streaming",
        messages: [{ role: "user", content: "hello" }],
        settings: {
          temperature: 1.25,
          topP: 0.72,
          frequencyPenalty: -0.2,
          presencePenalty: 0.35,
          maxOutputTokens: 2048,
          n: 3,
          stream: false,
        },
      }),
    );

    expect(body).toMatchObject({
      temperature: 1.25,
      top_p: 0.72,
      frequency_penalty: -0.2,
      presence_penalty: 0.35,
      max_tokens: 2048,
      n: 3,
      stream: false,
    });
    expect(events).toContainEqual(
      expect.objectContaining({ type: "text-delta", delta: "one shot" }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "usage",
        inputTokens: 12,
        outputTokens: 2,
      }),
    );
    expect(events.at(-1)).toMatchObject({ type: "finish", reason: "stop" });
  });

  it("keeps non-primary choices separate for multi-response presets", async () => {
    const provider = new OpenAICompatibleProvider(
      {
        baseUrl: "https://example.invalid/v1",
        model: "test",
      },
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "first" },
                finish_reason: "stop",
              },
              {
                index: 1,
                message: { role: "assistant", content: "second" },
                finish_reason: "stop",
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
    );

    const events = await collect(
      provider.generate({
        requestId: "request-multiple-choices",
        messages: [{ role: "user", content: "hello" }],
        settings: { n: 2, stream: false },
      }),
    );

    expect(events).toContainEqual(
      expect.objectContaining({ type: "text-delta", delta: "first" }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "text-delta",
        delta: "second",
        choiceIndex: 1,
      }),
    );
  });

  it("reports a stream that closes without a completion marker as incomplete", async () => {
    const provider = new OpenAICompatibleProvider(
      {
        baseUrl: "https://example.invalid/v1",
        model: "test",
      },
      async () =>
        new Response(
          'data: {"choices":[{"delta":{"content":"partial reply"}}]}\n\n',
          {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          },
        ),
    );

    const events = await collect(
      provider.generate({
        requestId: "request-incomplete-stream",
        messages: [{ role: "user", content: "hello" }],
      }),
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "text-delta",
        delta: "partial reply",
      }),
    );
    expect(events.at(-1)).toMatchObject({
      type: "error",
      code: "PROVIDER_STREAM_INCOMPLETE",
      retryable: true,
    });
    expect(events.some((event) => event.type === "finish")).toBe(false);
  });

  it("consumes the final SSE frame even when the proxy omits the trailing blank line", async () => {
    const provider = new OpenAICompatibleProvider(
      {
        baseUrl: "https://example.invalid/v1",
        model: "test",
      },
      async () =>
        new Response(
          'data: {"choices":[{"delta":{"content":"complete tail"},"finish_reason":"stop"}]}',
          {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          },
        ),
    );

    const events = await collect(
      provider.generate({
        requestId: "request-final-frame",
        messages: [{ role: "user", content: "hello" }],
      }),
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "text-delta",
        delta: "complete tail",
      }),
    );
    expect(events.at(-1)).toMatchObject({ type: "finish", reason: "stop" });
  });

  it("maps internal dotted tool names to provider-safe names", async () => {
    let body: Record<string, unknown> | undefined;
    const provider = new OpenAICompatibleProvider(
      {
        baseUrl: "https://example.invalid/v1",
        model: "test",
        nativeToolCalling: true,
      },
      async (_url, init) => {
        if (typeof init?.body !== "string") {
          throw new TypeError("Expected the provider body to be JSON text.");
        }
        body = JSON.parse(init.body) as Record<string, unknown>;
        const requestTools = body.tools as Record<string, unknown>[];
        const firstTool = requestTools[0]?.function as Record<string, unknown>;
        const providerToolName = firstTool.name as string;
        const stream = [
          `data: ${JSON.stringify({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "call-safe-name",
                      function: {
                        name: providerToolName,
                        arguments: "{}",
                      },
                    },
                  ],
                },
              },
            ],
          })}`,
          `data: ${JSON.stringify({
            choices: [{ delta: {}, finish_reason: "tool_calls" }],
          })}`,
          "data: [DONE]",
          "",
        ].join("\n\n");
        return new Response(stream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      },
    );

    const events = await collect(
      provider.generate({
        requestId: "request-safe-tool-name",
        messages: [{ role: "user", content: "hello" }],
        tools: [
          {
            name: "worldbook.get",
            description: "Get a worldbook",
            inputSchema: { type: "object" },
          },
        ],
      }),
    );

    const requestTools = body?.tools as Record<string, unknown>[];
    const firstTool = requestTools[0]?.function as Record<string, unknown>;
    expect(firstTool.name).toMatch(/^[a-zA-Z0-9_-]+$/u);
    expect(firstTool.name).not.toBe("worldbook.get");
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool-call-complete",
        name: "worldbook.get",
        arguments: {},
      }),
    );
  });

  it("resolves the legacy negative random-seed sentinel in OpenAI payloads", async () => {
    let body: Record<string, unknown> | undefined;
    const provider = new OpenAICompatibleProvider(
      {
        baseUrl: "https://example.invalid/v1",
        model: "test",
      },
      async (_url, init) => {
        if (typeof init?.body !== "string") {
          throw new TypeError("Expected the provider body to be JSON text.");
        }
        body = JSON.parse(init.body) as Record<string, unknown>;
        return new Response(
          'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n',
          {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          },
        );
      },
    );

    await collect(
      provider.generate({
        requestId: "request-negative-seed",
        messages: [{ role: "user", content: "hello" }],
        settings: { seed: -1 },
      }),
    );

    expect(body?.seed).toEqual(expect.any(Number));
    expect(body?.seed).toBeGreaterThanOrEqual(0);
    expect(body?.seed).toBeLessThan(0x1_0000_0000);

    await collect(
      provider.generate({
        requestId: "request-fixed-seed",
        messages: [{ role: "user", content: "hello" }],
        settings: { seed: 42 },
      }),
    );
    expect(body?.seed).toBe(42);
  });

  it("does not leak internal preset compatibility metadata to providers", async () => {
    let body: Record<string, unknown> | undefined;
    const provider = new OpenAICompatibleProvider(
      {
        baseUrl: "https://example.invalid/v1",
        model: "test",
      },
      async (_url, init) => {
        if (typeof init?.body !== "string") {
          throw new TypeError("Expected the provider body to be JSON text.");
        }
        body = JSON.parse(init.body) as Record<string, unknown>;
        return new Response("data: [DONE]\n\n", {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      },
    );

    await collect(
      provider.generate({
        requestId: "request-internal-settings",
        messages: [{ role: "user", content: "hello" }],
        settings: {
          stop: [],
          samplerOrder: [],
          additional: {
            maxContextTokens: 2_000_000,
            sourceFormat: "openai",
            min_p: 0.1,
          },
        },
      }),
    );

    expect(body).not.toHaveProperty("maxContextTokens");
    expect(body).not.toHaveProperty("sourceFormat");
    expect(body).toMatchObject({ min_p: 0.1 });
  });

  it("serializes assistant tool calls with matching tool results for continuation", async () => {
    let body: Record<string, unknown> | undefined;
    const provider = new OpenAICompatibleProvider(
      {
        baseUrl: "https://example.invalid/v1",
        model: "test",
        nativeToolCalling: true,
      },
      async (_url, init) => {
        if (typeof init?.body !== "string") {
          throw new TypeError("Expected the provider body to be JSON text.");
        }
        body = JSON.parse(init.body) as Record<string, unknown>;
        return new Response("data: [DONE]\n\n", {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      },
    );

    await collect(
      provider.generate({
        requestId: "request-tool-continuation",
        messages: [
          { role: "user", content: "What lore is available?" },
          {
            role: "assistant",
            content: "",
            toolCalls: [
              {
                id: "call-list",
                name: "worldbook.list",
                arguments: {},
              },
            ],
          },
          {
            role: "tool",
            content: '[{"id":"book-1"}]',
            name: "worldbook.list",
            toolCallId: "call-list",
          },
        ],
      }),
    );

    expect(body).toMatchObject({
      messages: [
        { role: "user", content: "What lore is available?" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call-list",
              type: "function",
              function: {
                name: "worldbook.list",
                arguments: "{}",
              },
            },
          ],
        },
        {
          role: "tool",
          content: '[{"id":"book-1"}]',
          name: "worldbook.list",
          tool_call_id: "call-list",
        },
      ],
    });
  });
});
