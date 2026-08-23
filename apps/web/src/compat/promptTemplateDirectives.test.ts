import { describe, expect, it } from "vitest";

import {
  applyPromptInjections,
  isStandalonePromptTemplateEntry,
  parsePromptInjection,
  parsePromptTemplateDecorators,
  promptTemplateRenderPosition,
} from "./promptTemplateDirectives";

describe("Prompt Template directive contracts", () => {
  it("parses only pinned decorators and preserves an escaped decorator line", () => {
    expect(
      parsePromptTemplateDecorators("@@activate\n@@if variables.ready\nbody"),
    ).toEqual({
      cleanContent: "body",
      decorators: [
        { name: "activate", argument: "" },
        { name: "if", argument: "variables.ready" },
      ],
    });
    expect(parsePromptTemplateDecorators("@@@activate\nbody")).toEqual({
      cleanContent: "@@@activate\nbody",
      decorators: [],
    });
  });

  it("recognizes only pinned standalone render positions", () => {
    const before = {
      title: "[render:before]",
      enabled: false,
      decorators: [],
    };
    const after = {
      title: "Status",
      enabled: false,
      decorators: [{ name: "render_after", argument: "" }],
    };
    const unrelated = {
      title: "[RENDER:SOMETIME]",
      enabled: true,
      decorators: [],
    };

    expect(promptTemplateRenderPosition(before)).toBe("BEFORE");
    expect(promptTemplateRenderPosition(after)).toBe("AFTER");
    expect(isStandalonePromptTemplateEntry(before)).toBe(true);
    expect(isStandalonePromptTemplateEntry(after)).toBe(true);
    expect(promptTemplateRenderPosition(unrelated)).toBeUndefined();
    expect(isStandalonePromptTemplateEntry(unrelated)).toBe(false);
  });

  it("inserts same-position messages in worldbook order", async () => {
    const instructions = [
      parsePromptInjection(
        "@INJECT target=user,index=1,at=before,role=system",
        "later",
        20,
        1,
      ),
      parsePromptInjection(
        "@INJECT target=user,index=1,at=before,role=system",
        "earlier",
        10,
        0,
      ),
    ].filter((value) => value !== null);
    await expect(
      applyPromptInjections(
        [
          { role: "system", content: "base" },
          { role: "user", content: "question" },
        ],
        instructions,
        async () => -1,
      ),
    ).resolves.toEqual([
      { role: "system", content: "base" },
      { role: "system", content: "earlier" },
      { role: "system", content: "later" },
      { role: "user", content: "question" },
    ]);
  });

  it("supports negative absolute positions and skips missing targets", async () => {
    const instructions = [
      parsePromptInjection("@INJECT pos=-1,role=assistant", "tail", 0, 0),
      parsePromptInjection(
        "@INJECT target=assistant,index=2,role=system",
        "missing",
        0,
        1,
      ),
    ].filter((value) => value !== null);
    await expect(
      applyPromptInjections(
        [
          { role: "system", content: "base" },
          { role: "user", content: "question" },
        ],
        instructions,
        async () => -1,
      ),
    ).resolves.toEqual([
      { role: "system", content: "base" },
      { role: "assistant", content: "tail" },
      { role: "user", content: "question" },
    ]);
  });
});
