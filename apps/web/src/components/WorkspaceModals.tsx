import {
  BookOpenText,
  BracketsCurly,
  Books,
  CheckCircle,
  ClockCounterClockwise,
  FileArrowUp,
  Lock,
  LockOpen,
  PlugsConnected,
  Plus,
  ShieldWarning,
  Star,
  Trash,
  UserCircle,
  UserPlus,
  Wrench,
  PencilSimple,
  X,
} from "@phosphor-icons/react";
import {
  lazy,
  Suspense,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import type { LegacyHostPluginStatus, PersonaInput } from "../api/workspaceApi";
import type {
  AgentProposal,
  LegacyPlugin,
  ModalState,
  PanelId,
  Persona,
  PromptPreset,
  ProviderConnection,
  ProviderConnectionInput,
  RegexScope,
  RegexScriptDefinition,
  RoleCard,
  Worldbook,
  WorldbookEntry,
  WorldbookEntryUpdate,
} from "../domain/workspace";
import { RegexRail, WorldbookRail } from "./ContextRail";
import { IconButton, SurfaceStatus } from "./WorkspacePrimitives";

const LazyLegacyManagementModal = lazy(() =>
  import("./LegacyManagementModal").then((module) => ({
    default: module.LegacyManagementModal,
  })),
);

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
    current?.nativeToolCalling ?? protocol === "openai-responses",
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
            onChange={(event) => {
              const next = event.target.value as ProviderConnection["protocol"];
              setProtocol(next);
              if (current === undefined && next === "openai-responses") {
                setNativeToolCalling(true);
              }
            }}
          >
            <option value="openai-compatible">OpenAI Compatible</option>
            <option value="openai-responses">
              OpenAI Responses（DeepSeek / CPA）
            </option>
            <option value="text-completion">Text Completion</option>
            <option value="fake">Deterministic Fake</option>
          </select>
        </label>
        <label className="field provider-editor__wide">
          <span>Base URL</span>
          <input
            value={baseUrl}
            placeholder={
              protocol === "openai-responses"
                ? "DeepSeek: https://api.deepseek.com；CPA: http://127.0.0.1:8317/v1"
                : "http://127.0.0.1:1234/v1"
            }
            onChange={(event) => setBaseUrl(event.target.value)}
          />
          {protocol === "openai-responses" ? (
            <small className="field-hint">
              Responses 地址：DeepSeek 使用 https://api.deepseek.com，CPA 使用
              http://127.0.0.1:8317/v1。
            </small>
          ) : null}
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

function BuiltInProviderDetails() {
  return (
    <div
      className="provider-editor modal-form"
      aria-label="本地确定性 Provider 信息"
    >
      <div className="provider-editor__grid">
        <label className="field">
          <span>连接名称</span>
          <input defaultValue="本地确定性 Provider" readOnly disabled />
        </label>
        <label className="field">
          <span>协议</span>
          <select defaultValue="fake" disabled>
            <option value="fake">Deterministic Fake</option>
          </select>
        </label>
        <label className="field provider-editor__wide">
          <span>运行位置</span>
          <input defaultValue="本地服务内置" readOnly disabled />
        </label>
        <label className="field">
          <span>模型</span>
          <input defaultValue="deterministic" readOnly disabled />
        </label>
        <label className="field">
          <span>API Key</span>
          <input defaultValue="无需密钥" readOnly disabled />
        </label>
      </div>
      <div className="provider-editor__options">
        <label className="check-row">
          <input type="checkbox" defaultChecked disabled />
          <span>支持流式传输与原生结构化工具调用</span>
        </label>
      </div>
      <div className="modal-note">
        <Lock size={17} />
        <span>本地确定性 Provider 由本地服务直接提供，无需单独保存连接。</span>
      </div>
    </div>
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
  const [editingId, setEditingId] = useState<string>(() =>
    selectedProviderId === "fake" ||
    connections.some((connection) => connection.id === selectedProviderId)
      ? selectedProviderId
      : (connections[0]?.id ?? "new"),
  );
  const current = connections.find((connection) => connection.id === editingId);
  const selectProvider = (providerId: string) => {
    onSelect(providerId);
    setEditingId(providerId);
  };
  const saveProvider = async (
    input: ProviderConnectionInput,
    provider?: ProviderConnection,
  ) => {
    const saved = await onSave(input, provider);
    setEditingId(saved.id);
    return saved;
  };

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
            onClick={() => selectProvider("fake")}
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
              onClick={() => selectProvider(connection.id)}
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
        {editingId === "fake" ? (
          <BuiltInProviderDetails />
        ) : (
          <ProviderEditor
            key={editingId}
            {...(current ? { current } : {})}
            online={online}
            onSave={saveProvider}
          />
        )}
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

function PersonaEditor({
  current,
  online,
  onSave,
}: {
  current?: Persona;
  online: boolean;
  onSave: (input: PersonaInput, current?: Persona) => Promise<void>;
}) {
  const [name, setName] = useState(current?.name ?? "");
  const [title, setTitle] = useState(current?.title ?? "");
  const [description, setDescription] = useState(current?.description ?? "");
  const [isDefault, setIsDefault] = useState(current?.isDefault ?? false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSave(
        { name: name.trim(), title: title.trim(), description, isDefault },
        current,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "人设保存失败。");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="persona-editor modal-form" onSubmit={submit}>
      <div className="persona-editor__grid">
        <label className="field">
          <span>人设名称</span>
          <input
            autoFocus
            value={name}
            placeholder="例如：谨慎的旅人"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="field">
          <span>显示标题（可选）</span>
          <input
            value={title}
            placeholder="例如：调查者"
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="field persona-editor__wide">
          <span>人设描述</span>
          <textarea
            rows={7}
            value={description}
            placeholder="这段描述会作为 Persona Description 提供给模型。支持 {{user}} 等提示词宏。"
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
      </div>
      <label className="check-row">
        <input
          type="checkbox"
          checked={isDefault}
          onChange={(event) => setIsDefault(event.target.checked)}
        />
        <span>设为新对话默认人设</span>
      </label>
      <div className="modal-note">
        <UserCircle size={17} />
        <span>
          切换人设只影响当前对话随后发送给模型的身份与描述，不会改写历史消息。
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
          disabled={!online || !name.trim() || submitting}
        >
          {current ? <PencilSimple size={17} /> : <UserPlus size={17} />}
          {submitting ? "正在保存" : current ? "保存人设" : "新增人设"}
        </button>
      </footer>
    </form>
  );
}

function PersonasModal({
  personas,
  activePersonaId,
  online,
  onClose,
  onSelect,
  onSave,
  onDelete,
}: {
  personas: Persona[];
  activePersonaId: string | null;
  online: boolean;
  onClose: () => void;
  onSelect: (persona: Persona) => Promise<void>;
  onSave: (input: PersonaInput, current?: Persona) => Promise<void>;
  onDelete: (persona: Persona) => Promise<void>;
}) {
  const [editingId, setEditingId] = useState<string | null>(
    personas[0]?.id ?? null,
  );
  const current = personas.find((persona) => persona.id === editingId);

  return (
    <ModalFrame
      title="我的人设"
      description="创建多个用户身份，并在当前对话中随时切换。"
      icon={<UserCircle size={22} />}
      onClose={onClose}
      size="large"
    >
      <div className="persona-settings">
        <div className="persona-list" aria-label="用户人设列表">
          {personas.map((persona) => {
            const active = persona.id === activePersonaId;
            return (
              <div
                className={`persona-row${active ? " is-selected" : ""}${
                  editingId === persona.id ? " is-editing" : ""
                }`}
                key={persona.id}
              >
                <button
                  className="persona-row__select"
                  type="button"
                  onClick={() => void onSelect(persona)}
                >
                  <UserCircle size={19} />
                  <span>
                    <strong>{persona.name}</strong>
                    <small>
                      {persona.title || persona.description || "暂无描述"}
                    </small>
                  </span>
                  {active ? (
                    <SurfaceStatus tone="mint">当前</SurfaceStatus>
                  ) : null}
                </button>
                <div className="persona-row__actions">
                  {persona.isDefault ? (
                    <span
                      className="persona-row__default"
                      title="新对话默认人设"
                    >
                      <Star size={14} weight="fill" />
                    </span>
                  ) : null}
                  <IconButton
                    compact
                    label={`编辑人设 ${persona.name}`}
                    icon={<PencilSimple size={15} />}
                    onClick={() => setEditingId(persona.id)}
                  />
                  <IconButton
                    compact
                    className="persona-row__delete"
                    label={`删除人设 ${persona.name}`}
                    icon={<Trash size={15} />}
                    onClick={() => void onDelete(persona)}
                  />
                </div>
              </div>
            );
          })}
          {personas.length === 0 ? (
            <div className="rail-empty">
              <UserCircle size={24} />
              <strong>还没有用户人设</strong>
              <span>先创建一个人设，让模型知道你是谁。</span>
            </div>
          ) : null}
          <button
            className="button button--secondary button--full"
            type="button"
            disabled={!online}
            onClick={() => setEditingId("new")}
          >
            <UserPlus size={17} />
            新增人设
          </button>
        </div>
        <PersonaEditor
          key={editingId ?? "new"}
          {...(current ? { current } : {})}
          online={online}
          onSave={async (input, selected) => {
            await onSave(input, selected);
            if (!selected) setEditingId(null);
          }}
        />
      </div>
      {!online ? (
        <p className="offline-note">连接本地服务后才能保存用户人设。</p>
      ) : null}
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

function RegexModal({
  card,
  preset,
  regexScopes,
  expanded,
  onClose,
  onToggle,
  onSave,
}: {
  card?: RoleCard | null | undefined;
  preset?: PromptPreset | undefined;
  regexScopes: RegexScope[];
  expanded: boolean;
  onClose: () => void;
  onToggle: () => void;
  onSave: (
    scope: RegexScope,
    patch: { enabled?: boolean; scripts?: RegexScriptDefinition[] },
  ) => Promise<void>;
}) {
  return (
    <ModalFrame
      title="正则"
      description="管理当前会话使用的全局、角色卡与预设脚本。"
      icon={<BracketsCurly size={22} />}
      onClose={onClose}
      size="large"
    >
      <div className="modal-support-content">
        <RegexRail
          card={card ?? undefined}
          preset={preset}
          regexScopes={regexScopes}
          expanded={expanded}
          onToggle={onToggle}
          onSaveRegexScope={onSave}
        />
      </div>
    </ModalFrame>
  );
}

function WorldbookModal({
  worldbooks,
  expanded,
  onClose,
  onToggle,
  onPermission,
  onSave,
}: {
  worldbooks: Worldbook[];
  expanded: boolean;
  onClose: () => void;
  onToggle: () => void;
  onPermission: (worldbookId: string, entryId: string) => void;
  onSave: (
    worldbook: Worldbook,
    entry: WorldbookEntry,
    patch: WorldbookEntryUpdate,
  ) => Promise<void>;
}) {
  return (
    <ModalFrame
      title="世界书"
      description="管理当前会话绑定的世界书与条目。"
      icon={<BookOpenText size={22} />}
      onClose={onClose}
      size="wide"
    >
      <div className="modal-support-content">
        <WorldbookRail
          worldbooks={worldbooks}
          expanded={expanded}
          onToggle={onToggle}
          onPermission={onPermission}
          onSaveWorldbookEntry={onSave}
        />
      </div>
    </ModalFrame>
  );
}

function AgentProposalModal({
  proposal,
  onClose,
  onConfirm,
  onReject,
  onUndo,
}: {
  proposal: AgentProposal;
  onClose: () => void;
  onConfirm: () => void;
  onReject: () => void;
  onUndo: () => void;
}) {
  const proposalStatus =
    proposal.status === "blocked"
      ? "权限已阻止"
      : proposal.status === "awaiting_confirmation"
        ? "等待确认"
        : proposal.status === "applied"
          ? "已应用"
          : "已撤销";
  const artifactLabel =
    proposal.artifactKind === "chat_summary" ? "聊天摘要" : "参与者档案";
  const revisionSummary =
    proposal.afterRevision === null
      ? `修订 ${proposal.beforeRevision}`
      : `修订 ${proposal.beforeRevision} → ${proposal.afterRevision}`;
  const targetSummary =
    proposal.targetKind === "worldbook"
      ? `世界书：${proposal.worldbookName ?? proposal.worldbookId ?? "未知"} · ${revisionSummary}`
      : `${artifactLabel}：${proposal.targetLabel ?? "当前对话"} · ${revisionSummary}`;

  return (
    <ModalFrame
      title="模型工具提案"
      description="模型请求修改世界书、聊天摘要或参与者档案时，需要在此处单独确认。"
      icon={<Wrench size={22} />}
      onClose={onClose}
      size="large"
    >
      <div className="modal-support-content">
        <article className={`tool-proposal tool-proposal--${proposal.status}`}>
          <div className="tool-proposal__header">
            <strong>{proposal.title}</strong>
            <SurfaceStatus
              tone={
                proposal.status === "applied"
                  ? "mint"
                  : proposal.status === "awaiting_confirmation"
                    ? "coral"
                    : "slate"
              }
            >
              {proposal.status === "applied" ? (
                <CheckCircle size={13} />
              ) : (
                <Wrench size={13} />
              )}
              {proposalStatus}
            </SurfaceStatus>
          </div>
          <p>{proposal.rationale}</p>
          <pre>{proposal.diffLines.join("\n")}</pre>
          {proposal.status === "awaiting_confirmation" ? (
            <div className="tool-proposal__actions">
              <button
                className="button button--quiet"
                type="button"
                onClick={onReject}
              >
                <X size={16} />
                拒绝提案
              </button>
              <button
                className="button button--primary"
                type="button"
                onClick={onConfirm}
              >
                <CheckCircle size={17} />
                确认并应用
              </button>
            </div>
          ) : null}
          {proposal.status === "blocked" ? (
            <button
              className="button button--quiet button--full"
              type="button"
              onClick={onReject}
            >
              <X size={16} />
              拒绝被阻止的提案
            </button>
          ) : null}
          {proposal.status === "applied" ? (
            <button
              className="button button--quiet button--full"
              type="button"
              onClick={onUndo}
            >
              <ClockCounterClockwise size={17} />
              撤销这次写入
            </button>
          ) : null}
          <small>
            目标：{targetSummary}
            {proposal.targetEntryId ? (
              <>
                {" "}
                · 条目 {proposal.targetEntryTitle ?? "未命名条目"}（
                {proposal.targetEntryId}）· 条目修订{" "}
                {proposal.beforeEntryRevision ?? "未知"}
              </>
            ) : null}
          </small>
        </article>
      </div>
    </ModalFrame>
  );
}

type WorkspaceModalsProps = {
  modal: ModalState;
  apiOnline: boolean;
  cards: RoleCard[];
  selectedCard?: RoleCard | null | undefined;
  preset?: PromptPreset | undefined;
  regexScopes?: RegexScope[];
  expandedPanels?: Record<PanelId, boolean>;
  personas?: Persona[];
  activePersonaId?: string | null;
  plugins: LegacyPlugin[];
  pluginRealms?: ReactNode;
  legacyHostPlugins: Record<string, LegacyHostPluginStatus>;
  worldbooks: Worldbook[];
  activeWorldbooks?: Worldbook[];
  agentProposal?: AgentProposal | null;
  providerConnections: ProviderConnection[];
  selectedProviderId: string;
  onClose: () => void;
  onSelectCard: (cardId: string) => void;
  onDeleteCard: (card: RoleCard) => void;
  onSelectPersona?: (persona: Persona) => Promise<void>;
  onSavePersona?: (input: PersonaInput, current?: Persona) => Promise<void>;
  onDeletePersona?: (persona: Persona) => Promise<void>;
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
  onRequestWorldbookPermission?: (worldbookId: string, entryId: string) => void;
  onTogglePanel?: (panel: PanelId) => void;
  onSaveRegexScope?: (
    scope: RegexScope,
    patch: { enabled?: boolean; scripts?: RegexScriptDefinition[] },
  ) => Promise<void>;
  onSaveWorldbookEntry?: (
    worldbook: Worldbook,
    entry: WorldbookEntry,
    patch: WorldbookEntryUpdate,
  ) => Promise<void>;
  onOpenPlugins?: () => void;
  onConfirmToolProposal?: () => void;
  onRejectToolProposal?: () => void;
  onUndoToolProposal?: () => void;
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
  selectedCard = null,
  preset,
  regexScopes = [],
  expandedPanels = { preset: false, regex: true, worldbooks: true },
  personas = [],
  activePersonaId = null,
  plugins,
  pluginRealms = null,
  legacyHostPlugins,
  worldbooks,
  activeWorldbooks = [],
  agentProposal = null,
  providerConnections,
  selectedProviderId,
  onClose,
  onSelectCard,
  onDeleteCard,
  onSelectPersona,
  onSavePersona,
  onDeletePersona,
  onCreateConversation,
  onImport,
  onInstallPlugin,
  onTogglePlugin,
  onPermission,
  onRequestWorldbookPermission = () => undefined,
  onTogglePanel = () => undefined,
  onSaveRegexScope = async () => undefined,
  onSaveWorldbookEntry = async () => undefined,
  onOpenPlugins = () => undefined,
  onConfirmToolProposal = () => undefined,
  onRejectToolProposal = () => undefined,
  onUndoToolProposal = () => undefined,
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
      <Suspense fallback={<div className="modal-backdrop" role="status" />}>
        <LazyLegacyManagementModal
          kind="plugins"
          online={apiOnline}
          plugins={plugins}
          legacyHostPlugins={legacyHostPlugins}
          onClose={onClose}
          onInstall={onInstallPlugin}
          onToggle={onTogglePlugin}
        />
      </Suspense>
    );
  }
  if (modal.kind === "extensions") {
    return (
      <Suspense fallback={<div className="modal-backdrop" role="status" />}>
        <LazyLegacyManagementModal
          kind="extensions"
          plugins={plugins}
          pluginRealms={pluginRealms}
          onClose={onClose}
          onOpenPlugins={onOpenPlugins}
        />
      </Suspense>
    );
  }
  if (modal.kind === "regex") {
    return (
      <RegexModal
        card={selectedCard}
        preset={preset}
        regexScopes={regexScopes}
        expanded={expandedPanels.regex}
        onClose={onClose}
        onToggle={() => onTogglePanel("regex")}
        onSave={onSaveRegexScope}
      />
    );
  }
  if (modal.kind === "worldbooks") {
    return (
      <WorldbookModal
        worldbooks={activeWorldbooks}
        expanded={expandedPanels.worldbooks}
        onClose={onClose}
        onToggle={() => onTogglePanel("worldbooks")}
        onPermission={onRequestWorldbookPermission}
        onSave={onSaveWorldbookEntry}
      />
    );
  }
  if (modal.kind === "agent_proposal") {
    return agentProposal ? (
      <AgentProposalModal
        proposal={agentProposal}
        onClose={onClose}
        onConfirm={onConfirmToolProposal}
        onReject={onRejectToolProposal}
        onUndo={onUndoToolProposal}
      />
    ) : null;
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
  if (
    modal.kind === "personas" &&
    onSelectPersona &&
    onSavePersona &&
    onDeletePersona
  ) {
    return (
      <PersonasModal
        personas={personas}
        activePersonaId={activePersonaId}
        online={apiOnline}
        onClose={onClose}
        onSelect={onSelectPersona}
        onSave={onSavePersona}
        onDelete={onDeletePersona}
      />
    );
  }
  if (modal.kind === "personas") return null;
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
