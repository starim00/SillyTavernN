import { X } from "@phosphor-icons/react";
import type { ReactNode } from "react";

import { IconButton } from "./WorkspacePrimitives";

export function WorkspaceModalFrame({
  title,
  description,
  icon,
  onClose,
  children,
  size = "medium",
}: {
  title: string;
  description: string;
  icon: ReactNode;
  onClose: () => void;
  children: ReactNode;
  size?: "medium" | "large" | "wide";
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className={`modal-card modal-card--${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        aria-describedby="modal-description"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-card__header">
          <span className="modal-card__icon" aria-hidden="true">
            {icon}
          </span>
          <div>
            <h2 id="modal-title">{title}</h2>
            <p id="modal-description">{description}</p>
          </div>
          <IconButton
            label="关闭弹窗"
            icon={<X size={19} />}
            onClick={onClose}
          />
        </header>
        {children}
      </section>
    </div>
  );
}
