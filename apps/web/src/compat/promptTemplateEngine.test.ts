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
});
