import { describe, expect, it, vi } from "vitest";

import {
  applyRegexScripts,
  applyRegexScriptsWithDiagnostics,
  collectRegexScripts,
  parseRegexScripts,
  REGEX_SCRIPT_FIELDS,
  splitRegexPattern,
} from "./index.js";
import type {
  ApplyRegexScriptsOptions,
  RegexPlacement,
  RegexScript,
  RegexScriptSource,
} from "./types.js";

function rawScript(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id: "script",
    scriptName: "Script",
    findRegex: "before",
    replaceString: "after",
    trimStrings: [],
    placement: [1],
    disabled: false,
    markdownOnly: false,
    promptOnly: false,
    runOnEdit: false,
    substituteRegex: 0,
    minDepth: null,
    maxDepth: null,
    ...overrides,
  };
}

function parsedScript(
  overrides: Readonly<Record<string, unknown>> = {},
  source: RegexScriptSource = "card",
): RegexScript {
  const parsed = parseRegexScripts([rawScript(overrides)], { source });
  expect(parsed.scripts).toHaveLength(1);
  return parsed.scripts[0]!;
}

function apply(
  text: string,
  script: RegexScript,
  options: Partial<ApplyRegexScriptsOptions> = {},
): string {
  return applyRegexScripts(text, [script], {
    placement: 1,
    ...options,
  });
}

describe("regex script parsing and collection", () => {
  it("normalizes all thirteen legacy fields without executable content", () => {
    const parsed = parseRegexScripts(
      [
        rawScript({
          id: 17,
          scriptName: "Normalize",
          findRegex: "/hello/gi",
          replaceString: "<b>{{match}}</b>",
          trimStrings: "a\r\nb",
          placement: ["1", 2, 2, 4],
          disabled: 1,
          markdownOnly: "true",
          promptOnly: 0,
          runOnEdit: "1",
          substituteRegex: "2",
          minDepth: "-1",
          maxDepth: "4",
        }),
      ],
      { source: "card" },
    );

    expect(REGEX_SCRIPT_FIELDS).toHaveLength(13);
    expect(parsed.scripts).toEqual([
      {
        id: "17",
        scriptName: "Normalize",
        findRegex: "/hello/gi",
        replaceString: "<b>{{match}}</b>",
        trimStrings: ["a", "b"],
        placement: [1, 2],
        disabled: true,
        markdownOnly: true,
        promptOnly: false,
        runOnEdit: true,
        substituteRegex: 2,
        minDepth: null,
        maxDepth: 4,
        source: "card",
        sourceIndex: 0,
      },
    ]);
    expect(parsed.diagnostics.map(({ code }) => code)).toContain(
      "REGEX_PLACEMENT_INVALID",
    );
  });

  it("collects global, preset, and current-card scripts in compatibility order", () => {
    const collected = collectRegexScripts({
      global: {
        regex_scripts: [
          rawScript({
            id: "global",
            findRegex: "value",
            replaceString: "global",
          }),
        ],
      },
      preset: {
        extensions: {
          legacySource: {
            extensions: {
              regex_scripts: [
                rawScript({
                  id: "preset",
                  findRegex: "global",
                  replaceString: "preset",
                }),
              ],
            },
          },
        },
      },
      card: {
        extensions: {
          regex_scripts: [
            rawScript({
              id: "card",
              findRegex: "preset",
              replaceString: "card",
            }),
          ],
        },
      },
    });

    expect(collected.scripts.map(({ id, source }) => [id, source])).toEqual([
      ["global", "global"],
      ["preset", "preset"],
      ["card", "card"],
    ]);
    expect(
      applyRegexScriptsWithDiagnostics(
        "value",
        [...collected.scripts].reverse(),
        {
          placement: 1,
        },
      ),
    ).toMatchObject({
      text: "card",
      appliedScriptIds: ["global", "preset", "card"],
    });
    expect(
      applyRegexScripts("value", collected.scripts, {
        placement: 1,
      }),
    ).toBe("card");
  });

  it("reports malformed extension containers and script values", () => {
    const invalidExtensions = collectRegexScripts({
      card: { extensions: "not-an-object" },
    });
    const invalidScripts = collectRegexScripts({
      preset: { regex_scripts: {} },
    });
    const invalidEntry = parseRegexScripts([null], { source: "global" });

    expect(invalidExtensions.diagnostics[0]?.code).toBe(
      "REGEX_EXTENSIONS_INVALID",
    );
    expect(invalidScripts.diagnostics[0]?.code).toBe("REGEX_SCRIPTS_INVALID");
    expect(invalidEntry.diagnostics[0]?.code).toBe("REGEX_SCRIPT_INVALID");
  });
});

