import {
  Books,
  Check,
  FileArrowUp,
  Lock,
  LockOpen,
  PlugsConnected,
  Plus,
  PuzzlePiece,
  ShieldWarning,
  Trash,
  X,
} from "@phosphor-icons/react";
import { useState, type FormEvent, type ReactNode } from "react";

import type { LegacyHostPluginStatus } from "../api/workspaceApi";
import type {
  LegacyPlugin,
  ModalState,
  ProviderConnection,
  ProviderConnectionInput,
  RoleCard,
  Worldbook,
  WorldbookEntry,
} from "../domain/workspace";
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
  size?: "medium" | "large";
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

function ImportModal({
  online,
  onClose,
  onImport,
}: {
  online: boolean;
  onClose: () => void;
  onImport: (file: File) => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!file || submitting) return;
    setSubmitting(true);
    try {
      await onImport(file);
      onClose();
    } catch {
      // The parent surface reports a durable toast and keeps this modal open.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalFrame
      title="导入便携内容"
      description="角色卡、世界书、提示词预设与聊天记录都会先经过兼容适配器；聊天记录必须导入到当前选择的角色卡。"
      icon={<FileArrowUp size={22} />}
      onClose={onClose}
    >
      <form className="modal-form" onSubmit={submit}>
        <label className="file-drop">
          <FileArrowUp size={28} aria-hidden="true" />
          <strong>{file?.name ?? "选择要导入的文件"}</strong>
          <span>支持预设/世界书/聊天 JSON、PNG 角色卡与 CharX</span>
          <input
            type="file"
            accept=".json,.png,.charx,.zip,.jsonl"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </label>
        <div className="modal-note">
          <Lock size={17} />
          <span>
            导入的世界书条目始终禁止 AI 编辑。可执行模板与脚本不会被自动信任。
          </span>
        </div>
        {!online ? (
          <p className="offline-note">
            当前为离线工作区；连接本地服务后才会写入内容库。
          </p>
        ) : null}
        <footer className="modal-actions">
          <button
            className="button button--quiet"
            type="button"
            onClick={onClose}
          >
            取消
          </button>
          <button
            className="button button--primary"
            type="submit"
            disabled={!file || submitting || !online}
          >
            <FileArrowUp size={17} />
            {submitting ? "正在导入" : "安全导入"}
          </button>
        </footer>
      </form>
    </ModalFrame>
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

function ProviderEditor({
  current,
  online,
  onSave,
}: {
  current?: ProviderConnection;
  online: boolean;
  onSave: (
    input: ProviderConnectionInput,
    current?: ProviderConnection,
  ) => Promise<ProviderConnection>;
}) {
  const [name, setName] = useState(current?.name ?? "");
  const [protocol, setProtocol] = useState<ProviderConnection["protocol"]>(
    current?.protocol ?? "openai-compatible",
  );
  const [baseUrl, setBaseUrl] = useState(current?.baseUrl ?? "");
  const [model, setModel] = useState(current?.model ?? "");
  const [apiKey, setApiKey] = useState("");
  const [removeApiKey, setRemoveApiKey] = useState(false);
  const [nativeToolCalling, setNativeToolCalling] = useState(
    current?.nativeToolCalling ?? false,
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !model.trim() || submitting || !online) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSave(
        {
          name: name.trim(),
          protocol,
          baseUrl: baseUrl.trim(),
          model: model.trim(),
          headers: current?.headers ?? {},
          nativeToolCalling,
          ...(removeApiKey ? { apiKey: "" } : apiKey ? { apiKey } : {}),
        },
        current,
      );
      setApiKey("");
      setRemoveApiKey(false);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Provider 连接保存失败。",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="provider-editor modal-form" onSubmit={submit}>
      <div className="provider-editor__grid">
        <label className="field">
          <span>连接名称</span>
          <input
            value={name}
            placeholder="例如：本地兼容服务"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="field">
          <span>协议</span>
          <select
            value={protocol}
            onChange={(event) =>
              setProtocol(event.target.value as ProviderConnection["protocol"])
            }
          >
            <option value="openai-compatible">OpenAI Compatible</option>
            <option value="text-completion">Text Completion</option>
            <option value="fake">Deterministic Fake</option>
          </select>
        </label>
        <label className="field provider-editor__wide">
          <span>Base URL</span>
          <input
            value={baseUrl}
            placeholder="http://127.0.0.1:1234/v1"
            onChange={(event) => setBaseUrl(event.target.value)}
          />
        </label>
        <label className="field">
          <span>模型</span>
          <input
            value={model}
            placeholder="model-name"
            onChange={(event) => setModel(event.target.value)}
          />
        </label>
        <label className="field">
          <span>API Key</span>
          <input
            type="password"
            autoComplete="new-password"
            value={apiKey}
            disabled={removeApiKey}
            placeholder={
              current?.hasApiKey ? "已安全保存；留空不更改" : "仅提交到本地服务"
            }
            onChange={(event) => setApiKey(event.target.value)}
          />
        </label>
      </div>
      <div className="provider-editor__options">
        <label className="check-row">
          <input
            type="checkbox"
            checked={nativeToolCalling}
            onChange={(event) => setNativeToolCalling(event.target.checked)}
          />
          <span>此连接支持原生结构化工具调用</span>
        </label>
        {current?.hasApiKey ? (
          <label className="check-row">
            <input
              type="checkbox"
              checked={removeApiKey}
              onChange={(event) => {
                setRemoveApiKey(event.target.checked);
                if (event.target.checked) setApiKey("");
              }}
            />
            <span>删除服务器中现有的 API Key</span>
          </label>
        ) : null}
      </div>
      <div className="modal-note">
        <Lock size={17} />
        <span>
          API Key
          只会随本次保存提交到本地服务；响应、浏览器状态和表单都不会回显密钥。
        </span>
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <footer className="modal-actions">
        <button
          className="button button--primary"
          type="submit"
          disabled={!online || !name.trim() || !model.trim() || submitting}
        >
          <PlugsConnected size={17} />
          {submitting ? "正在保存" : current ? "保存连接" : "创建连接"}
        </button>
      </footer>
    </form>
  );
}

function ProvidersModal({
  online,
  connections,
  selectedProviderId,
  onClose,
  onSelect,
  onSave,
}: {
  online: boolean;
  connections: ProviderConnection[];
  selectedProviderId: string;
  onClose: () => void;
  onSelect: (providerId: string) => void;
  onSave: (
    input: ProviderConnectionInput,
    current?: ProviderConnection,
  ) => Promise<ProviderConnection>;
}) {
  const [editingId, setEditingId] = useState<string>(
    connections[0]?.id ?? "new",
  );
  const current = connections.find((connection) => connection.id === editingId);

  return (
    <ModalFrame
      title="Provider 连接"
      description="选择对话生成所用的连接；凭据始终由本地服务保管。"
      icon={<PlugsConnected size={22} />}
      onClose={onClose}
      size="large"
    >
      <div className="provider-settings">
        <div className="provider-list" aria-label="Provider 连接列表">
          <button
            className={`provider-row${
              selectedProviderId === "fake" ? " is-selected" : ""
            }`}
            type="button"
            onClick={() => onSelect("fake")}
          >
            <span>
              <strong>本地确定性 Provider</strong>
              <small>无需密钥 · 支持流式与模型工具</small>
            </span>
            <SurfaceStatus
              tone={selectedProviderId === "fake" ? "mint" : "slate"}
            >
              {selectedProviderId === "fake" ? "当前" : "可用"}
            </SurfaceStatus>
          </button>
          {connections.map((connection) => (
            <button
              className={`provider-row${
                selectedProviderId === connection.id ? " is-selected" : ""
              }${editingId === connection.id ? " is-editing" : ""}`}
              type="button"
              key={connection.id}
              onClick={() => {
                onSelect(connection.id);
                setEditingId(connection.id);
              }}
            >
              <span>
                <strong>{connection.name}</strong>
                <small>
                  {connection.model} ·{" "}
                  {connection.hasApiKey ? "密钥已保存" : "无密钥"}
                </small>
              </span>
              <SurfaceStatus
                tone={selectedProviderId === connection.id ? "mint" : "slate"}
              >
                {selectedProviderId === connection.id ? "当前" : "选择"}
              </SurfaceStatus>
            </button>
          ))}
          <button
            className="button button--secondary button--full"
            type="button"
            onClick={() => setEditingId("new")}
          >
            <Plus size={17} />
            新增连接
          </button>
        </div>
        <ProviderEditor
          key={editingId}
          {...(current ? { current } : {})}
          online={online}
          onSave={onSave}
        />
      </div>
      {!online ? (
        <p className="offline-note">
          当前为离线工作区；连接本地服务后才能保存 Provider。
        </p>
      ) : null}
    </ModalFrame>
  );
}

function LibraryModal({
  cards,
  onClose,
  onSelectCard,
  onDeleteCard,
}: {
  cards: RoleCard[];
  onClose: () => void;
  onSelectCard: (cardId: string) => void;
  onDeleteCard: (card: RoleCard) => void;
}) {
  return (
    <ModalFrame
      title="角色卡库"
      description="每张角色卡都是人设、世界书和配套内容的集合；选择后直接进入最近对话。"
      icon={<Books size={22} />}
      onClose={onClose}
      size="large"
    >
      <div className="library-grid">
        {cards.map((card) => (
          <article className="library-item" key={card.id}>
            <button
              className="library-item__open"
              type="button"
              onClick={() => {
                onSelectCard(card.id);
                onClose();
              }}
            >
              <div className="library-item__heading">
                {card.imageUrl ? (
                  <img
                    className="library-item__cover"
                    src={card.imageUrl}
                    alt=""
                    loading="lazy"
                  />
                ) : (
                  <span className="library-item__icon">
                    <Books size={20} />
                  </span>
                )}
                <div>
                  <strong>{card.name}</strong>
                  <span>{card.conversationCount} 个历史对话</span>
                </div>
              </div>
              <p>{card.description}</p>
            </button>
            <IconButton
              compact
              className="library-item__delete"
              label={`删除角色卡 ${card.name}`}
              icon={<Trash size={17} />}
              onClick={() => onDeleteCard(card)}
            />
          </article>
        ))}
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

function CreateConversationModal({
  card,
  onClose,
  onCreate,
}: {
  card: RoleCard;
  onClose: () => void;
  onCreate: (input: { title: string; cardId: string }) => Promise<void>;
}) {
  const [title, setTitle] = useState(`${card.name} · 新对话`);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const nextTitle = title.trim();
    if (!nextTitle || submitting) return;
    setSubmitting(true);
    try {
      await onCreate({
        title: nextTitle,
        cardId: card.id,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalFrame
      title="新建对话"
      description={`新对话会归入“${card.name}”，并使用这张角色卡的全部内容。`}
      icon={<Plus size={22} />}
      onClose={onClose}
      size="large"
    >
      <form className="modal-form" onSubmit={submit}>
        <label className="field">
          <span>会话名称</span>
          <input
            autoFocus
            value={title}
            placeholder="例如：雾港 · 第二次调查"
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <div className="bound-card-note">
          {card.imageUrl ? (
            <img src={card.imageUrl} alt="" />
          ) : (
            <span aria-hidden="true">
              <Books size={20} />
            </span>
          )}
          <div>
            <strong>{card.name}</strong>
            <small>角色卡内容会自动随对话提供给模型</small>
          </div>
        </div>
        <footer className="modal-actions">
          <button
            className="button button--quiet"
            type="button"
            onClick={onClose}
          >
            取消
          </button>
          <button
            className="button button--primary"
            type="submit"
            disabled={!title.trim() || submitting}
          >
            <Plus size={17} />
            {submitting ? "正在创建" : "创建对话"}
          </button>
        </footer>
      </form>
    </ModalFrame>
  );
}

function PermissionModal({
  worldbook,
  entry,
  onClose,
  onConfirm,
}: {
  worldbook: Worldbook;
  entry: WorldbookEntry;
  onClose: () => void;
  onConfirm: (
    worldbook: Worldbook,
    entry: WorldbookEntry,
    editable: boolean,
  ) => Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);
  const nextEditable = !entry.agentEditable;

  const confirm = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onConfirm(worldbook, entry, nextEditable);
      onClose();
    } catch {
      // The parent surface reports the server-side failure and keeps this modal open.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalFrame
      title={nextEditable ? "允许 AI 编辑此条目？" : "禁止 AI 编辑此条目？"}
      description={`${worldbook.name} / ${entry.title} · 世界书修订 ${worldbook.revision}，条目修订 ${entry.revision}。`}
      icon={nextEditable ? <LockOpen size={22} /> : <Lock size={22} />}
      onClose={onClose}
    >
      <div className="permission-summary">
        <SurfaceStatus tone={entry.agentEditable ? "mint" : "slate"}>
          {entry.agentEditable ? "当前允许 AI 编辑" : "当前禁止 AI 编辑"}
        </SurfaceStatus>
        <p>
          {nextEditable
            ? "允许后，模型工具仍需通过世界书与条目的双修订检查，并由你确认具体提案。"
            : "禁止后，模型工具不能修改这个条目；条目现有内容不会被删除。"}
        </p>
        {worldbook.imported ? (
          <div className="modal-note">
            <ShieldWarning size={17} />
            <span>这是导入条目；文件中的 AI 编辑权限声明已被忽略。</span>
          </div>
        ) : null}
      </div>
      <footer className="modal-actions">
        <button
          className="button button--quiet"
          type="button"
          onClick={onClose}
        >
          取消
        </button>
        <button
          className={
            nextEditable ? "button button--primary" : "button button--secondary"
          }
          type="button"
          disabled={submitting}
          onClick={confirm}
        >
          {nextEditable ? <LockOpen size={17} /> : <Lock size={17} />}
          {submitting ? "正在更新" : nextEditable ? "确认允许" : "确认禁止"}
        </button>
      </footer>
    </ModalFrame>
  );
}

type WorkspaceModalsProps = {
  modal: ModalState;
  apiOnline: boolean;
  cards: RoleCard[];
  plugins: LegacyPlugin[];
  legacyHostPlugins: Record<string, LegacyHostPluginStatus>;
  worldbooks: Worldbook[];
  providerConnections: ProviderConnection[];
  selectedProviderId: string;
  onClose: () => void;
  onSelectCard: (cardId: string) => void;
  onDeleteCard: (card: RoleCard) => void;
  onCreateConversation: (input: {
    title: string;
    cardId: string;
  }) => Promise<void>;
  onImport: (file: File) => Promise<void>;
  onInstallPlugin: (plugin: LegacyPlugin) => Promise<void>;
  onTogglePlugin: (plugin: LegacyPlugin) => Promise<void>;
  onPermission: (
    worldbook: Worldbook,
    entry: WorldbookEntry,
    editable: boolean,
  ) => Promise<void>;
  onSelectProvider: (providerId: string) => void;
  onSaveProvider: (
    input: ProviderConnectionInput,
    current?: ProviderConnection,
  ) => Promise<ProviderConnection>;
};

export function WorkspaceModals({
  modal,
  apiOnline,
  cards,
  plugins,
  legacyHostPlugins,
  worldbooks,
  providerConnections,
  selectedProviderId,
  onClose,
  onSelectCard,
  onDeleteCard,
  onCreateConversation,
  onImport,
  onInstallPlugin,
  onTogglePlugin,
  onPermission,
  onSelectProvider,
  onSaveProvider,
}: WorkspaceModalsProps) {
  if (modal.kind === "closed") return null;
  if (modal.kind === "import") {
    return (
      <ImportModal online={apiOnline} onClose={onClose} onImport={onImport} />
    );
  }
  if (modal.kind === "plugins") {
    return (
      <PluginsModal
        online={apiOnline}
        plugins={plugins}
        legacyHostPlugins={legacyHostPlugins}
        onClose={onClose}
        onInstall={onInstallPlugin}
        onToggle={onTogglePlugin}
      />
    );
  }
  if (modal.kind === "providers") {
    return (
      <ProvidersModal
        online={apiOnline}
        connections={providerConnections}
        selectedProviderId={selectedProviderId}
        onClose={onClose}
        onSelect={onSelectProvider}
        onSave={onSaveProvider}
      />
    );
  }
  if (modal.kind === "library") {
    return (
      <LibraryModal
        cards={cards}
        onClose={onClose}
        onSelectCard={onSelectCard}
        onDeleteCard={onDeleteCard}
      />
    );
  }
  if (modal.kind === "create_conversation") {
    const card = cards.find((candidate) => candidate.id === modal.cardId);
    return card ? (
      <CreateConversationModal
        card={card}
        onClose={onClose}
        onCreate={onCreateConversation}
      />
    ) : null;
  }
  const worldbook = worldbooks.find((item) => item.id === modal.worldbookId);
  const entry = worldbook?.entries.find((item) => item.id === modal.entryId);
  return worldbook && entry ? (
    <PermissionModal
      worldbook={worldbook}
      entry={entry}
      onClose={onClose}
      onConfirm={onPermission}
    />
  ) : null;
}
