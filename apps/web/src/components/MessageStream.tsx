import {
  ArrowClockwise,
  ArrowDown,
  CaretLeft,
  CaretRight,
  ChatCircleDots,
  Copy,
  FloppyDisk,
  PencilSimple,
  Trash,
  X,
} from "@phosphor-icons/react";
import Markdown from "markdown-to-jsx";
import { marked } from "marked";
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { GenerationState, WorkspaceMessage } from "../domain/workspace";
import { EmptyState, IconButton } from "./WorkspacePrimitives";

const HTML_MARKUP_PATTERN = /<(?:!doctype|!--|\/?[a-z][^>]*>)/iu;
const HTML_DOCUMENT_OR_ACTIVE_CONTENT_PATTERN =
  /<(?:!doctype|!--|\/?(?:html|head|body|base|meta|link|style|script|noscript|iframe|object|embed|canvas|svg|math|template|slot|form|input|button|select|option|textarea|label|fieldset|dialog|video|audio|source|track|picture|img|table|thead|tbody|tfoot|tr|th|td|details|summary|section|article|main|nav|header|footer|aside|address|figure|figcaption|div|span|p|br|hr|h[1-6]|ul|ol|li|blockquote|pre|code|a|strong|em|b|i|u|s|del|ins|mark|small|sub|sup|ruby|rt|rp|time|data|meter|progress)\b[^>]*>)/iu;
const CUSTOM_DOCUMENT_TAG_PATTERN =
  /<\/?[a-z][\w:.-]*(?:\s[^<>\r\n]*?)?\s*\/?>/giu;
const FENCED_HTML_PATTERN =
  /^\s*```(?:html)?[^\S\r\n]*\r?\n([\s\S]*?)\r?\n```[^\S\r\n]*$/iu;
const FENCED_HTML_BLOCK_PATTERN =
  /```(?:html)?[^\S\r\n]*\r?\n([\s\S]*?)\r?\n```/giu;
const FULL_HTML_DOCUMENT_PATTERN = /^\s*(?:<!doctype\b[^>]*>\s*)?<html\b/iu;
const HIDDEN_DOCUMENT_WRAPPER_PATTERN =
  /<\/?(?:dream|thinking|reasoning|analysis)\b[^>]*>/giu;
const MIXED_DOCUMENT_HTML_PATTERN =
  /<style\b[^>]*>[\s\S]*?<\/style>|<script\b[^>]*>[\s\S]*?<\/script>|<!--[\s\S]*?-->|<\/?[a-z][^>]*>/giu;
const FRAME_HEIGHT_MESSAGE_TYPE = "stn:message-frame-height";
const FRAME_STORAGE_MESSAGE_TYPE = "stn:message-frame-storage";
const FRAME_SEND_MESSAGE_TYPE = "stn:message-frame-send";
const FRAME_HEIGHT_MIN = 96;
const FRAME_HEIGHT_MAX = 1_000_000;
const FRAME_STORAGE_PREFIX = "sillytavern-n.message-frame-storage.v1:";
const FRAME_STORAGE_MAX_LENGTH = 512_000;
const MARKDOWN_OPTIONS = {
  disableParsingRawHTML: true,
  forceBlock: true,
  wrapper: null,
} as const;
const FRAME_RESIZE_SCRIPT = `(()=>{const meta=document.querySelector('meta[name="stn-frame-id"]');if(!meta)return;const frameId=meta.content;let queued=false;const report=()=>{queued=false;const body=document.body;if(!body)return;const height=Math.ceil(Math.max(body.scrollHeight,body.offsetHeight,body.getBoundingClientRect().height));parent.postMessage({type:"stn:message-frame-height",frameId,height},"*")};const queue=()=>{if(queued)return;queued=true;requestAnimationFrame(report)};new ResizeObserver(queue).observe(document.body);addEventListener("load",queue);queue()})();`;

