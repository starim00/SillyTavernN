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
  useId,
  useLayoutEffect,
  useMemo,
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
const FRAME_HEIGHT_MESSAGE_TYPE = "stn:message-frame-height";
const FRAME_STORAGE_MESSAGE_TYPE = "stn:message-frame-storage";
const FRAME_SEND_MESSAGE_TYPE = "stn:message-frame-send";
const FRAME_MVU_UPDATE_MESSAGE_TYPE = "stn:message-frame-mvu-update";
const FRAME_HEIGHT_MIN = 96;
const FRAME_HEIGHT_MAX = 1_000_000;
const FRAME_STORAGE_PREFIX = "sillytavern-n.message-frame-storage.v1:";
const FRAME_STORAGE_MAX_LENGTH = 512_000;
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
const FRAME_RESIZE_SCRIPT = `(()=>{const meta=document.querySelector('meta[name="stn-frame-id"]');if(!meta)return;const frameId=meta.content;let queued=false;const report=()=>{queued=false;const body=document.body;if(!body)return;const height=Math.ceil(Math.max(body.scrollHeight,body.offsetHeight,body.getBoundingClientRect().height));parent.postMessage({type:"stn:message-frame-height",frameId,height},"*")};const queue=()=>{if(queued)return;queued=true;requestAnimationFrame(report)};new ResizeObserver(queue).observe(document.body);addEventListener("load",queue);queue()})();`;

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

export function clearMessageFrameStorage(conversationId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(
      frameStorageKey(`conversation:${conversationId}`),
    );
  } catch {
    // Storage is optional; an unavailable browser store must not block chat.
  }
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

