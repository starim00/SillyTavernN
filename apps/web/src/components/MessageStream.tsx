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
import { parseDocument } from "htmlparser2";
import Markdown, { RuleType, type MarkdownToJSX } from "markdown-to-jsx";
import { marked } from "marked";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { GenerationState, WorkspaceMessage } from "../domain/workspace";
import { EmptyState, IconButton } from "./WorkspacePrimitives";

const HTML_MARKUP_PATTERN = /<(?:!doctype|!--|\/?[a-z][^>]*>)/iu;
const CUSTOM_DOCUMENT_TAG_PATTERN =
  /<\/?[a-z][\w:.-]*(?:\s[^<>\r\n]*?)?\s*\/?>/giu;
const FENCED_HTML_PATTERN =
  /^\s*```(?:html)?[^\S\r\n]*\r?\n([\s\S]*?)\r?\n```[^\S\r\n]*$/iu;
const FENCED_HTML_BLOCK_PATTERN =
  /```(?:html)?[^\S\r\n]*\r?\n([\s\S]*?)\r?\n```/giu;
const FULL_HTML_DOCUMENT_PATTERN = /^\s*(?:<!doctype\b[^>]*>\s*)?<html\b/iu;
const HIDDEN_DOCUMENT_WRAPPER_PATTERN =
  /<\/?(?:dream|thinking|reasoning|analysis|tableedit)\b[^>]*>/giu;
const FRAME_HEIGHT_MIN = 20;
const FRAME_HEIGHT_MAX = 1_000_000;
const DIALOGUE_PATTERN =
  /“[^”\r\n]*”|「[^」\r\n]*」|『[^』\r\n]*』|〝[^〞\r\n]*〞|(?<![\p{L}\p{N}_])"[^"\r\n]{1,160}"(?![\p{L}\p{N}_])/gu;
const MARKDOWN_OPTIONS = {
  disableParsingRawHTML: true,
  forceBlock: true,
  renderRule(next: () => ReactNode, node: MarkdownToJSX.ASTNode): ReactNode {
    if (node.type === RuleType.text) {
      return highlightDialogueText(node.text);
    }
    return next();
  },
  wrapper: null,
} as const;

