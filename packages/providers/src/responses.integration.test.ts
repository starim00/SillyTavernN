import { describe, expect, it } from "vitest";

import { OpenAIResponsesProvider } from "./responses.js";

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of source) values.push(value);
  return values;
}

type LiveConfig = {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
};

const configs: LiveConfig[] = [
  {
    name: "DeepSeek",
    baseUrl: process.env.STN_DEEPSEEK_RESPONSES_BASE_URL ?? "",
    apiKey: process.env.STN_DEEPSEEK_API_KEY ?? "",
    model: process.env.STN_DEEPSEEK_RESPONSES_MODEL ?? "deepseek-v4-flash",
  },
  {
    name: "CPA",
    baseUrl: process.env.STN_CPA_RESPONSES_BASE_URL ?? "",
    apiKey: process.env.STN_CPA_RESPONSES_API_KEY ?? "",
    model: process.env.STN_CPA_RESPONSES_MODEL ?? "",
  },
].filter(
  (config): config is LiveConfig =>
    config.baseUrl.length > 0 &&
    config.apiKey.length > 0 &&
    config.model.length > 0,
);

describe.skipIf(configs.length === 0)("live Responses integrations", () => {
  it.each(configs)(
    "$name streams text and accepts a read-only function tool",
    async (config) => {
      const provider = new OpenAIResponsesProvider({
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        model: config.model,
        nativeToolCalling: true,
      });
      const events = await collect(
        provider.generate({
          requestId: `live-${config.name.toLowerCase()}`,
          messages: [
            {
              role: "user",
              content:
                "Reply with a short greeting. Do not call the tool unless needed.",
            },
          ],
          tools: [
            {
              name: "worldbook.list",
              description: "Read-only fixture catalog lookup.",
              inputSchema: { type: "object", additionalProperties: false },
            },
          ],
          settings: { stream: true, maxOutputTokens: 128 },
        }),
      );
      expect(
        events.some(
          (event) =>
            event.type === "finish" &&
            (event.reason === "stop" || event.reason === "tool-calls"),
        ),
      ).toBe(true);
      expect(
        events.some(
          (event) =>
            event.type === "text-delta" || event.type === "tool-call-complete",
        ),
      ).toBe(true);
    },
  );
});
