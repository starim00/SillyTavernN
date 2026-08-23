import { describe, expect, it } from "vitest";

import { repairAssistantStructuredContent } from "./assistant-content-repair.js";

describe("repairAssistantStructuredContent", () => {
  it("leaves ordinary prose and standalone analysis tags unchanged", () => {
    expect(repairAssistantStructuredContent("ordinary reply")).toBe(
      "ordinary reply",
    );
    expect(
      repairAssistantStructuredContent("<Analysis>thinking</Analysis>"),
    ).toBe("<Analysis>thinking</Analysis>");
  });

  it("repairs missing outer and inner closing tags", () => {
    const repaired = repairAssistantStructuredContent(
      '<UpdateVariable>\n<Analysis>changed\n<JSONPatch>\n[{"op":"replace","path":"/state","value":true}',
    );

    expect(repaired).toContain("<Analysis>changed\n</Analysis>");
    expect(repaired).toContain(
      '[{"op":"replace","path":"/state","value":true}]',
    );
    expect(repaired).toContain("</JSONPatch>");
    expect(repaired).toMatch(/<\/UpdateVariable>\s*$/);
  });

  it("restores a missing UpdateVariable wrapper around the two inner blocks", () => {
    const repaired = repairAssistantStructuredContent(
      'Reply\n<Analysis>changed</Analysis>\n<JSONPatch>[{"op":"remove","path":"/alert"}]</JSONPatch>',
    );

    expect(repaired).toBe(
      'Reply\n<UpdateVariable>\n<Analysis>changed</Analysis>\n<JSONPatch>\n[{"op":"remove","path":"/alert"}]\n</JSONPatch>\n</UpdateVariable>',
    );
  });

  it("adds an empty Analysis envelope when only that block is absent", () => {
    const repaired = repairAssistantStructuredContent(
      '<UpdateVariable>\n<JSONPatch>[{"op":"remove","path":"/alert"}]</JSONPatch>\n</UpdateVariable>',
    );

    expect(repaired).toContain("<Analysis>\n</Analysis>\n<JSONPatch>");
  });

  it("wraps bare patch objects, inserts separators, and decodes entities", () => {
    const repaired = repairAssistantStructuredContent(
      '<UpdateVariable>\n<Analysis>changed</Analysis>\n&#x20; { &quot;op&quot;: &quot;replace&quot;, &quot;path&quot;: &quot;/a&quot;, &quot;value&quot;: true }\n {"op":"remove","path":"/b"}\n</UpdateVariable>',
    );

    const body = /<JSONPatch>\s*([\s\S]*?)\s*<\/JSONPatch>/.exec(repaired)?.[1];
    expect(body).toBeTruthy();
    expect(JSON.parse(body!)).toEqual([
      { op: "replace", path: "/a", value: true },
      { op: "remove", path: "/b" },
    ]);
  });

  it("accepts escaped known tags and repairs an entity-encoded patch array", () => {
    const repaired = repairAssistantStructuredContent(
      "\\<UpdateVariable>\n\\<Analysis>changed\\</Analysis>\n\\<JSONPatch>\n[\n&#x20; { &quot;op&quot;: &quot;replace&quot;, &quot;path&quot;: &quot;/state&quot;, &quot;value&quot;: true }\n]\n\\</JSONPatch>\n\\</UpdateVariable>",
    );

    expect(repaired).not.toContain("\\<");
    const body = /<JSONPatch>\s*([\s\S]*?)\s*<\/JSONPatch>/.exec(repaired)?.[1];
    expect(JSON.parse(body!)).toEqual([
      { op: "replace", path: "/state", value: true },
    ]);
  });

  it("does not invent data for malformed or unterminated JSON strings", () => {
    const source =
      '<UpdateVariable><Analysis>changed</Analysis><JSONPatch>[{"op":"replace","path":"/a","value":"cut</JSONPatch></UpdateVariable>';
    expect(repairAssistantStructuredContent(source)).toBe(source);
  });

  it("does not rewrite JSON-looking punctuation inside valid string values", () => {
    const source =
      '<UpdateVariable><Analysis>changed</Analysis><JSONPatch>[{"op":"replace","path":"/text","value":"keep }{ and ,] exactly"}]</JSONPatch></UpdateVariable>';
    expect(repairAssistantStructuredContent(source)).toContain(
      '"value":"keep }{ and ,] exactly"',
    );
  });
});
