import { describe, expect, it } from "vitest";

import { DeterministicFakeProvider } from "./fake.js";
import { OpenAICompatibleProvider } from "./openai.js";
import { TextCompletionProvider } from "./text.js";
import { assertAgentSupported } from "./types.js";

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

  it("does not allow Agent mode on text completion providers", () => {
    const provider = new TextCompletionProvider({
      baseUrl: "http://localhost:5001/v1",
      model: "local",
    });
    expect(() => assertAgentSupported(provider)).toThrowError(
      expect.objectContaining({ code: "AGENT_NOT_SUPPORTED_BY_PROVIDER" }),
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
