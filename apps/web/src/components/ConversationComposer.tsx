import {
  Books,
  ChatCircleDots,
  List,
  PaperPlaneRight,
  Plus,
  ShieldCheck,
  StopCircle,
  Trash,
  Toolbox,
  WarningCircle,
} from "@phosphor-icons/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type {
  TavernHelperRuntimeButton,
  TavernHelperRuntimeStatus,
  TavernHelperSource,
} from "../compat/tavernHelperTypes";
import type { ConversationSpace } from "../domain/workspace";
import { IconButton } from "./WorkspacePrimitives";

const COMPOSER_MAX_HEIGHT = 180;

export function resizeComposerTextarea(
  textarea: HTMLTextAreaElement,
  maxHeight = COMPOSER_MAX_HEIGHT,
): void {
  textarea.style.height = "auto";
  const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
  textarea.style.height = `${String(nextHeight)}px`;
  textarea.style.overflowY =
    textarea.scrollHeight > maxHeight ? "auto" : "hidden";
}

type ConversationComposerProps = {
  draft: string;
  conversations: ConversationSpace[];
  selectedConversationId: string;
  cardName: string;
  disabled?: boolean;
  generationStatus?: "idle" | "streaming" | "stopping";
  scriptSources?: TavernHelperSource[];
  scriptButtons?: TavernHelperRuntimeButton[];
  scriptStatus?: TavernHelperRuntimeStatus;
  onDraftChange: (value: string) => void;
  onSelectConversation: (conversationId: string) => void;
  onDeleteConversation: (conversation: ConversationSpace) => void;
  onCreateConversation: () => void;
  onOpenCards: () => void;
  onOpenHelperTool: (
    tool: "variables" | "prompt" | "logs" | "audio" | "workbench",
  ) => void;
  onToggleScriptSource?: (source: TavernHelperSource) => void;
  onScriptButton?: (button: TavernHelperRuntimeButton) => void;
  onSend: () => void;
  onStop?: () => void;
};

