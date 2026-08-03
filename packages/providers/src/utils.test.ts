import { describe, expect, it } from "vitest";

import { estimateTokens } from "./utils.js";

describe("estimateTokens", () => {
  it("uses a conservative estimate for empty, ASCII, and mixed text", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(2);
    expect(estimateTokens("a".repeat(400))).toBe(115);
    expect(estimateTokens("中文 日本語 한국어")).toBe(10);
    expect(estimateTokens("Hello，世界！🙂")).toBe(9);
  });

  it("ignores whitespace and keeps the estimate stable through the bounded cache", () => {
    expect(estimateTokens("   \n\t")).toBe(0);
    const value = estimateTokens("cache me");
    expect(estimateTokens("cache me")).toBe(value);

    for (let index = 0; index < 1_100; index += 1) {
      estimateTokens(`entry-${index}`);
    }
    expect(estimateTokens("cache me")).toBe(value);
  });
});