describe("regex pattern and replacement compatibility", () => {
  it("supports raw patterns and slash-delimited patterns with flags", () => {
    expect(splitRegexPattern(String.raw`/foo\/bar/gi`)).toEqual({
      pattern: String.raw`foo\/bar`,
      flags: "gi",
    });
    expect(splitRegexPattern("cat")).toEqual({
      pattern: "cat",
      flags: "",
    });

    const global = parsedScript({
      findRegex: String.raw`/foo\/bar/gi`,
      replaceString: "hit",
    });
    const firstOnly = parsedScript({
      findRegex: "cat",
      replaceString: "dog",
    });

    expect(apply("FOO/bar foo/bar", global)).toBe("hit hit");
    expect(apply("cat cat", firstOnly)).toBe("dog cat");
  });

  it("expands numeric and named groups, {{match}}, and trimStrings", () => {
    const script = parsedScript({
      findRegex: String.raw`/(?<speaker>[A-Za-z]+):\s*(\w+)/g`,
      replaceString: "$<speaker> said $2 / $1 / {{match}} / $$",
      trimStrings: [":"],
    });

    expect(apply("Alice: hello", script)).toBe(
      "Alice said hello / Alice / Alice hello / $",
    );
  });

  it("substitutes Find Regex macros in none, raw, and escaped modes", () => {
    const none = parsedScript({
      findRegex: "/{{user}}/g",
      replaceString: "none",
      substituteRegex: 0,
    });
    const raw = parsedScript({
      findRegex: "/{{user}}/g",
      replaceString: "raw",
      substituteRegex: 1,
    });
    const escaped = parsedScript({
      findRegex: "/{{USER}}/g",
      replaceString: "escaped",
      substituteRegex: 2,
    });
    const substitutions = { user: "A.B" };

    expect(apply("{{user}} A.B", none, { substitutions })).toBe("none A.B");
    expect(apply("A0B A.B", raw, { substitutions })).toBe("raw raw");
    expect(apply("A0B A.B", escaped, { substitutions })).toBe("A0B escaped");
  });

  it("returns replacement markup as inert text without evaluating it", () => {
    const sideEffect = vi.fn();
    vi.stubGlobal("__regexSideEffect", sideEffect);
    const script = parsedScript({
      findRegex: "token",
      replaceString:
        '<img src=x onerror="__regexSideEffect()"> ${__regexSideEffect()}',
    });

    expect(apply("token", script)).toBe(
      '<img src=x onerror="__regexSideEffect()"> ${__regexSideEffect()}',
    );
    expect(sideEffect).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("regex execution filters and diagnostics", () => {
  it.each([1, 2, 3, 5, 6] as const)(
    "supports placement %i",
    (placement: RegexPlacement) => {
      const script = parsedScript({ placement: [placement] });
      expect(
        applyRegexScripts("before", [script], {
          placement,
        }),
      ).toBe("after");
      expect(
        applyRegexScripts("before", [script], {
          placement: placement === 1 ? 2 : 1,
        }),
      ).toBe("before");
    },
  );

  it("honors disabled and runOnEdit", () => {
    const disabled = parsedScript({ disabled: true });
    const normal = parsedScript({ runOnEdit: false });
    const editable = parsedScript({ runOnEdit: true });

    expect(apply("before", disabled)).toBe("before");
    expect(apply("before", normal)).toBe("after");
    expect(apply("before", normal, { edited: true })).toBe("before");
    expect(apply("before", editable, { edited: true })).toBe("after");
  });

  it("honors general, markdown-only, prompt-only, and dual targets", () => {
    const stored = parsedScript();
    const markdown = parsedScript({ markdownOnly: true });
    const prompt = parsedScript({ promptOnly: true });
    const both = parsedScript({ markdownOnly: true, promptOnly: true });

    expect(apply("before", stored, { target: "stored" })).toBe("after");
    expect(apply("before", stored, { target: "markdown" })).toBe("after");
    expect(apply("before", stored, { target: "prompt" })).toBe("after");
    expect(apply("before", markdown, { target: "markdown" })).toBe("after");
    expect(apply("before", markdown, { target: "prompt" })).toBe("before");
    expect(apply("before", prompt, { target: "prompt" })).toBe("after");
    expect(apply("before", prompt, { target: "markdown" })).toBe("before");
    expect(apply("before", both, { target: "markdown" })).toBe("after");
    expect(apply("before", both, { target: "prompt" })).toBe("after");
    expect(apply("before", both, { target: "stored" })).toBe("before");
  });

  it("applies inclusive minDepth and maxDepth bounds", () => {
    const bounded = parsedScript({ minDepth: 1, maxDepth: 2 });
    const unlimited = parsedScript({ minDepth: -1, maxDepth: -1 });

    expect(apply("before", bounded, { depth: 0 })).toBe("before");
    expect(apply("before", bounded, { depth: 1 })).toBe("after");
    expect(apply("before", bounded, { depth: 2 })).toBe("after");
    expect(apply("before", bounded, { depth: 3 })).toBe("before");
    expect(apply("before", bounded)).toBe("after");
    expect(apply("before", bounded, { depth: -1 })).toBe("before");
    expect(apply("before", unlimited, { depth: -1 })).toBe("after");
  });

  it("safely skips invalid regexes, emits diagnostics, and continues", () => {
    const invalid = parsedScript({
      id: "invalid",
      scriptName: "Invalid",
      findRegex: "/[/g",
    });
    const valid = parsedScript(
      {
        id: "valid",
        scriptName: "Valid",
        findRegex: "before",
        replaceString: "after",
      },
      "preset",
    );
    const onDiagnostic = vi.fn();

    const result = applyRegexScriptsWithDiagnostics(
      "before",
      [valid, invalid],
      {
        placement: 1,
        onDiagnostic,
      },
    );

    expect(result.text).toBe("after");
    expect(result.appliedScriptIds).toEqual(["valid"]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        severity: "warning",
        code: "REGEX_PATTERN_INVALID",
      }),
    ]);
    expect(onDiagnostic).toHaveBeenCalledWith(result.diagnostics[0]);
  });
});
