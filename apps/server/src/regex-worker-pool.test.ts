import { afterEach, describe, expect, it } from "vitest";

import type { RegexScript } from "@stn/core";

import { RegexWorkerPool } from "./regex-worker-pool.js";

const pools: RegexWorkerPool[] = [];

function script(findRegex: string, replaceString = "ok"): RegexScript {
  return {
    id: "test-script",
    scriptName: "test script",
    findRegex,
    replaceString,
    trimStrings: [],
    placement: [2],
    disabled: false,
    markdownOnly: false,
    promptOnly: false,
    runOnEdit: true,
    substituteRegex: 0,
    minDepth: null,
    maxDepth: null,
    source: "card",
    sourceIndex: 0,
  };
}

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.close()));
});

describe("RegexWorkerPool", () => {
  it("terminates catastrophic regex execution and recovers with a new worker", async () => {
    const pool = new RegexWorkerPool(1, 25);
    pools.push(pool);
    const dangerous = await pool.apply(
      `${"a".repeat(80_000)}!`,
      [script("(a+)+$")],
      { placement: 2, target: "markdown" },
    );
    expect(dangerous.text).toBe(`${"a".repeat(80_000)}!`);
    expect(dangerous.diagnostics.map((item) => item.code)).toContain(
      "REGEX_TIMEOUT",
    );

    await expect(
      pool.apply("seed", [script("seed", "safe")], {
        placement: 2,
        target: "markdown",
      }),
    ).resolves.toMatchObject({ text: "safe" });
  });

  it("keeps successful replacements around a timed-out script", async () => {
    const pool = new RegexWorkerPool(1, 25);
    pools.push(pool);
    const input = `${"a".repeat(80_000)}!`;
    const result = await pool.apply(
      input,
      [
        { ...script("^", "prefix:"), id: "before-timeout" },
        { ...script("(a+)+$"), id: "timed-out" },
        { ...script("!$", "?"), id: "after-timeout" },
      ],
      { placement: 2, target: "markdown" },
    );

    expect(result.text).toBe(`prefix:${"a".repeat(80_000)}?`);
    expect(result.appliedScriptIds).toEqual([
      "before-timeout",
      "after-timeout",
    ]);
    expect(result.diagnostics.map((item) => item.code)).toContain(
      "REGEX_TIMEOUT",
    );
  });

  it("returns the original input when input or output limits are exceeded", async () => {
    const pool = new RegexWorkerPool(1);
    pools.push(pool);
    const oversized = "x".repeat(2 * 1024 * 1024 + 1);
    await expect(
      pool.apply(oversized, [script("x")], {
        placement: 2,
        target: "markdown",
      }),
    ).resolves.toMatchObject({
      text: oversized,
      diagnostics: [{ code: "REGEX_INPUT_LIMIT" }],
    });
  });
});
