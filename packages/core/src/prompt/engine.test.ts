import type { PromptSegment, Worldbook } from "@stn/contracts";
import { describe, expect, it } from "vitest";

import { assemblePrompt } from "./assemble.js";
import { applyPromptTokenBudget, estimatePromptTokens } from "./budget.js";
import { createPromptMacroRuntime, expandPromptMacros } from "./macros.js";
import { matchWorldbookEntries } from "./worldbook.js";

function segment(
  id: string,
  content: string,
  overrides: Partial<PromptSegment> = {},
): PromptSegment {
  return {
    id,
    role: "system",
    content,
    source: { kind: "system", label: id, detail: {} },
    position: "before-history",
    priority: 0,
    order: 0,
    tokenEstimate: estimatePromptTokens(content),
    required: false,
    truncation: "drop",
    metadata: {},
    ...overrides,
  };
}

describe("prompt engine primitives", () => {
  it("assigns stable segment ids and ordering for identical inputs", () => {
    const input = {
      systemInstruction: "System law.",
      currentInput: "Current request.",
    };
    expect(assemblePrompt(input)).toEqual(assemblePrompt(input));
  });

  it("expands aliases, custom macros, escapes, and bounded recursion", () => {
    expect(
      expandPromptMacros(
        "{{user}}/{{char}}/{{participants}}/{{custom}}/\\{{user}}",
        {
          userName: "Lin",
          characterName: "Aria",
          participantNames: ["Aria", "Bo"],
          custom: { custom: "{{user}}", loop: "{{loop}}" },
        },
      ),
    ).toBe("Lin/Aria/Aria, Bo/Lin/{{user}}");
    expect(
      expandPromptMacros("{{loop}}", {
        custom: { loop: "{{loop}}" },
      }),
    ).toBe("{{loop}}");
  });

  it("removes unscoped trim controls and their surrounding line breaks", () => {
    expect(expandPromptMacros("Before\n\n{{trim}}\nAfter", {})).toBe(
      "BeforeAfter",
    );
    expect(expandPromptMacros("\\{{trim}}", {})).toBe("{{trim}}");
    expect(expandPromptMacros("{{TRIM}}Content", {})).toBe("Content");
  });

  it("evaluates legacy stateful, comment, random, dice, and chat macros", () => {
    const rolled: string[] = [];
    const runtime = createPromptMacroRuntime({
      random: () => 0.6,
      roll: (formula) => {
        rolled.push(formula);
        return 7;
      },
    });

    expect(
      expandPromptMacros(
        [
          "{{setvar::tone::bright}}",
          "{{getvar::tone}}",
          "{{// this never reaches the provider}}",
          "{{random::red::green::blue}}",
          "{{roll 1d20}}",
          "{{lastUserMessage}}",
        ].join("|"),
        { lastUserMessage: "Continue from here." },
        { runtime },
      ),
    ).toBe("|bright||green|7|Continue from here.");
    expect(rolled).toEqual(["1d20"]);
    expect(runtime.variables.get("tone")).toBe("bright");
  });

  it("honors secondary logic, whole words, and recursion guards", () => {
    const book: Worldbook = {
      id: "book",
      name: "Book",
      description: "",
      entries: [
        {
          id: "primary",
          label: "Primary",
          content: "secret lighthouse",
          primaryKeys: ["bell"],
          secondaryKeys: ["red"],
          secondaryLogic: "all",
          selective: true,
          constant: false,
          disabled: false,
          agentEditable: false,
          caseSensitive: false,
          matchWholeWords: true,
          recursion: true,
          preventRecursion: false,
          position: "before-history",
          order: 0,
          priority: 10,
          extensions: {},
          revision: 0,
        },
        {
          id: "recursive",
          label: "Recursive",
          content: "found",
          primaryKeys: ["lighthouse"],
          secondaryKeys: [],
          secondaryLogic: "any",
          selective: false,
          constant: false,
          disabled: false,
          agentEditable: false,
          caseSensitive: false,
          matchWholeWords: true,
          recursion: true,
          preventRecursion: true,
          position: "before-history",
          order: 1,
          priority: 0,
          extensions: {},
          revision: 0,
        },
        {
          id: "blocked",
          label: "Blocked",
          content: "must not appear",
          primaryKeys: ["found"],
          secondaryKeys: [],
          secondaryLogic: "any",
          selective: false,
          constant: false,
          disabled: false,
          agentEditable: false,
          caseSensitive: false,
          matchWholeWords: true,
          recursion: true,
          preventRecursion: false,
          position: "before-history",
          order: 2,
          priority: 0,
          extensions: {},
          revision: 0,
        },
      ],
      bindings: [],
      scanDepth: 4,
      recursionLimit: 4,
      agentEditable: false,
      revision: 0,
      extensions: {},
      createdAt: "2026-07-29",
      updatedAt: "2026-07-29",
    };

    const matches = matchWorldbookEntries(book ? [book] : [], [
      "The red bell rings.",
    ]);
    expect(matches.map((match) => match.entry.id)).toEqual([
      "primary",
      "recursive",
    ]);
    expect(matches.map((match) => match.depth)).toEqual([0, 1]);
  });

  it("drops low-priority context before truncating protected system and input", () => {
    const result = applyPromptTokenBudget(
      [
        segment("system", "System law must remain.", {
          position: "system",
          priority: 10_000,
          required: true,
          truncation: "head",
        }),
        segment("optional", "x".repeat(160), {
          priority: -10,
          truncation: "drop",
        }),
        segment("current", "Current input must remain.", {
          role: "user",
          position: "history",
          priority: 10_000,
          required: true,
          truncation: "tail",
          metadata: { currentInput: true },
        }),
      ],
      { maxContextTokens: 20 },
    );

    expect(result.dropped.map((value) => value.id)).toEqual(["optional"]);
    expect(result.segments.map((value) => value.id)).toEqual([
      "system",
      "current",
    ]);
    expect(result.segments.every((value) => value.content.length > 0)).toBe(
      true,
    );
    expect(result.overBudget).toBe(false);
  });
});
