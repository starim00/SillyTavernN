import { Check, PuzzlePiece, ShieldWarning, X } from "@phosphor-icons/react";
import { useState, type ReactNode } from "react";

import type { LegacyHostPluginStatus } from "../api/workspaceApi";
import type { LegacyPlugin } from "../domain/workspace";
import { IconButton, SurfaceStatus } from "./WorkspacePrimitives";

function ModalFrame({
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

function PluginsModal({
  online,
  plugins,
  legacyHostPlugins,
  onClose,
  onInstall,
  onToggle,
}: {
  online: boolean;
  plugins: LegacyPlugin[];
  legacyHostPlugins: Record<string, LegacyHostPluginStatus>;
  onClose: () => void;
  onInstall: (plugin: LegacyPlugin) => Promise<void>;
  onToggle: (plugin: LegacyPlugin) => Promise<void>;
}) {
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  return (
    <ModalFrame
      title="兼容插件"
      description="旧版扩展在独立来源的兼容域运行；插件权限与模型工具权限彼此独立。"
      icon={<PuzzlePiece size={22} />}
      onClose={onClose}
      size="large"
    >
      <div className="plugin-list">
        {plugins.map((plugin) => {
          const canonicalId = plugin.id.startsWith("plugin-")
            ? plugin.id.slice("plugin-".length)
            : plugin.id;
          const host = legacyHostPlugins[canonicalId];
          const verified = Boolean(host?.installed && host.verified);
          const hostEnabled = verified && host?.enabled === true;
          const runtimeAttention = hostEnabled && plugin.status === "attention";
          const installBlocked = Boolean(host?.installed && !host.verified);
          return (
            <article className="plugin-row" key={plugin.id}>
              <span className="plugin-row__icon" aria-hidden="true">
                <PuzzlePiece size={21} />
              </span>
              <div className="plugin-row__body">
                <div className="plugin-row__heading">
                  <strong>{plugin.name}</strong>
                  <span>v{plugin.version}</span>
                  <SurfaceStatus
                    tone={
                      hostEnabled && !runtimeAttention
                        ? "mint"
                        : runtimeAttention
                          ? "coral"
                          : "slate"
                    }
                  >
                    {hostEnabled && !runtimeAttention
                      ? "已启用"
                      : runtimeAttention
                        ? "需要检查"
                        : "已停用"}
                  </SurfaceStatus>
                </div>
                <p>{plugin.description}</p>
                <small>
                  {host === undefined
                    ? "安装服务不可用"
                    : verified
                      ? `已校验固定提交 ${host.commit.slice(0, 12)}，宿主${
                          hostEnabled ? "已启用" : "保持停用"
                        }`
                      : host.installed
                        ? `本地目录校验失败${host.reason ? `：${host.reason}` : ""}`
                        : "尚未安装固定版本"}
                  {" · "}
                  {plugin.trust === "trusted"
                    ? "已由用户信任 · 独立兼容域"
                    : "未信任 · 默认不加载"}
                </small>
              </div>
              <button
                className={`button ${
                  verified && hostEnabled
                    ? "button--quiet"
                    : "button--secondary"
                }`}
                type="button"
                disabled={
                  !online ||
                  submittingId !== null ||
                  host === undefined ||
                  installBlocked
                }
                onClick={() => {
                  setSubmittingId(plugin.id);
                  void (
                    verified ? onToggle(plugin) : onInstall(plugin)
                  ).finally(() => setSubmittingId(null));
                }}
              >
                {verified && hostEnabled ? (
                  <X size={16} />
                ) : (
                  <Check size={16} />
                )}
                {submittingId === plugin.id
                  ? verified
                    ? "正在检查"
                    : "正在安装"
                  : installBlocked
                    ? "需要处理目录"
                    : !verified
                      ? "安装固定版本"
                      : hostEnabled
                        ? "停用"
                        : plugin.trust === "trusted"
                          ? "启用"
                          : "信任并启用"}
              </button>
            </article>
          );
        })}
      </div>
      <div className="modal-note">
        <ShieldWarning size={17} />
        <span>Provider 密钥、主应用 DOM 与数据库句柄不会暴露给旧版插件。</span>
      </div>
      <footer className="modal-actions">
        <button
          className="button button--primary"
          type="button"
          onClick={onClose}
        >
          完成
        </button>
      </footer>
    </ModalFrame>
  );
}

function ExtensionsPanel({
  plugins,
  pluginRealms,
  onOpenPlugins,
}: {
  plugins: LegacyPlugin[];
  pluginRealms: ReactNode;
  onOpenPlugins: () => void;
}) {
  return (
    <section className="extension-plugins" aria-labelledby="plugin-menu-title">
      <div className="extension-plugins__heading">
        <div>
          <PuzzlePiece size={17} />
          <strong id="plugin-menu-title">兼容插件</strong>
        </div>
        <button className="text-button" type="button" onClick={onOpenPlugins}>
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
  );
}

function ExtensionsModal({
  plugins,
  pluginRealms,
  onClose,
  onOpenPlugins,
}: {
  plugins: LegacyPlugin[];
  pluginRealms: ReactNode;
  onClose: () => void;
  onOpenPlugins: () => void;
}) {
  return (
    <ModalFrame
      title="扩展"
      description="查看兼容插件及其提供的功能菜单。"
      icon={<PuzzlePiece size={22} />}
      onClose={onClose}
      size="large"
    >
      <div className="modal-support-content modal-support-content--extensions">
        <ExtensionsPanel
          plugins={plugins}
          pluginRealms={pluginRealms}
          onOpenPlugins={onOpenPlugins}
        />
      </div>
    </ModalFrame>
  );
}

export type LegacyManagementModalProps =
  | {
      kind: "plugins";
      online: boolean;
      plugins: LegacyPlugin[];
      legacyHostPlugins: Record<string, LegacyHostPluginStatus>;
      onClose: () => void;
      onInstall: (plugin: LegacyPlugin) => Promise<void>;
      onToggle: (plugin: LegacyPlugin) => Promise<void>;
    }
  | {
      kind: "extensions";
      plugins: LegacyPlugin[];
      pluginRealms: ReactNode;
      onClose: () => void;
      onOpenPlugins: () => void;
    };

export function LegacyManagementModal(props: LegacyManagementModalProps) {
  if (props.kind === "plugins") {
    return <PluginsModal {...props} />;
  }
  return <ExtensionsModal {...props} />;
}
