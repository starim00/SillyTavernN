import {
  DotsSixVertical,
  FloppyDisk,
  MagnifyingGlass,
  PencilSimple,
  Plus,
} from "@phosphor-icons/react";
import {
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import type {
  RegexPlacement,
  RegexScope,
  RegexScopeKind,
  RegexScriptDefinition,
} from "../domain/workspace";
import { SurfaceStatus } from "./WorkspacePrimitives";

const scopeLabels: Record<RegexScopeKind, string> = {
  global: "全局",
  card: "当前角色卡",
  preset: "当前预设",
};

const placementLabels: Record<RegexPlacement, string> = {
  1: "用户输入",
  2: "模型回复",
  3: "斜杠命令",
  5: "世界书",
  6: "推理内容",
};

const placements = Object.keys(placementLabels).map(
  (value) => Number(value) as RegexPlacement,
);

type RegexScopePatch = {
  enabled?: boolean;
  scripts?: RegexScriptDefinition[];
};

type RegexManagerProps = {
  scopes: RegexScope[];
  cardId?: string;
  presetId?: string;
  onSaveScope: (scope: RegexScope, patch: RegexScopePatch) => Promise<void>;
};

const createRegexScript = (): RegexScriptDefinition => {
  const suffix =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return {
    id: `regex-${suffix}`,
    scriptName: "新正则",
    findRegex: "",
    replaceString: "",
    trimStrings: [],
    placement: [1, 2],
    disabled: true,
    markdownOnly: false,
    promptOnly: false,
    runOnEdit: false,
    substituteRegex: 0,
    minDepth: null,
    maxDepth: null,
  };
};

function RegexScriptEditor({
  script,
  saving,
  onCancel,
  onSave,
}: {
  script: RegexScriptDefinition;
  saving: boolean;
  onCancel: () => void;
  onSave: (script: RegexScriptDefinition) => Promise<void>;
}) {
  const [draft, setDraft] = useState(script);

  useEffect(() => {
    setDraft(script);
  }, [script]);

  const togglePlacement = (placement: RegexPlacement) => {
    setDraft((current) => ({
      ...current,
      placement: current.placement.includes(placement)
        ? current.placement.filter((candidate) => candidate !== placement)
        : [...current.placement, placement].sort((left, right) => left - right),
    }));
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void onSave(draft);
  };

  return (
    <form className="regex-editor" onSubmit={submit}>
      <label>
        <span>名称</span>
        <input
          value={draft.scriptName}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              scriptName: event.target.value,
            }))
          }
          disabled={saving}
        />
      </label>
      <label>
        <span>ID（只读）</span>
        <input value={draft.id} readOnly />
      </label>
      <label>
        <span>查找表达式</span>
        <textarea
          value={draft.findRegex}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              findRegex: event.target.value,
            }))
          }
          rows={4}
          spellCheck={false}
          disabled={saving}
        />
      </label>
      <label>
        <span>替换内容</span>
        <textarea
          value={draft.replaceString}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              replaceString: event.target.value,
            }))
          }
          rows={5}
          spellCheck={false}
          disabled={saving}
        />
      </label>
      <label>
        <span>替换后清理（每行一项）</span>
        <textarea
          value={draft.trimStrings.join("\n")}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              trimStrings: event.target.value
                .split(/\r?\n/u)
                .filter((item) => item.length > 0),
            }))
          }
          rows={3}
          spellCheck={false}
          disabled={saving}
        />
      </label>

      <fieldset className="regex-editor__placements">
        <legend>作用位置</legend>
        {placements.map((placement) => (
          <label key={placement}>
            <input
              type="checkbox"
              checked={draft.placement.includes(placement)}
              onChange={() => togglePlacement(placement)}
              disabled={saving}
            />
            {placementLabels[placement]}
          </label>
        ))}
      </fieldset>

      <div className="regex-editor__checks">
        <label>
          <input
            type="checkbox"
            checked={!draft.disabled}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                disabled: !event.target.checked,
              }))
            }
            disabled={saving}
          />
          启用此条正则
        </label>
        <label>
          <input
            type="checkbox"
            checked={draft.markdownOnly}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                markdownOnly: event.target.checked,
              }))
            }
            disabled={saving}
          />
          仅处理显示副本
        </label>
        <label>
          <input
            type="checkbox"
            checked={draft.promptOnly}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                promptOnly: event.target.checked,
              }))
            }
            disabled={saving}
          />
          仅处理提示词副本
        </label>
        <label>
          <input
            type="checkbox"
            checked={draft.runOnEdit}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                runOnEdit: event.target.checked,
              }))
            }
            disabled={saving}
          />
          编辑消息时运行
        </label>
      </div>

      <div className="regex-editor__grid">
        <label>
          <span>变量替换</span>
          <select
            value={draft.substituteRegex}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                substituteRegex: Number(event.target.value) as 0 | 1 | 2,
              }))
            }
            disabled={saving}
          >
            <option value={0}>不替换</option>
            <option value={1}>先替换查找式</option>
            <option value={2}>先替换替换内容</option>
          </select>
        </label>
        <label>
          <span>最小深度</span>
          <input
            type="number"
            value={draft.minDepth ?? ""}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                minDepth:
                  event.target.value === "" ? null : Number(event.target.value),
              }))
            }
            disabled={saving}
          />
        </label>
        <label>
          <span>最大深度</span>
          <input
            type="number"
            value={draft.maxDepth ?? ""}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                maxDepth:
                  event.target.value === "" ? null : Number(event.target.value),
              }))
            }
            disabled={saving}
          />
        </label>
      </div>

      <div className="regex-editor__actions">
        <button
          className="button button--quiet"
          type="button"
          onClick={onCancel}
          disabled={saving}
        >
          收起
        </button>
        <button
          className="button button--secondary"
          type="submit"
          disabled={saving}
        >
          <FloppyDisk size={15} />
          {saving ? "保存中" : "保存正则"}
        </button>
      </div>
    </form>
  );
}

