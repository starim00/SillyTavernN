import { Trash } from "@phosphor-icons/react";

import type { WorkspaceMessage } from "../domain/workspace";

type MessageDeleteDialogProps = {
  message: WorkspaceMessage | null;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function MessageDeleteDialog({
  message,
  deleting,
  onCancel,
  onConfirm,
}: MessageDeleteDialogProps) {
  if (!message) return null;

  const actor = message.role === "user" ? "你的这条输入" : "这条模型回复";

  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        if (!deleting) onCancel();
      }}
    >
      <section
        className="modal-card message-delete-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="message-delete-dialog-title"
        aria-describedby="message-delete-dialog-description"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-card__header">
          <span className="modal-card__icon message-delete-dialog__icon">
            <Trash size={22} />
          </span>
          <div>
            <h2 id="message-delete-dialog-title">删除消息</h2>
            <p id="message-delete-dialog-description">
              确定删除{actor}及其之后的所有消息吗？
            </p>
          </div>
        </header>
        <div className="message-delete-dialog__body">
          此操作无法撤销，后续消息和相关 Swipe 也会一并删除。
        </div>
        <footer className="modal-actions">
          <button
            className="button button--quiet"
            type="button"
            disabled={deleting}
            autoFocus
            onClick={onCancel}
          >
            取消
          </button>
          <button
            className="button button--danger"
            type="button"
            disabled={deleting}
            onClick={onConfirm}
          >
            {deleting ? "正在删除…" : "删除消息"}
          </button>
        </footer>
      </section>
    </div>
  );
}
