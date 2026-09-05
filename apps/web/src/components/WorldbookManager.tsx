import {
  ArrowLeft,
  BookOpenText,
  Lock,
  LockOpen,
  MagnifyingGlass,
  Trash,
  X,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import type {
  RoleCard,
  Worldbook,
  WorldbookEntry,
  WorldbookEntryUpdate,
} from "../domain/workspace";
import { WorldbookEntryEditor } from "./WorldbookEntryEditor";
import { IconButton } from "./WorkspacePrimitives";
import { worldbookEntryModeLabel } from "./worldbookFields";

export type EntryFilter = "all" | "enabled" | "disabled" | "editable";
export function filterWorldbookEntries(
  entries: WorldbookEntry[],
  query: string,
  filter: EntryFilter,
) {
  const term = query.trim().toLocaleLowerCase();
  return entries.filter(
    (entry) =>
      (filter === "all" ||
        (filter === "enabled" && entry.enabled) ||
        (filter === "disabled" && !entry.enabled) ||
        (filter === "editable" && entry.agentEditable)) &&
      (!term ||
        [
          entry.title,
          entry.content,
          ...entry.primaryKeys,
          ...entry.secondaryKeys,
        ]
          .join("\n")
          .toLocaleLowerCase()
          .includes(term)),
  );
}

export function WorldbookManager({
  card,
  worldbooks,
  activeWorldbooks,
  online,
  onClose,
  onPermission,
  onSave,
  onSaveCardWorldbooks,
  onDeleteWorldbook,
}: {
  card: RoleCard | null;
  worldbooks: Worldbook[];
  activeWorldbooks: Worldbook[];
  online: boolean;
  onClose: () => void;
  onPermission: (
    book: Worldbook,
    entry: WorldbookEntry,
    editable: boolean,
  ) => Promise<void>;
  onSave: (
    book: Worldbook,
    entry: WorldbookEntry,
    patch: WorldbookEntryUpdate,
  ) => Promise<void>;
  onSaveCardWorldbooks: (ids: string[]) => Promise<void>;
  onDeleteWorldbook: (book: Worldbook) => Promise<void>;
}) {
  const initialBook =
    worldbooks.find((book) => card?.worldbookIds.includes(book.id)) ??
    worldbooks[0];
  const [bookId, setBookId] = useState(initialBook?.id ?? "");
  const [entryId, setEntryId] = useState(initialBook?.entries[0]?.id ?? "");
  const [bookQuery, setBookQuery] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<EntryFilter>("all");
  const [draftSelectedIds, setSelectedIds] = useState(
    () => new Set(card?.worldbookIds ?? []),
  );
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const [step, setStep] = useState<"books" | "entries" | "editor">("books");
  const [pending, setPending] = useState<(() => void) | null>(null);
  const [permission, setPermission] = useState(false);
  const [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLDivElement>(null);
  const book =
    worldbooks.find((candidate) => candidate.id === bookId) ?? worldbooks[0];
  const entry =
    book?.entries.find((candidate) => candidate.id === entryId) ??
    book?.entries[0];
  const selectedIds = new Set(
    [...draftSelectedIds].filter((id) =>
      worldbooks.some((candidate) => candidate.id === id),
    ),
  );
  const persisted = new Set(card?.worldbookIds ?? []);
  const combinationDirty =
    selectedIds.size !== persisted.size ||
    [...selectedIds].some((id) => !persisted.has(id));
  const visibleBooks = worldbooks.filter((candidate) =>
    `${candidate.name}\n${candidate.description}`
      .toLocaleLowerCase()
      .includes(bookQuery.trim().toLocaleLowerCase()),
  );
  const entries = filterWorldbookEntries(book?.entries ?? [], query, filter);
  const guard = (action: () => void, closing = false) => {
    if (busy) return;
    if (dirty || (closing && combinationDirty)) setPending(() => action);
    else action();
  };
  const close = () => guard(onClose, true);
  useEffect(() => {
    const previous = document.activeElement;
    root.current?.focus();
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  useEffect(() => {
    if (!dirty && !combinationDirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, combinationDirty]);
  useEffect(() => {
    if (!pending && !permission) return;
    const previous = document.activeElement;
    confirmRef.current?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, [pending, permission]);
  const selectBook = (next: Worldbook) => {
    if (next.id === book?.id) {
      setStep("entries");
      return;
    }
    guard(() => {
      setDirty(false);
      setBookId(next.id);
      setEntryId(next.entries[0]?.id ?? "");
      setQuery("");
      setFilter("all");
      setStep("entries");
      setError("");
      setEpoch((value) => value + 1);
    });
  };
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch {
      setError("操作失败，请检查连接后重试。未保存的修改仍保留。");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="modal-backdrop wb-backdrop"
      role="presentation"
      onMouseDown={close}
      ref={root}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          event.preventDefault();
          if (!busy) {
            if (pending) setPending(null);
            else if (permission) setPermission(false);
            else close();
          }
        }
        if (event.key === "Tab") {
          const surface =
            pending || permission ? confirmRef.current : root.current;
          const controls = [
            ...(surface?.querySelectorAll<HTMLElement>(
              'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary, [tabindex="0"]',
            ) ?? []),
          ].filter((node) => node.getClientRects().length > 0);
          const first = controls[0],
            last = controls.at(-1);
          if (!first) {
            event.preventDefault();
            return;
          }
          if (
            event.shiftKey &&
            (document.activeElement === first ||
              !controls.includes(document.activeElement as HTMLElement))
          ) {
            event.preventDefault();
            last?.focus();
          } else if (
            !event.shiftKey &&
            (document.activeElement === last ||
              !controls.includes(document.activeElement as HTMLElement))
          ) {
            event.preventDefault();
            first.focus();
          }
        }
      }}
    >
      <section
        className={`wb-manager wb-manager--${step}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="wb-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div
          className="wb-manager__main"
          inert={Boolean(pending || permission)}
        >
          <header className="wb-manager__header">
            <BookOpenText size={24} />
            <div>
              <h2 id="wb-title">世界书</h2>
              <p>管理背景资料、触发规则与角色卡组合</p>
            </div>
            {!online ? <span role="status">当前离线</span> : null}
            <IconButton
              label="关闭弹窗"
              icon={<X size={20} />}
              disabled={busy}
              onClick={close}
            />
          </header>
          <div className="wb-manager__workspace">
            <aside className="wb-books" aria-label="全部世界书">
              <div className="wb-pane-heading">
                <strong>全部世界书</strong>
                <span>{worldbooks.length} 本</span>
              </div>
              <label className="wb-search">
                <MagnifyingGlass size={16} />
                <input
                  aria-label="搜索世界书"
                  placeholder="搜索世界书"
                  value={bookQuery}
                  onChange={(event) => setBookQuery(event.target.value)}
                />
              </label>
              <div className="wb-books__list">
                {visibleBooks.map((candidate) => (
                  <button
                    type="button"
                    key={candidate.id}
                    className={`wb-book ${candidate.id === book?.id ? "is-selected" : ""}`}
                    aria-pressed={candidate.id === book?.id}
                    disabled={busy}
                    onClick={() => selectBook(candidate)}
                  >
                    <strong>{candidate.name}</strong>
                    <span>
                      {candidate.entries.length} 个条目
                      {selectedIds.has(candidate.id)
                        ? " · 角色卡已选"
                        : activeWorldbooks.some(
                              (active) => active.id === candidate.id,
                            )
                          ? " · 当前会话"
                          : ""}
                    </span>
                  </button>
                ))}
                {!visibleBooks.length ? (
                  <p className="wb-empty">
                    {worldbooks.length
                      ? "没有匹配的世界书"
                      : "还没有世界书，请从导入菜单添加世界书 JSON。"}
                  </p>
                ) : null}
              </div>
              <footer className="wb-combination">
                <strong>当前角色卡组合 · {selectedIds.size} 本</strong>
                <span>{card?.name ?? "尚未选择角色卡"}</span>
                <p>
                  保存后应用到这张角色卡的所有对话。世界书内容由引用它的角色卡共享。
                </p>
                <button
                  type="button"
                  className="button button--primary"
                  disabled={!card || !online || !combinationDirty || busy}
                  onClick={() =>
                    void run(() => onSaveCardWorldbooks([...selectedIds]))
                  }
                >
                  保存组合{combinationDirty ? " · 未保存" : ""}
                </button>
              </footer>
            </aside>
            <section className="wb-entries" aria-label="条目列表">
              <div className="wb-pane-heading">
                <button
                  className="text-button wb-back"
                  onClick={() => setStep("books")}
                >
                  <ArrowLeft size={16} />
                  世界书
                </button>
                <span>
                  {entries.length} / {book?.entries.length ?? 0} 条
                </span>
              </div>
              <div className="wb-book-info">
                <h3>{book?.name ?? "选择一本世界书"}</h3>
                {book?.description ? <p>{book.description}</p> : null}
                {book ? (
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(book.id)}
                      disabled={!card || !online || busy}
                      onChange={(event) =>
                        setSelectedIds((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(book.id);
                          else next.delete(book.id);
                          return next;
                        })
                      }
                    />
                    <span>用于当前角色卡</span>
                  </label>
                ) : null}
                {book &&
                activeWorldbooks.some((active) => active.id === book.id) &&
                !persisted.has(book.id) ? (
                  <p>当前会话专属世界书</p>
                ) : null}
              </div>
              <label className="wb-search">
                <MagnifyingGlass size={16} />
                <input
                  aria-label="搜索条目"
                  placeholder="搜索名称、关键词或正文"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <select
                className="wb-filter"
                aria-label="筛选条目"
                value={filter}
                onChange={(event) =>
                  setFilter(event.target.value as EntryFilter)
                }
              >
                <option value="all">全部条目</option>
                <option value="enabled">已启用</option>
                <option value="disabled">已停用</option>
                <option value="editable">Agent 可编辑</option>
              </select>
              <div className="wb-entries__list">
                {entries.map((candidate) => (
                  <button
                    type="button"
                    key={candidate.id}
                    disabled={busy}
                    aria-pressed={candidate.id === entry?.id}
                    className={`wb-entry ${candidate.id === entry?.id ? "is-selected" : ""}`}
                    onClick={() => {
                      if (candidate.id === entry?.id) {
                        setStep("editor");
                        return;
                      }
                      guard(() => {
                        setDirty(false);
                        setEntryId(candidate.id);
                        setStep("editor");
                        setEpoch((value) => value + 1);
                      });
                    }}
                  >
                    <span className="wb-entry__title">
                      <i className={candidate.enabled ? "is-enabled" : ""} />
                      <strong>{candidate.title}</strong>
                    </span>
                    <span>
                      {candidate.enabled
                        ? worldbookEntryModeLabel(candidate)
                        : "已停用"}
                      {candidate.agentEditable ? " · Agent 可编辑" : ""}
                    </span>
                    <small>
                      {candidate.primaryKeys.join(" · ") ||
                        (candidate.constant
                          ? "始终参与提示词"
                          : "未设置关键词")}
                    </small>
                  </button>
                ))}
                {!entries.length ? (
                  <p className="wb-empty">
                    {book?.entries.length
                      ? "没有匹配的条目，试试其他关键词或筛选条件。"
                      : "这本世界书还没有条目。"}
                  </p>
                ) : null}
              </div>
              {book?.imported ? (
                <button
                  className="text-button wb-delete"
                  disabled={!online || busy || dirty || combinationDirty}
                  onClick={() => void run(() => onDeleteWorldbook(book))}
                >
                  <Trash size={15} />
                  删除这本世界书
                </button>
              ) : null}
            </section>
            <section className="wb-detail" aria-label="条目编辑器">
              <header className="wb-detail__header">
                <button
                  className="text-button wb-back"
                  onClick={() => setStep("entries")}
                >
                  <ArrowLeft size={16} />
                  条目列表
                </button>
                <span>{entry ? "编辑条目" : "条目详情"}</span>
                {book && entry ? (
                  <button
                    className="button button--quiet wb-permission"
                    disabled={!online || busy || dirty}
                    title={
                      dirty
                        ? "请先保存或还原条目修改"
                        : "管理此条目的 Agent 编辑权限"
                    }
                    onClick={() => setPermission(true)}
                  >
                    {entry.agentEditable ? (
                      <LockOpen size={16} />
                    ) : (
                      <Lock size={16} />
                    )}
                    <span>
                      {entry.agentEditable ? "Agent 可编辑" : "Agent 只读"}
                    </span>
                  </button>
                ) : null}
              </header>
              {book && entry ? (
                <WorldbookEntryEditor
                  key={`${book.id}/${entry.id}/${epoch}`}
                  worldbook={book}
                  entry={entry}
                  online={online && !busy}
                  onSave={onSave}
                  onSaved={() => setEpoch((value) => value + 1)}
                  onDirtyChange={setDirty}
                  onBusyChange={setBusy}
                />
              ) : (
                <div className="wb-empty">
                  <BookOpenText size={32} />
                  <p>从列表选择一个条目，查看或编辑正文与触发规则。</p>
                </div>
              )}
            </section>
          </div>
          {error ? (
            <p className="wb-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        {pending || permission ? (
          <div className="wb-confirm-backdrop">
            <div
              className="wb-confirm"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="wb-confirm-title"
              aria-describedby="wb-confirm-description"
              ref={confirmRef}
              tabIndex={-1}
            >
              <h3 id="wb-confirm-title">
                {pending
                  ? "有尚未保存的修改"
                  : entry?.agentEditable
                    ? "关闭 Agent 编辑权限"
                    : "允许 Agent 编辑此条目"}
              </h3>
              <p id="wb-confirm-description">
                {pending
                  ? "离开会丢弃当前未保存的修改。你可以返回继续编辑并保存。"
                  : `此操作仅影响“${entry?.title}”。${entry?.agentEditable ? "关闭后，Agent 将无法修改此条目。" : "开启后，Agent 可以通过受控工具修改此条目，写入仍会检查版本、确认和运行状态。"}`}
              </p>
              <div>
                <button
                  className="button button--quiet"
                  disabled={busy}
                  onClick={() => {
                    setPending(null);
                    setPermission(false);
                  }}
                >
                  {pending ? "继续编辑" : "取消"}
                </button>
                <button
                  className="button button--primary"
                  disabled={busy || (!pending && !online)}
                  onClick={() => {
                    if (pending) {
                      const action = pending;
                      setPending(null);
                      action();
                    } else if (book && entry)
                      void run(async () => {
                        await onPermission(book, entry, !entry.agentEditable);
                        setPermission(false);
                        setEpoch((value) => value + 1);
                      });
                  }}
                >
                  {pending ? "放弃修改并离开" : busy ? "处理中…" : "确认"}
                </button>
              </div>
              {error ? (
                <p role="alert" className="wb-error">
                  {error}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
