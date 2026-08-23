import {
  ArrowsDownUp,
  BookOpenText,
  Bug,
  CaretRight,
  Code,
  Cube,
  FloppyDisk,
  FolderOpen,
  Info,
  MusicNotes,
  PencilSimple,
  Plus,
  SlidersHorizontal,
  TerminalWindow,
  TextT,
  Toolbox,
  Trash,
  X,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";

import type {
  PreparedPromptMessage,
  PromptTemplateDirective,
} from "../api/workspaceApi";
import { TAVERN_HELPER_COMPAT_VERSION } from "../compat/legacyPluginIds";
import type {
  TavernHelperContext,
  TavernHelperScript,
  TavernHelperSettings,
  TavernHelperSource,
  TavernHelperStateNamespace,
} from "../compat/tavernHelperTypes";

export type TavernHelperTool =
  "variables" | "prompt" | "logs" | "audio" | "workbench";

type PreparedPrompt = {
  enabled: boolean;
  messages: PreparedPromptMessage[];
  directives: PromptTemplateDirective[];
  templateCount: number;
  renderedCount?: number;
  diagnostics?: Array<{
    messageIndex: number;
    message: string;
    phase?: string;
    sourceId?: string;
    sourceLabel?: string;
  }>;
};

export type VariableTarget = {
  key: string;
  label: string;
  namespace: TavernHelperStateNamespace;
  messageId?: string;
  variables: Record<string, unknown>;
};

type VariableParseResult =
  | { valid: true; value: Record<string, unknown> }
  | { valid: false; message: string };

type Props = {
  open: boolean;
  initialTool: TavernHelperTool;
  context: TavernHelperContext | null;
  status: {
    loading: boolean;
    loadedScriptIds: string[];
    errors: Array<{
      scriptName: string;
      message: string;
    }>;
  };
  onClose: () => void;
  onToggleSource: (source: TavernHelperSource) => void;
  onSaveSettings: (settings: TavernHelperSettings) => Promise<void>;
  onSaveScripts: (
    source: Pick<TavernHelperSource, "scope" | "id">,
    scripts: TavernHelperScript[],
  ) => Promise<void>;
  onSaveVariables: (
    target: VariableTarget,
    value: Record<string, unknown>,
  ) => Promise<void>;
  onLoadPrompt: () => Promise<PreparedPrompt>;
};

type Tab = "render" | "scripts" | "tools" | "optimize" | "developer";

const tabs: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
  { id: "render", label: "渲染", icon: <BookOpenText size={17} /> },
  { id: "scripts", label: "脚本", icon: <Code size={17} /> },
  { id: "tools", label: "工具", icon: <Toolbox size={17} /> },
  { id: "optimize", label: "优化", icon: <SlidersHorizontal size={17} /> },
  { id: "developer", label: "开发", icon: <Bug size={17} /> },
];

const renderToggleRows: Array<
  [
    keyof Pick<
      TavernHelperSettings["render"],
      | "ignoreHiddenMessages"
      | "allowBlobUrls"
      | "syntaxHighlighting"
      | "cleanupProtection"
      | "streaming"
    >,
    string,
    string,
  ]
> = [
  ["ignoreHiddenMessages", "忽略隐藏楼层", "不为隐藏消息创建富内容渲染器。"],
  [
    "allowBlobUrls",
    "允许 Blob URL",
    "支持脚本生成的临时图片、音频和视频资源。",
  ],
  ["syntaxHighlighting", "代码高亮", "为 Markdown 代码块启用语法着色。"],
  ["cleanupProtection", "清理保护", "避免渲染刷新误删脚本挂载的内容。"],
  ["streaming", "流式渲染", "在模型生成过程中同步刷新富内容。"],
];

const optimizeToggleRows: Array<
  [keyof TavernHelperSettings["optimize"], string, string]
> = [
  [
    "limitRenderedMessages",
    "限制已渲染消息",
    "配合渲染深度减少长对话中的实时 DOM 开销。",
  ],
  [
    "carryWorldbookOnCardUpdate",
    "角色卡更新时保留世界书",
    "更新角色卡内容时保持已经绑定的世界书。",
  ],
  [
    "exportLatestWorldbook",
    "导出角色卡时使用最新世界书",
    "避免导出卡片中嵌入过期的世界书快照。",
  ],
  [
    "recommendedWorldbookSettings",
    "世界书推荐设置",
    "为关键词召回和常驻条目采用兼容的默认参数。",
  ],
  [
    "maximizePresetContext",
    "最大化预设上下文",
    "允许预设尽可能使用 Provider 的上下文窗口。",
  ],
];

const toolOptions: Array<{
  id: "variables" | "prompt" | "logs" | "audio";
  label: string;
  icon: React.ReactNode;
}> = [
  { id: "variables", label: "变量管理器", icon: <Code size={16} /> },
  { id: "prompt", label: "提示词查看器", icon: <BookOpenText size={16} /> },
  { id: "logs", label: "运行日志", icon: <TerminalWindow size={16} /> },
  { id: "audio", label: "音频播放器", icon: <MusicNotes size={16} /> },
];

function sourceLabel(source: TavernHelperSource): string {
  if (source.scope === "global") return "全局脚本";
  if (source.scope === "card") return `角色卡 · ${source.name}`;
  return `预设 · ${source.name}`;
}

