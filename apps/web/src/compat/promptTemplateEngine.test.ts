import { afterEach, describe, expect, it, vi } from "vitest";

import { renderPromptTemplateMessages } from "./promptTemplateEngine";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("native Prompt Template processing", () => {
  it("renders EJS with merged Tavern Helper variables", async () => {
    vi.stubGlobal("window", {});
    const result = await renderPromptTemplateMessages(
      [
        {
          role: "system",
          content:
            "Favor: <%= variables.hero.favor %>; <% if (variables.hero.favor > 3) { %>high<% } %>",
        },
      ],
      {
        enabled: true,
        context: {
          conversation: {
            id: "conversation",
            cardId: "card",
            presetId: null,
          },
          sources: [],
          variables: {
            global: {},
            character: { hero: { favor: 2 } },
            preset: {},
            chat: { hero: { favor: 5 } },
            messages: {},
            scripts: {},
          },
        },
      },
    );
    expect(result.messages[0]?.content).toBe("Favor: 5; high");
    expect(result.renderedCount).toBe(1);
    expect(result.diagnostics).toEqual([]);
  });

  it("removes executable blocks when the imported source is not trusted", async () => {
    vi.stubGlobal("window", {});
    const result = await renderPromptTemplateMessages(
      [{ role: "system", content: "Before <% throw Error('no') %> after" }],
      { enabled: false, context: null },
    );
    expect(result.messages[0]?.content).toBe("Before  after");
    expect(result.renderedCount).toBe(0);
  });

  it("applies generation and independent message injection directives", async () => {
    vi.stubGlobal("window", {});
    const result = await renderPromptTemplateMessages(
      [
        { role: "system", content: "base" },
        { role: "user", content: "question" },
      ],
      {
        enabled: true,
        context: null,
        directives: [
          {
            id: "before",
            worldbookId: "book",
            title: "[GENERATE:BEFORE]",
            content: "prefix",
            enabled: false,
            order: 0,
          },
          {
            id: "inject",
            worldbookId: "book",
            title: "@INJECT target=user,index=1,at=before,role=assistant",
            content: "independent",
            enabled: false,
            order: 1,
          },
        ],
      },
    );
    expect(result.messages).toEqual([
      { role: "system", content: "prefix\nbase" },
      { role: "assistant", content: "independent" },
      { role: "user", content: "question" },
    ]);
  });

  it("evaluates worldbook entries independently and filters @@if entries", async () => {
    vi.stubGlobal("window", {});
    const result = await renderPromptTemplateMessages(
      [
        {
          role: "system",
          content:
            "@@if variables.stage === 2\nhidden branch\n<%= variables.stage %>\n\nvisible <%= variables.stage %>",
        },
      ],
      {
        enabled: true,
        context: {
          conversation: {
            id: "conversation",
            cardId: "card",
            presetId: null,
          },
          sources: [],
          worldbooks: [
            {
              id: "book",
              name: "Book",
              bindings: [],
              entries: [
                {
                  id: "conditional",
                  legacyUid: 1,
                  keys: [],
                  content:
                    "@@if variables.stage === 2\nhidden branch\n<%= variables.stage %>",
                  enabled: true,
                  position: 0,
                  metadata: { label: "Conditional" },
                },
                {
                  id: "visible",
                  legacyUid: 2,
                  keys: [],
                  content: "visible <%= variables.stage %>",
                  enabled: true,
                  position: 1,
                  metadata: { label: "Visible" },
                },
              ],
            },
          ],
          variables: {
            global: {},
            character: {},
            preset: {},
            chat: { stage: 1 },
            messages: {},
            scripts: {},
          },
        },
      },
    );
    expect(result.messages[0]?.content).not.toContain("hidden branch");
    expect(result.messages[0]?.content).toContain("visible 1");
    expect(result.sourceTemplateCount).toBe(2);
    expect(result.diagnostics).toEqual([]);
  });

  it("fails one invalid worldbook entry closed without dropping valid entries", async () => {
    vi.stubGlobal("window", {});
    const invalid = "broken <% missingHelper() %>";
    const valid = "kept <%= variables.value %>";
    const result = await renderPromptTemplateMessages(
      [{ role: "system", content: `${invalid}\n${valid}` }],
      {
        enabled: true,
        context: {
          conversation: {
            id: "conversation",
            cardId: "card",
            presetId: null,
          },
          sources: [],
          worldbooks: [
            {
              id: "book",
              name: "Book",
              bindings: [],
              entries: [
                {
                  id: "invalid",
                  legacyUid: 1,
                  keys: [],
                  content: invalid,
                  enabled: true,
                  position: 0,
                  metadata: { label: "Invalid" },
                },
                {
                  id: "valid",
                  legacyUid: 2,
                  keys: [],
                  content: valid,
                  enabled: true,
                  position: 1,
                  metadata: { label: "Valid" },
                },
              ],
            },
          ],
          variables: {
            global: {},
            character: {},
            preset: {},
            chat: { value: 7 },
            messages: {},
            scripts: {},
          },
        },
      },
    );
    expect(result.messages[0]?.content).not.toContain("broken");
    expect(result.messages[0]?.content).toContain("kept 7");
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        phase: "render",
        sourceId: "invalid",
        sourceLabel: "Book: Invalid",
      }),
    ]);
  });
});
