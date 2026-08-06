import {
  ArrowClockwise,
  CloudSlash,
  WarningCircle,
} from "@phosphor-icons/react";

import type { WorkspaceAvailability } from "../domain/workspace";

type WorkspaceConnectionBannerProps = {
  availability: WorkspaceAvailability;
  error: string | null;
  onRetry: () => void;
  onEnterDemo: () => void;
};

export function WorkspaceConnectionBanner({
  availability,
  error,
  onRetry,
  onEnterDemo,
}: WorkspaceConnectionBannerProps) {
  if (availability === "api") return null;

  if (availability === "loading") {
    return (
      <div
        className="workspace-connection-banner workspace-connection-banner--loading"
        role="status"
      >
        <CloudSlash size={17} />
        <span>正在连接本地服务；当前工作区会先保持可用。</span>
      </div>
    );
  }

  if (availability === "demo") {
    return (
      <div
        className="workspace-connection-banner workspace-connection-banner--demo"
        role="status"
      >
        <CloudSlash size={17} />
        <span>当前为演示模式，内容不会写入本地服务。</span>
        <button
          className="button button--quiet"
          type="button"
          onClick={onRetry}
        >
          <ArrowClockwise size={15} />
          重试连接
        </button>
      </div>
    );
  }

  return (
    <div
      className="workspace-connection-banner workspace-connection-banner--error"
      role="alert"
    >
      <WarningCircle size={18} />
      <div>
        <strong>本地服务连接失败</strong>
        <span>{error || "无法连接本地服务。当前仍保留本地工作区。"}</span>
      </div>
      <div className="workspace-connection-banner__actions">
        <button
          className="button button--quiet"
          type="button"
          onClick={onRetry}
        >
          <ArrowClockwise size={15} />
          重试
        </button>
        <button
          className="button button--secondary"
          type="button"
          onClick={onEnterDemo}
        >
          进入演示
        </button>
      </div>
    </div>
  );
}