function sandboxContentSecurityPolicy(): string {
  return [
    "default-src 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "script-src 'unsafe-inline' http: https:",
    "connect-src http: https:",
    "frame-src http: https:",
    "child-src http: https: blob:",
    "worker-src http: https: blob:",
    "form-action 'none'",
    "navigate-to 'none'",
    "img-src http: https: data: blob:",
    "media-src http: https: data: blob:",
    "font-src http: https: data:",
    "style-src 'unsafe-inline' http: https:",
  ].join("; ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function frameStorageKey(namespace: string): string {
  return `${FRAME_STORAGE_PREFIX}${namespace}`;
}

function loadFrameStorage(namespace: string): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(frameStorageKey(namespace));
    if (!raw || raw.length > FRAME_STORAGE_MAX_LENGTH) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([key, value]) =>
        typeof value === "string" ? [[key, value]] : [],
      ),
    );
  } catch {
    return {};
  }
}

function saveFrameStorage(
  namespace: string,
  values: Record<string, string>,
): void {
  if (typeof window === "undefined") return;
  try {
    const serialized = JSON.stringify(values);
    if (serialized.length > FRAME_STORAGE_MAX_LENGTH) return;
    window.localStorage.setItem(frameStorageKey(namespace), serialized);
  } catch {
    // Storage is optional; the frame keeps its in-memory copy for this visit.
  }
}

function escapeInlineJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function frameCompatibilityScript(
  frameId: string,
  storage: Record<string, string>,
): string {
  return `const __stnFrameId=${escapeInlineJson(frameId)};const __stnValues=new Map(Object.entries(${escapeInlineJson(storage)}));const __stnNotify=(operation,key,value)=>parent.postMessage({type:"${FRAME_STORAGE_MESSAGE_TYPE}",frameId:__stnFrameId,operation,key,value},"*");const __stnLocalStorage={get length(){return __stnValues.size},key(index){return Array.from(__stnValues.keys())[Number(index)]??null},getItem(key){key=String(key);return __stnValues.has(key)?__stnValues.get(key):null},setItem(key,value){key=String(key);value=String(value);__stnValues.set(key,value);__stnNotify("set",key,value)},removeItem(key){key=String(key);__stnValues.delete(key);__stnNotify("remove",key,null)},clear(){__stnValues.clear();__stnNotify("clear","",null)}};const __stnPrompt=(message,defaultValue="")=>typeof window.prompt==="function"?window.prompt(message,defaultValue):(navigator.userActivation?.isActive?String(defaultValue??""):null);const __stnConfirm=(message)=>typeof window.confirm==="function"?window.confirm(message):navigator.userActivation?.isActive===true;const __stnAlert=(message)=>{if(typeof window.alert==="function")window.alert(message)};let __stnPendingInput="";const __stnInputProxy={get value(){return __stnPendingInput},set value(value){__stnPendingInput=String(value)},dispatchEvent(){return true}};const __stnSendProxy={click(){const content=__stnPendingInput.trim();if(content)parent.postMessage({type:"${FRAME_SEND_MESSAGE_TYPE}",frameId:__stnFrameId,content},"*")}};const __stnParentDocument=Object.freeze({querySelector(selector){if(selector==="#send_textarea")return __stnInputProxy;if(selector==="#send_but")return __stnSendProxy;return null}});`;
}

