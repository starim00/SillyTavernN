import { describe, expect, it } from "vitest";
import { OpenAICompatibleProvider } from "./openai.js";
import { OpenAIResponsesProvider } from "./responses.js";

describe.each(["chat", "responses"] as const)(
  "%s reasoning effort",
  (protocol) => {
    it.each(["auto", "low", "medium", "high"])(
      "sends %s in the protocol field",
      async (effort) => {
        let body: Record<string, unknown> = {};
        const Provider =
          protocol === "chat"
            ? OpenAICompatibleProvider
            : OpenAIResponsesProvider;
        const provider = new Provider(
          { baseUrl: "https://example.invalid/v1", model: "test" },
          async (_url, init) => {
            if (typeof init?.body !== "string")
              throw new Error("Expected JSON body");
            body = JSON.parse(init.body) as Record<string, unknown>;
            return new Response("data: [DONE]\n\n", {
              headers: { "content-type": "text/event-stream" },
            });
          },
        );
        for await (const event of provider.generate({
          requestId: "test",
          messages: [],
          settings: {
            additional: {
              reasoning_effort: effort,
              ...(protocol === "responses"
                ? { reasoning: { effort: "high", summary: "auto" } }
                : {}),
            },
          },
        })) {
          void event;
        }
        if (protocol === "chat")
          expect(body.reasoning_effort).toBe(
            effort === "auto" ? undefined : effort,
          );
        else {
          expect(body).not.toHaveProperty("reasoning_effort");
          expect(body.reasoning).toEqual(
            effort === "auto"
              ? { summary: "auto" }
              : { summary: "auto", effort },
          );
        }
      },
    );
  },
);
