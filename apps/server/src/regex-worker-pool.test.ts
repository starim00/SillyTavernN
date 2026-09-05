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
  it("runs variable guards before display replacement on expanded HTML", async () => {
    const pool = new RegexWorkerPool(1);
    pools.push(pool);
    const rules = [
      script(
        String.raw`/<StatusSlot\/>(?=[\s\S]*?<UpdateVariable>)|(?<=<\/UpdateVariable>[\s\S]*?)<StatusSlot\/>/g`,
        "<StatusReady/>",
      ),
      script("<StatusReady/>", "<section>status loaded</section>"),
      script(
        String.raw`/<UpdateVariable>[\s\S]*?<\/UpdateVariable>/g`,
        "update log",
      ),
      script(String.raw`<StatusSlot\/>`, "VAR_DESYNC"),
    ].map((rule, index) => ({
      ...rule,
      id: `rule-${index}`,
      sourceIndex: index,
    }));
    const decoration = "<span>display decoration</span>".repeat(800);
    for (const content of [
      `${decoration}<UpdateVariable>update</UpdateVariable><StatusSlot/>`,
      `<StatusSlot/>${decoration}<UpdateVariable>update</UpdateVariable>`,
    ]) {
      const result = await pool.apply(content, rules, {
        placement: 2,
        target: "markdown",
      });
      expect(result.diagnostics).toEqual([]);
      expect(result.text).toContain("<section>status loaded</section>");
      expect(result.text).toContain("update log");
      expect(result.text).not.toContain("VAR_DESYNC");
      expect(result.appliedScriptIds).toEqual(["rule-0", "rule-1", "rule-2"]);
    }
    const missing = await pool.apply(`${decoration}<StatusSlot/>`, rules, {
      placement: 2,
      target: "markdown",
    });
    expect(missing.diagnostics).toEqual([]);
    expect(missing.text).toContain("VAR_DESYNC");
    expect(missing.text).not.toContain("status loaded");
  });

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
