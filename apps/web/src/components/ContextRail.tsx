import {
  BookOpenText,
  BracketsCurly,
  CaretDown,
  CaretRight,
  CheckCircle,
  ClockCounterClockwise,
  DotsSixVertical,
  FloppyDisk,
  LinkBreak,
  Lock,
  LockOpen,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  PuzzlePiece,
  ShieldCheck,
  Wrench,
  X,
} from "@phosphor-icons/react";
import {
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import type {
  AgentProposal,
  LegacyPlugin,
  PanelId,
  PromptPreset,
  PromptPresetEntry,
  PromptTraceSegment,
  RegexScope,
  RegexScriptDefinition,
  RoleCard,
  Worldbook,
  WorldbookEntry,
  WorldbookEntryUpdate,
} from "../domain/workspace";
import { IconButton, SurfaceStatus } from "./WorkspacePrimitives";
import { RegexManager } from "./RegexManager";

function SupportPanel({
  id,
  title,
  icon,
  expanded,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  icon: ReactNode;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className="support-panel">
      <button
        className="support-panel__toggle"
        type="button"
        aria-expanded={expanded}
        aria-controls={id}
        onClick={onToggle}
      >
        <span className="support-panel__title">
          {icon}
          {title}
        </span>
        {expanded ? <CaretDown size={16} /> : <CaretRight size={16} />}
      </button>
      {expanded ? (
        <div className="support-panel__content" id={id}>
          {children}
        </div>
      ) : null}
    </section>
  );
}

function PresetPromptItem({
  prompt,
  expanded,
  canReorder,
  reordering,
  dropPosition,
  dragging,
  onEdit,
  onToggle,
  onSave,
  onDetach,
  onPointerDown,
}: {
  prompt: PromptPresetEntry;
  expanded: boolean;
  canReorder: boolean;
  reordering: boolean;
  dropPosition: "before" | "after" | null;
  dragging: boolean;
  onEdit: (promptId: string | null) => void;
  onToggle: (promptId: string, enabled: boolean) => Promise<void>;
  onSave: (promptId: string, content: string) => Promise<void>;
  onDetach: (promptId: string) => Promise<void>;
  onPointerDown: (
    promptId: string,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => void;
}) {
  const [draft, setDraft] = useState(prompt.content);
  const [saving, setSaving] = useState<"toggle" | "content" | "detach" | null>(
    null,
  );
  const busy = saving !== null || reordering;

  useEffect(() => {
    setDraft(prompt.content);
  }, [prompt.content]);

  const toggle = async () => {
    if (saving) return;
    setSaving("toggle");
    try {
      await onToggle(prompt.id, !prompt.enabled);
    } catch {
      // The parent surface reports a durable toast and keeps server state.
    } finally {
      setSaving(null);
    }
  };

  const save = async () => {
    if (saving || draft === prompt.content) return;
    setSaving("content");
    try {
      await onSave(prompt.id, draft);
    } catch {
      // The parent surface reports a durable toast and keeps the draft editable.
    } finally {
      setSaving(null);
    }
  };

  const detach = async () => {
    if (saving) return;
    setSaving("detach");
    try {
      await onDetach(prompt.id);
    } catch {
      // The parent surface reports a durable toast and keeps server state.
    } finally {
      setSaving(null);
    }
  };

  return (
    <li
      className={[
        "preset-prompt",
        prompt.enabled ? "" : "preset-prompt--disabled",
        dragging ? "preset-prompt--dragging" : "",
        dropPosition === "before" ? "preset-prompt--drop-before" : "",
        dropPosition === "after" ? "preset-prompt--drop-after" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-prompt-id={prompt.id}
    >
      <div className="preset-prompt__row">
        <button
          className="preset-prompt__drag"
          type="button"
          aria-label={`拖动 ${prompt.name} 调整顺序`}
          title={
            canReorder
              ? "按住拖动调整顺序"
              : "切换到“全部”并清除搜索后可调整顺序"
          }
          disabled={!canReorder || busy || expanded}
          onPointerDown={(event) => onPointerDown(prompt.id, event)}
        >
          <DotsSixVertical size={16} weight="bold" />
        </button>
        <div className="preset-prompt__identity" title={prompt.name}>
          <strong>{prompt.name}</strong>
          {prompt.dynamicMarker ? <span>动态</span> : null}
        </div>
        <div className="preset-prompt__controls">
          <button
            className="preset-prompt__icon"
            type="button"
            aria-label={`编辑 ${prompt.name}`}
            title="编辑正文"
            onClick={() => onEdit(expanded ? null : prompt.id)}
            disabled={busy}
          >
            <PencilSimple size={15} />
          </button>
          {!prompt.systemPrompt ? (
            <button
              className="preset-prompt__icon preset-prompt__icon--danger"
              type="button"
              aria-label={`移出 ${prompt.name}`}
              title="移出当前列表"
              onClick={() => void detach()}
              disabled={busy}
            >
              <LinkBreak size={15} />
            </button>
          ) : null}
          <button
            className={`preset-prompt__switch${
              prompt.enabled ? " preset-prompt__switch--on" : ""
            }`}
            type="button"
            role="switch"
            aria-checked={prompt.enabled}
            aria-label={`${prompt.enabled ? "停用" : "启用"} ${prompt.name}`}
            title={prompt.enabled ? "已启用，点击停用" : "已停用，点击启用"}
            onClick={() => void toggle()}
            disabled={busy}
          >
            <span />
          </button>
        </div>
      </div>
      {expanded ? (
        <div className="preset-prompt__editor">
          {prompt.dynamicMarker ? (
            <p className="preset-prompt__dynamic-note">
              实际内容由当前会话、角色卡或世界书动态填充；这里保存的正文不会直接进入模型。
            </p>
          ) : null}
          <label>
            <span>条目正文</span>
            <textarea
              aria-label={`编辑 ${prompt.name} 的正文`}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={7}
              disabled={busy}
              autoFocus
            />
          </label>
          <div className="preset-prompt__editor-actions">
            <button
              className="button button--quiet"
              type="button"
              onClick={() => {
                setDraft(prompt.content);
                onEdit(null);
              }}
              disabled={busy}
            >
              取消
            </button>
            <button
              className="button button--secondary"
              type="button"
              onClick={() => void save()}
              disabled={busy || draft === prompt.content}
            >
              <FloppyDisk size={15} />
              {saving === "content" ? "保存中" : "保存正文"}
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

export function PresetDetail({
  preset,
  onToggle,
  onSave,
  onInsert,
  onDetach,
  onReorder,
}: {
  preset: PromptPreset;
  onToggle: (promptId: string, enabled: boolean) => Promise<void>;
  onSave: (promptId: string, content: string) => Promise<void>;
  onInsert: (promptId: string) => Promise<void>;
  onDetach: (promptId: string) => Promise<void>;
  onReorder: (promptIds: string[]) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase());
  const [filter, setFilter] = useState<"all" | "enabled" | "disabled">("all");
  const [expandedPromptId, setExpandedPromptId] = useState<string | null>(null);
  const [selectedUninsertedId, setSelectedUninsertedId] = useState("");
  const [inserting, setInserting] = useState(false);
  const [draggedPromptId, setDraggedPromptId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    promptId: string;
    position: "before" | "after";
  } | null>(null);
  const [reordering, setReordering] = useState(false);

  useEffect(() => {
    setQuery("");
    setFilter("all");
    setExpandedPromptId(null);
    setSelectedUninsertedId("");
    setDraggedPromptId(null);
    setDropTarget(null);
  }, [preset.id]);

  const { enabledCount, insertedPrompts, uninsertedPrompts, visiblePrompts } =
    useMemo(() => {
      const insertedPrompts = preset.prompts
        .filter((prompt) => prompt.inserted !== false)
        .sort(
          (left, right) =>
            left.order - right.order || left.id.localeCompare(right.id),
        );
      const uninsertedPrompts = preset.prompts
        .filter((prompt) => prompt.inserted === false)
        .sort(
          (left, right) =>
            left.name.localeCompare(right.name) ||
            left.id.localeCompare(right.id),
        );
      const enabledCount = insertedPrompts.reduce(
        (count, prompt) => count + (prompt.enabled ? 1 : 0),
        0,
      );
      const visiblePrompts = insertedPrompts.filter((prompt) => {
        if (filter === "enabled" && !prompt.enabled) return false;
        if (filter === "disabled" && prompt.enabled) return false;
        if (!deferredQuery) return true;
        return [prompt.name, prompt.id, prompt.content, prompt.role]
          .join("\n")
          .toLocaleLowerCase()
          .includes(deferredQuery);
      });
      return {
        enabledCount,
        insertedPrompts,
        uninsertedPrompts,
        visiblePrompts,
      };
    }, [deferredQuery, filter, preset.prompts]);

  const insertionSelection =
    uninsertedPrompts.find((prompt) => prompt.id === selectedUninsertedId)
      ?.id ??
    uninsertedPrompts[0]?.id ??
    "";
  const canReorder = filter === "all" && deferredQuery.length === 0;

  const insertSelected = async () => {
    if (!insertionSelection || inserting) return;
    setInserting(true);
    try {
      await onInsert(insertionSelection);
    } catch {
      // The parent surface reports a durable toast and keeps server state.
    } finally {
      setInserting(false);
    }
  };

  const clearDragState = () => {
    setDraggedPromptId(null);
    setDropTarget(null);
  };

  const startDragging = (
    promptId: string,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (!canReorder || reordering) {
      event.preventDefault();
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraggedPromptId(promptId);
  };

  const dropTargetAt = (clientX: number, clientY: number) => {
    const row = document
      .elementFromPoint(clientX, clientY)
      ?.closest<HTMLElement>("[data-prompt-id]");
    const promptId = row?.dataset.promptId;
    if (!row || !promptId || promptId === draggedPromptId) return null;
    const bounds = row.getBoundingClientRect();
    const position =
      clientY < bounds.top + bounds.height / 2 ? "before" : "after";
    return { promptId, position } as const;
  };

  const movePointer = (event: ReactPointerEvent<HTMLUListElement>) => {
    if (!canReorder || !draggedPromptId || reordering) return;
    event.preventDefault();
    const target = dropTargetAt(event.clientX, event.clientY);
    if (!target) {
      setDropTarget(null);
      return;
    }
    setDropTarget((current) =>
      current?.promptId === target.promptId &&
      current.position === target.position
        ? current
        : target,
    );
  };

  const reorderPrompt = async (
    sourceId: string,
    promptId: string,
    position: "before" | "after",
  ) => {
    if (!canReorder || !sourceId || sourceId === promptId || reordering) {
      clearDragState();
      return;
    }

    const promptIds = insertedPrompts.map((prompt) => prompt.id);
    const sourceIndex = promptIds.indexOf(sourceId);
    if (sourceIndex < 0) {
      clearDragState();
      return;
    }
    promptIds.splice(sourceIndex, 1);
    const targetIndex = promptIds.indexOf(promptId);
    if (targetIndex < 0) {
      clearDragState();
      return;
    }
    promptIds.splice(targetIndex + (position === "after" ? 1 : 0), 0, sourceId);
    clearDragState();
    if (
      promptIds.every(
        (candidateId, index) => candidateId === insertedPrompts[index]?.id,
      )
    ) {
      return;
    }

    setReordering(true);
    try {
      await onReorder(promptIds);
    } catch {
      // The parent surface reports a durable toast and keeps server order.
    } finally {
      setReordering(false);
    }
  };

  const finishPointerDrag = (event: ReactPointerEvent<HTMLUListElement>) => {
    if (!draggedPromptId) return;
    const sourceId = draggedPromptId;
    const target = dropTargetAt(event.clientX, event.clientY) ?? dropTarget;
    clearDragState();
    if (target) {
      void reorderPrompt(sourceId, target.promptId, target.position);
    }
  };

  return (
    <div className="preset-detail">
      <div className="preset-detail__summary">
        <div>
          <strong>{preset.name}</strong>
          <span>预设修订 {preset.revision}</span>
        </div>
        <SurfaceStatus tone="slate">
          {enabledCount}/{insertedPrompts.length} 启用 ·{" "}
          {uninsertedPrompts.length} 未插入
        </SurfaceStatus>
      </div>
      {preset.prompts.length > 0 ? (
        <>
          {uninsertedPrompts.length > 0 ? (
            <div className="preset-insert">
              <label>
                <span>未插入条目</span>
                <select
                  aria-label="选择要插入的预设条目"
                  value={insertionSelection}
                  onChange={(event) =>
                    setSelectedUninsertedId(event.target.value)
                  }
                  disabled={inserting}
                >
                  {uninsertedPrompts.map((prompt) => (
                    <option key={prompt.id} value={prompt.id}>
                      {prompt.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="button button--secondary"
                type="button"
                onClick={() => void insertSelected()}
                disabled={inserting}
              >
                <Plus size={15} />
                {inserting ? "插入中" : "插入"}
              </button>
              <small>插入后默认保持停用，可在下面的列表中再启用。</small>
            </div>
          ) : null}
          {insertedPrompts.length > 0 ? (
            <>
              <label className="preset-search">
                <MagnifyingGlass size={14} aria-hidden="true" />
                <span className="sr-only">搜索已插入的预设条目</span>
                <input
                  type="search"
                  value={query}
                  placeholder="搜索已插入条目"
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <div className="preset-filters" aria-label="筛选预设条目">
                {(
                  [
                    ["all", `全部 ${insertedPrompts.length}`],
                    ["enabled", `已启用 ${enabledCount}`],
                    [
                      "disabled",
                      `已停用 ${insertedPrompts.length - enabledCount}`,
                    ],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={filter === value}
                    onClick={() => setFilter(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {visiblePrompts.length > 0 ? (
                <ul
                  className="preset-prompt-list"
                  onPointerMove={movePointer}
                  onPointerUp={finishPointerDrag}
                  onPointerCancel={clearDragState}
                >
                  {visiblePrompts.map((prompt) => (
                    <PresetPromptItem
                      key={prompt.id}
                      prompt={prompt}
                      expanded={expandedPromptId === prompt.id}
                      canReorder={canReorder}
                      reordering={reordering}
                      dragging={draggedPromptId === prompt.id}
                      dropPosition={
                        dropTarget?.promptId === prompt.id
                          ? dropTarget.position
                          : null
                      }
                      onEdit={setExpandedPromptId}
                      onToggle={onToggle}
                      onSave={onSave}
                      onDetach={onDetach}
                      onPointerDown={startDragging}
                    />
                  ))}
                </ul>
              ) : (
                <p className="support-empty">
                  没有符合当前搜索或筛选条件的已插入条目。
                </p>
              )}
            </>
          ) : (
            <p className="support-empty">
              当前列表还没有条目，请从上方选择一个定义插入。
            </p>
          )}
        </>
      ) : (
        <p className="support-empty">这个预设还没有提示词条目。</p>
      )}
    </div>
  );
}

type ExplicitInsertionPosition = Exclude<
  WorldbookEntry["insertionPosition"],
  null
>;

const insertionPositionOptions: ReadonlyArray<{
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

const insertionPositionLabels = Object.fromEntries(
  insertionPositionOptions.map(({ value, label }) => [value, label]),
) as Record<ExplicitInsertionPosition, string>;

function insertionPositionLabel(
  value: WorldbookEntry["insertionPosition"],
): string {
  return value === null
    ? "默认（沿用原始位置）"
    : insertionPositionLabels[value];
}

function compactKeywordRows(values: string[]): string[] {
  return [...new Set(values.filter((keyword) => keyword.length > 0))];
}

function KeywordListEditor({
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

function editableWorldbookEntry(entry: WorldbookEntry): WorldbookEntryUpdate {
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
  };
}

function WorldbookEntryItem({
  worldbook,
  entry,
  onPermission,
  onSave,
}: {
  worldbook: Worldbook;
  entry: WorldbookEntry;
  onPermission: (worldbookId: string, entryId: string) => void;
  onSave: (
    worldbook: Worldbook,
    entry: WorldbookEntry,
    patch: WorldbookEntryUpdate,
  ) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState(() => editableWorldbookEntry(entry));
  const [primaryKeys, setPrimaryKeys] = useState(() => [...entry.primaryKeys]);
  const [secondaryKeys, setSecondaryKeys] = useState(() => [
    ...entry.secondaryKeys,
  ]);
  const preview =
    entry.content.length > 240
      ? `${entry.content.slice(0, 240)}…`
      : entry.content;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || !draft.title.trim()) return;
    setSaving(true);
    try {
      await onSave(worldbook, entry, {
        ...draft,
        title: draft.title.trim(),
        primaryKeys: compactKeywordRows(primaryKeys),
        secondaryKeys: compactKeywordRows(secondaryKeys),
      });
      setEditing(false);
    } catch {
      // The parent surface reports the durable server error.
    } finally {
      setSaving(false);
    }
  };

  return (
    <li
      className={`worldbook-entry${
        entry.enabled ? "" : " worldbook-entry--disabled"
      }`}
    >
      <div className="worldbook-entry__header">
        <div>
          <strong>{entry.title}</strong>
          <span>
            条目修订 {entry.revision} ·{" "}
            {insertionPositionLabel(entry.insertionPosition)}
          </span>
        </div>
        <div className="worldbook-entry__statuses">
          <SurfaceStatus tone={entry.enabled ? "mint" : "slate"}>
            {entry.enabled
              ? entry.constant
                ? "永久启用"
                : "关键词召回"
              : "已停用"}
          </SurfaceStatus>
          <SurfaceStatus tone={entry.agentEditable ? "mint" : "slate"}>
            {entry.agentEditable ? <LockOpen size={13} /> : <Lock size={13} />}
            {entry.agentEditable ? "AI 可编辑" : "AI 禁止编辑"}
          </SurfaceStatus>
        </div>
      </div>
      {editing ? (
        <form className="worldbook-entry-editor" onSubmit={submit}>
          <label className="field">
            <span>条目名称</span>
            <input
              value={draft.title}
              disabled={saving}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  title: event.target.value,
                }))
              }
            />
          </label>
          <KeywordListEditor
            label="主要关键词"
            values={primaryKeys}
            disabled={saving || draft.constant}
            onChange={setPrimaryKeys}
          />
          <KeywordListEditor
            label="辅助关键词"
            values={secondaryKeys}
            disabled={saving || draft.constant || !draft.selective}
            onChange={setSecondaryKeys}
          />
          <div className="worldbook-entry-editor__checks">
            <label className="check-row">
              <input
                type="checkbox"
                checked={draft.enabled}
                disabled={saving}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    enabled: event.target.checked,
                  }))
                }
              />
              <span>启用此条目</span>
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={draft.constant}
                disabled={saving}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    constant: event.target.checked,
                  }))
                }
              />
              <span>永久启用，不依赖关键词</span>
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={draft.selective}
                disabled={saving || draft.constant}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    selective: event.target.checked,
                  }))
                }
              />
              <span>使用辅助关键词</span>
            </label>
          </div>
          {draft.selective && !draft.constant ? (
            <label className="field">
              <span>辅助关键词逻辑</span>
              <select
                value={draft.secondaryLogic}
                disabled={saving}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    secondaryLogic: event.target
                      .value as WorldbookEntry["secondaryLogic"],
                  }))
                }
              >
                <option value="any">命中任意一个</option>
                <option value="all">命中全部</option>
                <option value="not-any">全部都不能命中</option>
                <option value="not-all">不能全部命中</option>
              </select>
            </label>
          ) : null}
          <label className="field">
            <span>条目正文</span>
            <textarea
              value={draft.content}
              rows={9}
              disabled={saving}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  content: event.target.value,
                }))
              }
            />
          </label>
          <div className="worldbook-entry-editor__grid">
            <label className="field">
              <span>插入位置</span>
              <select
                value={draft.insertionPosition ?? ""}
                disabled={saving}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    insertionPosition:
                      event.target.value === ""
                        ? null
                        : (event.target.value as ExplicitInsertionPosition),
                  }))
                }
              >
                <option value="">默认（沿用原始位置）</option>
                {insertionPositionOptions.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>插入顺序</span>
              <input
                type="number"
                value={draft.order}
                disabled={saving}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    order: event.target.valueAsNumber || 0,
                  }))
                }
              />
            </label>
            <label className="field">
              <span>优先级</span>
              <input
                type="number"
                value={draft.priority}
                disabled={saving}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    priority: event.target.valueAsNumber || 0,
                  }))
                }
              />
            </label>
            <label className="field">
              <span>扫描深度</span>
              <input
                type="number"
                min={1}
                max={10_000}
                value={draft.scanDepth ?? ""}
                placeholder="使用世界书默认值"
                disabled={saving}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    scanDepth:
                      event.target.value === ""
                        ? null
                        : event.target.valueAsNumber,
                  }))
                }
              />
            </label>
          </div>
          {draft.insertionPosition === "outlet" ? (
            <label className="field">
              <span>出口名称</span>
              <input
                value={draft.outletName ?? ""}
                placeholder="与 {{outlet::名称}} 中的名称一致"
                disabled={saving}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    outletName: event.target.value || null,
                  }))
                }
              />
            </label>
          ) : null}
          {draft.insertionPosition === "at-depth" ? (
            <div className="worldbook-entry-editor__grid">
              <label className="field">
                <span>历史深度</span>
                <input
                  type="number"
                  min={0}
                  max={10_000}
                  value={draft.insertionDepth ?? 0}
                  disabled={saving}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      insertionDepth: event.target.valueAsNumber || 0,
                    }))
                  }
                />
              </label>
              <label className="field">
                <span>消息角色</span>
                <select
                  value={draft.insertionRole}
                  disabled={saving}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      insertionRole: event.target
                        .value as WorldbookEntry["insertionRole"],
                    }))
                  }
                >
                  <option value="system">system</option>
                  <option value="user">user</option>
                  <option value="assistant">assistant</option>
                </select>
              </label>
            </div>
          ) : null}
          <details className="worldbook-entry-editor__advanced">
            <summary>匹配与递归设置</summary>
            <div className="worldbook-entry-editor__checks">
              {(
                [
                  ["caseSensitive", "区分大小写"],
                  ["matchWholeWords", "仅匹配完整词"],
                  ["useRegex", "识别 /表达式/flags 关键词"],
                  ["recursion", "允许此条目触发递归召回"],
                  ["preventRecursion", "正文不继续参与递归"],
                  ["excludeRecursion", "递归轮次排除此条目"],
                  ["delayUntilRecursion", "仅在递归轮次参与匹配"],
                ] as const
              ).map(([key, label]) => (
                <label className="check-row" key={key}>
                  <input
                    type="checkbox"
                    checked={draft[key]}
                    disabled={saving}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        [key]: event.target.checked,
                      }))
                    }
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </details>
          <div className="worldbook-entry__actions">
            <button
              className="button button--quiet"
              type="button"
              disabled={saving}
              onClick={() => {
                setDraft(editableWorldbookEntry(entry));
                setPrimaryKeys([...entry.primaryKeys]);
                setSecondaryKeys([...entry.secondaryKeys]);
                setEditing(false);
              }}
            >
              取消
            </button>
            <button
              className="button button--secondary"
              type="submit"
              disabled={saving || !draft.title.trim()}
            >
              <FloppyDisk size={15} />
              {saving ? "保存中" : "保存条目"}
            </button>
          </div>
        </form>
      ) : (
        <>
          <p>{preview || "此条目暂无正文。"}</p>
          {entry.primaryKeys.length > 0 ? (
            <div className="worldbook-entry__keys" aria-label="主要关键词">
              {entry.primaryKeys.map((key, index) => (
                <span key={`${key}-${String(index)}`}>{key}</span>
              ))}
            </div>
          ) : entry.constant ? (
            <small className="worldbook-entry__constant-note">
              永久启用条目无需关键词即可进入提示词。
            </small>
          ) : (
            <small className="worldbook-entry__constant-note">
              没有主要关键词时不会被关键词召回。
            </small>
          )}
          <div className="worldbook-entry__actions">
            <button
              className="text-button"
              type="button"
              onClick={() => setEditing(true)}
            >
              <PencilSimple size={14} />
              编辑条目
            </button>
            <button
              className="text-button"
              type="button"
              onClick={() => onPermission(worldbook.id, entry.id)}
            >
              {entry.agentEditable ? "禁止 AI 编辑" : "允许 AI 编辑"}
            </button>
          </div>
        </>
      )}
    </li>
  );
}

