import { WorldbookEntryEditor } from "./WorldbookEntryEditor";
import {
  editableWorldbookEntry,
  insertionPositionLabel,
  worldbookEntryModeLabel,
  worldbookEntryPlacementLabel,
} from "./worldbookFields";
import {
  BookOpenText,
  BracketsCurly,
  CaretDown,
  CaretRight,
  DotsSixVertical,
  FloppyDisk,
  LinkBreak,
  Lock,
  LockOpen,
  MagnifyingGlass,
  PencilSimple,
  Power,
  Plus,
} from "@phosphor-icons/react";
import {
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import type {
  PromptPreset,
  PromptPresetEntry,
  RegexScope,
  RegexScriptDefinition,
  RoleCard,
  Worldbook,
  WorldbookEntry,
  WorldbookEntryUpdate,
} from "../domain/workspace";
import {
  PresetGenerationControls,
  type PresetGenerationPatch,
} from "./PresetGenerationControls";
import { SurfaceStatus } from "./WorkspacePrimitives";
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
  onSave: (
    promptId: string,
    content: string,
    role: PromptPresetEntry["role"],
  ) => Promise<void>;
  onDetach: (promptId: string) => Promise<void>;
  onPointerDown: (
    promptId: string,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => void;
}) {
  const [draft, setDraft] = useState(prompt.content);
  const [draftRole, setDraftRole] = useState(prompt.role);
  const [saving, setSaving] = useState<"toggle" | "entry" | "detach" | null>(
    null,
  );
  const busy = saving !== null || reordering;

  useEffect(() => {
    setDraft(prompt.content);
    setDraftRole(prompt.role);
  }, [prompt.content, prompt.role]);

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
    if (saving || (draft === prompt.content && draftRole === prompt.role)) {
      return;
    }
    setSaving("entry");
    try {
      await onSave(prompt.id, draft, draftRole);
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
          <span
            className="preset-prompt__role"
            title={`发送角色：${prompt.role}`}
          >
            {prompt.role}
          </span>
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
          {!prompt.dynamicMarker ? (
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
            <span>发送角色</span>
            <select
              aria-label={`修改 ${prompt.name} 的发送角色`}
              value={draftRole}
              onChange={(event) =>
                setDraftRole(event.target.value as PromptPresetEntry["role"])
              }
              disabled={busy}
            >
              <option value="system">system</option>
              <option value="user">user</option>
              <option value="assistant">assistant</option>
              <option value="tool">tool</option>
            </select>
          </label>
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
                setDraftRole(prompt.role);
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
              disabled={
                busy || (draft === prompt.content && draftRole === prompt.role)
              }
            >
              <FloppyDisk size={15} />
              {saving === "entry" ? "保存中" : "保存条目"}
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
  onSaveGeneration,
  onInsert,
  onDetach,
  onReorder,
}: {
  preset: PromptPreset;
  onToggle: (promptId: string, enabled: boolean) => Promise<void>;
  onSave: (
    promptId: string,
    content: string,
    role: PromptPresetEntry["role"],
  ) => Promise<void>;
  onSaveGeneration: (patch: PresetGenerationPatch) => Promise<void>;
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
      <PresetGenerationControls preset={preset} onSave={onSaveGeneration} />
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
  const toggleEnabled = async () => {
    if (saving || editing) return;
    const enabled = !entry.enabled;
    setSaving(true);
    try {
      await onSave(worldbook, entry, {
        ...editableWorldbookEntry(entry),
        enabled,
      });
    } catch {
      // The parent surface reports the durable server error.
    } finally {
      setSaving(false);
    }
  };

  const toggleTriggerMode = async () => {
    if (saving || editing) return;
    const constant = !entry.constant;
    setSaving(true);
    try {
      await onSave(worldbook, entry, {
        ...editableWorldbookEntry(entry),
        constant,
        selective: !constant,
      });
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
      }${editing ? " worldbook-entry--editing" : ""}`}
    >
      <div
        className={`worldbook-entry__header${
          editing ? "" : " worldbook-entry__header--editing-only"
        }`}
      >
        <div>
          <strong>{entry.title}</strong>
          <span>
            条目修订 {entry.revision} ·{" "}
            {insertionPositionLabel(entry.insertionPosition)}
          </span>
        </div>
        <div className="worldbook-entry__statuses">
          <button
            className={`worldbook-entry__toggle${
              entry.enabled ? " worldbook-entry__toggle--enabled" : ""
            }`}
            type="button"
            aria-pressed={entry.enabled}
            aria-label={`${entry.enabled ? "停用" : "启用"}条目 ${entry.title}`}
            title={`${entry.enabled ? "停用" : "启用"}此条目`}
            disabled={saving || editing}
            onClick={() => void toggleEnabled()}
          >
            <Power size={13} />
            {entry.enabled ? "已启用" : "已停用"}
          </button>
          <button
            className={`surface-status worldbook-entry__permission surface-status--${
              entry.agentEditable ? "mint" : "slate"
            }`}
            type="button"
            aria-pressed={entry.agentEditable}
            aria-label={`${entry.agentEditable ? "禁止" : "允许"} AI 编辑条目 ${entry.title}`}
            title={`${entry.agentEditable ? "禁止" : "允许"} AI 编辑此条目`}
            disabled={saving || editing}
            onClick={() => onPermission(worldbook.id, entry.id)}
          >
            {entry.agentEditable ? <LockOpen size={13} /> : <Lock size={13} />}
            {entry.agentEditable ? "AI 可编辑" : "AI 禁止编辑"}
          </button>
        </div>
      </div>
      {editing ? (
        <WorldbookEntryEditor
          worldbook={worldbook}
          entry={entry}
          onSave={onSave}
          onSaved={() => setEditing(false)}
          onCancel={() => setEditing(false)}
          onBusyChange={setSaving}
        />
      ) : (
        <div className="worldbook-entry__row" role="row">
          <button
            className={`worldbook-entry__enabled${
              entry.enabled ? " worldbook-entry__enabled--on" : ""
            }`}
            type="button"
            aria-pressed={entry.enabled}
            aria-label={`${entry.enabled ? "停用" : "启用"}条目 ${entry.title}`}
            title={`${entry.enabled ? "停用" : "启用"}此条目`}
            disabled={saving}
            onClick={() => void toggleEnabled()}
          >
            <Power size={15} />
          </button>
          <button
            className="worldbook-entry__title"
            type="button"
            onClick={() => setEditing(true)}
            title="编辑条目"
          >
            <strong>{entry.title}</strong>
            <span>条目修订 {entry.revision}</span>
          </button>
          <button
            className={`worldbook-entry__mode${
              entry.constant ? " worldbook-entry__mode--constant" : ""
            }`}
            type="button"
            aria-pressed={entry.constant}
            aria-label={`切换条目 ${entry.title} 的触发策略，当前为${worldbookEntryModeLabel(entry)}`}
            title="切换永久启用与关键词匹配"
            disabled={saving}
            onClick={() => void toggleTriggerMode()}
          >
            <Power size={13} weight="fill" />
            <span>{worldbookEntryModeLabel(entry)}</span>
            <CaretDown size={12} />
          </button>
          <span
            className="worldbook-entry__placement"
            title={worldbookEntryPlacementLabel(entry)}
          >
            {worldbookEntryPlacementLabel(entry)}
          </span>
          <span className="worldbook-entry__number">
            {entry.insertionDepth ?? "—"}
          </span>
          <span className="worldbook-entry__number">{entry.order}</span>
          <span className="worldbook-entry__number">{entry.probability}%</span>
          <div className="worldbook-entry__row-actions">
            <button
              className={`worldbook-entry__permission worldbook-entry__icon-action surface-status--${
                entry.agentEditable ? "mint" : "slate"
              }`}
              type="button"
              aria-pressed={entry.agentEditable}
              aria-label={`${entry.agentEditable ? "禁止" : "允许"} AI 编辑条目 ${entry.title}`}
              title={`${entry.agentEditable ? "禁止" : "允许"} AI 编辑此条目`}
              onClick={() => onPermission(worldbook.id, entry.id)}
            >
              {entry.agentEditable ? (
                <LockOpen size={14} />
              ) : (
                <Lock size={14} />
              )}
              <span className="sr-only">
                {entry.agentEditable ? "AI 可编辑" : "AI 禁止编辑"}
              </span>
            </button>
            <button
              className="worldbook-entry__icon-action"
              type="button"
              aria-label={`编辑条目 ${entry.title}`}
              title="编辑条目"
              onClick={() => setEditing(true)}
            >
              <PencilSimple size={15} />
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

type RegexRailProps = {
  card: RoleCard | undefined;
  preset: PromptPreset | undefined;
  regexScopes: RegexScope[];
  expanded: boolean;
  onToggle: () => void;
  onSaveRegexScope: (
    scope: RegexScope,
    patch: { enabled?: boolean; scripts?: RegexScriptDefinition[] },
  ) => Promise<void>;
};

export function RegexRail({
  card,
  preset,
  regexScopes,
  expanded,
  onToggle,
  onSaveRegexScope,
}: RegexRailProps) {
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
    <SupportPanel
      id="regex-panel"
      title={`当前作用域 · ${currentRegexCount}`}
      icon={<BracketsCurly size={18} />}
      expanded={expanded}
      onToggle={onToggle}
    >
      <RegexManager
        scopes={currentRegexScopes}
        {...(card ? { cardId: card.id } : {})}
        {...(preset ? { presetId: preset.id } : {})}
        onSaveScope={onSaveRegexScope}
      />
    </SupportPanel>
  );
}

type WorldbookRailProps = {
  worldbooks: Worldbook[];
  title?: string;
  emptyText?: string;
  expanded: boolean;
  onToggle: () => void;
  onPermission: (worldbookId: string, entryId: string) => void;
  onSaveWorldbookEntry: (
    worldbook: Worldbook,
    entry: WorldbookEntry,
    patch: WorldbookEntryUpdate,
  ) => Promise<void>;
};

export function WorldbookRail({
  worldbooks,
  title,
  emptyText = "此会话暂未绑定世界书。",
  expanded,
  onToggle,
  onPermission,
  onSaveWorldbookEntry,
}: WorldbookRailProps) {
  return (
    <SupportPanel
      id="worldbook-panel"
      title={title ?? `当前会话 · ${worldbooks.length} 本`}
      icon={<BookOpenText size={18} />}
      expanded={expanded}
      onToggle={onToggle}
    >
      <div className="worldbook-stack">
        {worldbooks.map((worldbook) => (
          <article className="worldbook-item" key={worldbook.id}>
            <div className="worldbook-item__header">
              <div>
                <strong>{worldbook.name}</strong>
                <span>
                  {worldbook.entries.length} 个条目 · 修订 {worldbook.revision}
                </span>
              </div>
            </div>
            {worldbook.entries.length > 0 ? (
              <div
                className="worldbook-entry-table"
                role="table"
                aria-label={`${worldbook.name} 条目`}
              >
                <div className="worldbook-entry-table__header" role="row">
                  <span aria-hidden="true" />
                  <span>标题（备注）</span>
                  <span>触发策略</span>
                  <span>插入位置</span>
                  <span>深度</span>
                  <span>顺序</span>
                  <span>触发概率 %</span>
                  <span>操作</span>
                </div>
                <ul className="worldbook-entry-list" role="rowgroup">
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
              </div>
            ) : (
              <p className="support-empty">这本世界书还没有具体条目。</p>
            )}
          </article>
        ))}
        {worldbooks.length === 0 ? (
          <p className="support-empty">{emptyText}</p>
        ) : null}
      </div>
    </SupportPanel>
  );
}
