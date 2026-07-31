import type { ButtonHTMLAttributes, ReactNode } from "react";

import type { Participant } from "../domain/workspace";

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  icon: ReactNode;
  compact?: boolean;
};

export function IconButton({
  label,
  icon,
  compact = false,
  className = "",
  ...props
}: IconButtonProps) {
  return (
    <button
      className={`icon-button${compact ? " icon-button--compact" : ""} ${className}`.trim()}
      type="button"
      aria-label={label}
      title={label}
      {...props}
    >
      {icon}
    </button>
  );
}

export function ParticipantChips({
  participants,
  compact = false,
}: {
  participants: Participant[];
  compact?: boolean;
}) {
  if (participants.length === 0) {
    return (
      <span className="participant-empty" data-testid="participant-empty">
        无固定参与者
      </span>
    );
  }

  return (
    <div
      className={`participant-chips${compact ? " participant-chips--compact" : ""}`}
    >
      {participants.map((participant) => (
        <span
          className={`participant-chip participant-chip--${participant.accent}`}
          key={participant.id}
          title={participant.kind}
        >
          <span aria-hidden="true" className="participant-chip__dot" />
          {participant.name}
        </span>
      ))}
    </div>
  );
}

export function SurfaceStatus({
  tone,
  children,
}: {
  tone: "mint" | "slate" | "coral";
  children: ReactNode;
}) {
  return (
    <span className={`surface-status surface-status--${tone}`}>{children}</span>
  );
}

export function EmptyState({
  icon,
  title,
  detail,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <div className="empty-state">
      <span className="empty-state__icon" aria-hidden="true">
        {icon}
      </span>
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}