function loadFrameStorageWithFallbacks(
  namespace: string,
  fallbackNamespaces: readonly string[],
): Record<string, string> {
  const primary = loadFrameStorage(namespace);
  if (fallbackNamespaces.length === 0) return primary;

  const merged = { ...primary };
  for (const fallbackNamespace of fallbackNamespaces) {
    const fallback = loadFrameStorage(fallbackNamespace);
    for (const [key, value] of Object.entries(fallback)) {
      if (!Object.hasOwn(merged, key)) merged[key] = value;
    }
  }

  try {
    if (JSON.stringify(merged).length > FRAME_STORAGE_MAX_LENGTH) {
      return primary;
    }
  } catch {
    return primary;
  }

  if (Object.keys(merged).length !== Object.keys(primary).length) {
    saveFrameStorage(namespace, merged);
  }
  return merged;
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

function frameDialogueDecorationScript(): string {
  return `<style>html,body{background:#ffffff!important;color:#202124!important}body>p,body>p *,body>li,body>li *,body>blockquote,body>blockquote *,body>h1,body>h1 *,body>h2,body>h2 *,body>h3,body>h3 *,body>h4,body>h4 *,body>h5,body>h5 *,body>h6,body>h6 *{color:#202124!important}.stn-message-dialogue{color:#8b1e1e!important;font-weight:650}</style><script>(()=>{const pattern=new RegExp(${escapeInlineJson(DIALOGUE_PATTERN.source)},"gu");const skipped=new Set(["SCRIPT","STYLE","PRE","CODE","TEXTAREA","NOSCRIPT"]);const decorate=()=>{const root=document.body;if(!root)return;const walker=document.createTreeWalker(root,4);const nodes=[];let node=walker.nextNode();while(node){const parent=node.parentElement;if(parent&&!parent.closest(".stn-message-dialogue")&&!skipped.has(parent.tagName)){pattern.lastIndex=0;if(pattern.test(node.nodeValue??""))nodes.push(node)}node=walker.nextNode()}for(const textNode of nodes){const value=textNode.nodeValue??"";pattern.lastIndex=0;const matches=[...value.matchAll(pattern)];if(!matches.length)continue;const fragment=document.createDocumentFragment();let cursor=0;for(const match of matches){const dialogue=match[0],start=match.index;if(!dialogue||start===undefined)continue;if(start>cursor)fragment.append(document.createTextNode(value.slice(cursor,start)));const span=document.createElement("span");span.className="stn-message-dialogue";span.textContent=dialogue;fragment.append(span);cursor=start+dialogue.length}if(cursor<value.length)fragment.append(document.createTextNode(value.slice(cursor)));textNode.replaceWith(fragment)}};decorate();new MutationObserver(decorate).observe(document.body,{subtree:true,childList:true})})()</script>`;
}

function frameCompatibilityScript(
  frameId: string,
  storage: Record<string, string>,
  messageVariables: Record<string, unknown>,
): string {
  return `const __stnFrameId=${escapeInlineJson(frameId)};const __stnValues=new Map(Object.entries(${escapeInlineJson(storage)}));const __stnNotify=(operation,key,value)=>parent.postMessage({type:"${FRAME_STORAGE_MESSAGE_TYPE}",frameId:__stnFrameId,operation,key,value},"*");const __stnLocalStorage={get length(){return __stnValues.size},key(index){return Array.from(__stnValues.keys())[Number(index)]??null},getItem(key){key=String(key);return __stnValues.has(key)?__stnValues.get(key):null},setItem(key,value){key=String(key);value=String(value);__stnValues.set(key,value);__stnNotify("set",key,value)},removeItem(key){key=String(key);__stnValues.delete(key);__stnNotify("remove",key,null)},clear(){__stnValues.clear();__stnNotify("clear","",null)}};const __stnPrompt=(message,defaultValue="")=>typeof window.prompt==="function"?window.prompt(message,defaultValue):(navigator.userActivation?.isActive?String(defaultValue??""):null);const __stnConfirm=(message)=>typeof window.confirm==="function"?window.confirm(message):navigator.userActivation?.isActive===true;const __stnAlert=(message)=>{if(typeof window.alert==="function")window.alert(message)};let __stnPendingInput="";const __stnInputProxy={get value(){return __stnPendingInput},set value(value){__stnPendingInput=String(value)},dispatchEvent(){return true}};const __stnSendProxy={click(){const content=__stnPendingInput.trim();if(content)parent.postMessage({type:"${FRAME_SEND_MESSAGE_TYPE}",frameId:__stnFrameId,content},"*")}};const __stnParentDocument=Object.freeze({querySelector(selector){if(selector==="#send_textarea")return __stnInputProxy;if(selector==="#send_but")return __stnSendProxy;return null}});const __stnClone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));let __stnMvuData=__stnClone(${escapeInlineJson(messageVariables)});const __stnPath=path=>String(path).split(".").filter(Boolean);const __stnGet=(value,path,fallback)=>{let cursor=value;for(const key of __stnPath(path)){if(cursor==null||!Object.prototype.hasOwnProperty.call(Object(cursor),key))return fallback;cursor=cursor[key]}return cursor};const __stnSet=(value,path,next)=>{const parts=__stnPath(path);let cursor=value;parts.forEach((key,index)=>{if(index===parts.length-1){cursor[key]=next;return}if(!cursor[key]||typeof cursor[key]!=="object")cursor[key]={};cursor=cursor[key]});return value};const __stnUnset=(value,path)=>{const parts=__stnPath(path);const key=parts.pop();const parentValue=parts.length?__stnGet(value,parts.join(".")):value;if(parentValue&&key)delete parentValue[key];return value};window._=window._||{get:__stnGet,set:__stnSet,unset:__stnUnset,cloneDeep:__stnClone,isArray:Array.isArray,isEmpty:value=>value==null||(Array.isArray(value)?value.length===0:typeof value==="object"?Object.keys(value).length===0:false)};const __stnMvuEvent="mag_variable_update_ended";window.Mvu={events:{VARIABLE_UPDATE_ENDED:__stnMvuEvent,VARIABLE_INITIALIZED:"mag_variable_initialized"},getMvuData(){return __stnMvuData},async replaceMvuData(value){__stnMvuData=__stnClone(value)||{};parent.postMessage({type:"${FRAME_MVU_UPDATE_MESSAGE_TYPE}",frameId:__stnFrameId,variables:__stnMvuData},"*");document.dispatchEvent(new CustomEvent(__stnMvuEvent,{detail:__stnMvuData,bubbles:true}));return __stnMvuData}};window.getChatMessages=async()=>[{message_id:-1,data:__stnMvuData,swipes_data:[__stnMvuData]}];window.getCurrentMessageId=()=>-1;window.getLastMessageId=()=>-1;`;
}

function adaptLegacyScriptApis(content: string): string {
  return content.replace(
    /(<script\b[^>]*>)([\s\S]*?)(<\/script>)/giu,
    (_match, opening: string, code: string, closing: string) => {
      const adapted = code
        .replaceAll("window.parent?.Mvu", "window.Mvu")
        .replaceAll("window.parent.Mvu", "window.Mvu")
        .replaceAll("window.top?.Mvu", "window.Mvu")
        .replaceAll("window.top.Mvu", "window.Mvu")
        .replaceAll("window.parent && window.Mvu", "window.Mvu")
        .replaceAll("window.top && window.Mvu", "window.Mvu")
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
  const fenced = FENCED_HTML_PATTERN.exec(value)?.[1];
  if (fenced !== undefined && HTML_MARKUP_PATTERN.test(fenced)) {
    return [{ kind: "html", content: fenced }];
  }

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

export function sandboxedDisplayDocument(
  content: string,
  resizeFrameId?: string,
  frameStorage: Record<string, string> = {},
  messageVariables: Record<string, unknown> = {},
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
    ? `<script>${frameCompatibilityScript(
        resizeFrameId,
        frameStorage,
        messageVariables,
      )}</script>`
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
      html, body { margin: 0; background: #ffffff; color: #202124; overflow: visible; }
      body { box-sizing: border-box; width: 100%; padding: 14px 16px; font: 14px/1.72 system-ui, -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; overflow-wrap: anywhere; }
      img, video, svg, canvas { max-width: 100%; height: auto; }
      pre { white-space: pre-wrap; }
      a { color: #416f88; }
    </style>
  </head>
  <body>${compatibilityScript}${displayContent}${frameDialogueDecorationScript()}${resizeScript}</body>
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
  storageFallbackNamespaces?: readonly string[] | undefined;
  messageVariables?: Record<string, unknown> | undefined;
  onSendMessage?: ((content: string) => void) | undefined;
  onVariablesChange?:
    ((variables: Record<string, unknown>) => void) | undefined;
  onHeightChange?: (() => void) | undefined;
};

function SandboxedDisplayFrame({
  title,
  content,
  displayKind = "html",
  appliedRegexScriptIds,
  storageNamespace,
  storageFallbackNamespaces = [],
  messageVariables = {},
  onSendMessage,
  onVariablesChange,
  onHeightChange,
}: SandboxedDisplayFrameProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const frameId = useId();
  const initialStorage = useMemo(
    () =>
      loadFrameStorageWithFallbacks(
        storageNamespace,
        storageFallbackNamespaces,
      ),
    [storageFallbackNamespaces, storageNamespace],
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
        return;
      }

      if (
        event.data.type === FRAME_MVU_UPDATE_MESSAGE_TYPE &&
        isRecord(event.data.variables)
      ) {
        try {
          if (JSON.stringify(event.data.variables).length > 2_000_000) return;
          onVariablesChange?.(event.data.variables);
        } catch {
          // Ignore non-serializable or oversized frame updates.
        }
      }
    },
    [
      frameId,
      onHeightChange,
      onSendMessage,
      onVariablesChange,
      storageNamespace,
    ],
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
      srcDoc={sandboxedDisplayDocument(
        content,
        frameId,
        initialStorage,
        messageVariables,
      )}
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
  storageNamespace?: string;
  storageFallbackNamespaces?: readonly string[] | undefined;
  messageVariables?: Record<string, unknown> | undefined;
  onVariablesChange?:
    | ((message: WorkspaceMessage, variables: Record<string, unknown>) => void)
    | undefined;
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
  storageNamespace = `conversation:${message.conversationId}`,
  storageFallbackNamespaces,
  messageVariables,
  onVariablesChange,
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
      ) : message.role === "user" || !renderRichContent ? (
        <div data-collapse-code={collapseCodeBlocks}>
          <MarkdownMessageContent
            content={displayContent}
            appliedRegexScriptIds={appliedRegexScriptIds}
          />
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
                storageNamespace={storageNamespace}
                storageFallbackNamespaces={storageFallbackNamespaces}
                messageVariables={messageVariables}
                onSendMessage={onEmbeddedSend}
                onVariablesChange={(variables) =>
                  onVariablesChange?.(message, variables)
                }
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
  cardId?: string | undefined;
  storageConversationIds?: readonly string[] | undefined;
  messages: WorkspaceMessage[];
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
  onEmbeddedSend?: ((content: string) => void) | undefined;
  variablesByMessage?: Record<string, Record<string, unknown>> | undefined;
  onVariablesChange?:
    | ((message: WorkspaceMessage, variables: Record<string, unknown>) => void)
    | undefined;
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
  cardId,
  storageConversationIds,
  messages,
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
  onEmbeddedSend,
  variablesByMessage,
  onVariablesChange,
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
  const storageConversationKey = (storageConversationIds ?? []).join("\u001f");
  const storageNamespace = cardId
    ? `card:${cardId}`
    : `conversation:${conversationId}`;
  const storageFallbackNamespaces = useMemo(() => {
    if (!cardId) return [];
    const conversationIds = [conversationId, ...(storageConversationIds ?? [])];
    return [...new Set(conversationIds)].map((id) => `conversation:${id}`);
  }, [cardId, conversationId, storageConversationKey]);

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
              storageNamespace={storageNamespace}
              storageFallbackNamespaces={storageFallbackNamespaces}
              messageVariables={variablesByMessage?.[message.id]}
              onVariablesChange={onVariablesChange}
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