type ContextRailProps = {
  open: boolean;
  card: RoleCard | undefined;
  worldbooks: Worldbook[];
  preset: PromptPreset | undefined;
  regexScopes: RegexScope[];
  promptTrace: PromptTraceSegment[];
  proposal: AgentProposal | null;
  expandedPanels: Record<PanelId, boolean>;
  onTogglePanel: (panel: PanelId) => void;
  onClose: () => void;
  onPermission: (worldbookId: string, entryId: string) => void;
  onSaveWorldbookEntry: (
    worldbook: Worldbook,
    entry: WorldbookEntry,
    patch: WorldbookEntryUpdate,
  ) => Promise<void>;
  onSaveRegexScope: (
    scope: RegexScope,
    patch: { enabled?: boolean; scripts?: RegexScriptDefinition[] },
  ) => Promise<void>;
  onConfirmToolProposal: () => void;
  onRejectToolProposal: () => void;
  onUndoToolProposal: () => void;
};

export function ContextRail({
  open,
  card,
  worldbooks,
  preset,
  regexScopes,
  promptTrace,
  proposal,
  expandedPanels,
  onTogglePanel,
  onClose,
  onPermission,
  onSaveWorldbookEntry,
  onSaveRegexScope,
  onConfirmToolProposal,
  onRejectToolProposal,
  onUndoToolProposal,
}: ContextRailProps) {
  const proposalWorldbook = worldbooks.find(
    (worldbook) => worldbook.id === proposal?.worldbookId,
  );
  const proposalStatus =
    proposal?.status === "blocked"
      ? "权限已阻止"
      : proposal?.status === "awaiting_confirmation"
        ? "等待确认"
        : proposal?.status === "applied"
          ? "已应用"
          : "已撤销";
  const currentRegexScopes = regexScopes.filter(
    (scope) =>
      (scope.scope === "global" && scope.id === "global") ||
      (scope.scope === "card" && scope.id === card?.id) ||
      (scope.scope === "preset" && scope.id === preset?.id),
  );
  const currentRegexCount = currentRegexScopes.reduce(
    (count, scope) => count + scope.scripts.length,
    0,
  );

  return (
    <aside
      className={`extensions-drawer${open ? " extensions-drawer--open" : ""}`}
      aria-label="上下文菜单"
    >
      <div className="extensions-drawer__header">
        <div>
          <strong>上下文</strong>
          <span>当前角色卡、正则、世界书与提示词轨迹</span>
        </div>
        <IconButton
          label="关闭上下文菜单"
          icon={<X size={18} />}
          onClick={onClose}
          compact
        />
      </div>

      <div className="extensions-drawer__scroll">
        <SupportPanel
          id="context-panel"
          title="当前会话"
          icon={<ShieldCheck size={18} />}
          expanded={expandedPanels.context}
          onToggle={() => onTogglePanel("context")}
        >
          <dl className="context-facts">
            <div>
              <dt>角色卡</dt>
              <dd>{card?.name ?? "未找到绑定角色卡"}</dd>
            </div>
            <div>
              <dt>预设</dt>
              <dd>{preset?.name ?? "未选择"}</dd>
            </div>
          </dl>
        </SupportPanel>

        <SupportPanel
          id="regex-panel"
          title={`正则 · ${currentRegexCount}`}
          icon={<BracketsCurly size={18} />}
          expanded={expandedPanels.regex}
          onToggle={() => onTogglePanel("regex")}
        >
          <RegexManager
            scopes={currentRegexScopes}
            {...(card ? { cardId: card.id } : {})}
            {...(preset ? { presetId: preset.id } : {})}
            onSaveScope={onSaveRegexScope}
          />
        </SupportPanel>

        {proposal ? (
          <section className="tool-proposal-section" aria-label="模型工具提案">
            <div className="tool-proposal-section__label">
              <Wrench size={16} />
              <strong>模型工具提案</strong>
              <span>仅在普通聊天产生待处理操作时显示</span>
            </div>
            <article
              className={`tool-proposal tool-proposal--${proposal.status}`}
            >
              <div className="tool-proposal__header">
                <strong>{proposal.title}</strong>
                <SurfaceStatus
                  tone={
                    proposal.status === "applied"
                      ? "mint"
                      : proposal.status === "awaiting_confirmation"
                        ? "coral"
                        : "slate"
                  }
                >
                  {proposal.status === "applied" ? (
                    <CheckCircle size={13} />
                  ) : (
                    <Wrench size={13} />
                  )}
                  {proposalStatus}
                </SurfaceStatus>
              </div>
              <p>{proposal.rationale}</p>
              <pre>{proposal.diffLines.join("\n")}</pre>
              {proposal.status === "awaiting_confirmation" ? (
                <div className="tool-proposal__actions">
                  <button
                    className="button button--quiet"
                    type="button"
                    onClick={onRejectToolProposal}
                  >
                    <X size={16} />
                    拒绝提案
                  </button>
                  <button
                    className="button button--primary"
                    type="button"
                    onClick={onConfirmToolProposal}
                  >
                    <CheckCircle size={17} />
                    确认并应用
                  </button>
                </div>
              ) : null}
              {proposal.status === "blocked" ? (
                <button
                  className="button button--quiet button--full"
                  type="button"
                  onClick={onRejectToolProposal}
                >
                  <X size={16} />
                  拒绝被阻止的提案
                </button>
              ) : null}
              {proposal.status === "applied" ? (
                <button
                  className="button button--quiet button--full"
                  type="button"
                  onClick={onUndoToolProposal}
                >
                  <ClockCounterClockwise size={17} />
                  撤销这次写入
                </button>
              ) : null}
              <small>
                目标：{proposalWorldbook?.name ?? proposal.worldbookName} ·
                世界书修订 {proposal.beforeRevision}
                {proposal.targetEntryId ? (
                  <>
                    {" "}
                    · 条目 {proposal.targetEntryTitle ?? "未命名条目"}（
                    {proposal.targetEntryId}）· 条目修订{" "}
                    {proposal.beforeEntryRevision ?? "未知"}
                  </>
                ) : null}
              </small>
            </article>
          </section>
        ) : null}

        <SupportPanel
          id="worldbook-panel"
          title={`世界书 · ${worldbooks.length}`}
          icon={<BookOpenText size={18} />}
          expanded={expandedPanels.worldbooks}
          onToggle={() => onTogglePanel("worldbooks")}
        >
          <div className="worldbook-stack">
            {worldbooks.map((worldbook) => (
              <article className="worldbook-item" key={worldbook.id}>
                <div className="worldbook-item__header">
                  <div>
                    <strong>{worldbook.name}</strong>
                    <span>
                      {worldbook.entries.length} 个条目 · 修订{" "}
                      {worldbook.revision}
                    </span>
                  </div>
                </div>
                <p className="worldbook-item__description">
                  {worldbook.description}
                </p>
                {worldbook.entries.length > 0 ? (
                  <ul className="worldbook-entry-list">
                    {worldbook.entries.map((entry) => (
                      <WorldbookEntryItem
                        key={`${entry.id}:${entry.revision}`}
                        worldbook={worldbook}
                        entry={entry}
                        onPermission={onPermission}
                        onSave={onSaveWorldbookEntry}
                      />
                    ))}
                  </ul>
                ) : (
                  <p className="support-empty">这本世界书还没有具体条目。</p>
                )}
              </article>
            ))}
            {worldbooks.length === 0 ? (
              <p className="support-empty">此会话暂未绑定世界书。</p>
            ) : null}
          </div>
        </SupportPanel>

        <SupportPanel
          id="trace-panel"
          title="提示词轨迹"
          icon={<BracketsCurly size={18} />}
          expanded={expandedPanels.trace}
          onToggle={() => onTogglePanel("trace")}
        >
          <ol className="trace-list">
            {promptTrace.map((segment) => (
              <li key={segment.id}>
                <span
                  className={`trace-dot trace-dot--${segment.source}`}
                  aria-hidden="true"
                />
                <div>
                  <strong>{segment.label}</strong>
                  <p>{segment.detail}</p>
                </div>
                <span>{segment.tokens}</span>
              </li>
            ))}
          </ol>
        </SupportPanel>
      </div>
    </aside>
  );
}

