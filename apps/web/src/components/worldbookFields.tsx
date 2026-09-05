import { Plus, X } from "@phosphor-icons/react";
import type { WorldbookEntry, WorldbookEntryUpdate } from "../domain/workspace";
import { IconButton } from "./WorkspacePrimitives";

export type ExplicitInsertionPosition = Exclude<
  WorldbookEntry["insertionPosition"],
  null
>;

export const insertionPositionOptions: ReadonlyArray<{
  value: ExplicitInsertionPosition;
  label: string;
}> = [
  { value: "before-card", label: "角色卡之前" },
  { value: "after-card", label: "角色卡之后" },
  { value: "examples-top", label: "示例对话之前" },
  { value: "examples-bottom", label: "示例对话之后" },
  { value: "author-note-top", label: "作者注释之前" },
  { value: "author-note-bottom", label: "作者注释之后" },
  { value: "at-depth", label: "对话历史指定深度" },
  { value: "outlet", label: "命名出口" },
];

export const insertionPositionLabels = Object.fromEntries(
  insertionPositionOptions.map(({ value, label }) => [value, label]),
) as Record<ExplicitInsertionPosition, string>;

export function insertionPositionLabel(
  value: WorldbookEntry["insertionPosition"],
): string {
  return value === null
    ? "默认（沿用原始位置）"
    : insertionPositionLabels[value];
}

export const insertionRoleLabels: Record<
  WorldbookEntry["insertionRole"],
  string
> = {
  system: "系统",
  user: "用户",
  assistant: "助手",
};

export function worldbookEntryModeLabel(entry: WorldbookEntry): string {
  return entry.constant ? "永久启用" : "关键词匹配";
}

export function worldbookEntryPlacementLabel(entry: WorldbookEntry): string {
  if (entry.insertionPosition === "at-depth") {
    return `@D ${insertionRoleLabels[entry.insertionRole]}在深度`;
  }
  if (entry.insertionPosition === "outlet") {
    return entry.outletName ? `出口 · ${entry.outletName}` : "命名出口";
  }
  return insertionPositionLabel(entry.insertionPosition);
}

export function compactKeywordRows(values: string[]): string[] {
  return [...new Set(values.filter((keyword) => keyword.length > 0))];
}

export function KeywordListEditor({
  label,
  values,
  disabled,
  onChange,
}: {
  label: string;
  values: string[];
  disabled: boolean;
  onChange: (values: string[]) => void;
}) {
  const rows = values.length > 0 ? values : [""];
  return (
    <fieldset className="keyword-list-editor">
      <legend>{label}</legend>
      {rows.map((value, index) => (
        <div
          className="keyword-list-editor__row"
          key={`${label}-${String(index)}`}
        >
          <input
            aria-label={`${label} ${String(index + 1)}`}
            value={value}
            disabled={disabled}
            placeholder={index === 0 ? "输入关键词或 /表达式/flags" : ""}
            onChange={(event) =>
              onChange(
                rows.map((keyword, rowIndex) =>
                  rowIndex === index ? event.target.value : keyword,
                ),
              )
            }
          />
          <IconButton
            compact
            label={`删除${label} ${String(index + 1)}`}
            icon={<X size={14} />}
            disabled={disabled || values.length === 0}
            onClick={() =>
              onChange(values.filter((_, rowIndex) => rowIndex !== index))
            }
          />
        </div>
      ))}
      <button
        className="text-button keyword-list-editor__add"
        type="button"
        disabled={disabled}
        onClick={() => onChange([...values, ""])}
      >
        <Plus size={13} />
        添加一项
      </button>
    </fieldset>
  );
}

export function editableWorldbookEntry(
  entry: WorldbookEntry,
): WorldbookEntryUpdate {
  return {
    title: entry.title,
    primaryKeys: entry.primaryKeys,
    secondaryKeys: entry.secondaryKeys,
    secondaryLogic: entry.secondaryLogic,
    selective: entry.selective,
    content: entry.content,
    enabled: entry.enabled,
    constant: entry.constant,
    caseSensitive: entry.caseSensitive,
    matchWholeWords: entry.matchWholeWords,
    useRegex: entry.useRegex,
    scanDepth: entry.scanDepth,
    recursion: entry.recursion,
    preventRecursion: entry.preventRecursion,
    excludeRecursion: entry.excludeRecursion,
    delayUntilRecursion: entry.delayUntilRecursion,
    insertionPosition: entry.insertionPosition,
    outletName: entry.outletName,
    insertionDepth: entry.insertionDepth,
    insertionRole: entry.insertionRole,
    order: entry.order,
    priority: entry.priority,
    probability: entry.probability,
  };
}