export function ConversationComposer({
  draft,
  conversations,
  selectedConversationId,
  cardName,
  disabled = false,
  generationStatus = "idle",
  scriptSources = [],
  scriptButtons = [],
  scriptStatus,
  onDraftChange,
  onSelectConversation,
  onDeleteConversation,
  onCreateConversation,
  onOpenCards,
  onOpenHelperTool,
  onToggleScriptSource,
  onScriptButton,
  onSend,
  onStop,
}: ConversationComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const helperMenuRef = useRef<HTMLDivElement>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [helperMenuOpen, setHelperMenuOpen] = useState(false);
  const generating = generationStatus !== "idle";
  const canSend = draft.trim().length > 0 && !disabled && !generating;

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) resizeComposerTextarea(textarea);
  }, [draft]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || typeof ResizeObserver === "undefined") return;

    let previousWidth: number | undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const nextWidth = entry.contentRect.width;
      if (
        previousWidth !== undefined &&
        Math.abs(previousWidth - nextWidth) < 1
      ) {
        return;
      }
      previousWidth = nextWidth;
      resizeComposerTextarea(textarea);
    });
    observer.observe(textarea);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!historyOpen && !helperMenuOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !menuRef.current?.contains(event.target) &&
        !helperMenuRef.current?.contains(event.target)
      ) {
        setHistoryOpen(false);
        setHelperMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setHistoryOpen(false);
        setHelperMenuOpen(false);
      }
    };
    window.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [helperMenuOpen, historyOpen]);

  const chooseConversation = (conversationId: string) => {
    setHistoryOpen(false);
    onSelectConversation(conversationId);
  };

  return (
    <section className="composer" aria-label="消息编辑器">
      {scriptSources.length > 0 || scriptButtons.length > 0 ? (
        <div className="composer__script-bar" aria-label="角色卡与预设脚本">
          <div className="composer__script-sources">
            {scriptSources.map((source) => (
              <button
                className={`composer__script-source${
                  source.trusted ? " is-trusted" : ""
                }`}
                type="button"
                key={`${source.scope}:${source.id}`}
                onClick={() => onToggleScriptSource?.(source)}
                title={
                  source.trusted
                    ? `停止 ${source.name} 中的脚本`
                    : `信任并启用 ${source.name} 中的脚本`
                }
              >
                {source.trusted ? (
                  <ShieldCheck size={15} weight="fill" />
                ) : (
                  <WarningCircle size={15} />
                )}
                <span>
                  {source.scope === "card" ? "角色卡" : "预设"}脚本
                  {source.trusted ? "已启用" : "待信任"}
                </span>
              </button>
            ))}
          </div>
          {scriptButtons.length > 0 ? (
            <div className="composer__script-actions">
              {scriptButtons.map((button) => (
                <button
                  type="button"
                  key={button.id}
                  onClick={() => onScriptButton?.(button)}
                  title={`${button.scriptName} · ${button.name}`}
                >
                  {button.name}
                </button>
              ))}
            </div>
          ) : null}
          {scriptStatus?.errors.length ? (
            <span
              className="composer__script-error"
              title={scriptStatus.errors
                .map((error) => `${error.scriptName}: ${error.message}`)
                .join("\n")}
            >
              <WarningCircle size={15} />
              {scriptStatus.errors.length} 个脚本加载失败
            </span>
          ) : null}
          <details className="composer__script-settings">
            <summary>脚本设置</summary>
            <div id="extensions_settings2" />
          </details>
        </div>
      ) : null}
      <div className="composer__input-row">
        <div className="composer__left-actions">
          <div className="composer-history" ref={menuRef}>
            <IconButton
              label="聊天历史与会话操作"
              icon={<List size={20} />}
              aria-expanded={historyOpen}
              onClick={() => setHistoryOpen((current) => !current)}
            />
            {historyOpen ? (
              <div className="composer-history__menu" role="menu">
                <div className="composer-history__heading">
                  <div>
                    <strong>{cardName}</strong>
                    <span>{conversations.length} 个历史对话</span>
                  </div>
                  <button
                    className="composer-history__new"
                    type="button"
                    onClick={() => {
                      setHistoryOpen(false);
                      onCreateConversation();
                    }}
                  >
                    <Plus size={15} />
                    新建对话
                  </button>
                </div>
                <div className="composer-history__list">
                  {conversations.map((conversation) => {
                    const selected = conversation.id === selectedConversationId;
                    return (
                      <div
                        className={`composer-history__item${selected ? " is-selected" : ""}`}
                        key={conversation.id}
                      >
                        <button
                          className="composer-history__select"
                          type="button"
                          role="menuitem"
                          onClick={() => chooseConversation(conversation.id)}
                        >
                          <ChatCircleDots size={15} />
                          <span>
                            <strong>{conversation.title}</strong>
                            <small>{conversation.updatedLabel}</small>
                          </span>
                        </button>
                        <IconButton
                          className="composer-history__delete"
                          compact
                          label={`删除对话 ${conversation.title}`}
                          icon={<Trash size={15} />}
                          role="menuitem"
                          onClick={(event) => {
                            event.stopPropagation();
                            setHistoryOpen(false);
                            onDeleteConversation(conversation);
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
                <div className="composer-history__footer">
                  <button
                    type="button"
                    onClick={() => {
                      setHistoryOpen(false);
                      onOpenCards();
                    }}
                  >
                    <Books size={15} />
                    角色卡列表
                  </button>
                </div>
              </div>
            ) : null}
          </div>
          <div className="composer-helper-tools" ref={helperMenuRef}>
            <IconButton
              label="打开酒馆助手快捷工具"
              icon={<Toolbox size={19} />}
              aria-expanded={helperMenuOpen}
              onClick={() => {
                setHistoryOpen(false);
                setHelperMenuOpen((current) => !current);
              }}
            />
            {helperMenuOpen ? (
              <div className="composer-helper-tools__menu" role="menu">
                {[
                  ["variables", "变量管理器"],
                  ["prompt", "提示词查看器"],
                  ["logs", "运行日志"],
                  ["audio", "音频播放器"],
                  ["workbench", "酒馆助手工作台"],
                ].map(([tool, label]) => (
                  <button
                    type="button"
                    role="menuitem"
                    key={tool}
                    onClick={() => {
                      setHelperMenuOpen(false);
                      onOpenHelperTool(
                        tool as
                          | "variables"
                          | "prompt"
                          | "logs"
                          | "audio"
                          | "workbench",
                      );
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        <textarea
          ref={textareaRef}
          id="send_textarea"
          value={draft}
          rows={1}
          placeholder="输入消息…"
          aria-label="消息内容"
          data-autogrow="true"
          disabled={disabled || generating}
          onChange={(event) => {
            resizeComposerTextarea(event.currentTarget);
            onDraftChange(event.currentTarget.value);
          }}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              if (canSend) onSend();
            }
          }}
        />
        {generating ? (
          <button
            className="stop-button composer__primary-action"
            type="button"
            disabled={generationStatus === "stopping"}
            onClick={onStop}
          >
            <StopCircle size={19} weight="fill" />
            <span>{generationStatus === "stopping" ? "正在停止" : "停止"}</span>
          </button>
        ) : (
          <button
            id="send_but"
            className="send-button composer__primary-action"
            type="button"
            disabled={!canSend}
            onClick={onSend}
          >
            <PaperPlaneRight size={19} weight="fill" />
            <span>发送</span>
          </button>
        )}
      </div>
      <div className="composer__hint">
        {generating
          ? "完整回复持久化前只显示临时预览"
          : "Enter 发送 · Shift + Enter 换行"}
      </div>
    </section>
  );
}
