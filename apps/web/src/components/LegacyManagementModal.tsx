import { Check, PuzzlePiece, ShieldWarning, X } from "@phosphor-icons/react";
import { useState, type ReactNode } from "react";

import type { LegacyHostPluginStatus } from "../api/workspaceApi";
import type { CompatibilityPlugin } from "../domain/workspace";
import { WorkspaceModalFrame } from "./WorkspaceModalFrame";
import { SurfaceStatus } from "./WorkspacePrimitives";

function PluginsModal({
  online,
  plugins,
  legacyHostPlugins,
  onClose,
  onInstall,
  onToggle,
}: {
  online: boolean;
  plugins: CompatibilityPlugin[];
  legacyHostPlugins: Record<string, LegacyHostPluginStatus>;
  onClose: () => void;
  onInstall: (plugin: CompatibilityPlugin) => Promise<void>;
  onToggle: (plugin: CompatibilityPlugin) => Promise<void>;
}) {
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  return (
    <WorkspaceModalFrame
      title="兼容插件"
      description="原生替代插件由内置兼容层执行；其他旧版扩展才会进入独立兼容域。"
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
          const nativeReplacement = plugin.executionOwner === "native";
          const verified = Boolean(host?.installed && host.verified);
          const hostEnabled =
            !nativeReplacement && verified && host?.enabled === true;
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
                      nativeReplacement || (hostEnabled && !runtimeAttention)
                        ? "mint"
                        : runtimeAttention
                          ? "coral"
                          : "slate"
                    }
                  >
                    {nativeReplacement
                      ? "原生接管"
                      : hostEnabled && !runtimeAttention
                        ? "已启用"
                        : runtimeAttention
                          ? "需要检查"
                          : "已停用"}
                  </SurfaceStatus>
                </div>
                <p>{plugin.description}</p>
                <small>
                  {nativeReplacement ? (
                    host === undefined ? (
                      "能力由内置兼容层提供 · 固定版本校验服务不可用"
                    ) : verified ? (
                      `能力由内置兼容层提供 · 已校验固定提交 ${host.commit.slice(0, 12)} · 不加载上游代码`
                    ) : host.installed ? (
                      `能力由内置兼容层提供 · 本地固定版本校验失败${host.reason ? `：${host.reason}` : ""} · 不加载上游代码`
                    ) : (
                      "能力由内置兼容层提供 · 上游固定版本尚未校验 · 不加载上游代码"
                    )
                  ) : (
                    <>
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
                    </>
                  )}
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
                  installBlocked ||
                  (nativeReplacement && verified)
                }
                onClick={() => {
                  setSubmittingId(plugin.id);
                  void (
                    verified && !nativeReplacement
                      ? onToggle(plugin)
                      : onInstall(plugin)
                  ).finally(() => setSubmittingId(null));
                }}
              >
                {verified && hostEnabled ? (
                  <X size={16} />
                ) : (
                  <Check size={16} />
                )}
                {nativeReplacement && verified
                  ? "固定版本已校验"
                  : submittingId === plugin.id
                    ? verified
                      ? "正在检查"
                      : "正在安装"
                    : installBlocked
                      ? "需要处理目录"
                      : !verified
                        ? nativeReplacement
                          ? "校验固定版本"
                          : "安装固定版本"
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
        <span>
          原生替代插件不会加载上游 bundle；独立兼容域也不会取得 Provider
          密钥或数据库句柄。
        </span>
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
    </WorkspaceModalFrame>
  );
}

function ExtensionsPanel({
  plugins,
  pluginRealms,
  onOpenPlugins,
}: {
  plugins: CompatibilityPlugin[];
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
          const nativeReplacement = plugin.executionOwner === "native";
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
                <p>{plugin.description}</p>
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
  plugins: CompatibilityPlugin[];
  pluginRealms: ReactNode;
  onClose: () => void;
  onOpenPlugins: () => void;
}) {
  return (
    <WorkspaceModalFrame
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
    </WorkspaceModalFrame>
  );
}

export type LegacyManagementModalProps =
  | {
      kind: "plugins";
      online: boolean;
      plugins: CompatibilityPlugin[];
      legacyHostPlugins: Record<string, LegacyHostPluginStatus>;
      onClose: () => void;
      onInstall: (plugin: CompatibilityPlugin) => Promise<void>;
      onToggle: (plugin: CompatibilityPlugin) => Promise<void>;
    }
  | {
      kind: "extensions";
      plugins: CompatibilityPlugin[];
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
