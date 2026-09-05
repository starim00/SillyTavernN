import { FloppyDisk, ArrowCounterClockwise } from "@phosphor-icons/react";
import { useEffect, useState, type FormEvent } from "react";
import type {
  Worldbook,
  WorldbookEntry,
  WorldbookEntryUpdate,
} from "../domain/workspace";
import {
  editableWorldbookEntry,
  compactKeywordRows,
  KeywordListEditor,
  insertionPositionOptions,
  type ExplicitInsertionPosition,
} from "./worldbookFields";

export function WorldbookEntryEditor({
  worldbook,
  entry,
  online = true,
  onSave,
  onSaved,
  onCancel,
  onDirtyChange,
  onBusyChange,
}: {
  worldbook: Worldbook;
  entry: WorldbookEntry;
  online?: boolean;
  onSave: (
    book: Worldbook,
    entry: WorldbookEntry,
    patch: WorldbookEntryUpdate,
  ) => Promise<void>;
  onSaved: () => void;
  onCancel?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [snapshot] = useState(() => ({ worldbook, entry }));
  const [draft, setDraft] = useState(() => editableWorldbookEntry(entry));
  const [primaryKeys, setPrimaryKeys] = useState(() => [...entry.primaryKeys]);
  const [secondaryKeys, setSecondaryKeys] = useState(() => [
    ...entry.secondaryKeys,
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const blocked = saving || !online;
  const patch = {
    ...draft,
    primaryKeys: compactKeywordRows(primaryKeys),
    secondaryKeys: compactKeywordRows(secondaryKeys),
  };
  const dirty =
    JSON.stringify(patch) !==
    JSON.stringify({
      ...editableWorldbookEntry(snapshot.entry),
      primaryKeys: compactKeywordRows(snapshot.entry.primaryKeys),
      secondaryKeys: compactKeywordRows(snapshot.entry.secondaryKeys),
    });
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);
  const reset = () => {
    setDraft(editableWorldbookEntry(snapshot.entry));
    setPrimaryKeys([...snapshot.entry.primaryKeys]);
    setSecondaryKeys([...snapshot.entry.secondaryKeys]);
    setError("");
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (blocked || !dirty || !draft.title.trim()) return;
    setSaving(true);
    onBusyChange?.(true);
    setError("");
    try {
      await onSave(snapshot.worldbook, snapshot.entry, {
        ...patch,
        title: draft.title.trim(),
      });
      onDirtyChange?.(false);
      onSaved();
    } catch {
      setError(
        "保存失败，修改仍保留在编辑器中。请检查连接；若条目已在其他位置更新，请先复制保留修改，再刷新页面后合并。",
      );
    } finally {
      setSaving(false);
      onBusyChange?.(false);
    }
  };
  return (
    <form className="wb-editor" onSubmit={submit}>
      <div className="wb-editor__body">
        <label className="field">
          <span>条目名称</span>
          <input
            value={draft.title}
            disabled={blocked}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                title: event.target.value,
              }))
            }
          />
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={draft.enabled}
            disabled={blocked}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                enabled: event.target.checked,
              }))
            }
          />
          <span>启用此条目</span>
        </label>
        <label className="field">
          <span>条目正文</span>
          <textarea
            value={draft.content}
            rows={9}
            disabled={blocked}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                content: event.target.value,
              }))
            }
          />
        </label>
        <details className="wb-editor__section" open>
          <summary>触发条件与关键词</summary>
          <div className="wb-editor__section-body">
            {" "}
            <KeywordListEditor
              label="主要关键词"
              values={primaryKeys}
              disabled={blocked || draft.constant}
              onChange={setPrimaryKeys}
            />
            <KeywordListEditor
              label="辅助关键词"
              values={secondaryKeys}
              disabled={blocked || draft.constant || !draft.selective}
              onChange={setSecondaryKeys}
            />
            <div className="wb-editor__checks">
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={draft.constant}
                  disabled={blocked}
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
                  disabled={blocked || draft.constant}
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
                  disabled={blocked}
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
          </div>
        </details>
        <details className="wb-editor__section">
          <summary>插入位置与优先级</summary>
          <div className="wb-editor__section-body">
            {" "}
            <div className="wb-editor__grid">
              <label className="field">
                <span>插入位置</span>
                <select
                  value={draft.insertionPosition ?? ""}
                  disabled={blocked}
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
                  disabled={blocked}
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
                  disabled={blocked}
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
                  disabled={blocked}
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
              <label className="field">
                <span>触发概率 %</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={draft.probability ?? 100}
                  disabled={blocked}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      probability: event.target.valueAsNumber || 0,
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
                  disabled={blocked}
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
              <div className="wb-editor__grid">
                <label className="field">
                  <span>历史深度</span>
                  <input
                    type="number"
                    min={0}
                    max={10_000}
                    value={draft.insertionDepth ?? 0}
                    disabled={blocked}
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
                    disabled={blocked}
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
          </div>
        </details>{" "}
        <details className="wb-editor__section">
          <summary>匹配与递归设置</summary>
          <div className="wb-editor__checks">
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
                  disabled={blocked}
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
      </div>
      <footer className="wb-editor__footer">
        <span role="status">
          {saving ? "正在保存…" : dirty ? "有未保存的修改" : "已保存"}
        </span>
        {onCancel ? (
          <button
            type="button"
            className="button button--quiet"
            disabled={saving}
            onClick={onCancel}
          >
            取消
          </button>
        ) : null}
        <button
          type="button"
          className="button button--quiet"
          disabled={blocked || !dirty}
          onClick={reset}
        >
          <ArrowCounterClockwise size={16} />
          还原修改
        </button>
        <button
          type="submit"
          className="button button--primary"
          disabled={blocked || !dirty || !draft.title.trim()}
        >
          <FloppyDisk size={16} />
          {saving ? "保存中" : "保存条目"}
        </button>
        {error ? (
          <p className="wb-error" role="alert">
            {error}
          </p>
        ) : null}
      </footer>
    </form>
  );
}