function RegexScriptItem({
  script,
  expanded,
  canReorder,
  saving,
  dragging,
  dropPosition,
  onEdit,
  onToggle,
  onSave,
  onPointerDown,
}: {
  script: RegexScriptDefinition;
  expanded: boolean;
  canReorder: boolean;
  saving: boolean;
  dragging: boolean;
  dropPosition: "before" | "after" | null;
  onEdit: (scriptId: string | null) => void;
  onToggle: (script: RegexScriptDefinition) => Promise<void>;
  onSave: (script: RegexScriptDefinition) => Promise<void>;
  onPointerDown: (
    scriptId: string,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => void;
}) {
  const name = script.scriptName || "未命名正则";

  return (
    <li
      className={[
        "regex-script",
        script.disabled ? "regex-script--disabled" : "",
        dragging ? "regex-script--dragging" : "",
        dropPosition === "before" ? "regex-script--drop-before" : "",
        dropPosition === "after" ? "regex-script--drop-after" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-regex-script-id={script.id}
    >
      <div className="regex-script__row">
        <button
          className="regex-script__drag"
          type="button"
          aria-label={`拖动 ${name} 调整顺序`}
          title={
            canReorder
              ? "按住拖动调整执行顺序"
              : "切换到“全部”并清除搜索后可调整顺序"
          }
          disabled={!canReorder || saving || expanded}
          onPointerDown={(event) => onPointerDown(script.id, event)}
        >
          <DotsSixVertical size={16} weight="bold" />
        </button>
        <div className="regex-script__identity" title={name}>
          <strong>{name}</strong>
        </div>
        <div className="regex-script__controls">
          <button
            className="regex-script__icon"
            type="button"
            aria-label={`编辑 ${name}`}
            title="编辑正则"
            onClick={() => onEdit(expanded ? null : script.id)}
            disabled={saving}
          >
            <PencilSimple size={15} />
          </button>
          <button
            className={`regex-script__switch${
              script.disabled ? "" : " regex-script__switch--on"
            }`}
            type="button"
            role="switch"
            aria-checked={!script.disabled}
            aria-label={`${script.disabled ? "启用" : "停用"} ${name}`}
            title={script.disabled ? "已停用，点击启用" : "已启用，点击停用"}
            onClick={() =>
              void onToggle({ ...script, disabled: !script.disabled })
            }
            disabled={saving}
          >
            <span />
          </button>
        </div>
      </div>
      {expanded ? (
        <RegexScriptEditor
          script={script}
          saving={saving}
          onCancel={() => onEdit(null)}
          onSave={onSave}
        />
      ) : null}
    </li>
  );
}

export function RegexManager({
  scopes,
  cardId,
  presetId,
  onSaveScope,
}: RegexManagerProps) {
  const [selectedKind, setSelectedKind] = useState<RegexScopeKind>(
    cardId ? "card" : "global",
  );
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase());
  const [filter, setFilter] = useState<"all" | "enabled" | "disabled">("all");
  const [expandedScriptId, setExpandedScriptId] = useState<string | null>(null);
  const [draggedScriptId, setDraggedScriptId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    scriptId: string;
    position: "before" | "after";
  } | null>(null);
  const [saving, setSaving] = useState(false);

  const availableScopes = useMemo(
    () => ({
      global: scopes.find(
        (scope) => scope.scope === "global" && scope.id === "global",
      ),
      card: scopes.find(
        (scope) => scope.scope === "card" && scope.id === cardId,
      ),
      preset: scopes.find(
        (scope) => scope.scope === "preset" && scope.id === presetId,
      ),
    }),
    [cardId, presetId, scopes],
  );
  const scope = availableScopes[selectedKind];

  useEffect(() => {
    setQuery("");
    setFilter("all");
    setExpandedScriptId(null);
    setDraggedScriptId(null);
    setDropTarget(null);
  }, [scope?.id, selectedKind]);

  const { enabledCount, visibleScripts } = useMemo(() => {
    const scripts = scope?.scripts ?? [];
    return {
      enabledCount: scripts.reduce(
        (count, script) => count + (script.disabled ? 0 : 1),
        0,
      ),
      visibleScripts: scripts.filter((script) => {
        if (filter === "enabled" && script.disabled) return false;
        if (filter === "disabled" && !script.disabled) return false;
        if (!deferredQuery) return true;
        return [
          script.scriptName,
          script.id,
          script.findRegex,
          script.replaceString,
        ]
          .join("\n")
          .toLocaleLowerCase()
          .includes(deferredQuery);
      }),
    };
  }, [deferredQuery, filter, scope?.scripts]);

  const savePatch = async (patch: RegexScopePatch): Promise<boolean> => {
    if (!scope || saving) return false;
    setSaving(true);
    try {
      await onSaveScope(scope, patch);
      return true;
    } catch {
      // The parent surface reports a durable toast and preserves server state.
      return false;
    } finally {
      setSaving(false);
    }
  };

  const replaceScript = async (updated: RegexScriptDefinition) => {
    if (!scope) return;
    await savePatch({
      scripts: scope.scripts.map((script) =>
        script.id === updated.id ? updated : script,
      ),
    });
  };

  const addScript = async () => {
    if (!scope) return;
    const script = createRegexScript();
    const saved = await savePatch({ scripts: [...scope.scripts, script] });
    if (saved) setExpandedScriptId(script.id);
  };

  const orderingEnabled = filter === "all" && deferredQuery.length === 0;

  const clearDragState = () => {
    setDraggedScriptId(null);
    setDropTarget(null);
  };

  const startDragging = (
    scriptId: string,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (!orderingEnabled || saving) {
      event.preventDefault();
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraggedScriptId(scriptId);
  };

  const dropTargetAt = (clientX: number, clientY: number) => {
    const row = document
      .elementFromPoint(clientX, clientY)
      ?.closest<HTMLElement>("[data-regex-script-id]");
    const scriptId = row?.dataset.regexScriptId;
    if (!row || !scriptId || scriptId === draggedScriptId) return null;
    const bounds = row.getBoundingClientRect();
    const position =
      clientY < bounds.top + bounds.height / 2 ? "before" : "after";
    return { scriptId, position } as const;
  };

  const movePointer = (event: ReactPointerEvent<HTMLUListElement>) => {
    if (!orderingEnabled || !draggedScriptId || saving) return;
    event.preventDefault();
    const target = dropTargetAt(event.clientX, event.clientY);
    if (!target) {
      setDropTarget(null);
      return;
    }
    setDropTarget((current) =>
      current?.scriptId === target.scriptId &&
      current.position === target.position
        ? current
        : target,
    );
  };

  const reorderScript = async (
    sourceId: string,
    targetId: string,
    position: "before" | "after",
  ) => {
    if (!scope || !orderingEnabled || sourceId === targetId || saving) {
      clearDragState();
      return;
    }
    const next = [...scope.scripts];
    const sourceIndex = next.findIndex((script) => script.id === sourceId);
    if (sourceIndex < 0) {
      clearDragState();
      return;
    }
    const [source] = next.splice(sourceIndex, 1);
    const targetIndex = next.findIndex((script) => script.id === targetId);
    if (!source || targetIndex < 0) {
      clearDragState();
      return;
    }
    next.splice(targetIndex + (position === "after" ? 1 : 0), 0, source);
    clearDragState();
    if (next.every((script, index) => script.id === scope.scripts[index]?.id)) {
      return;
    }
    await savePatch({ scripts: next });
  };

  const finishPointerDrag = (event: ReactPointerEvent<HTMLUListElement>) => {
    if (!draggedScriptId) return;
    const sourceId = draggedScriptId;
    const target = dropTargetAt(event.clientX, event.clientY) ?? dropTarget;
    clearDragState();
    if (target) {
      void reorderScript(sourceId, target.scriptId, target.position);
    }
  };

  return (
    <div className="regex-manager">
      <div className="regex-scope-tabs" role="tablist" aria-label="正则来源">
        {(Object.keys(scopeLabels) as RegexScopeKind[]).map((kind) => (
          <button
            className={kind === selectedKind ? "is-active" : ""}
            type="button"
            role="tab"
            aria-selected={kind === selectedKind}
            key={kind}
            onClick={() => setSelectedKind(kind)}
          >
            {scopeLabels[kind]}
            <span>{availableScopes[kind]?.scripts.length ?? 0}</span>
          </button>
        ))}
      </div>

      {scope ? (
        <>
          <div className="regex-source-summary">
            <div>
              <strong>{scope.name}</strong>
              <span>
                {enabledCount}/{scope.scripts.length} 条启用 · 来源修订{" "}
                {scope.revision}
              </span>
            </div>
            <SurfaceStatus tone={scope.enabled ? "mint" : "slate"}>
              {scope.enabled ? "来源生效" : "来源未授权"}
            </SurfaceStatus>
          </div>
          <p className="regex-source-note">
            {scope.scope === "global"
              ? "此处规则对所有普通聊天生效。"
              : scope.enabled
                ? `此处规则仅跟随${scope.scope === "card" ? "当前角色卡" : "当前预设"}生效。`
                : "条目已完整导入，但来源未授权，因此当前不会处理消息或提示词。"}
          </p>
          <button
            className={`button ${scope.enabled ? "button--quiet" : "button--primary"} button--full`}
            type="button"
            onClick={() => void savePatch({ enabled: !scope.enabled })}
            disabled={saving}
          >
            {scope.enabled
              ? scope.scope === "global"
                ? "停用全局正则"
                : "停用此来源"
              : scope.scope === "global"
                ? "启用全局正则"
                : "信任并启用此来源"}
          </button>

          {scope.diagnostics.length > 0 ? (
            <ul className="regex-diagnostics" aria-label="正则解析提示">
              {scope.diagnostics.map((diagnostic, index) => (
                <li key={`${diagnostic.code}:${diagnostic.path ?? index}`}>
                  <strong>{diagnostic.code}</strong>
                  <span>{diagnostic.message}</span>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="regex-toolbar">
            <label className="regex-search">
              <MagnifyingGlass size={16} />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索名称、ID 或表达式"
              />
            </label>
            <button
              className="button button--secondary"
              type="button"
              onClick={() => void addScript()}
              disabled={saving}
            >
              <Plus size={15} />
              新增正则
            </button>
          </div>
          <div className="regex-filters" aria-label="筛选正则条目">
            {(
              [
                ["all", `全部 ${scope.scripts.length}`],
                ["enabled", `启用 ${enabledCount}`],
                ["disabled", `停用 ${scope.scripts.length - enabledCount}`],
              ] as const
            ).map(([value, label]) => (
              <button
                className={filter === value ? "is-active" : ""}
                type="button"
                key={value}
                onClick={() => setFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>

          {visibleScripts.length > 0 ? (
            <ul
              className="regex-script-list"
              onPointerMove={movePointer}
              onPointerUp={finishPointerDrag}
              onPointerCancel={clearDragState}
            >
              {visibleScripts.map((script) => (
                <RegexScriptItem
                  key={script.id}
                  script={script}
                  expanded={script.id === expandedScriptId}
                  canReorder={orderingEnabled}
                  saving={saving}
                  dragging={script.id === draggedScriptId}
                  dropPosition={
                    dropTarget?.scriptId === script.id
                      ? dropTarget.position
                      : null
                  }
                  onEdit={setExpandedScriptId}
                  onToggle={replaceScript}
                  onSave={replaceScript}
                  onPointerDown={startDragging}
                />
              ))}
            </ul>
          ) : (
            <p className="support-empty">
              {scope.scripts.length === 0
                ? "这个来源还没有正则条目。"
                : "没有符合筛选条件的正则条目。"}
            </p>
          )}
        </>
      ) : (
        <p className="support-empty">
          {selectedKind === "card"
            ? "当前会话没有可用的角色卡正则来源。"
            : selectedKind === "preset"
              ? "请先选择一个预设。"
              : "全局正则来源尚未初始化。"}
        </p>
      )}
    </div>
  );
}