function ToggleRow({
  checked,
  title,
  detail,
  onChange,
}: {
  checked: boolean;
  title: string;
  detail: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="helper-toggle-row">
      <span>
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

function createScript(): TavernHelperScript {
  const id =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `script-${Date.now().toString(36)}`;
  return {
    id,
    name: "新脚本",
    content: "",
    info: "",
    declaredEnabled: true,
    enabled: true,
    buttonEnabled: false,
    buttons: [],
    data: {},
    sourcePath: "native:editor",
  };
}

function hasVariables(variables: Record<string, unknown>): boolean {
  return Object.keys(variables).length > 0;
}

export function createVariableTargets(
  context: TavernHelperContext,
): VariableTarget[] {
  const messageEntries = Object.entries(context.variables.messages).reverse();
  const messageTargets = messageEntries.map(
    ([messageId, variables], index) => ({
      key: `message:${messageId}`,
      label:
        index === 0
          ? `最新消息 · ${messageId.slice(-8)}`
          : `消息 ${String(messageEntries.length - index)} · ${messageId.slice(-8)}`,
      namespace: "message" as const,
      messageId,
      variables,
    }),
  );

  return [
    ...messageTargets,
    {
      key: "chat",
      label: "当前对话变量",
      namespace: "chat",
      variables: context.variables.chat,
    },
    {
      key: "character",
      label: "角色卡变量",
      namespace: "character",
      variables: context.variables.character,
    },
    {
      key: "preset",
      label: "预设变量",
      namespace: "preset",
      variables: context.variables.preset,
    },
    {
      key: "global",
      label: "全局变量",
      namespace: "global",
      variables: context.variables.global,
    },
  ];
}

function preferredVariableKey(targets: VariableTarget[]): string {
  return (
    targets.find(
      (target) =>
        target.namespace === "message" && hasVariables(target.variables),
    )?.key ??
    targets.find((target) => target.namespace === "message")?.key ??
    "chat"
  );
}

function parseVariableText(text: string): VariableParseResult {
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { valid: false, message: "变量根节点必须是 JSON 对象。" };
    }
    return { valid: true, value: value as Record<string, unknown> };
  } catch (error) {
    return {
      valid: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function variableValueLabel(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") {
    return value.toString();
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "undefined") return "undefined";
  return JSON.stringify(value) ?? "";
}

type VariableValueType =
  "string" | "number" | "boolean" | "null" | "object" | "array";

const variableValueTypes: Array<{
  value: VariableValueType;
  label: string;
}> = [
  { value: "string", label: "string" },
  { value: "number", label: "number" },
  { value: "boolean", label: "boolean" },
  { value: "null", label: "null" },
  { value: "object", label: "object" },
  { value: "array", label: "array" },
];

function variableValueType(value: unknown): VariableValueType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "string";
}

function variableEditingText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function parseVariableNodeValue(
  text: string,
  type: VariableValueType,
): unknown {
  if (type === "string") return text;
  if (type === "null") return null;
  if (type === "number") {
    const value = Number(text);
    if (!Number.isFinite(value)) throw new Error("请输入有效数字。");
    return value;
  }
  if (type === "boolean") {
    if (text === "true") return true;
    if (text === "false") return false;
    throw new Error("布尔值只能是 true 或 false。");
  }
  const value = JSON.parse(text) as unknown;
  if (type === "array" && !Array.isArray(value)) {
    throw new Error("当前类型需要 JSON 数组。");
  }
  if (
    type === "object" &&
    (!value || typeof value !== "object" || Array.isArray(value))
  ) {
    throw new Error("当前类型需要 JSON 对象。");
  }
  return value;
}

type VariablePath = Array<string | number>;

function variablePathLabel(path: VariablePath): string {
  return path
    .map((part, index) =>
      typeof part === "number"
        ? `[${String(part)}]`
        : `${index === 0 ? "" : "."}${part}`,
    )
    .join("");
}

function updateVariableAtPath(
  current: Record<string, unknown>,
  path: VariablePath,
  value: unknown,
): Record<string, unknown> {
  const update = (container: unknown, offset: number): unknown => {
    const key = path[offset];
    if (key === undefined) return value;
    if (Array.isArray(container)) {
      const nextContainer = [...(container as unknown[])];
      const index = Number(key);
      nextContainer[index] = update(nextContainer[index], offset + 1);
      return nextContainer;
    }
    const nextContainer = { ...(container as Record<string, unknown>) };
    const property = String(key);
    nextContainer[property] = update(nextContainer[property], offset + 1);
    return nextContainer;
  };

  return update(current, 0) as Record<string, unknown>;
}

function VariableTreeNode({
  name,
  value,
  depth,
  path,
  editingPath,
  editingText,
  editingType,
  editingError,
  saving,
  onEdit,
  onEditingTextChange,
  onEditingTypeChange,
  onSave,
  onCancel,
}: {
  name: string;
  value: unknown;
  depth: number;
  path: VariablePath;
  editingPath: string | null;
  editingText: string;
  editingType: VariableValueType;
  editingError: string;
  saving: boolean;
  onEdit: ((path: VariablePath, value: unknown) => void) | undefined;
  onEditingTextChange: (value: string) => void;
  onEditingTypeChange: (value: VariableValueType) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const pathLabel = variablePathLabel(path);
  const isEditing = editingPath === JSON.stringify(path);
  const isStructuredEditing =
    isEditing && (editingType === "object" || editingType === "array");
  const isStructuredValue = value !== null && typeof value === "object";
  const entries: Array<readonly [string, unknown]> = isStructuredValue
    ? Array.isArray(value)
      ? (value as unknown[]).map(
          (item, index) => [String(index), item] as const,
        )
      : Object.entries(value as Record<string, unknown>)
    : [];
  const kind = Array.isArray(value) ? "数组" : "对象";
  const editButton = onEdit ? (
    <button
      className="helper-variable-tree__edit"
      type="button"
      aria-label={`编辑变量 ${pathLabel}`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.closest("details")?.setAttribute("open", "");
        onEdit(path, value);
      }}
      title={`编辑 ${pathLabel}`}
    >
      <PencilSimple size={15} />
    </button>
  ) : null;

  const rowContent = (
    <>
      <span className="helper-variable-tree__caret" aria-hidden="true">
        {isStructuredValue ? <CaretRight size={16} weight="bold" /> : null}
      </span>
      <span
        className={`helper-variable-tree__kind-icon ${
          isStructuredValue ? "is-structured" : "is-primitive"
        }`}
        aria-hidden="true"
      >
        {isStructuredValue ? <Cube size={17} /> : <TextT size={16} />}
      </span>
      <span className="helper-variable-tree__key" title={name}>
        {name}
      </span>
      {isEditing ? (
        <div
          className="helper-variable-tree__inline-editor"
          onClick={(event) => event.stopPropagation()}
        >
          {!isStructuredEditing ? (
            <input
              aria-label={`变量 ${pathLabel} 的值`}
              value={editingText}
              disabled={saving}
              onChange={(event) => onEditingTextChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") onSave();
                if (event.key === "Escape") onCancel();
              }}
            />
          ) : null}
          <select
            aria-label={`变量 ${pathLabel} 的类型`}
            value={editingType}
            disabled={saving}
            onChange={(event) =>
              onEditingTypeChange(event.target.value as VariableValueType)
            }
          >
            {variableValueTypes.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            className="helper-variable-tree__save-node"
            type="button"
            disabled={saving}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onSave();
            }}
          >
            {saving ? "保存中" : "保存"}
          </button>
          <button
            className="helper-variable-tree__cancel-node"
            type="button"
            disabled={saving}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onCancel();
            }}
          >
            取消
          </button>
        </div>
      ) : (
        <>
          {isStructuredValue ? (
            <span className="helper-variable-tree__meta">
              {kind} · {entries.length}
            </span>
          ) : (
            <span
              className={`helper-variable-tree__value helper-variable-tree__value--${variableValueType(value)}`}
            >
              {variableValueLabel(value)}
            </span>
          )}
          {editButton}
        </>
      )}
    </>
  );

  const structuredEditor = isStructuredEditing ? (
    <div
      className="helper-variable-tree__structured-editor"
      onClick={(event) => event.stopPropagation()}
    >
      <textarea
        className="helper-code-editor"
        aria-label={`变量 ${pathLabel} 的 JSON 值`}
        rows={Math.min(10, Math.max(4, editingText.split("\n").length))}
        value={editingText}
        disabled={saving}
        spellCheck={false}
        onChange={(event) => onEditingTextChange(event.target.value)}
      />
    </div>
  ) : null;

  const error =
    isEditing && editingError ? (
      <p className="helper-variable-tree__error" role="alert">
        {editingError}
      </p>
    ) : null;

  if (isStructuredValue) {
    return (
      <details
        className="helper-variable-tree__branch"
        data-depth={depth}
        {...(depth === 0 && !Array.isArray(value) ? { open: true } : {})}
      >
        <summary
          className={`helper-variable-tree__row ${isEditing ? "is-editing" : ""}`}
        >
          {rowContent}
        </summary>
        {structuredEditor}
        {error}
        <div className="helper-variable-tree__children">
          {entries.length ? (
            entries.map(([key, child]) => (
              <VariableTreeNode
                key={key}
                name={Array.isArray(value) ? `[${key}]` : key}
                value={child}
                depth={depth + 1}
                path={[...path, Array.isArray(value) ? Number(key) : key]}
                editingPath={editingPath}
                editingText={editingText}
                editingType={editingType}
                editingError={editingError}
                saving={saving}
                onEdit={onEdit}
                onEditingTextChange={onEditingTextChange}
                onEditingTypeChange={onEditingTypeChange}
                onSave={onSave}
                onCancel={onCancel}
              />
            ))
          ) : (
            <span className="helper-variable-tree__empty">空{kind}</span>
          )}
        </div>
      </details>
    );
  }

  return (
    <div className="helper-variable-tree__node" data-depth={depth}>
      <div
        className={`helper-variable-tree__row ${isEditing ? "is-editing" : ""}`}
      >
        {rowContent}
      </div>
      {structuredEditor}
      {error}
    </div>
  );
}

