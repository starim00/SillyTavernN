import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { TavernHelperContext } from "../compat/tavernHelperTypes";
import { createVariableTargets, VariableTree } from "./TavernHelperWorkbench";

function contextWithMessages(): TavernHelperContext {
  return {
    conversation: {
      id: "conversation-1",
      cardId: "card-1",
      presetId: null,
    },
    sources: [],
    variables: {
      global: { theme: "light" },
      character: {},
      preset: {},
      chat: { chapter: 2 },
      messages: {
        "message-oldest": { score: 1 },
        "message-middle": { score: 2 },
        "message-latest": { score: 3 },
      },
      scripts: {},
    },
  };
}

describe("TavernHelperWorkbench variables", () => {
  it("puts the latest message variables before broader scopes", () => {
    const targets = createVariableTargets(contextWithMessages());

    expect(targets.map((target) => target.key)).toEqual([
      "message:message-latest",
      "message:message-middle",
      "message:message-oldest",
      "chat",
      "character",
      "preset",
      "global",
    ]);
    expect(targets[0]?.label).toBe("最新消息 · e-latest");
    expect(targets[1]?.label).toBe("消息 2 · e-middle");
  });

  it("renders nested objects and arrays as collapsible tree branches", () => {
    const html = renderToStaticMarkup(
      <VariableTree
        value={{
          player: {
            name: "Mira",
            stats: { hp: 18, active: true },
          },
          inventory: ["key", { amount: 2 }],
          note: null,
        }}
      />,
    );

    expect(html).toContain('aria-label="变量树"');
    expect(html).toContain("player");
    expect(html).toContain("对象 · 2 项");
    expect(html).toContain("inventory");
    expect(html).toContain("数组 · 2 项");
    expect(html).toContain("[1]");
    expect(html).toContain("&quot;Mira&quot;");
    expect(html).toContain("null");
    expect(html.match(/<details/g)).toHaveLength(4);
  });
});
