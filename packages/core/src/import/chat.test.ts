import { describe, expect, it } from "vitest";

import { importConversation } from "./chat.js";

function importOptions() {
  let sequence = 0;
  return {
    now: () => "2026-07-29T00:00:00.000Z",
    idFactory: (kind: string) => `${kind}-${++sequence}`,
  };
}

describe("conversation import", () => {
  it("keeps an ordinary chat as user input and model reply", () => {
    const source = [
      JSON.stringify({ user_name: "Lin", character_name: "Aria" }),
      JSON.stringify({ name: "Lin", is_user: true, mes: "Hello." }),
      JSON.stringify({
        name: "Aria",
        is_user: false,
        mes: "Welcome.",
      }),
    ].join("\n");

    const result = importConversation(source, importOptions());

    expect(
      result.value.messages.map((message) => ({
        role: message.role,
        author: message.author.kind,
        content: message.swipes[0]?.content,
      })),
    ).toEqual([
      { role: "user", author: "user", content: "Hello." },
      { role: "assistant", author: "assistant", content: "Welcome." },
    ]);
    expect(result.value.participants).toEqual([]);
    expect(result.value.conversation.participants).toEqual([]);
  });

  it("folds legacy group speaker names into model reply bodies", () => {
    const source = [
      JSON.stringify({ user_name: "Lin", character_name: "Narrator" }),
      JSON.stringify({ name: "Lin", is_user: true, mes: "Who is here?" }),
      JSON.stringify({
        name: "Narrator",
        is_user: false,
        mes: "Two voices answer.",
      }),
      JSON.stringify({
        name: "Guide",
        is_user: false,
        mes: "I can show the way.",
        swipes: ["I can show the way.", "Follow the lantern."],
      }),
    ].join("\n");

    const result = importConversation(source, importOptions());

    expect(result.value.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "assistant",
    ]);
    expect(result.value.messages[1]?.author.kind).toBe("assistant");
    expect(result.value.messages[1]?.author).not.toHaveProperty(
      "participantId",
    );
    expect(result.value.messages[1]?.swipes[0]?.content).toBe(
      "Narrator: Two voices answer.",
    );
    expect(
      result.value.messages[2]?.swipes.map((swipe) => swipe.content),
    ).toEqual(["Guide: I can show the way.", "Guide: Follow the lantern."]);
  });

  it("ignores system records and the unused character-name sentinel", () => {
    const source = [
      JSON.stringify({ user_name: "Lin", character_name: "unused" }),
      JSON.stringify({
        name: "System",
        is_user: false,
        is_system: true,
        mes: "Imported runtime note.",
      }),
      JSON.stringify({
        name: "Guide",
        is_user: false,
        mes: "Welcome.",
      }),
    ].join("\n");

    const result = importConversation(source, {
      ...importOptions(),
      filename: "ordinary.jsonl",
    });

    expect(result.value.conversation.title).toBe("ordinary");
    expect(result.value.participants).toEqual([]);
    expect(result.value.messages[1]?.swipes[0]?.content).toBe("Welcome.");
  });

  it("maps native role, content and swipe objects without inventing actors", () => {
    const result = importConversation(
      {
        title: "Native ordinary chat",
        messages: [
          {
            id: "source-user",
            role: "user",
            content: "Open the gate.",
            author: { kind: "user", displayName: "Lin" },
            createdAt: "2026-07-29T10:00:00.000Z",
          },
          {
            id: "source-assistant",
            role: "assistant",
            author: { kind: "assistant", displayName: "Model" },
            swipes: [
              {
                id: "source-swipe-1",
                content: "The gate opens.",
              },
              {
                id: "source-swipe-2",
                content: "The gate remains closed.",
              },
            ],
            activeSwipeId: "source-swipe-2",
            createdAt: "2026-07-29T10:00:01.000Z",
          },
        ],
      },
      importOptions(),
    );

    expect(result.sourceFormat).toBe("native-conversation");
    expect(result.value.participants).toEqual([]);
    expect(
      result.value.messages.map((message) => ({
        role: message.role,
        author: message.author.kind,
        content: message.swipes.find(
          (swipe) => swipe.id === message.activeSwipeId,
        )?.content,
      })),
    ).toEqual([
      { role: "user", author: "user", content: "Open the gate." },
      {
        role: "assistant",
        author: "assistant",
        content: "The gate remains closed.",
      },
    ]);
  });
});
