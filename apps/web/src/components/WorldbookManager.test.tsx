import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createDemoWorkspace } from "../data/demoWorkspace";
import { WorldbookEntryEditor } from "./WorldbookEntryEditor";
import { filterWorldbookEntries } from "./WorldbookManager";
import { editableWorldbookEntry } from "./worldbookFields";

describe("worldbook entry management", () => {
  const book = createDemoWorkspace().worldbooks[0]!;
  const entry = book.entries[0]!;

  it("finds entries by title, body and both keyword lists without changing source order", () => {
    const entries = [
      {
        ...entry,
        id: "a",
        title: "潮位档案",
        content: "正文提到 North Gate",
        primaryKeys: ["钟楼"],
        secondaryKeys: ["潮水"],
      },
      {
        ...entry,
        id: "b",
        title: "航道",
        content: "North Gate 航行记录",
        primaryKeys: [],
        secondaryKeys: [],
      },
    ];
    expect(
      filterWorldbookEntries(entries, "潮位", "all").map((item) => item.id),
    ).toEqual(["a"]);
    expect(
      filterWorldbookEntries(entries, "钟楼", "all").map((item) => item.id),
    ).toEqual(["a"]);
    expect(
      filterWorldbookEntries(entries, "潮水", "all").map((item) => item.id),
    ).toEqual(["a"]);
    expect(
      filterWorldbookEntries(entries, "  north gate  ", "all").map(
        (item) => item.id,
      ),
    ).toEqual(["a", "b"]);
    expect(entries.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("combines text matching with enabled and per-entry permission filters", () => {
    const entries = [
      { ...entry, id: "a", title: "钟楼", enabled: true, agentEditable: false },
      { ...entry, id: "b", title: "钟楼", enabled: false, agentEditable: true },
    ];
    expect(
      filterWorldbookEntries(entries, "钟楼", "enabled").map((item) => item.id),
    ).toEqual(["a"]);
    expect(
      filterWorldbookEntries(entries, "钟楼", "disabled").map(
        (item) => item.id,
      ),
    ).toEqual(["b"]);
    expect(
      filterWorldbookEntries(entries, "钟楼", "editable").map(
        (item) => item.id,
      ),
    ).toEqual(["b"]);
    expect(filterWorldbookEntries(entries, "不存在", "editable")).toEqual([]);
  });

  it("preserves advanced settings in the edit payload while excluding permissions and revisions", () => {
    const patch = editableWorldbookEntry({
      ...entry,
      insertionPosition: "outlet",
      outletName: "港务",
      probability: 37,
      secondaryLogic: "not-all",
      recursion: true,
      delayUntilRecursion: true,
    });
    expect(patch).toMatchObject({
      insertionPosition: "outlet",
      outletName: "港务",
      probability: 37,
      secondaryLogic: "not-all",
      recursion: true,
      delayUntilRecursion: true,
    });
    expect(patch).not.toHaveProperty("agentEditable");
    expect(patch).not.toHaveProperty("revision");
    expect(patch).not.toHaveProperty("id");
  });

  it("puts content before rules and keeps advanced controls folded", () => {
    const html = renderToStaticMarkup(
      <WorldbookEntryEditor
        worldbook={book}
        entry={entry}
        onSave={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    expect(html.indexOf("条目正文")).toBeLessThan(
      html.indexOf("触发条件与关键词"),
    );
    expect(html).toContain(
      '<details class="wb-editor__section"><summary>插入位置与优先级</summary>',
    );
    expect(html).toContain(
      '<details class="wb-editor__section"><summary>匹配与递归设置</summary>',
    );
    expect(html).toContain("保存条目");
  });
});