export function VariableTree({
  value,
  onSave,
}: {
  value: Record<string, unknown>;
  onSave?: (value: Record<string, unknown>) => Promise<void>;
}) {
  const entries = Object.entries(value);
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState("");
  const [editingText, setEditingText] = useState("");
  const [editingType, setEditingType] = useState<VariableValueType>("string");
  const [editingError, setEditingError] = useState("");
  const [saving, setSaving] = useState(false);

  const startEditing = (path: VariablePath, current: unknown) => {
    setEditingPath(JSON.stringify(path));
    setEditingLabel(variablePathLabel(path));
    setEditingText(variableEditingText(current));
    setEditingType(variableValueType(current));
    setEditingError("");
  };

  const saveNode = async () => {
    if (!onSave || !editingPath || saving) return;
    try {
      const nextValue = parseVariableNodeValue(editingText, editingType);
      const next = updateVariableAtPath(
        value,
        JSON.parse(editingPath) as VariablePath,
        nextValue,
      );
      setSaving(true);
      await onSave(next);
      setEditingPath(null);
      setEditingError("");
    } catch (error) {
      setEditingError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="helper-variable-tree" aria-label="变量树">
        {entries.length ? (
          entries.map(([key, child]) => (
            <VariableTreeNode
              key={key}
              name={key}
              value={child}
              depth={0}
              path={[key]}
              editingPath={editingPath}
              editingText={editingText}
              editingType={editingType}
              editingError={editingError}
              saving={saving}
              onEdit={onSave ? startEditing : undefined}
              onEditingTextChange={(next) => {
                setEditingText(next);
                setEditingError("");
              }}
              onEditingTypeChange={(next) => {
                setEditingType(next);
                setEditingError("");
                if (next === "object") setEditingText("{}");
                if (next === "array") setEditingText("[]");
                if (next === "null") setEditingText("null");
                if (next === "boolean") setEditingText("false");
                if (next === "number") setEditingText("0");
              }}
              onSave={() => void saveNode()}
              onCancel={() => {
                setEditingPath(null);
                setEditingError("");
              }}
            />
          ))
        ) : (
          <p className="helper-empty">此范围暂无变量。</p>
        )}
      </div>
      {editingPath ? (
        <span className="sr-only" aria-live="polite">
          正在编辑变量 {editingLabel}
        </span>
      ) : null}
    </>
  );
}

function importedScripts(value: unknown): TavernHelperScript[] {
  const root = Array.isArray(value)
    ? value
    : value && typeof value === "object" && "scripts" in value
      ? (value as { scripts?: unknown }).scripts
      : undefined;
  if (!Array.isArray(root))
    throw new Error("文件中没有可导入的 scripts 数组。");
  return root.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const raw = item as Record<string, unknown>;
    const button =
      raw.button && typeof raw.button === "object"
        ? (raw.button as Record<string, unknown>)
        : {};
    const buttons = Array.isArray(raw.buttons)
      ? raw.buttons
      : Array.isArray(button.buttons)
        ? button.buttons
        : [];
    const normalizedButtons = buttons.flatMap((candidate, buttonIndex) => {
      if (!candidate || typeof candidate !== "object") return [];
      const rawButton = candidate as Record<string, unknown>;
      const name =
        typeof rawButton.name === "string"
          ? rawButton.name
          : `按钮 ${String(buttonIndex + 1)}`;
      return [
        {
          id:
            typeof rawButton.id === "string"
              ? rawButton.id
              : `button-${String(buttonIndex + 1)}`,
          name,
          visible: rawButton.visible !== false,
        },
      ];
    });
    return [
      {
        id:
          typeof raw.id === "string"
            ? raw.id
            : `imported-${Date.now().toString(36)}-${String(index)}`,
        name:
          typeof raw.name === "string"
            ? raw.name
            : `导入脚本 ${String(index + 1)}`,
        content: typeof raw.content === "string" ? raw.content : "",
        info: typeof raw.info === "string" ? raw.info : "",
        declaredEnabled: raw.enabled !== false,
        enabled: raw.enabled !== false,
        buttonEnabled: raw.buttonEnabled === true || button.enabled === true,
        buttons: normalizedButtons,
        data:
          raw.data && typeof raw.data === "object" && !Array.isArray(raw.data)
            ? (raw.data as Record<string, unknown>)
            : {},
        ...(typeof raw.treeId === "string" ? { treeId: raw.treeId } : {}),
        ...(typeof raw.treeName === "string" ? { treeName: raw.treeName } : {}),
        sourcePath: "native:import",
      },
    ];
  });
}