function adaptLegacyScriptApis(content: string): string {
  return content.replace(
    /(<script\b[^>]*>)([\s\S]*?)(<\/script>)/giu,
    (_match, opening: string, code: string, closing: string) => {
      const adapted = code
        .replaceAll("window.parent.document", "__stnParentDocument")
        .replaceAll("parent.document", "__stnParentDocument")
        .replaceAll("window.localStorage", "__stnLocalStorage")
        .replace(/\blocalStorage\b/gu, "__stnLocalStorage")
        .replaceAll("window.prompt", "__stnPrompt")
        .replace(/\bprompt(?=\s*\()/gu, "__stnPrompt")
        .replaceAll("window.confirm", "__stnConfirm")
        .replace(/\bconfirm(?=\s*\()/gu, "__stnConfirm")
        .replaceAll("window.alert", "__stnAlert")
        .replace(/\balert(?=\s*\()/gu, "__stnAlert");
      return `${opening}${adapted}${closing}`;
    },
  );
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function isHtmlDisplayContent(value: string): boolean {
  const fenced = FENCED_HTML_PATTERN.exec(value)?.[1];
  if (fenced !== undefined) return HTML_MARKUP_PATTERN.test(fenced);
  return HTML_DOCUMENT_OR_ACTIVE_CONTENT_PATTERN.test(value);
}

export function htmlDisplayContent(value: string): string {
  const fenced = FENCED_HTML_PATTERN.exec(value)?.[1];
  return fenced !== undefined && HTML_MARKUP_PATTERN.test(fenced)
    ? fenced
    : value;
}

export function markdownDisplayContent(value: string): string {
  return value.replace(CUSTOM_DOCUMENT_TAG_PATTERN, "").trim();
}

export type DisplayContentSegment = {
  kind: "html" | "markdown" | "mixed";
  content: string;
};

function looseDisplayContentSegment(content: string): DisplayContentSegment {
  if (FULL_HTML_DOCUMENT_PATTERN.test(content)) {
    return { kind: "html", content };
  }
  return {
    kind: HTML_DOCUMENT_OR_ACTIVE_CONTENT_PATTERN.test(content)
      ? "mixed"
      : "markdown",
    content,
  };
}

export function mixedDisplayContent(value: string): string {
  const source = value.replace(HIDDEN_DOCUMENT_WRAPPER_PATTERN, "");
  let tokenPrefix = "STNMIXEDHTMLTOKEN";
  while (source.includes(tokenPrefix)) tokenPrefix += "_";
  const htmlTokens: string[] = [];
  const protectedSource = source.replace(
    MIXED_DOCUMENT_HTML_PATTERN,
    (html) => {
      const token = `${tokenPrefix}${String(htmlTokens.length)}END`;
      htmlTokens.push(html);
      return token;
    },
  );
  const rendered = marked.parse(protectedSource, {
    async: false,
    breaks: true,
    gfm: true,
  });
  return rendered.replace(
    new RegExp(`${tokenPrefix}(\\d+)END`, "gu"),
    (_match, index: string) => htmlTokens[Number(index)] ?? "",
  );
}

export function displayContentSegments(value: string): DisplayContentSegment[] {
  const matches = [...value.matchAll(FENCED_HTML_BLOCK_PATTERN)].filter(
    (match) => HTML_MARKUP_PATTERN.test(match[1] ?? ""),
  );
  if (matches.length === 0) {
    return [looseDisplayContentSegment(value)];
  }

  const segments: DisplayContentSegment[] = [];
  let cursor = 0;
  const appendLooseContent = (content: string) => {
    if (markdownDisplayContent(content).length === 0) return;
    segments.push(looseDisplayContentSegment(content));
  };
  for (const match of matches) {
    const index = match.index ?? cursor;
    appendLooseContent(value.slice(cursor, index));
    segments.push({ kind: "html", content: match[1] ?? "" });
    cursor = index + match[0].length;
  }
  appendLooseContent(value.slice(cursor));
  return segments;
}

export function sandboxedDisplayDocument(
  content: string,
  resizeFrameId?: string,
  frameStorage: Record<string, string> = {},
): string {
  const displayContent = adaptLegacyScriptApis(htmlDisplayContent(content));
  const withResizeReporter = resizeFrameId !== undefined;
  const resizeMetadata = withResizeReporter
    ? `<meta name="stn-frame-id" content="${escapeHtmlAttribute(resizeFrameId)}">`
    : "";
  const resizeScript = withResizeReporter
    ? `<script>${FRAME_RESIZE_SCRIPT}</script>`
    : "";
  const compatibilityScript = withResizeReporter
    ? `<script>${frameCompatibilityScript(resizeFrameId, frameStorage)}</script>`
    : "";
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="${sandboxContentSecurityPolicy()}">
    <meta name="referrer" content="no-referrer">
    ${resizeMetadata}
    <style>
      :root { color-scheme: light; }
      html, body { margin: 0; background: #fffdf8; color: #30414f; overflow: visible; }
      body { box-sizing: border-box; width: 100%; padding: 14px 16px; font: 14px/1.72 ui-serif, "Songti SC", "Noto Serif CJK SC", serif; overflow-wrap: anywhere; }
      img, video, svg, canvas { max-width: 100%; height: auto; }
      pre { white-space: pre-wrap; }
      a { color: #416f88; }
    </style>
  </head>
  <body>${compatibilityScript}${displayContent}${resizeScript}</body>
</html>`;
}

type FrameHeightMessage = {
  type: typeof FRAME_HEIGHT_MESSAGE_TYPE;
  frameId: string;
  height: number;
};

function isFrameHeightMessage(value: unknown): value is FrameHeightMessage {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.type === FRAME_HEIGHT_MESSAGE_TYPE &&
    typeof candidate.frameId === "string" &&
    typeof candidate.height === "number" &&
    Number.isFinite(candidate.height)
  );
}

type SandboxedDisplayFrameProps = {
  title: string;
  content: string;
  displayKind?: "html" | "mixed";
  appliedRegexScriptIds: string[];
  storageNamespace: string;
  onSendMessage?: ((content: string) => void) | undefined;
  onHeightChange?: (() => void) | undefined;
};

function SandboxedDisplayFrame({
  title,
  content,
  displayKind = "html",
  appliedRegexScriptIds,
  storageNamespace,
  onSendMessage,
  onHeightChange,
}: SandboxedDisplayFrameProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const frameId = useId();
  const initialStorage = useMemo(
    () => loadFrameStorage(storageNamespace),
    [storageNamespace],
  );

  const handleFrameMessage = useCallback(
    (event: MessageEvent<unknown>) => {
      const frame = frameRef.current;
      if (
        !frame ||
        event.source !== frame.contentWindow ||
        !isRecord(event.data) ||
        event.data.frameId !== frameId
      ) {
        return;
      }

      if (isFrameHeightMessage(event.data)) {
        if (event.data.height <= 0 || event.data.height > FRAME_HEIGHT_MAX) {
          return;
        }
        const nextHeight = Math.max(
          FRAME_HEIGHT_MIN,
          Math.ceil(event.data.height),
        );
        if (Math.abs(frame.offsetHeight - nextHeight) < 1) return;
        frame.style.height = `${String(nextHeight)}px`;
        onHeightChange?.();
        return;
      }

      if (event.data.type === FRAME_STORAGE_MESSAGE_TYPE) {
        const operation = event.data.operation;
        const key = event.data.key;
        const value = event.data.value;
        if (
          !["set", "remove", "clear"].includes(String(operation)) ||
          typeof key !== "string" ||
          key.length > 1_024 ||
          (operation === "set" &&
            (typeof value !== "string" ||
              value.length > FRAME_STORAGE_MAX_LENGTH))
        ) {
          return;
        }
        const current = loadFrameStorage(storageNamespace);
        if (operation === "clear") {
          saveFrameStorage(storageNamespace, {});
        } else if (operation === "remove") {
          delete current[key];
          saveFrameStorage(storageNamespace, current);
        } else if (typeof value === "string") {
          current[key] = value;
          saveFrameStorage(storageNamespace, current);
        }
        return;
      }

      if (
        event.data.type === FRAME_SEND_MESSAGE_TYPE &&
        typeof event.data.content === "string" &&
        event.data.content.trim().length > 0 &&
        event.data.content.length <= 100_000
      ) {
        onSendMessage?.(event.data.content.trim());
      }
    },
    [frameId, onHeightChange, onSendMessage, storageNamespace],
  );

  useEffect(() => {
    window.addEventListener("message", handleFrameMessage);
    return () => window.removeEventListener("message", handleFrameMessage);
  }, [handleFrameMessage]);

  return (
    <iframe
      ref={frameRef}
      className="message-item__display-frame"
      title={title}
      sandbox="allow-scripts allow-downloads allow-modals"
      scrolling="no"
      referrerPolicy="no-referrer"
      srcDoc={sandboxedDisplayDocument(content, frameId, initialStorage)}
      data-display-kind={displayKind}
      data-applied-regex={appliedRegexScriptIds.join(" ")}
      data-auto-height="true"
    />
  );
}

function MarkdownMessageContent({
  content,
  appliedRegexScriptIds,
}: {
  content: string;
  appliedRegexScriptIds: string[];
}) {
  return (
    <div
      className="message-item__content message-item__content--markdown"
      data-applied-regex={appliedRegexScriptIds.join(" ")}
    >
      <Markdown options={MARKDOWN_OPTIONS}>
        {markdownDisplayContent(content)}
      </Markdown>
    </div>
  );
}

type MessageCardProps = {
  message: WorkspaceMessage;
  isLast: boolean;
  renderRichContent?: boolean;
  collapseCodeBlocks?: "all" | "frontend" | "none";
  onCopy: (message: WorkspaceMessage) => void;
  onUpdate: (message: WorkspaceMessage, content: string) => Promise<void>;
  onDelete: (message: WorkspaceMessage) => Promise<void> | void;
  onRegenerate: (message: WorkspaceMessage) => Promise<void> | void;
  onContinue: (message: WorkspaceMessage) => Promise<void> | void;
  onSelectSwipe: (
    message: WorkspaceMessage,
    index: number,
  ) => Promise<void> | void;
  onEmbeddedSend?: ((content: string) => void) | undefined;
  onContentResize?: (() => void) | undefined;
};

export const MessageCard = memo(function MessageCard({
  message,
  isLast,
  renderRichContent = true,
  collapseCodeBlocks = "none",
  onCopy,
  onUpdate,
  onDelete,
  onRegenerate,
  onContinue,
  onSelectSwipe,
  onEmbeddedSend,
  onContentResize,
}: MessageCardProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(message.content);
  const [savingEdit, setSavingEdit] = useState(false);
  const swipes = message.swipes ?? [];
  const activeSwipeIndex = Math.min(
    message.activeSwipeIndex ?? 0,
    Math.max(0, swipes.length - 1),
  );
  const canRegenerate = message.role === "assistant";
  const actorLabel = message.role === "user" ? "你" : "模型";
  const displayContent = message.displayContent ?? message.content;
  const appliedRegexScriptIds = message.appliedRegexScriptIds ?? [];
  const displaySegments = displayContentSegments(displayContent);
  const displaysHtml = displaySegments.some(
    (segment) => segment.kind === "html" || segment.kind === "mixed",
  );

  useEffect(() => {
    if (!editing) setEditValue(message.content);
  }, [editing, message.content]);

  const saveEdit = async () => {
    const next = editValue.trim();
    if (!next || savingEdit) return;
    setSavingEdit(true);
    try {
      await onUpdate(message, next);
      setEditing(false);
    } finally {
      setSavingEdit(false);
    }
  };

  return (
    <article
      className={`message-item message-item--${message.role}`}
      data-message-id={message.id}
    >
      <header className="message-item__header">
        <span className="speaker-mark" aria-hidden="true" />
        <strong>{actorLabel}</strong>
        <span className="message-role">
          {message.role === "user" ? "用户输入" : "模型回复"}
        </span>
        <time>{message.createdLabel}</time>
      </header>

      {editing ? (
        <div className="message-editor">
          <textarea
            value={editValue}
            aria-label={`编辑${actorLabel}的消息`}
            onChange={(event) => setEditValue(event.target.value)}
            rows={Math.min(10, Math.max(3, editValue.split("\n").length + 1))}
          />
          <div className="message-editor__actions">
            <button
              className="button button--quiet"
              type="button"
              onClick={() => setEditing(false)}
            >
              <X size={17} />
              取消
            </button>
            <button
              className="button button--primary"
              type="button"
              disabled={savingEdit}
              onClick={() => void saveEdit()}
            >
              <FloppyDisk size={17} />
              {savingEdit ? "正在保存" : "保存"}
            </button>
          </div>
        </div>
      ) : !renderRichContent ? (
        <div className="message-item__content message-item__content--plain">
          {displayContent}
        </div>
      ) : displaysHtml ? (
        <div className="message-item__rich-content">
          {displaySegments.map((segment, index) =>
            segment.kind === "html" || segment.kind === "mixed" ? (
              <SandboxedDisplayFrame
                key={`html-${String(index)}`}
                title={
                  segment.kind === "mixed"
                    ? `${actorLabel}的混合 Markdown 与 HTML 内容`
                    : `${actorLabel}的正则显示内容`
                }
                content={
                  segment.kind === "mixed"
                    ? mixedDisplayContent(segment.content)
                    : segment.content
                }
                displayKind={segment.kind}
                appliedRegexScriptIds={appliedRegexScriptIds}
                storageNamespace={`conversation:${message.conversationId}`}
                onSendMessage={onEmbeddedSend}
                onHeightChange={onContentResize}
              />
            ) : (
              <div
                key={`markdown-${String(index)}`}
                data-collapse-code={collapseCodeBlocks}
              >
                <MarkdownMessageContent
                  content={segment.content}
                  appliedRegexScriptIds={appliedRegexScriptIds}
                />
              </div>
            ),
          )}
        </div>
      ) : (
        <div data-collapse-code={collapseCodeBlocks}>
          <MarkdownMessageContent
            content={displayContent}
            appliedRegexScriptIds={appliedRegexScriptIds}
          />
        </div>
      )}

      <footer className="message-item__footer">
        <div className="message-actions" aria-label="消息操作">
          <IconButton
            compact
            label="复制消息"
            icon={<Copy size={16} />}
            onClick={() => onCopy(message)}
          />
          <IconButton
            compact
            label="编辑消息"
            icon={<PencilSimple size={16} />}
            onClick={() => setEditing(true)}
          />
          {canRegenerate ? (
            <IconButton
              compact
              label="重新生成并创建 Swipe"
              icon={<ArrowClockwise size={16} />}
              onClick={() => onRegenerate(message)}
            />
          ) : null}
          {isLast ? (
            <IconButton
              compact
              label="从这里继续"
              icon={<ArrowDown size={16} />}
              onClick={() => onContinue(message)}
            />
          ) : null}
          <IconButton
            compact
            label="删除消息"
            icon={<Trash size={16} />}
            onClick={() => onDelete(message)}
          />
        </div>

        {swipes.length > 1 ? (
          <div className="swipe-control" aria-label="消息 Swipe">
            <IconButton
              compact
              label="上一个 Swipe"
              icon={<CaretLeft size={14} />}
              disabled={activeSwipeIndex === 0}
              onClick={() => onSelectSwipe(message, activeSwipeIndex - 1)}
            />
            <span>
              {activeSwipeIndex + 1} / {swipes.length}
            </span>
            <IconButton
              compact
              label="下一个 Swipe"
              icon={<CaretRight size={14} />}
              disabled={activeSwipeIndex >= swipes.length - 1}
              onClick={() => onSelectSwipe(message, activeSwipeIndex + 1)}
            />
          </div>
        ) : null}
      </footer>
    </article>
  );
});

type MessageStreamProps = {
  conversationId: string;
  messages: WorkspaceMessage[];
  generation: GenerationState;
  onCopy: (message: WorkspaceMessage) => void;
  onUpdate: (message: WorkspaceMessage, content: string) => Promise<void>;
  onDelete: (message: WorkspaceMessage) => Promise<void> | void;
  onRegenerate: (message: WorkspaceMessage) => Promise<void> | void;
  onContinue: (message: WorkspaceMessage) => Promise<void> | void;
  onSelectSwipe: (
    message: WorkspaceMessage,
    index: number,
  ) => Promise<void> | void;
  onEmbeddedSend?: ((content: string) => void) | undefined;
  helperRenderSettings?:
    | {
        enabled: boolean;
        depth: number;
        collapseCodeBlocks: "all" | "frontend" | "none";
      }
    | undefined;
};

export function MessageStream({
  conversationId,
  messages,
  generation,
  onCopy,
  onUpdate,
  onDelete,
  onRegenerate,
  onContinue,
  onSelectSwipe,
  onEmbeddedSend,
  helperRenderSettings,
}: MessageStreamProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const sticksToBottomRef = useRef(true);
  const previousConversationIdRef = useRef(conversationId);
  const showsGeneration =
    generation.status !== "idle" &&
    generation.conversationId === conversationId;

  const scrollToBottom = useCallback(() => {
    const element = viewportRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
    sticksToBottomRef.current = true;
  }, []);

  const handleScroll = useCallback(() => {
    const element = viewportRef.current;
    if (!element) return;
    const distanceFromBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight;
    sticksToBottomRef.current = distanceFromBottom <= 80;
  }, []);

  const handleMessageContentResize = useCallback(() => {
    if (sticksToBottomRef.current) scrollToBottom();
  }, [scrollToBottom]);

  useLayoutEffect(() => {
    const conversationChanged =
      previousConversationIdRef.current !== conversationId;
    previousConversationIdRef.current = conversationId;
    if (conversationChanged) sticksToBottomRef.current = true;
    if (conversationChanged || sticksToBottomRef.current) scrollToBottom();
  }, [
    conversationId,
    generation.preview,
    messages.length,
    scrollToBottom,
    showsGeneration,
  ]);

  return (
    <div
      className="message-stream"
      ref={viewportRef}
      onScroll={handleScroll}
      role="log"
      aria-label="消息流"
      aria-live="polite"
      data-layout="flow"
    >
      {messages.length === 0 && !showsGeneration ? (
        <EmptyState
          icon={<ChatCircleDots size={28} />}
          title="开始普通聊天"
          detail="输入一条消息，模型会结合当前角色卡的内容生成回复。"
        />
      ) : (
        <div className="message-window">
          {messages.map((message, index) => (
            <MessageCard
              key={message.id}
              message={message}
              isLast={index === messages.length - 1}
              renderRichContent={
                (helperRenderSettings?.enabled ?? true) &&
                (!(helperRenderSettings?.depth ?? 0) ||
                  index >= messages.length - (helperRenderSettings?.depth ?? 0))
              }
              collapseCodeBlocks={
                helperRenderSettings?.collapseCodeBlocks ?? "none"
              }
              onCopy={onCopy}
              onUpdate={onUpdate}
              onDelete={onDelete}
              onRegenerate={onRegenerate}
              onContinue={onContinue}
              onSelectSwipe={onSelectSwipe}
              onEmbeddedSend={onEmbeddedSend}
              onContentResize={handleMessageContentResize}
            />
          ))}
          {showsGeneration ? (
            <article
              className="message-item message-item--assistant message-item--streaming"
              aria-label="Provider 临时生成预览"
              aria-busy="true"
            >
              <header className="message-item__header">
                <span className="speaker-mark" aria-hidden="true" />
                <strong>模型</strong>
                <span className="message-role">
                  {generation.status === "stopping"
                    ? "正在停止"
                    : generation.mode === "regenerate"
                      ? "重新生成"
                      : "正在生成"}
                </span>
              </header>
              <div className="message-item__content generation-preview">
                {generation.preview || "正在等待第一个内容片段…"}
                <span className="generation-caret" aria-hidden="true" />
              </div>
              <footer className="generation-disclaimer">
                这是临时预览；只有服务端确认完整持久化后才会进入消息记录。
              </footer>
            </article>
          ) : null}
        </div>
      )}
    </div>
  );
}
