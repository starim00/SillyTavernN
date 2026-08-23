import { afterEach, describe, expect, it, vi } from "vitest";

import {
  renderPromptTemplateDisplayMessages,
  renderPromptTemplateMessages,
} from "./promptTemplateEngine";

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

  it("omits template messages that render to empty content", async () => {
    vi.stubGlobal("window", {});
    const result = await renderPromptTemplateMessages(
      [
        { role: "user", content: "<% const hidden = true; %>" },
        { role: "user", content: "Visible" },
      ],
      { enabled: true, context: null },
    );
    expect(result.messages).toEqual([{ role: "user", content: "Visible" }]);
  });

  it("inherits the latest initialized MVU state across an empty user floor", async () => {
    vi.stubGlobal("window", {});
    const result = await renderPromptTemplateMessages(
      [
        {
          role: "user",
          content:
            "<% if (variables.stat_data.phase === 'ready') { %>initialized<% } %>",
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
            character: {},
            preset: {},
            chat: {},
            messages: {
              opening: { stat_data: { phase: "ready" } },
              user: { stat_data: {}, display_data: { compact: true } },
            },
            scripts: {},
          },
        },
      },
    );
    expect(result.messages).toEqual([{ role: "user", content: "initialized" }]);
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

  it("keeps generation output unescaped and preserves escaped EJS ranges", async () => {
    vi.stubGlobal("window", {});
    const result = await renderPromptTemplateMessages(
      [
        {
          role: "system",
          content:
            'value=<%= "<tag>" %>\n<#escape-ejs><%= untouched %><#/escape-ejs>',
        },
      ],
      { enabled: true, context: null },
    );
    expect(result.messages).toEqual([
      { role: "system", content: "value=<tag>\n<%= untouched %>" },
    ]);
  });

  it("uses the pinned inverted state and probability for standalone entries", async () => {
    vi.stubGlobal("window", {});
    const render = (enabled: boolean, probability: number) =>
      renderPromptTemplateMessages([{ role: "system", content: "base" }], {
        enabled: true,
        context: null,
        random: () => 0.5,
        directives: [
          {
            id: "before",
            worldbookId: "book",
            title: "[GENERATE:BEFORE]",
            content: "prefix",
            enabled,
            order: 0,
            probability,
          },
        ],
      });

    await expect(render(false, 100)).resolves.toMatchObject({
      messages: [{ role: "system", content: "prefix\nbase" }],
    });
    await expect(render(false, 50)).resolves.toMatchObject({
      messages: [{ role: "system", content: "base" }],
    });
    await expect(render(true, 100)).resolves.toMatchObject({
      messages: [{ role: "system", content: "base" }],
    });
  });

  it("force-activates a disabled entry through the activewi overload", async () => {
    vi.stubGlobal("window", {});
    const result = await renderPromptTemplateMessages(
      [{ role: "system", content: "base" }],
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
                  id: "forced",
                  legacyUid: 2,
                  keys: [],
                  content: "@@dont_activate\nhard forced",
                  enabled: false,
                  position: 1,
                  metadata: { label: "Forced" },
                },
              ],
            },
          ],
          variables: {
            global: {},
            character: {},
            preset: {},
            chat: {},
            messages: {},
            scripts: {},
          },
        },
        directives: [
          {
            id: "activator",
            worldbookId: "book",
            title: "[GENERATE:BEFORE]",
            content: "<% await activewi(2, true); %>",
            enabled: false,
            order: 0,
          },
        ],
      },
    );
    expect(result.messages[0]?.content).toContain("hard forced");
    expect(result.messages[0]?.content).not.toContain("@@dont_activate");
  });

  it("renders message EJS and ordered RENDER entries only for display", async () => {
    vi.stubGlobal("window", {});
    const result = await renderPromptTemplateDisplayMessages(
      [
        { role: "user", content: "User <%= variables.hp %>" },
        { role: "assistant", content: "Assistant <%- '**raw**' %>" },
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
                  id: "before",
                  legacyUid: 1,
                  keys: [],
                  content: "Before <%= message_index %>|",
                  enabled: false,
                  position: 1,
                  metadata: { label: "[RENDER:BEFORE]" },
                },
                {
                  id: "after",
                  legacyUid: 2,
                  keys: [],
                  content:
                    "@@render_after\n@@message_formatting\n@@if !is_user && !is_system\n|After <%= variables.hp %>",
                  enabled: false,
                  position: 2,
                  metadata: { label: "Status" },
                },
              ],
            },
          ],
          variables: {
            global: {},
            character: {},
            preset: {},
            chat: { hp: 80 },
            messages: {},
            scripts: {},
          },
        },
        formatDisplayContent: (content) => `<article>${content}</article>`,
        formatDisplayInline: (content) => `<mark>${content}</mark>`,
      },
    );

    expect(result.messages).toEqual([
      {
        role: "user",
        content:
          "Before <mark>0</mark>|<article>User <mark>80</mark></article>",
      },
      {
        role: "assistant",
        content:
          "Before <mark>1</mark>|<article>Assistant **raw**</article><article>|After <mark>80</mark></article>",
      },
    ]);
    expect(result.displayRenderedIndexes).toEqual([0, 1]);
    expect(result.diagnostics).toEqual([]);
  });

  it("removes untrusted display EJS while preserving escaped template text", async () => {
    vi.stubGlobal("window", {});
    const result = await renderPromptTemplateDisplayMessages(
      [
        {
          role: "assistant",
          content:
            "Before <% throw Error('blocked') %><#escape-ejs><%= literal %><#/escape-ejs>",
        },
      ],
      {
        enabled: false,
        context: null,
        formatDisplayContent: (content) => content,
        formatDisplayInline: (content) => content,
      },
    );

    expect(result.messages[0]?.content).toBe("Before <%= literal %>");
    expect(result.displayRenderedIndexes).toEqual([0]);
    expect(result.renderedCount).toBe(0);
  });
});