function ScriptEditor({
  script,
  onChange,
  onClose,
}: {
  script: TavernHelperScript;
  onChange: (script: TavernHelperScript) => void;
  onClose: () => void;
}) {
  return (
    <div className="helper-script-editor">
      <div className="helper-script-editor__header">
        <strong>编辑脚本</strong>
        <button type="button" aria-label="关闭脚本编辑器" onClick={onClose}>
          <X size={17} />
        </button>
      </div>
      <label>
        名称
        <input
          value={script.name}
          onChange={(event) =>
            onChange({ ...script, name: event.target.value })
          }
        />
      </label>
      <label>
        文件夹
        <input
          value={script.treeName ?? ""}
          placeholder="可选"
          onChange={(event) =>
            onChange(
              event.target.value
                ? {
                    ...script,
                    treeName: event.target.value,
                    treeId: script.treeId ?? `folder-${event.target.value}`,
                  }
                : (Object.fromEntries(
                    Object.entries(script).filter(
                      ([key]) => key !== "treeName" && key !== "treeId",
                    ),
                  ) as unknown as TavernHelperScript),
            )
          }
        />
      </label>
      <label>
        说明
        <textarea
          rows={3}
          value={script.info}
          onChange={(event) =>
            onChange({ ...script, info: event.target.value })
          }
        />
      </label>
      <label>
        JavaScript
        <textarea
          className="helper-code-editor"
          rows={14}
          value={script.content}
          spellCheck={false}
          onChange={(event) =>
            onChange({ ...script, content: event.target.value })
          }
        />
      </label>
    </div>
  );
}