export function highlightDialogueText(text: string): ReactNode {
  const matches = [...text.matchAll(DIALOGUE_PATTERN)];
  if (matches.length === 0) return text;

  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const [index, match] of matches.entries()) {
    const dialogue = match[0];
    const start = match.index;
    if (!dialogue || start === undefined) continue;
    if (start > cursor) parts.push(text.slice(cursor, start));
    parts.push(
      <span
        className="message-item__dialogue"
        key={`dialogue-${String(start)}-${String(index)}`}
      >
        {dialogue}
      </span>,
    );
    cursor = start + dialogue.length;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

function escapeInlineJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function frameDialogueDecorationScript(): string {
  return `<style>body>p,body>p *,body>li,body>li *,body>blockquote,body>blockquote *,body>h1,body>h1 *,body>h2,body>h2 *,body>h3,body>h3 *,body>h4,body>h4 *,body>h5,body>h5 *,body>h6,body>h6 *{color:#202124!important}.stn-message-dialogue{color:#8b1e1e!important;font-weight:650}</style><script>(()=>{const pattern=new RegExp(${escapeInlineJson(DIALOGUE_PATTERN.source)},"gu");const skipped=new Set(["SCRIPT","STYLE","PRE","CODE","TEXTAREA","NOSCRIPT"]);const root=document.body;if(!root)return;const decorate=()=>{const walker=document.createTreeWalker(root,4);const nodes=[];let node=walker.nextNode();while(node){const parent=node.parentElement;if(parent&&!parent.closest(".stn-message-dialogue")&&!skipped.has(parent.tagName)){pattern.lastIndex=0;if(pattern.test(node.nodeValue??""))nodes.push(node)}node=walker.nextNode()}for(const textNode of nodes){const value=textNode.nodeValue??"";pattern.lastIndex=0;const matches=[...value.matchAll(pattern)];if(!matches.length)continue;const fragment=document.createDocumentFragment();let cursor=0;for(const match of matches){const dialogue=match[0],start=match.index;if(!dialogue||start===undefined)continue;if(start>cursor)fragment.append(document.createTextNode(value.slice(cursor,start)));const span=document.createElement("span");span.className="stn-message-dialogue";span.textContent=dialogue;fragment.append(span);cursor=start+dialogue.length}if(cursor<value.length)fragment.append(document.createTextNode(value.slice(cursor)));textNode.replaceWith(fragment)}};decorate();new MutationObserver(decorate).observe(root,{subtree:true,childList:true})})()</script>`;
}

function trustedHostBridgeScript(frameName: string): string {
  return `(()=>{const host=window.parent;const frameName=${escapeInlineJson(frameName)};window.__TH_IFRAME_ID=frameName;if(!window.name)window.name=frameName;const expose=name=>{try{Object.defineProperty(window,name,{configurable:true,enumerable:true,get:()=>host[name],set:value=>{host[name]=value}})}catch{}};["_","$","jQuery","Vue","YAML","showdown","toastr","z","EjsTemplate","Mvu"].forEach(expose);const helper=host.TavernHelper;if(helper){Object.defineProperty(window,"TavernHelper",{configurable:true,enumerable:true,get:()=>host.TavernHelper});for(const name of Object.keys(helper)){if(name==="_bind")continue;try{Object.defineProperty(window,name,{configurable:true,enumerable:true,get:()=>host.TavernHelper?.[name]})}catch{}}for(const [name,value] of Object.entries(helper._bind??{})){const publicName=name.startsWith("_")?name.slice(1):name;try{Object.defineProperty(window,publicName,{configurable:true,enumerable:true,writable:true,value:typeof value==="function"?value.bind(window):value})}catch{}}}const directParentDom=host.document===window.frameElement?.ownerDocument;document.documentElement.dataset.stnHostBridge=helper?"ready":"missing";document.documentElement.dataset.stnParentDom=directParentDom?"direct":"blocked";document.documentElement.dataset.stnOrigin=directParentDom?"same-origin-access":"isolated";Object.defineProperty(window,"SillyTavern",{configurable:true,enumerable:true,get:()=>{const api=host.SillyTavern;const getContext=()=>api?.getContext?.()??api??{};return {...getContext(),getContext}}});void host.TavernHelper?.eventEmit?.("message_iframe_render_started",frameName);addEventListener("pagehide",()=>{void host.TavernHelper?.eventEmit?.("message_iframe_render_ended",frameName)},{once:true})})();`;
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function isHtmlDisplayContent(value: string): boolean {
  const source = value.replace(HIDDEN_DOCUMENT_WRAPPER_PATTERN, "");
  const fenced = FENCED_HTML_PATTERN.exec(source)?.[1];
  if (fenced !== undefined) return HTML_MARKUP_PATTERN.test(fenced);
  return HTML_MARKUP_PATTERN.test(source);
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
  const visibleContent = content.replace(HIDDEN_DOCUMENT_WRAPPER_PATTERN, "");
  if (FULL_HTML_DOCUMENT_PATTERN.test(visibleContent)) {
    return { kind: "html", content: visibleContent };
  }
  const containsFencedHtml = [
    ...visibleContent.matchAll(FENCED_HTML_BLOCK_PATTERN),
  ].some((match) => HTML_MARKUP_PATTERN.test(match[1] ?? ""));
  return {
    kind:
      HTML_MARKUP_PATTERN.test(visibleContent) || containsFencedHtml
        ? "mixed"
        : "markdown",
    content,
  };
}

function startsAtLineBoundary(source: string, index: number): boolean {
  const lineStart = source.lastIndexOf("\n", Math.max(0, index - 1)) + 1;
  return source.slice(lineStart, index).trim().length === 0;
}

function protectCompleteHtmlBlocks(source: string): {
  blocks: string[];
  content: string;
  tokenPrefix: string;
} {
  let tokenPrefix = "STNHTMLBLOCK";
  while (source.includes(tokenPrefix)) tokenPrefix += "_";

  const document = parseDocument(source, {
    recognizeSelfClosing: true,
    withEndIndices: true,
    withStartIndices: true,
  });
  const ranges = document.children.flatMap((node) => {
    const start = node.startIndex;
    const end = node.endIndex;
    if (
      String(node.type) === "text" ||
      typeof start !== "number" ||
      typeof end !== "number" ||
      !startsAtLineBoundary(source, start)
    ) {
      return [];
    }
    return [{ end: end + 1, start }];
  });

  const blocks: string[] = [];
  let content = "";
  let cursor = 0;
  for (const range of ranges) {
    content += source.slice(cursor, range.start);
    const index = blocks.length;
    blocks.push(source.slice(range.start, range.end));
    content += `<!--${tokenPrefix}${String(index)}END-->`;
    cursor = range.end;
  }
  content += source.slice(cursor);
  return { blocks, content, tokenPrefix };
}

export function mixedDisplayContent(value: string): string {
  const source = value
    .replace(HIDDEN_DOCUMENT_WRAPPER_PATTERN, "")
    .replace(FENCED_HTML_BLOCK_PATTERN, (fence, content: string) =>
      HTML_MARKUP_PATTERN.test(content) ? content : fence,
    );
  const protectedHtml = protectCompleteHtmlBlocks(source);
  const rendered = marked.parse(protectedHtml.content, {
    async: false,
    breaks: true,
    gfm: true,
  });
  return rendered.replace(
    new RegExp(`<!--${protectedHtml.tokenPrefix}(\\d+)END-->`, "gu"),
    (_match, index: string) => protectedHtml.blocks[Number(index)] ?? "",
  );
}

export function displayContentSegments(value: string): DisplayContentSegment[] {
  const segments: DisplayContentSegment[] = [];
  let cursor = 0;
  for (const match of value.matchAll(FENCED_HTML_BLOCK_PATTERN)) {
    const content = match[1] ?? "";
    const start = match.index;
    if (
      start === undefined ||
      !FULL_HTML_DOCUMENT_PATTERN.test(content.replace(/^\s+/u, ""))
    ) {
      continue;
    }

    const before = value.slice(cursor, start);
    if (before.trim()) segments.push(looseDisplayContentSegment(before));
    segments.push({ kind: "html", content });
    cursor = start + match[0].length;
  }

  if (segments.length === 0) return [looseDisplayContentSegment(value)];

  const after = value.slice(cursor);
  if (after.trim()) segments.push(looseDisplayContentSegment(after));
  return segments;
}

export function trustedDisplayDocument(
  content: string,
  frameName = "TH-message--0--0",
  hostRuntimeReady = true,
): string {
  const displayContent = hostRuntimeReady
    ? htmlDisplayContent(content)
    : '<p class="stn-trusted-frame-loading">正在加载可信脚本运行时…</p>';
  const compatibilityScript = hostRuntimeReady
    ? `<script>${trustedHostBridgeScript(frameName)}</script>`
    : "";
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="stn-frame-id" content="${escapeHtmlAttribute(frameName)}">
    <style>
      :root { color-scheme: light; }
      html, body { margin: 0; background: transparent; color: #202124; overflow: visible; }
      body { box-sizing: border-box; width: 100%; padding: 14px 16px; font: 14px/1.72 system-ui, -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; overflow-wrap: anywhere; }
      img, video, svg, canvas { max-width: 100%; height: auto; }
      pre { white-space: pre-wrap; }
      a { color: #416f88; }
      .stn-trusted-frame-loading { color: #667681; }
    </style>
  </head>
  <body>${compatibilityScript}${displayContent}${frameDialogueDecorationScript()}</body>
</html>`;
}

type TrustedDisplayFrameProps = {
  title: string;
  content: string;
  frameName: string;
  hostRuntimeReady: boolean;
  displayKind?: "html" | "mixed";
  appliedRegexScriptIds: string[];
  onHeightChange?: (() => void) | undefined;
};

function TrustedDisplayFrame({
  title,
  content,
  frameName,
  hostRuntimeReady,
  displayKind = "html",
  appliedRegexScriptIds,
  onHeightChange,
}: TrustedDisplayFrameProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  useEffect(() => {
    return () => resizeObserverRef.current?.disconnect();
  }, []);

  const handleLoad = useCallback(() => {
    const frame = frameRef.current;
    resizeObserverRef.current?.disconnect();
    if (!frame) return;
    try {
      const body = frame.contentDocument?.body;
      if (!body) return;
      const resize = () => {
        const height = Math.ceil(
          Math.max(
            body.scrollHeight,
            body.offsetHeight,
            body.getBoundingClientRect().height,
          ),
        );
        if (height <= 0 || height > FRAME_HEIGHT_MAX) return;
        const nextHeight = Math.max(FRAME_HEIGHT_MIN, height);
        if (Math.abs(frame.offsetHeight - nextHeight) < 1) return;
        frame.style.height = `${String(nextHeight)}px`;
        onHeightChange?.();
      };
      resize();
      if (typeof ResizeObserver !== "undefined") {
        const observer = new ResizeObserver(resize);
        observer.observe(body);
        resizeObserverRef.current = observer;
      }
      void (
        window as unknown as {
          TavernHelper?: { eventEmit?: (event: string, id: string) => unknown };
        }
      ).TavernHelper?.eventEmit?.("message_iframe_render_ended", frameName);
    } catch {
      // Trusted content may navigate the frame away from the app origin.
    }
  }, [frameName, onHeightChange]);

  return (
    <iframe
      ref={frameRef}
      id={frameName}
      name={frameName}
      className="message-item__display-frame"
      title={title}
      loading="lazy"
      frameBorder={0}
      scrolling="no"
      srcDoc={trustedDisplayDocument(content, frameName, hostRuntimeReady)}
      onLoad={handleLoad}
      data-display-kind={displayKind}
      data-applied-regex={appliedRegexScriptIds.join(" ")}
      data-auto-height="true"
      data-execution-model="trusted-same-origin"
    />
  );
}

type DeferredTrustedDisplayFrameProps = TrustedDisplayFrameProps;

function DeferredTrustedDisplayFrame(props: DeferredTrustedDisplayFrameProps) {
  const [visible, setVisible] = useState(false);

  if (visible) return <TrustedDisplayFrame {...props} />;

  return (
    <button
      className="message-item__deferred-frame"
      type="button"
      onClick={() => setVisible(true)}
    >
      显示前端代码块
    </button>
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
  messageIndex?: number;
  isLast: boolean;
  helperHostReady?: boolean;
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
  onContentResize?: (() => void) | undefined;
};

export const MessageCard = memo(function MessageCard({
  message,
  messageIndex = 0,
  isLast,
  helperHostReady = true,
  renderRichContent = true,
  collapseCodeBlocks = "none",
  onCopy,
  onUpdate,
  onDelete,
  onRegenerate,
  onContinue,
  onSelectSwipe,
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
  const reasoningText = message.reasoningText?.trim();

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
      className={`message-item message-item--${message.role} mes`}
      data-message-id={message.id}
      {...{
        mesid: String(messageIndex),
        is_user: message.role === "user" ? "true" : "false",
        is_system: "false",
      }}
    >
      <header className="message-item__header">
        <span className="speaker-mark" aria-hidden="true" />
        <strong>{actorLabel}</strong>
        <span className="message-role">
          {message.role === "user" ? "用户输入" : "模型回复"}
        </span>
        <time>{message.createdLabel}</time>
      </header>

      {message.role === "assistant" && reasoningText ? (
        <details className="message-reasoning">
          <summary>思考过程</summary>
          <div className="message-reasoning__content">
            <MarkdownMessageContent
              content={reasoningText}
              appliedRegexScriptIds={[]}
            />
          </div>
        </details>
      ) : null}

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
      ) : message.role === "user" ? (
        <div className="mes_text" data-collapse-code={collapseCodeBlocks}>
          <MarkdownMessageContent
            content={displayContent}
            appliedRegexScriptIds={appliedRegexScriptIds}
          />
        </div>
      ) : displaysHtml ? (
        <div className="message-item__rich-content mes_text">
          {displaySegments.map((segment, index) =>
            segment.kind === "html" || segment.kind === "mixed" ? (
              segment.kind === "html" && !renderRichContent ? (
                <DeferredTrustedDisplayFrame
                  key={`deferred-html-${String(index)}`}
                  frameName={`TH-message--${String(messageIndex)}--${String(index)}`}
                  hostRuntimeReady={helperHostReady}
                  title={`${actorLabel}的正则显示内容`}
                  content={segment.content}
                  displayKind="html"
                  appliedRegexScriptIds={appliedRegexScriptIds}
                  onHeightChange={onContentResize}
                />
              ) : (
                <TrustedDisplayFrame
                  key={`html-${String(index)}-${String(helperHostReady)}`}
                  frameName={`TH-message--${String(messageIndex)}--${String(index)}`}
                  hostRuntimeReady={helperHostReady}
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
                  onHeightChange={onContentResize}
                />
              )
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
        <div className="mes_text" data-collapse-code={collapseCodeBlocks}>
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
  messageFloorById?: Readonly<Record<string, number>>;
  hasMore?: boolean;
  loadingOlder?: boolean;
  onLoadOlder?: (() => Promise<void>) | undefined;
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
  helperHostReady?: boolean;
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
  messageFloorById,
  hasMore = false,
  loadingOlder = false,
  onLoadOlder,
  generation,
  onCopy,
  onUpdate,
  onDelete,
  onRegenerate,
  onContinue,
  onSelectSwipe,
  helperHostReady = true,
  helperRenderSettings,
}: MessageStreamProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const sticksToBottomRef = useRef(true);
  const previousConversationIdRef = useRef(conversationId);
  const loadingOlderRef = useRef(false);
  const historyAnchorRef = useRef<{
    scrollHeight: number;
    scrollTop: number;
  } | null>(null);
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
    if (
      element.scrollTop <= 120 &&
      hasMore &&
      !loadingOlder &&
      !loadingOlderRef.current &&
      onLoadOlder
    ) {
      loadingOlderRef.current = true;
      historyAnchorRef.current = {
        scrollHeight: element.scrollHeight,
        scrollTop: element.scrollTop,
      };
      void onLoadOlder().finally(() => {
        loadingOlderRef.current = false;
      });
    }
  }, [hasMore, loadingOlder, onLoadOlder]);

  const handleMessageContentResize = useCallback(() => {
    if (sticksToBottomRef.current) scrollToBottom();
  }, [scrollToBottom]);

  useLayoutEffect(() => {
    const pendingAnchor = historyAnchorRef.current;
    const element = viewportRef.current;
    if (pendingAnchor && element) {
      element.scrollTop =
        element.scrollHeight -
        pendingAnchor.scrollHeight +
        pendingAnchor.scrollTop;
      historyAnchorRef.current = null;
      sticksToBottomRef.current = false;
      return;
    }
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
    messages[0]?.id,
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
      {loadingOlder ? (
        <div className="message-history-loading" role="status">
          正在加载更早消息…
        </div>
      ) : null}
      {messages.length === 0 && !showsGeneration ? (
        <EmptyState
          icon={<ChatCircleDots size={28} />}
          title="开始普通聊天"
          detail="输入一条消息，模型会结合当前角色卡的内容生成回复。"
        />
      ) : (
        <div className="message-window" id="chat">
          {messages.map((message, index) => (
            <MessageCard
              key={message.id}
              message={message}
              messageIndex={messageFloorById?.[message.id] ?? index}
              isLast={index === messages.length - 1}
              helperHostReady={helperHostReady}
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
              {generation.reasoningPreview ? (
                <details className="message-reasoning" open>
                  <summary>正在思考</summary>
                  <div className="message-reasoning__content">
                    <MarkdownMessageContent
                      content={generation.reasoningPreview}
                      appliedRegexScriptIds={[]}
                    />
                  </div>
                </details>
              ) : null}
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
