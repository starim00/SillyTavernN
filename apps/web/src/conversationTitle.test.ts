import { describe, expect, it } from "vitest";

import { createConversationTitle } from "./conversationTitle";

describe("createConversationTitle", () => {
  it("uses the card name and local creation date and time", () => {
    const createdAt = new Date(2026, 7, 21, 14, 5, 9);

    expect(createConversationTitle("雾港调查", createdAt)).toBe(
      "雾港调查 · 2026-08-21 14:05:09",
    );
  });
});