export function TavernHelperWorkbench({
  open,
  initialTool,
  context,
  status,
  onClose,
  onToggleSource,
  onSaveSettings,
  onSaveScripts,
  onSaveVariables,
  onLoadPrompt,
}: Props) {
  const [tab, setTab] = useState<Tab>("render");
  const [tool, setTool] =
    useState<Exclude<TavernHelperTool, "workbench">>("variables");
  const [settings, setSettings] = useState<TavernHelperSettings | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [scriptDrafts, setScriptDrafts] = useState<
    Record<string, TavernHelperScript[]>
  >({});
  const [editingScript, setEditingScript] = useState<{
    sourceKey: string;
    scriptId: string;
  } | null>(null);
  const [savingSource, setSavingSource] = useState<string | null>(null);
  const [scriptSearch, setScriptSearch] = useState("");
  const [prompt, setPrompt] = useState<PreparedPrompt | null>(null);
  const [promptLoading, setPromptLoading] = useState(false);
  const [variableKey, setVariableKey] = useState("chat");
  const [variableText, setVariableText] = useState("{}");
  const [variableError, setVariableError] = useState("");
  const variableSelectionConversation = useRef<string | null>(null);
  const [audioUrl, setAudioUrl] = useState("");
  const [listenerResult, setListenerResult] = useState("");

  const sources = useMemo(() => {
    if (!context) return [];
    const hasGlobal = context.sources.some(
      (source) => source.scope === "global",
    );
    return hasGlobal
      ? context.sources
      : [
          {
            scope: "global" as const,
            id: "global",
            name: "全局脚本",
            revision: 0,
            trusted: false,
            bundle: {
              present: false,
              sourcePath: "native:global",
              scripts: [],
              variables: {},
              diagnostics: [],
            },
          },
          ...context.sources,
        ];
  }, [context]);

  const variableTargets = useMemo<VariableTarget[]>(() => {
    if (!context) return [];
    return createVariableTargets(context);
  }, [context]);

  const parsedVariables = useMemo(
    () => parseVariableText(variableText),
    [variableText],
  );

  useEffect(() => {
    if (!open) return;
    if (initialTool !== "workbench") {
      setTab("tools");
      setTool(initialTool);
    }
  }, [initialTool, open]);

  useEffect(() => {
    if (!context) return;
    if (context.settings) setSettings(context.settings);
    setScriptDrafts(
      Object.fromEntries(
        context.sources.map((source) => [
          `${source.scope}:${source.id}`,
          source.bundle.scripts,
        ]),
      ),
    );
  }, [context]);

  useEffect(() => {
    if (!open) {
      variableSelectionConversation.current = null;
      return;
    }
    if (
      !context ||
      variableSelectionConversation.current === context.conversation.id
    )
      return;
    variableSelectionConversation.current = context.conversation.id;
    setVariableKey(preferredVariableKey(variableTargets));
  }, [context?.conversation.id, open, variableTargets]);

  useEffect(() => {
    const selected = variableTargets.find(
      (target) => target.key === variableKey,
    );
    if (!selected) return;
    setVariableText(JSON.stringify(selected.variables, null, 2));
    setVariableError("");
  }, [variableKey, variableTargets]);

  if (!open) return null;

  const updateSettings = (next: TavernHelperSettings) => {
    setSettings(next);
  };

  const saveSettings = async () => {
    if (!settings || savingSettings) return;
    setSavingSettings(true);
    try {
      await onSaveSettings(settings);
    } finally {
      setSavingSettings(false);
    }
  };

  const scriptsFor = (source: TavernHelperSource) =>
    scriptDrafts[`${source.scope}:${source.id}`] ?? source.bundle.scripts;

  const setScriptsFor = (
    source: TavernHelperSource,
    scripts: TavernHelperScript[],
  ) =>
    setScriptDrafts((current) => ({
      ...current,
      [`${source.scope}:${source.id}`]: scripts,
    }));

  const saveScripts = async (source: TavernHelperSource) => {
    const key = `${source.scope}:${source.id}`;
    setSavingSource(key);
    try {
      await onSaveScripts(source, scriptsFor(source));
    } finally {
      setSavingSource(null);
    }
  };

  const loadPrompt = async () => {
    setPromptLoading(true);
    try {
      setPrompt(await onLoadPrompt());
    } finally {
      setPromptLoading(false);
    }
  };

  const saveVariables = async () => {
    const selected = variableTargets.find(
      (target) => target.key === variableKey,
    );
    if (!selected) return;
    try {
      if (!parsedVariables.valid) throw new Error(parsedVariables.message);
      await onSaveVariables(selected, parsedVariables.value);
      setVariableError("");
    } catch (error) {
      setVariableError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div
      className="helper-workbench-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="helper-workbench"
        role="dialog"
        aria-modal="true"
        aria-label="酒馆助手工作台"
      >
        <header className="helper-workbench__header">
          <div>
            <strong>酒馆助手</strong>
            <span>原生兼容运行时 · {TAVERN_HELPER_COMPAT_VERSION} API</span>
          </div>
          <button type="button" aria-label="关闭酒馆助手" onClick={onClose}>
            <X size={20} />
          </button>
        </header>

        <nav className="helper-workbench__tabs" aria-label="酒馆助手功能">
          {tabs.map((item) => (
            <button
              type="button"
              key={item.id}
              className={tab === item.id ? "is-active" : ""}
              aria-selected={tab === item.id}
              onClick={() => setTab(item.id)}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>

        <div className="helper-workbench__body">
          {tab === "render" && settings ? (
            <div className="helper-settings-page">
              <ToggleRow
                checked={settings.render.enabled}
                title="助手渲染"
                detail="控制消息中的 Markdown 与正则 HTML 富内容渲染。"
                onChange={(enabled) =>
                  updateSettings({
                    ...settings,
                    render: { ...settings.render, enabled },
                  })
                }
              />
              <label className="helper-field-row">
                <span>
                  <strong>渲染深度</strong>
                  <small>0 表示全部；大于 0 时仅渲染最后指定数量的消息。</small>
                </span>
                <input
                  type="number"
                  min={0}
                  value={settings.render.depth}
                  onChange={(event) =>
                    updateSettings({
                      ...settings,
                      render: {
                        ...settings.render,
                        depth: Math.max(0, Number(event.target.value) || 0),
                      },
                    })
                  }
                />
              </label>
              <label className="helper-field-row">
                <span>
                  <strong>代码块折叠</strong>
                  <small>选择长代码块在聊天正文中的默认展示方式。</small>
                </span>
                <select
                  value={settings.render.collapseCodeBlocks}
                  onChange={(event) =>
                    updateSettings({
                      ...settings,
                      render: {
                        ...settings.render,
                        collapseCodeBlocks: event.target.value as
                          "all" | "frontend" | "none",
                      },
                    })
                  }
                >
                  <option value="none">不折叠</option>
                  <option value="frontend">仅前端代码</option>
                  <option value="all">全部折叠</option>
                </select>
              </label>
              {renderToggleRows.map(([key, title, detail]) => (
                <ToggleRow
                  key={key}
                  checked={
                    settings.render[
                      key as keyof TavernHelperSettings["render"]
                    ] as boolean
                  }
                  title={title}
                  detail={detail}
                  onChange={(checked) =>
                    updateSettings({
                      ...settings,
                      render: { ...settings.render, [key]: checked },
                    })
                  }
                />
              ))}
              <button
                className="button button--primary helper-save"
                type="button"
                disabled={savingSettings}
                onClick={() => void saveSettings()}
              >
                <FloppyDisk size={17} />
                {savingSettings ? "正在保存" : "保存渲染设置"}
              </button>
            </div>
          ) : null}

          {tab === "scripts" ? (
            <div className="helper-scripts-page">
              <div className="helper-page-intro">
                <div>
                  <strong>脚本管理</strong>
                  <span>
                    全局、角色卡和预设脚本按来源独立生效；可信脚本拥有当前页面权限。
                  </span>
                </div>
                <Info size={18} />
              </div>
              <input
                className="helper-script-search"
                type="search"
                value={scriptSearch}
                placeholder="搜索脚本或文件夹"
                onChange={(event) => setScriptSearch(event.target.value)}
              />
              {sources.map((source) => {
                const key = `${source.scope}:${source.id}`;
                const scripts = scriptsFor(source);
                const visibleScripts = scripts.filter((script) =>
                  `${script.name}\n${script.info}\n${script.treeName ?? ""}`
                    .toLocaleLowerCase()
                    .includes(scriptSearch.trim().toLocaleLowerCase()),
                );
                return (
                  <section className="helper-script-source" key={key}>
                    <header>
                      <div>
                        <strong>{sourceLabel(source)}</strong>
                        <span>{scripts.length} 个脚本</span>
                      </div>
                      <label>
                        <input
                          type="checkbox"
                          role="switch"
                          checked={source.trusted}
                          onChange={() => onToggleSource(source)}
                        />
                        {source.trusted ? "已启用" : "未信任"}
                      </label>
                    </header>
                    <div className="helper-script-toolbar">
                      <button
                        type="button"
                        onClick={() =>
                          setScriptsFor(source, [...scripts, createScript()])
                        }
                      >
                        <Plus size={15} />
                        脚本
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const folder = window.prompt("文件夹名称");
                          if (!folder) return;
                          const next = createScript();
                          setScriptsFor(source, [
                            ...scripts,
                            {
                              ...next,
                              name: `${folder} 中的新脚本`,
                              treeId: `folder-${Date.now().toString(36)}`,
                              treeName: folder,
                            },
                          ]);
                        }}
                      >
                        <Plus size={15} />
                        文件夹
                      </button>
                      <label className="helper-script-import">
                        <FolderOpen size={15} />
                        导入
                        <input
                          type="file"
                          accept="application/json,.json"
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            event.currentTarget.value = "";
                            if (!file) return;
                            void file
                              .text()
                              .then((text) =>
                                setScriptsFor(source, [
                                  ...scripts,
                                  ...importedScripts(
                                    JSON.parse(text) as unknown,
                                  ),
                                ]),
                              )
                              .catch((error) =>
                                window.alert(
                                  `脚本导入失败：${
                                    error instanceof Error
                                      ? error.message
                                      : String(error)
                                  }`,
                                ),
                              );
                          }}
                        />
                      </label>
                      <button
                        type="button"
                        disabled={scripts.length === 0}
                        onClick={() => {
                          const url = URL.createObjectURL(
                            new Blob([JSON.stringify({ scripts }, null, 2)], {
                              type: "application/json",
                            }),
                          );
                          const anchor = document.createElement("a");
                          anchor.href = url;
                          anchor.download = `${source.scope}-tavern-helper-scripts.json`;
                          anchor.click();
                          URL.revokeObjectURL(url);
                        }}
                      >
                        导出
                      </button>
                    </div>
                    <div className="helper-script-list">
                      {scripts.length === 0 ? (
                        <p className="helper-empty">暂无脚本</p>
                      ) : (
                        visibleScripts.map((script) => {
                          const index = scripts.findIndex(
                            (candidate) => candidate.id === script.id,
                          );
                          return (
                            <div className="helper-script-item" key={script.id}>
                              <ArrowsDownUp size={16} aria-hidden="true" />
                              <input
                                type="checkbox"
                                role="switch"
                                aria-label={`启用 ${script.name}`}
                                checked={script.enabled}
                                onChange={(event) =>
                                  setScriptsFor(
                                    source,
                                    scripts.map((candidate) =>
                                      candidate.id === script.id
                                        ? {
                                            ...candidate,
                                            enabled: event.target.checked,
                                          }
                                        : candidate,
                                    ),
                                  )
                                }
                              />
                              <button
                                className="helper-script-item__name"
                                type="button"
                                onClick={() =>
                                  setEditingScript({
                                    sourceKey: key,
                                    scriptId: script.id,
                                  })
                                }
                              >
                                <strong>{script.name}</strong>
                                <small>
                                  {script.treeName || "未分组"}
                                  {script.buttons.length
                                    ? ` · ${String(script.buttons.length)} 个按钮`
                                    : ""}
                                </small>
                              </button>
                              <button
                                type="button"
                                aria-label={`上移 ${script.name}`}
                                disabled={index === 0}
                                onClick={() => {
                                  const next = [...scripts];
                                  [next[index - 1], next[index]] = [
                                    next[index]!,
                                    next[index - 1]!,
                                  ];
                                  setScriptsFor(source, next);
                                }}
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                aria-label={`下移 ${script.name}`}
                                disabled={index === scripts.length - 1}
                                onClick={() => {
                                  const next = [...scripts];
                                  [next[index], next[index + 1]] = [
                                    next[index + 1]!,
                                    next[index]!,
                                  ];
                                  setScriptsFor(source, next);
                                }}
                              >
                                ↓
                              </button>
                              <button
                                type="button"
                                aria-label={`删除 ${script.name}`}
                                onClick={() =>
                                  setScriptsFor(
                                    source,
                                    scripts.filter(
                                      (candidate) => candidate.id !== script.id,
                                    ),
                                  )
                                }
                              >
                                <Trash size={16} />
                              </button>
                            </div>
                          );
                        })
                      )}
                    </div>
                    {editingScript?.sourceKey === key &&
                    scripts.some(
                      (script) => script.id === editingScript.scriptId,
                    ) ? (
                      <ScriptEditor
                        script={
                          scripts.find(
                            (script) => script.id === editingScript.scriptId,
                          ) ?? scripts[0]!
                        }
                        onChange={(updated) =>
                          setScriptsFor(
                            source,
                            scripts.map((script) =>
                              script.id === updated.id ? updated : script,
                            ),
                          )
                        }
                        onClose={() => setEditingScript(null)}
                      />
                    ) : null}
                    <button
                      className="button button--primary helper-save"
                      type="button"
                      disabled={savingSource === key}
                      onClick={() => void saveScripts(source)}
                    >
                      <FloppyDisk size={16} />
                      {savingSource === key ? "正在保存" : "保存此来源"}
                    </button>
                  </section>
                );
              })}
            </div>
          ) : null}

          {tab === "tools" ? (
            <div className="helper-tools-page">
              <nav className="helper-tool-selector" aria-label="助手工具">
                {toolOptions.map(({ id, label, icon }) => (
                  <button
                    type="button"
                    key={id}
                    className={tool === id ? "is-active" : ""}
                    onClick={() => setTool(id)}
                  >
                    {icon}
                    {label}
                  </button>
                ))}
              </nav>
              {tool === "variables" ? (
                <div className="helper-tool-panel">
                  <label>
                    变量范围
                    <select
                      value={variableKey}
                      onChange={(event) => setVariableKey(event.target.value)}
                    >
                      {variableTargets.map((target) => (
                        <option value={target.key} key={target.key}>
                          {target.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {parsedVariables.valid ? (
                    <VariableTree
                      key={variableKey}
                      value={parsedVariables.value}
                      onSave={async (value) => {
                        const selected = variableTargets.find(
                          (target) => target.key === variableKey,
                        );
                        if (!selected) return;
                        await onSaveVariables(selected, value);
                        setVariableText(JSON.stringify(value, null, 2));
                        setVariableError("");
                      }}
                    />
                  ) : (
                    <p className="helper-error" role="alert">
                      JSON 解析失败：{parsedVariables.message}
                    </p>
                  )}
                  <details className="helper-variable-editor">
                    <summary>编辑原始 JSON</summary>
                    <textarea
                      className="helper-code-editor"
                      rows={14}
                      value={variableText}
                      spellCheck={false}
                      onChange={(event) => setVariableText(event.target.value)}
                    />
                  </details>
                  {variableError ? (
                    <p className="helper-error">{variableError}</p>
                  ) : null}
                  <button
                    className="button button--primary"
                    type="button"
                    onClick={() => void saveVariables()}
                  >
                    <FloppyDisk size={16} />
                    保存全部变量
                  </button>
                </div>
              ) : null}
              {tool === "prompt" ? (
                <div className="helper-tool-panel">
                  <div className="helper-tool-panel__heading">
                    <div>
                      <strong>当前请求提示词</strong>
                      <span>展示发送给模型前、已包含预设和世界书的消息。</span>
                    </div>
                    <button
                      className="button button--quiet"
                      type="button"
                      disabled={promptLoading}
                      onClick={() => void loadPrompt()}
                    >
                      {promptLoading ? "正在读取" : "刷新"}
                    </button>
                  </div>
                  {prompt ? (
                    <>
                      <p className="helper-prompt-summary">
                        {prompt.messages.length} 条消息 · {prompt.templateCount}{" "}
                        个源模板
                        {prompt.renderedCount === undefined
                          ? ""
                          : ` · 已执行 ${String(prompt.renderedCount)} 个`}
                        {" · "}
                        {prompt.enabled ? "模板已启用" : "模板未启用"}
                      </p>
                      {prompt.diagnostics?.length ? (
                        <div className="helper-prompt-diagnostics" role="alert">
                          <strong>
                            {prompt.diagnostics.length} 处模板没有进入最终请求
                          </strong>
                          <ul>
                            {prompt.diagnostics.map((diagnostic, index) => (
                              <li
                                key={`${diagnostic.sourceId ?? diagnostic.messageIndex}-${String(index)}`}
                              >
                                {diagnostic.sourceLabel
                                  ? `${diagnostic.sourceLabel}：`
                                  : ""}
                                {diagnostic.message}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      <div className="helper-prompt-list">
                        {prompt.messages.map((message, index) => (
                          <details key={`${message.role}-${String(index)}`}>
                            <summary>
                              {index + 1}. {message.role}
                            </summary>
                            <pre>{message.content}</pre>
                          </details>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="helper-empty">点击“刷新”读取当前提示词。</p>
                  )}
                </div>
              ) : null}
              {tool === "logs" ? (
                <div className="helper-tool-panel">
                  <p className="helper-prompt-summary">
                    {status.loading
                      ? "脚本正在加载"
                      : `已加载 ${String(status.loadedScriptIds.length)} 个脚本`}
                  </p>
                  {status.errors.length ? (
                    <div className="helper-log-list">
                      {status.errors.map((error, index) => (
                        <div key={`${error.scriptName}-${String(index)}`}>
                          <strong>{error.scriptName}</strong>
                          <pre>{error.message}</pre>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="helper-empty">当前没有脚本错误。</p>
                  )}
                </div>
              ) : null}
              {tool === "audio" ? (
                <div className="helper-tool-panel">
                  <label>
                    音频地址
                    <input
                      value={audioUrl}
                      placeholder="https://…"
                      onChange={(event) => setAudioUrl(event.target.value)}
                    />
                  </label>
                  {audioUrl ? (
                    <audio controls src={audioUrl}>
                      当前浏览器无法播放此音频。
                    </audio>
                  ) : (
                    <p className="helper-empty">
                      输入脚本或外部资源提供的音频地址。
                    </p>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}

          {tab === "optimize" && settings ? (
            <div className="helper-settings-page">
              {optimizeToggleRows.map(([key, title, detail]) => (
                <ToggleRow
                  key={key}
                  checked={settings.optimize[key]}
                  title={title}
                  detail={detail}
                  onChange={(checked) =>
                    updateSettings({
                      ...settings,
                      optimize: { ...settings.optimize, [key]: checked },
                    })
                  }
                />
              ))}
              <button
                className="button button--primary helper-save"
                type="button"
                disabled={savingSettings}
                onClick={() => void saveSettings()}
              >
                <FloppyDisk size={17} />
                保存优化设置
              </button>
            </div>
          ) : null}

          {tab === "developer" && settings ? (
            <div className="helper-settings-page">
              <ToggleRow
                checked={settings.developer.macrosEnabled}
                title="酒馆助手宏"
                detail="允许脚本使用助手提供的宏替换接口。"
                onChange={(macrosEnabled) =>
                  updateSettings({
                    ...settings,
                    developer: { ...settings.developer, macrosEnabled },
                  })
                }
              />
              <ToggleRow
                checked={settings.developer.errorPopups}
                title="错误通知"
                detail="脚本加载或执行失败时显示持久提示。"
                onChange={(errorPopups) =>
                  updateSettings({
                    ...settings,
                    developer: { ...settings.developer, errorPopups },
                  })
                }
              />
              <ToggleRow
                checked={settings.developer.liveListenerEnabled}
                title="实时监听"
                detail="启用开发服务器轮询配置，用于脚本联调。"
                onChange={(liveListenerEnabled) =>
                  updateSettings({
                    ...settings,
                    developer: {
                      ...settings.developer,
                      liveListenerEnabled,
                    },
                  })
                }
              />
              <label className="helper-field-stack">
                实时监听地址
                <input
                  value={settings.developer.liveListenerUrl}
                  placeholder="http://127.0.0.1:…"
                  onChange={(event) =>
                    updateSettings({
                      ...settings,
                      developer: {
                        ...settings.developer,
                        liveListenerUrl: event.target.value,
                      },
                    })
                  }
                />
              </label>
              <label className="helper-field-stack">
                轮询间隔（毫秒）
                <input
                  type="number"
                  min={250}
                  value={settings.developer.liveListenerInterval}
                  onChange={(event) =>
                    updateSettings({
                      ...settings,
                      developer: {
                        ...settings.developer,
                        liveListenerInterval: Math.max(
                          250,
                          Number(event.target.value) || 1_000,
                        ),
                      },
                    })
                  }
                />
              </label>
              <div className="helper-developer-actions">
                <button
                  className="button button--quiet"
                  type="button"
                  disabled={!settings.developer.liveListenerUrl}
                  onClick={() => {
                    setListenerResult("正在连接…");
                    void fetch(settings.developer.liveListenerUrl)
                      .then((response) =>
                        setListenerResult(
                          `连接成功 · HTTP ${String(response.status)}`,
                        ),
                      )
                      .catch((error) =>
                        setListenerResult(
                          `连接失败 · ${
                            error instanceof Error
                              ? error.message
                              : String(error)
                          }`,
                        ),
                      );
                  }}
                >
                  测试连接
                </button>
                <button
                  className="button button--primary"
                  type="button"
                  disabled={savingSettings}
                  onClick={() => void saveSettings()}
                >
                  <FloppyDisk size={16} />
                  保存开发设置
                </button>
              </div>
              {listenerResult ? <p>{listenerResult}</p> : null}
              <section className="helper-api-reference">
                <strong>原生兼容接口</strong>
                <code>
                  TavernHelper / eventOn / getVariables / setVariables
                </code>
                <code>generate / createChatMessages / getChatMessages</code>
                <code>getButtonEvent / replaceScriptButtons / toastr</code>
              </section>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