type ExtensionsDrawerProps = {
  open: boolean;
  plugins: LegacyPlugin[];
  pluginRealms: ReactNode;
  onClose: () => void;
  onOpenPlugins: () => void;
};

export function ExtensionsDrawer({
  open,
  plugins,
  pluginRealms,
  onClose,
  onOpenPlugins,
}: ExtensionsDrawerProps) {
  return (
    <aside
      className={`extensions-drawer extensions-drawer--plugins${
        open ? " extensions-drawer--open" : ""
      }`}
      aria-label="扩展菜单"
    >
      <div className="extensions-drawer__header">
        <div>
          <strong>扩展</strong>
          <span>已安装插件及插件提供的功能菜单</span>
        </div>
        <IconButton
          label="关闭扩展菜单"
          icon={<X size={18} />}
          onClick={onClose}
          compact
        />
      </div>
      <div className="extensions-drawer__scroll">
        <section
          className="extension-plugins"
          aria-labelledby="plugin-menu-title"
        >
          <div className="extension-plugins__heading">
            <div>
              <PuzzlePiece size={17} />
              <strong id="plugin-menu-title">兼容插件</strong>
            </div>
            <button
              className="text-button"
              type="button"
              onClick={onOpenPlugins}
            >
              管理插件
            </button>
          </div>
          <div className="extension-plugin-list">
            {plugins.map((plugin) => {
              const nativeReplacement =
                plugin.id === "plugin-js-slash-runner" ||
                plugin.id === "plugin-st-prompt-template";
              const active =
                plugin.status === "enabled" && plugin.trust === "trusted";
              return (
                <details className="extension-plugin" key={plugin.id}>
                  <summary>
                    <span>
                      <PuzzlePiece size={15} />
                      <strong>{plugin.name}</strong>
                    </span>
                    <SurfaceStatus
                      tone={nativeReplacement || active ? "mint" : "slate"}
                    >
                      {nativeReplacement
                        ? "原生接管"
                        : active
                          ? "菜单已接入"
                          : "未启用"}
                    </SurfaceStatus>
                  </summary>
                  <div>
                    <p>
                      {plugin.id === "plugin-js-slash-runner"
                        ? "角色卡与预设脚本由内置酒馆助手接口执行。"
                        : plugin.id === "plugin-st-prompt-template"
                          ? "EJS 与模板指令由原生请求管线处理。"
                          : plugin.description}
                    </p>
                    <small>
                      {plugin.version} ·{" "}
                      {nativeReplacement
                        ? "卡片与预设能力由内置兼容层执行"
                        : "独立兼容域运行"}
                    </small>
                    <button
                      className="button button--quiet button--full"
                      type="button"
                      onClick={onOpenPlugins}
                    >
                      查看权限与加载详情
                    </button>
                  </div>
                </details>
              );
            })}
            {plugins.length === 0 ? (
              <p className="support-empty">
                还没有兼容插件；安装后菜单项会自动出现在这里。
              </p>
            ) : null}
          </div>
          <div className="legacy-plugin-realms" aria-label="兼容插件菜单">
            {pluginRealms}
          </div>
        </section>
      </div>
    </aside>
  );
}
