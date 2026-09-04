import $ from "jquery";
import _ from "lodash";
import toastr from "toastr";
import * as Vue from "vue";
import * as YAML from "yaml";
import * as z from "zod";

import type { WorkspaceMessage } from "../domain/workspace";
import { createBrowserIdentifier } from "./browserIdentifier";
import { TAVERN_HELPER_COMPAT_VERSION } from "./legacyPluginIds";
import type {
  TavernHelperContext,
  TavernHelperRuntimeButton,
  TavernHelperRuntimeStatus,
  TavernHelperScope,
  TavernHelperScript,
  TavernHelperSource,
  TavernHelperStateNamespace,
} from "./tavernHelperTypes";
import { iframeEvents, mvuEvents, tavernEvents } from "./tavernHelperEvents";
import {
  appendAssistantStatusPlaceholder,
  createTavernHelperMessageView,
  resolveTavernHelperFrameMessageId,
  resolveTavernHelperMessageVariables,
  shouldEnsureAssistantStatusPlaceholder,
  shouldReconcileOpeningMessageVariables,
  shouldReparseAssistantVariables,
  tavernHelperConfirmResult,
  validateTavernHelperVariables,
} from "./tavernHelperMessageView";

export {
  appendAssistantStatusPlaceholder,
  createTavernHelperMessageView,
  resolveTavernHelperFrameMessageId,
  resolveTavernHelperMessageVariables,
  shouldEnsureAssistantStatusPlaceholder,
  shouldReconcileOpeningMessageVariables,
  shouldReparseAssistantVariables,
  tavernHelperConfirmResult,
  validateTavernHelperVariables,
} from "./tavernHelperMessageView";

type JsonRecord = Record<string, unknown>;
type EventListener = (...values: unknown[]) => unknown;

type VariableOption =
  | { type: "global" | "character" | "preset" | "chat" }
  | { type: "message"; message_id?: number | "latest" }
  | { type: "script"; script_id?: string }
  | { type: "extension"; extension_id: string };

type RuntimeScript = {
  source: TavernHelperSource;
  script: TavernHelperScript;
  key: string;
};

type RuntimeListener = {
  listener: EventListener;
  owner: RuntimeScript | null;
  once: boolean;
  priority: number;
  sequence: number;
};

type PersistRequest = {
  namespace: TavernHelperStateNamespace;
  variables: JsonRecord;
  identifiers: {
    messageId?: string;
    sourceScope?: TavernHelperScope;
    sourceId?: string;
    scriptId?: string;
    extensionId?: string;
  };
};

export type AssistantSwipePreparation = {
  messageId: string;
  revision: number;
  hadVariables: boolean;
  variables: JsonRecord;
};

const nativeRuntimeGlobals = new WeakSet<object>();
const SCRIPT_TOAST_CONTAINER_ID = "stn-script-toast-container";
const SCRIPT_TOAST_CLASS = "stn-script-toast";
const SCRIPT_TOAST_LIMIT = 3;

const scriptToastOptions = (overrides?: ToastrOptions): ToastrOptions => ({
  ...toastr.options,
  ...overrides,
  closeButton: true,
  closeDuration: 80,
  closeMethod: "fadeOut",
  closeOnHover: true,
  containerId: SCRIPT_TOAST_CONTAINER_ID,
  extendedTimeOut: 800,
  hideDuration: 80,
  hideMethod: "fadeOut",
  newestOnTop: true,
  positionClass: "stn-script-toast-container--bottom-right",
  preventDuplicates: true,
  progressBar: true,
  showDuration: 120,
  tapToDismiss: true,
  target: "body",
  toastClass: SCRIPT_TOAST_CLASS,
});

const trimScriptToasts = () => {
  const container = document.getElementById(SCRIPT_TOAST_CONTAINER_ID);
  if (!container) return;
  const visibleToasts = Array.from(
    container.querySelectorAll(`.${SCRIPT_TOAST_CLASS}`),
  );
  const overflow = visibleToasts.length - SCRIPT_TOAST_LIMIT + 1;
  if (overflow <= 0) return;
  visibleToasts
    .slice(-overflow)
    .forEach((notification) => notification.remove());
};

const showScriptToast = (
  tone: "error" | "info" | "success" | "warning",
  message: string | JQuery,
  title?: string,
  overrides?: ToastrOptions,
) => {
  trimScriptToasts();
  return toastr[tone](message, title, scriptToastOptions(overrides));
};

const scriptToastr = {
  ...toastr,
  clear: (toast?: JQuery, clearOptions?: { force: boolean }) => {
    if (toast) {
      toastr.clear(toast, clearOptions);
      return;
    }
    document.getElementById(SCRIPT_TOAST_CONTAINER_ID)?.remove();
  },
  error: (
    message: string | JQuery,
    title?: string,
    overrides?: ToastrOptions,
  ) => showScriptToast("error", message, title, overrides),
  getContainer: (options?: ToastrOptions, create?: boolean) =>
    toastr.getContainer(scriptToastOptions(options), create ?? false),
  info: (message: string | JQuery, title?: string, overrides?: ToastrOptions) =>
    showScriptToast("info", message, title, overrides),
  remove: (toast?: JQuery) => {
    if (toast) {
      toastr.remove(toast);
      return;
    }
    document.getElementById(SCRIPT_TOAST_CONTAINER_ID)?.remove();
  },
  success: (
    message: string | JQuery,
    title?: string,
    overrides?: ToastrOptions,
  ) => showScriptToast("success", message, title, overrides),
  warning: (
    message: string | JQuery,
    title?: string,
    overrides?: ToastrOptions,
  ) => showScriptToast("warning", message, title, overrides),
} satisfies typeof toastr;

Object.defineProperty(scriptToastr, "options", {
  configurable: false,
  enumerable: true,
  get: () => toastr.options,
  set: (value: ToastrOptions) => {
    toastr.options = value;
  },
});

export type TavernHelperRuntimeAdapter = {
  connectionId: string;
  connection?: {
    name: string;
    protocol:
      "openai-compatible" | "openai-responses" | "text-completion" | "fake";
    baseUrl: string;
    model: string;
    hasApiKey: boolean;
  };
  replacePreset?: (input: {
    presetId: string;
    expectedRevision: number;
    preset: Record<string, unknown>;
  }) => Promise<{
    id: string;
    name: string;
    revision: number;
    value: Record<string, unknown>;
  }>;
  getMessages: () => WorkspaceMessage[];
  createMessage: (input: {
    content: string;
    role: "user" | "assistant";
    parentMessageId?: string;
  }) => Promise<WorkspaceMessage>;
  deleteMessage: (message: WorkspaceMessage) => Promise<void>;
  updateMessage: (
    message: WorkspaceMessage,
    content: string,
  ) => Promise<WorkspaceMessage>;
  refreshMessages: () => Promise<WorkspaceMessage[]>;
  generate: (input: {
    userInput?: string;
    settings?: Record<string, unknown>;
    injects: Array<{
      role: "system" | "assistant" | "user";
      content: string;
      depth: number;
    }>;
  }) => Promise<string>;
  saveState: (input: {
    namespace: TavernHelperStateNamespace;
    variables: JsonRecord;
    messageId?: string;
    sourceScope?: TavernHelperScope;
    sourceId?: string;
    scriptId?: string;
    extensionId?: string;
  }) => Promise<void>;
  onButtonsChanged: (buttons: TavernHelperRuntimeButton[]) => void;
  onStatusChanged: (status: TavernHelperRuntimeStatus) => void;
  notify: (message: string, tone?: "success" | "info" | "warning") => void;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function asRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function scriptKey(
  scope: TavernHelperScope,
  sourceId: string,
  scriptId: string,
): string {
  return `${scope}:${sourceId}:${scriptId}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function appendInstanceToRemoteImports(
  content: string,
  instanceId: string,
): string {
  const suffix = `stn_instance=${encodeURIComponent(instanceId)}`;
  return content.replace(
    /(\b(?:from\s*|import\s*)["'])(https?:\/\/[^"']+)(["'])/gu,
    (_match, prefix: string, url: string, quote: string) => {
      const separator = url.includes("?") ? "&" : "?";
      return `${prefix}${url}${separator}${suffix}${quote}`;
    },
  );
}

function selectMessageIndexes(
  range: string | number,
  length: number,
): number[] {
  if (length === 0) return [];
  const resolve = (value: number): number =>
    value < 0 ? Math.max(0, length + value) : Math.min(length - 1, value);
  if (typeof range === "number") return [resolve(range)];
  const expanded = range.replaceAll("{{lastMessageId}}", String(length - 1));
  const match = /^(-?\d+)\s*-\s*(-?\d+)$/u.exec(expanded);
  if (!match) {
    const parsed = Number.parseInt(expanded, 10);
    return Number.isNaN(parsed) ? [] : [resolve(parsed)];
  }
  const start = resolve(Number(match[1]));
  const end = resolve(Number(match[2]));
  const low = Math.min(start, end);
  const high = Math.max(start, end);
  return Array.from({ length: high - low + 1 }, (_, index) => low + index);
}

export class TavernHelperRuntime {
  private readonly listeners = new Map<string, RuntimeListener[]>();
  private readonly buttons = new Map<
    string,
    Array<{ name: string; visible: boolean }>
  >();
  private readonly extensionVariables = new Map<string, JsonRecord>();
  private readonly variableSchemas = new Map<string, z.ZodType>();
  private readonly macroLike = new Map<
    string,
    string | ((...values: string[]) => unknown)
  >();
  private readonly initializedGlobals = new Map<string, Promise<unknown>>();
  private readonly scriptInfo = new Map<string, string>();
  private readonly messageViews = new Map<
    string,
    ReturnType<typeof createTavernHelperMessageView>
  >();
  private readonly legacyChatViews = new Map<
    string,
    ReturnType<typeof createTavernHelperMessageView> & {
      variables: JsonRecord[];
    }
  >();
  private readonly audio = new Map<
    "bgm" | "ambient",
    {
      playlist: Array<{ title: string; url: string }>;
      current: string;
      settings: {
        enabled: boolean;
        mode: "repeat_one" | "repeat_all" | "shuffle" | "play_one_and_stop";
        muted: boolean;
        volume: number;
      };
      element: HTMLAudioElement | null;
    }
  >();
  private readonly persistTimers = new Map<string, number>();
  private readonly pendingPersists = new Map<string, PersistRequest>();
  private readonly activePersists = new Set<Promise<void>>();
  private readonly injections = new Map<
    string,
    {
      prompts: Array<{
        role: "system" | "assistant" | "user";
        content: string;
        depth: number;
        filter?: () => boolean | Promise<boolean>;
      }>;
      once: boolean;
    }
  >();
  private readonly loadedScriptIds: string[] = [];
  private readonly errors: TavernHelperRuntimeStatus["errors"] = [];
  private readonly runtimeId = createBrowserIdentifier();
  private listenerSequence = 0;
  private activeScript: RuntimeScript | null = null;
  private nativeMvuParser:
    ((message: string, oldData: JsonRecord) => Promise<JsonRecord>) | null =
    null;
  private disposed = false;
  private globalsCleanup: (() => void) | null = null;

  constructor(
    readonly context: TavernHelperContext,
    private readonly adapter: TavernHelperRuntimeAdapter,
  ) {
    for (const [extensionId, variables] of Object.entries(
      context.variables.extensions ?? {},
    )) {
      this.extensionVariables.set(extensionId, variables);
    }
    for (const source of context.sources) {
      for (const script of source.bundle.scripts) {
        this.buttons.set(
          scriptKey(source.scope, source.id, script.id),
          script.buttons.map(({ name, visible }) => ({ name, visible })),
        );
      }
    }
    for (const type of ["bgm", "ambient"] as const) {
      this.audio.set(type, {
        playlist: [],
        current: "",
        settings: {
          enabled: true,
          mode: "repeat_all",
          muted: false,
          volume: 1,
        },
        element: null,
      });
    }
  }

  async start(): Promise<void> {
    this.adapter.onStatusChanged({
      loading: true,
      loadedScriptIds: [],
      errors: [],
    });
    this.globalsCleanup = this.installGlobals();
    for (const source of this.context.sources) {
      if (!source.trusted) continue;
      for (const script of source.bundle.scripts) {
        if (!script.enabled || !script.content.trim()) continue;
        await this.loadScript({
          source,
          script,
          key: scriptKey(source.scope, source.id, script.id),
        });
      }
    }
    this.publishButtons();
    this.adapter.onStatusChanged({
      loading: false,
      loadedScriptIds: [...this.loadedScriptIds],
      errors: [...this.errors],
    });
    await this.emit(tavernEvents.APP_READY);
    await this.emit(tavernEvents.CHAT_CHANGED, this.context.conversation.id);
    void this.processOpeningAssistantMessage().catch((error) => {
      if (!this.disposed) {
        this.adapter.notify(
          `首条模型消息脚本处理失败：${errorMessage(error)}`,
          "warning",
        );
      }
    });
  }

  dispose(): void {
    this.persistLegacyChatVariables();
    void this.flushPersistence();
    this.disposed = true;
    this.listeners.clear();
    this.injections.clear();
    this.messageViews.clear();
    this.legacyChatViews.clear();
    for (const audio of this.audio.values()) {
      audio.element?.pause();
      audio.element = null;
    }
    this.globalsCleanup?.();
    this.globalsCleanup = null;
    this.adapter.onButtonsChanged([]);
  }

  async emit(event: string, ...values: unknown[]): Promise<void> {
    const entries = [...(this.listeners.get(event) ?? [])];
    for (const entry of entries) {
      try {
        await this.withOwner(entry.owner, () => entry.listener(...values));
      } catch (error) {
        this.reportRuntimeError(entry.owner, error);
        this.adapter.notify(
          `${entry.owner?.script.name ?? "酒馆助手兼容层"} 处理 ${event} 事件失败：${errorMessage(error)}`,
          "warning",
        );
      } finally {
        if (entry.once) this.removeListener(event, entry.listener);
      }
    }
    if (
      event === tavernEvents.MESSAGE_RECEIVED &&
      typeof values[0] === "number"
    ) {
      await this.reconcileAssistantMessage(values[0]);
    }
  }

  async clickButton(button: TavernHelperRuntimeButton): Promise<void> {
    const owner = this.runtimeScript(
      button.sourceScope,
      button.sourceId,
      button.scriptId,
    );
    await this.withOwner(owner, () => this.emit(this.buttonEvent(button.name)));
  }

  async processUserMessage(expectedMessageId: string): Promise<boolean> {
    const messages = await this.adapter.refreshMessages();
    const messageIndex = messages.findIndex(
      (message) => message.id === expectedMessageId,
    );
    if (messageIndex < 0) return false;
    await this.emit(tavernEvents.MESSAGE_SENT, messageIndex);
    await this.emit(tavernEvents.USER_MESSAGE_RENDERED, messageIndex, "user");
    return true;
  }

  async prepareAssistantSwipe(
    expectedMessageId: string,
  ): Promise<AssistantSwipePreparation | null> {
    const messages = await this.adapter.refreshMessages();
    const messageIndex = messages.findIndex(
      (message) => message.id === expectedMessageId,
    );
    const message = messages[messageIndex];
    if (!message || message.role !== "assistant") return null;

    const hadVariables = Object.prototype.hasOwnProperty.call(
      this.context.variables.messages,
      message.id,
    );
    const preparation: AssistantSwipePreparation = {
      messageId: message.id,
      revision: message.revision,
      hadVariables,
      variables: clone(this.context.variables.messages[message.id] ?? {}),
    };
    this.rollbackAssistantMessageVariables(messageIndex, messages);
    await this.flushPersistence();
    return preparation;
  }

  async restoreAssistantSwipePreparation(
    preparation: AssistantSwipePreparation,
  ): Promise<boolean> {
    const messages = await this.adapter.refreshMessages();
    const message = messages.find(
      (candidate) => candidate.id === preparation.messageId,
    );
    if (
      !message ||
      message.role !== "assistant" ||
      message.revision !== preparation.revision
    ) {
      return false;
    }

    if (preparation.hadVariables) {
      this.context.variables.messages[message.id] = clone(
        preparation.variables,
      );
    } else {
      delete this.context.variables.messages[message.id];
    }
    this.queuePersist(
      "message",
      preparation.hadVariables ? preparation.variables : {},
      { messageId: message.id },
    );
    await this.flushPersistence();
    return true;
  }

  async processAssistantSwipe(
    messageIndex: number,
    expectedSwipeId?: string,
  ): Promise<boolean> {
    const messages = await this.adapter.refreshMessages();
    const message = messages[messageIndex];
    if (!message || message.role !== "assistant") return false;

    if (expectedSwipeId !== undefined) {
      const activeSwipe =
        message.swipes?.[message.activeSwipeIndex ?? 0] ?? undefined;
      if (activeSwipe?.id !== expectedSwipeId) return false;
    }

    const baseline = this.rollbackAssistantMessageVariables(
      messageIndex,
      messages,
    );
    try {
      await this.emit(tavernEvents.MESSAGE_SWIPED, messageIndex);
      const parsed = await this.parseAssistantMessageVariables(
        messageIndex,
        message,
        baseline,
      );
      if (parsed) {
        await this.reconcileAssistantMessage(messageIndex);
      } else {
        await this.emit(
          tavernEvents.MESSAGE_RECEIVED,
          messageIndex,
          "assistant",
        );
      }
      await this.emit(
        tavernEvents.CHARACTER_MESSAGE_RENDERED,
        messageIndex,
        "assistant",
      );
    } finally {
      const processedMessage = this.adapter.getMessages()[messageIndex];
      if (processedMessage) {
        const variables =
          this.context.variables.messages[processedMessage.id] ?? {};
        this.queuePersist("message", variables, {
          messageId: processedMessage.id,
        });
      }
      await this.flushPersistence();
    }
    return true;
  }

  async processAssistantMessage(messageIndex: number): Promise<boolean> {
    const messages = await this.adapter.refreshMessages();
    const message = messages[messageIndex];
    if (!message || message.role !== "assistant") return false;
    const baseline = this.previousMessageVariables(messageIndex, messages);

    try {
      await this.emit(tavernEvents.MESSAGE_RECEIVED, messageIndex, "assistant");
      const variables = this.context.variables.messages[message.id] ?? {};
      if (
        this.hasMessageVariableSchema(messageIndex) &&
        shouldReparseAssistantVariables(message.content, variables, baseline)
      ) {
        const parsed = await this.parseAssistantMessageVariables(
          messageIndex,
          message,
          baseline,
        );
        if (parsed) await this.reconcileAssistantMessage(messageIndex);
      }
      await this.emit(
        tavernEvents.CHARACTER_MESSAGE_RENDERED,
        messageIndex,
        "assistant",
      );
    } finally {
      const processedMessage = this.adapter.getMessages()[messageIndex];
      if (processedMessage) {
        const variables =
          this.context.variables.messages[processedMessage.id] ?? {};
        this.queuePersist("message", variables, {
          messageId: processedMessage.id,
        });
      }
      await this.flushPersistence();
    }
    return true;
  }

  async activePromptInjections(): Promise<
    Array<{
      role: "system" | "assistant" | "user";
      content: string;
      depth: number;
    }>
  > {
    const active: Array<{
      role: "system" | "assistant" | "user";
      content: string;
      depth: number;
    }> = [];
    const consumed: string[] = [];
    for (const [id, injection] of this.injections) {
      for (const prompt of injection.prompts) {
        if (prompt.filter && !(await prompt.filter())) continue;
        active.push({
          role: prompt.role,
          content: prompt.content,
          depth: prompt.depth,
        });
      }
      if (injection.once) consumed.push(id);
    }
    consumed.forEach((id) => this.injections.delete(id));
    return active;
  }

  private runtimeScript(
    scope: TavernHelperScope,
    sourceId: string,
    scriptId: string,
  ): RuntimeScript | null {
    const source = this.context.sources.find(
      (candidate) => candidate.scope === scope && candidate.id === sourceId,
    );
    const script = source?.bundle.scripts.find(
      (candidate) => candidate.id === scriptId,
    );
    return source && script
      ? { source, script, key: scriptKey(scope, sourceId, scriptId) }
      : null;
  }

  private async loadScript(owner: RuntimeScript): Promise<void> {
    try {
      const content = appendInstanceToRemoteImports(
        owner.script.content,
        `${owner.key}-${Date.now().toString(36)}`,
      );
      const url = URL.createObjectURL(
        new Blob([content], { type: "text/javascript" }),
      );
      try {
        await this.withOwner(owner, async () => {
          await import(/* @vite-ignore */ url);
          await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
        });
      } finally {
        URL.revokeObjectURL(url);
      }
      this.loadedScriptIds.push(owner.key);
    } catch (error) {
      this.errors.push({
        sourceScope: owner.source.scope,
        sourceId: owner.source.id,
        scriptId: owner.script.id,
        scriptName: owner.script.name,
        message: errorMessage(error),
      });
    }
  }

  private async processOpeningAssistantMessage(): Promise<void> {
    const opening = this.adapter.getMessages();
    if (opening[0]?.role !== "assistant") {
      return;
    }

    let initializationReconciled = false;
    for (let attempt = 0; attempt < 600 && !this.disposed; attempt += 1) {
      const message = this.adapter.getMessages()[0];
      if (!message || message.role !== "assistant") {
        return;
      }
      const variables = this.context.variables.messages[message.id] ?? {};
      const needsInitializationReconciliation =
        shouldReconcileOpeningMessageVariables(variables);
      const initializationListeners =
        this.listeners.get(mvuEvents.VARIABLE_INITIALIZED) ?? [];
      if (
        !initializationReconciled &&
        initializationListeners.length > 0 &&
        needsInitializationReconciliation
      ) {
        await this.emit(
          mvuEvents.VARIABLE_INITIALIZED,
          variables,
          message.activeSwipeIndex ?? 0,
        );
        initializationReconciled = true;
        this.replaceVariableStore(
          { type: "message", message_id: 0 },
          clone(variables),
        );
      }
      if (message.content.includes("<StatusPlaceHolderImpl/>")) {
        if (initializationReconciled || !needsInitializationReconciliation) {
          await this.reconcileAssistantBacklog();
          return;
        }
        await new Promise<void>((resolve) => window.setTimeout(resolve, 20));
        continue;
      }
      const listeners = this.listeners.get(tavernEvents.MESSAGE_RECEIVED) ?? [];
      if (_.has(variables, "stat_data")) {
        if (listeners.length > 0) {
          await this.emit(tavernEvents.MESSAGE_RECEIVED, 0, "assistant");
        } else {
          await this.reconcileAssistantMessage(0);
        }
        await this.emit(
          tavernEvents.CHARACTER_MESSAGE_RENDERED,
          0,
          "assistant",
        );
        await this.reconcileAssistantBacklog();
        return;
      }
      await new Promise<void>((resolve) => window.setTimeout(resolve, 100));
    }
  }

  private async reconcileAssistantBacklog(): Promise<void> {
    let messages = this.adapter.getMessages();
    for (const [index, message] of messages.entries()) {
      if (message.role !== "assistant") continue;
      const baseline = this.previousMessageVariables(index, messages);
      const variables = this.context.variables.messages[message.id] ?? {};
      if (
        this.hasMessageVariableSchema(index) &&
        shouldReparseAssistantVariables(message.content, variables, baseline)
      ) {
        const parsed = await this.parseAssistantMessageVariables(
          index,
          message,
          baseline,
        );
        if (parsed) {
          await this.reconcileAssistantMessage(index);
          messages = this.adapter.getMessages();
          continue;
        }
      }
      await this.reconcileAssistantMessage(index);
      messages = this.adapter.getMessages();
    }
    await this.flushPersistence();
  }

  private hasMessageVariableSchema(messageIndex: number): boolean {
    return (
      this.variableSchemas.has(`message:${String(messageIndex)}`) ||
      this.variableSchemas.has("message:*")
    );
  }

  private previousMessageVariables(
    messageIndex: number,
    messages: WorkspaceMessage[],
  ): JsonRecord | undefined {
    for (let index = messageIndex - 1; index >= 0; index -= 1) {
      const previousMessage = messages[index];
      if (!previousMessage) continue;
      const previousVariables =
        this.context.variables.messages[previousMessage.id];
      if (!previousVariables || !_.has(previousVariables, "stat_data")) {
        continue;
      }
      return clone(previousVariables);
    }
    return undefined;
  }

  private rollbackAssistantMessageVariables(
    messageIndex: number,
    messages: WorkspaceMessage[],
  ): JsonRecord | undefined {
    const message = messages[messageIndex];
    if (!message || message.role !== "assistant") return undefined;

    const snapshot = this.previousMessageVariables(messageIndex, messages);
    if (snapshot !== undefined) {
      this.context.variables.messages[message.id] = snapshot;
      this.queuePersist("message", snapshot, { messageId: message.id });
      return snapshot;
    }
    return undefined;
  }

  private async parseAssistantMessageVariables(
    messageIndex: number,
    message: WorkspaceMessage,
    baseline: JsonRecord | undefined,
  ): Promise<boolean> {
    if (baseline === undefined) return false;
    const mvu = asRecord(
      (window as unknown as Record<string, unknown>).Mvu,
    ) as JsonRecord & {
      parseMessage?: (
        message: string,
        oldData: JsonRecord,
      ) => JsonRecord | Promise<JsonRecord>;
    };
    const parser = mvu.parseMessage;
    if (typeof parser !== "function" || parser === this.nativeMvuParser) {
      return false;
    }
    const parsed = asRecord(
      await parser.call(mvu, message.content, clone(baseline)),
    );
    this.replaceVariableStore(
      { type: "message", message_id: messageIndex },
      parsed,
    );
    return true;
  }

  private async reconcileAssistantMessage(messageIndex: number): Promise<void> {
    let messages = await this.adapter.refreshMessages();
    let message = messages[messageIndex];
    if (!message || message.role !== "assistant") return;

    let variables = this.context.variables.messages[message.id] ?? {};
    if (!_.has(variables, "stat_data")) {
      for (let index = messageIndex - 1; index >= 0; index -= 1) {
        const source = messages[index];
        if (!source) continue;
        const candidate = this.context.variables.messages[source.id] ?? {};
        if (!_.has(candidate, "stat_data")) continue;
        variables = clone(candidate);
        this.context.variables.messages[message.id] = variables;
        this.queuePersist("message", variables, { messageId: message.id });
        break;
      }
    }

    if (
      !shouldEnsureAssistantStatusPlaceholder(messageIndex, message, variables)
    ) {
      return;
    }
    const content = appendAssistantStatusPlaceholder(message.content);
    try {
      await this.adapter.updateMessage(message, content);
    } catch {
      messages = await this.adapter.refreshMessages();
      message = messages[messageIndex];
      if (
        !message ||
        !shouldEnsureAssistantStatusPlaceholder(
          messageIndex,
          message,
          variables,
        )
      ) {
        return;
      }
      await this.adapter.updateMessage(
        message,
        appendAssistantStatusPlaceholder(message.content),
      );
    }
    await this.adapter.refreshMessages();
  }

  private async withOwner<T>(
    owner: RuntimeScript | null,
    operation: () => T | Promise<T>,
  ): Promise<T> {
    const previous = this.activeScript;
    this.activeScript = owner;
    try {
      return await operation();
    } finally {
      this.activeScript = previous;
    }
  }

  private bindOwner<T extends (...args: never[]) => unknown>(
    owner: RuntimeScript | null,
    callback: T,
  ): T {
    const withOwner = this.withOwner.bind(this);
    const reportRuntimeError = this.reportRuntimeError.bind(this);
    return function (this: unknown, ...args: never[]) {
      return withOwner(owner, () => callback.apply(this, args)).catch(
        (error) => {
          reportRuntimeError(owner, error);
          return undefined;
        },
      );
    } as T;
  }

  private reportRuntimeError(
    owner: RuntimeScript | null,
    error: unknown,
  ): void {
    const resolvedOwner = owner ?? this.activeScript;
    const next = {
      sourceScope: resolvedOwner?.source.scope ?? ("card" as const),
      sourceId: resolvedOwner?.source.id ?? this.context.conversation.cardId,
      scriptId: resolvedOwner?.script.id ?? "runtime",
      scriptName: resolvedOwner?.script.name ?? "酒馆助手兼容层",
      message: errorMessage(error),
    };
    if (
      !this.errors.some(
        (current) =>
          current.scriptId === next.scriptId &&
          current.message === next.message,
      )
    ) {
      this.errors.push(next);
    }
    this.adapter.onStatusChanged({
      loading: false,
      loadedScriptIds: [...this.loadedScriptIds],
      errors: [...this.errors],
    });
  }

  private buttonEvent(name: string): string {
    const owner = this.requireActiveScript();
    return `tavern-helper-button:${owner.key}:${name}`;
  }

  private requireActiveScript(): RuntimeScript {
    if (this.activeScript) return this.activeScript;
    const candidates = this.context.sources.flatMap((source) =>
      source.trusted
        ? source.bundle.scripts
            .filter((script) => script.enabled && script.content.trim())
            .map((script) => ({
              source,
              script,
              key: scriptKey(source.scope, source.id, script.id),
            }))
        : [],
    );
    if (candidates.length === 1) return candidates[0]!;
    throw new Error(
      "This Tavern Helper API must be called from an active card or preset script.",
    );
  }

  private addListener(
    event: string,
    listener: EventListener,
    once = false,
    priority = 0,
  ): { stop: () => void } {
    const existing = this.listeners.get(event) ?? [];
    if (!existing.some((entry) => entry.listener === listener)) {
      existing.push({
        listener,
        owner: this.activeScript,
        once,
        priority,
        sequence: this.listenerSequence++,
      });
      existing.sort(
        (left, right) =>
          left.priority - right.priority || left.sequence - right.sequence,
      );
      this.listeners.set(event, existing);
    }
    return { stop: () => this.removeListener(event, listener) };
  }

  private removeListener(event: string, listener: EventListener): void {
    const remaining = (this.listeners.get(event) ?? []).filter(
      (entry) => entry.listener !== listener,
    );
    if (remaining.length === 0) this.listeners.delete(event);
    else this.listeners.set(event, remaining);
  }

  private variableStore(option: VariableOption): {
    variables: JsonRecord;
    persist: () => void;
  } {
    if (option.type === "global") {
      return {
        variables: this.context.variables.global,
        persist: () =>
          this.queuePersist("global", this.context.variables.global),
      };
    }
    if (option.type === "character") {
      return {
        variables: this.context.variables.character,
        persist: () =>
          this.queuePersist("character", this.context.variables.character),
      };
    }
    if (option.type === "preset") {
      return {
        variables: this.context.variables.preset,
        persist: () =>
          this.queuePersist("preset", this.context.variables.preset),
      };
    }
    if (option.type === "chat") {
      return {
        variables: this.context.variables.chat,
        persist: () => this.queuePersist("chat", this.context.variables.chat),
      };
    }
    if (option.type === "message") {
      const messages = this.adapter.getMessages();
      const floor =
        option.message_id === undefined || option.message_id === "latest"
          ? messages.length - 1
          : option.message_id < 0
            ? messages.length + option.message_id
            : option.message_id;
      const message = messages[floor];
      if (!message) throw new Error("Message variable floor is out of range.");
      const variables = (this.context.variables.messages[message.id] ??= {});
      return {
        variables,
        persist: () =>
          this.queuePersist("message", variables, { messageId: message.id }),
      };
    }
    if (option.type === "extension") {
      const variables = this.extensionVariables.get(option.extension_id) ?? {};
      this.extensionVariables.set(option.extension_id, variables);
      return {
        variables,
        persist: () =>
          this.queuePersist("extension", variables, {
            extensionId: option.extension_id,
          }),
      };
    }
    if (option.type !== "script") {
      throw new Error("Unsupported Tavern Helper variable type.");
    }
    const owner =
      option.script_id === undefined
        ? this.requireActiveScript()
        : this.context.sources
            .flatMap((source) =>
              source.bundle.scripts.map((script) => ({
                source,
                script,
                key: scriptKey(source.scope, source.id, script.id),
              })),
            )
            .find((candidate) => candidate.script.id === option.script_id);
    if (!owner)
      throw new Error(`Unknown Tavern Helper script '${option.script_id}'.`);
    const variables = (this.context.variables.scripts[owner.key] ??= {});
    return {
      variables,
      persist: () =>
        this.queuePersist("script", variables, {
          sourceScope: owner.source.scope,
          sourceId: owner.source.id,
          scriptId: owner.script.id,
        }),
    };
  }

  private replaceVariableStore(
    option: VariableOption,
    variables: JsonRecord,
  ): void {
    const schema =
      this.variableSchemas.get(this.variableSchemaKey(option)) ??
      (option.type === "message"
        ? this.variableSchemas.get("message:*")
        : undefined);
    if (schema) {
      variables = validateTavernHelperVariables(schema, variables);
    }
    const target = this.variableStore(option);
    Object.keys(target.variables).forEach(
      (key) => delete target.variables[key],
    );
    Object.assign(target.variables, clone(variables));
    target.persist();
  }

  private variableSchemaKey(option: VariableOption): string {
    if (option.type === "message")
      return option.message_id === undefined || option.message_id === "latest"
        ? "message:*"
        : `message:${String(option.message_id)}`;
    if (option.type === "script")
      return `script:${option.script_id ?? this.activeScript?.script.id ?? ""}`;
    if (option.type === "extension") return `extension:${option.extension_id}`;
    return option.type;
  }

  private queuePersist(
    namespace: TavernHelperStateNamespace,
    variables: JsonRecord,
    identifiers: {
      messageId?: string;
      sourceScope?: TavernHelperScope;
      sourceId?: string;
      scriptId?: string;
      extensionId?: string;
    } = {},
  ): void {
    const key = [
      namespace,
      identifiers.messageId,
      identifiers.sourceScope,
      identifiers.sourceId,
      identifiers.scriptId,
      identifiers.extensionId,
    ]
      .filter(Boolean)
      .join(":");
    const request: PersistRequest = {
      namespace,
      variables: clone(variables),
      identifiers,
    };
    if (namespace === "message" && identifiers.messageId !== undefined) {
      const view = this.legacyChatViews.get(identifiers.messageId);
      const message =
        view === undefined
          ? undefined
          : this.adapter.getMessages()[view.message_id];
      if (view && message?.id === identifiers.messageId) {
        const activeSwipeIndex = message.activeSwipeIndex ?? 0;
        while (view.variables.length <= activeSwipeIndex) {
          view.variables.push({});
        }
        view.variables[activeSwipeIndex] = clone(variables);
      }
    }
    this.pendingPersists.set(key, request);
    const previous = this.persistTimers.get(key);
    if (previous !== undefined) window.clearTimeout(previous);
    this.persistTimers.set(
      key,
      window.setTimeout(() => {
        this.persistTimers.delete(key);
        if (this.disposed) return;
        const pending = this.pendingPersists.get(key);
        if (!pending) return;
        this.pendingPersists.delete(key);
        this.persistState(pending);
      }, 120),
    );
  }

  async flushPersistence(): Promise<void> {
    for (const timer of this.persistTimers.values()) window.clearTimeout(timer);
    this.persistTimers.clear();
    const pending = [...this.pendingPersists.values()];
    this.pendingPersists.clear();
    pending.forEach((request) => this.persistState(request));
    await Promise.all([...this.activePersists]);
  }

  private persistState(request: PersistRequest): void {
    const operation = this.adapter
      .saveState({
        namespace: request.namespace,
        variables: request.variables,
        ...request.identifiers,
      })
      .catch((error) => {
        this.adapter.notify(
          `酒馆助手变量保存失败：${errorMessage(error)}`,
          "warning",
        );
      });
    this.activePersists.add(operation);
    void operation.then(() => this.activePersists.delete(operation));
  }

  private publishButtons(): void {
    const buttons: TavernHelperRuntimeButton[] = [];
    for (const source of this.context.sources) {
      if (!source.trusted) continue;
      for (const script of source.bundle.scripts) {
        if (!script.enabled || !script.buttonEnabled) continue;
        const key = scriptKey(source.scope, source.id, script.id);
        (this.buttons.get(key) ?? []).forEach((button, index) => {
          if (!button.visible) return;
          buttons.push({
            id: `${key}:${String(index)}`,
            name: button.name,
            visible: true,
            sourceScope: source.scope,
            sourceId: source.id,
            scriptId: script.id,
            scriptName: script.name,
          });
        });
      }
    }
    this.adapter.onButtonsChanged(buttons);
  }

  private messageView(message: WorkspaceMessage, messageId: number) {
    const next = createTavernHelperMessageView(
      message,
      messageId,
      this.context.variables.messages[message.id] ?? {},
      this.context.sources.find((source) => source.scope === "card")?.name ??
        "Assistant",
    );
    const current = this.messageViews.get(message.id);
    if (!current) {
      this.messageViews.set(message.id, next);
      return next;
    }
    Object.assign(current, next);
    return current;
  }

  private legacyChatView(message: WorkspaceMessage, messageId: number) {
    const next = this.messageView(message, messageId);
    const current = this.legacyChatViews.get(message.id);
    if (!current) {
      const created = {
        ...next,
        variables: clone(next.swipes_data),
      };
      this.legacyChatViews.set(message.id, created);
      return created;
    }
    const variables = current.variables;
    Object.assign(current, next);
    current.variables = variables;
    return current;
  }

  private persistLegacyChatVariables(): void {
    const messages = this.adapter.getMessages();
    const messagesById = new Map(
      messages.map((message) => [message.id, message] as const),
    );
    for (const [messageId, view] of this.legacyChatViews) {
      const message = messagesById.get(messageId);
      if (!message) continue;
      const variables = resolveTavernHelperMessageVariables(
        { swipes_data: view.variables },
        message.activeSwipeIndex ?? 0,
      );
      if (
        variables === undefined ||
        _.isEqual(this.context.variables.messages[messageId] ?? {}, variables)
      ) {
        continue;
      }
      this.context.variables.messages[messageId] = variables;
      this.queuePersist("message", variables, { messageId });
    }
  }

  private async setChatMessages(
    updates: Array<Record<string, unknown> & { message_id: number }>,
  ): Promise<void> {
    const messages = this.adapter.getMessages();
    const variableUpdateIndexes = new Set<number>();
    for (const update of updates) {
      const message = messages[update.message_id];
      if (!message) continue;
      if (
        typeof update.message === "string" &&
        update.message !== message.content
      ) {
        await this.adapter.updateMessage(message, update.message);
      }
      const variables = resolveTavernHelperMessageVariables(
        update,
        message.activeSwipeIndex ?? 0,
      );
      if (variables !== undefined) {
        this.context.variables.messages[message.id] = variables;
        this.queuePersist("message", variables, { messageId: message.id });
        variableUpdateIndexes.add(update.message_id);
      }
    }
    await this.adapter.refreshMessages();
    for (const messageIndex of variableUpdateIndexes) {
      await this.reconcileAssistantMessage(messageIndex);
    }
  }

  private async generate(config: JsonRecord): Promise<string> {
    await this.emit(iframeEvents.GENERATION_STARTED);
    const injects = await this.activePromptInjections();
    if (Array.isArray(config.injects)) {
      for (const item of config.injects) {
        const value = asRecord(item);
        if (
          (value.role === "system" ||
            value.role === "assistant" ||
            value.role === "user") &&
          typeof value.content === "string"
        ) {
          injects.push({
            role: value.role,
            content: value.content,
            depth: typeof value.depth === "number" ? value.depth : 0,
          });
        }
      }
    }
    const settings = asRecord(config.settings);
    const content = await this.adapter.generate({
      ...(typeof config.user_input === "string"
        ? { userInput: config.user_input }
        : {}),
      ...(Object.keys(settings).length > 0 ? { settings } : {}),
      injects,
    });
    await this.emit(iframeEvents.STREAM_TOKEN_RECEIVED_FULLY, content);
    await this.emit(iframeEvents.GENERATION_ENDED, content);
    return content;
  }

  private installGlobals(): () => void {
    const global = window as unknown as Record<string, unknown>;
    const previous = new Map<string, PropertyDescriptor | undefined>();
    const installed = new Map<string, unknown>();
    const existingRoster = document.getElementById("tavern_helper");
    const roster = existingRoster ?? document.createElement("div");
    if (!existingRoster) {
      roster.id = "tavern_helper";
      roster.hidden = true;
      roster.dataset.stnNative = "true";
      document.body.append(roster);
    }
    for (const source of this.context.sources) {
      if (!source.trusted) continue;
      for (const script of source.bundle.scripts) {
        if (!script.enabled || !script.content.trim()) continue;
        const item = document.createElement("div");
        item.dataset.scriptId = script.id;
        item.dataset.sourceScope = source.scope;
        item.dataset.sourceId = source.id;
        item.dataset.stnNativeRuntime = this.runtimeId;
        roster.append(item);
      }
    }
    const expose = (name: string, value: unknown) => {
      previous.set(name, Object.getOwnPropertyDescriptor(global, name));
      installed.set(name, value);
      if (
        (typeof value === "object" && value !== null) ||
        typeof value === "function"
      ) {
        nativeRuntimeGlobals.add(value);
      }
      Object.defineProperty(global, name, {
        configurable: true,
        enumerable: true,
        writable: true,
        value,
      });
    };
    const jqueryTarget = $ as unknown as (...args: unknown[]) => unknown;
    const ownerAwareJQuery = new Proxy(jqueryTarget, {
      apply: (
        target: typeof jqueryTarget,
        thisArg: unknown,
        argumentsList: unknown[],
      ) => {
        const owner = this.activeScript;
        const args: unknown[] = [...argumentsList];
        if (typeof args[0] === "function") {
          args[0] = this.bindOwner(
            owner,
            args[0] as (...values: never[]) => unknown,
          );
        }
        return Reflect.apply(target, thisArg, args);
      },
    }) as unknown as typeof $;
    const eventOn = (event: string, listener: EventListener) =>
      this.addListener(event, listener);
    const eventOnce = (event: string, listener: EventListener) =>
      this.addListener(event, listener, true);
    const eventMakeFirst = (event: string, listener: EventListener) =>
      this.addListener(event, listener, false, -1);
    const eventMakeLast = (event: string, listener: EventListener) =>
      this.addListener(event, listener, false, 1);
    const eventEmit = (event: string, ...values: unknown[]) =>
      this.emit(event, ...values);
    const lastMessageId = () => this.adapter.getMessages().length - 1;
    const getBoundCurrentMessageId = function (this: Window) {
      const runtimeWindow = this as Window & { __TH_IFRAME_ID?: string };
      const frameName =
        runtimeWindow.__TH_IFRAME_ID ??
        this.frameElement?.id ??
        this.frameElement?.getAttribute("name") ??
        this.name;
      return resolveTavernHelperFrameMessageId(frameName, lastMessageId());
    };
    const getVariables = (option: VariableOption) =>
      clone(this.variableStore(option).variables);
    const getAllVariables = () => {
      const messages = this.adapter.getMessages();
      return clone(
        Object.assign(
          {},
          this.context.variables.global,
          this.context.variables.character,
          this.context.variables.preset,
          this.context.variables.chat,
          messages.length > 0
            ? this.variableStore({ type: "message", message_id: "latest" })
                .variables
            : {},
        ) as JsonRecord,
      );
    };
    const replaceVariables = (variables: JsonRecord, option: VariableOption) =>
      this.replaceVariableStore(option, asRecord(variables));
    const updateVariablesWith = async (
      updater: (variables: JsonRecord) => JsonRecord | Promise<JsonRecord>,
      option: VariableOption,
    ) => {
      const result = await updater(getVariables(option));
      replaceVariables(result, option);
      return clone(result);
    };
    const insertOrAssignVariables = (
      variables: JsonRecord,
      option: VariableOption,
    ) => {
      const result = asRecord(_.merge(getVariables(option), clone(variables)));
      replaceVariables(result, option);
      return result;
    };
    const insertVariables = (variables: JsonRecord, option: VariableOption) => {
      const result = asRecord(
        _.defaultsDeep(getVariables(option), clone(variables)),
      );
      replaceVariables(result, option);
      return result;
    };
    const deleteVariable = (path: string, option: VariableOption) => {
      const result = getVariables(option);
      const deleteOccurred = _.has(result, path);
      _.unset(result, path);
      replaceVariables(result, option);
      return { variables: result, delete_occurred: deleteOccurred };
    };
    const registerVariableSchema = (
      schema: z.ZodType,
      option: VariableOption = { type: "chat" },
    ) => {
      this.variableSchemas.set(this.variableSchemaKey(option), schema);
      if (option.type === "message") {
        window.setTimeout(() => {
          if (this.disposed) return;
          void this.reconcileAssistantBacklog().catch((error) =>
            this.reportRuntimeError(this.activeScript, error),
          );
        }, 0);
      }
      return {
        unregister: () =>
          this.variableSchemas.delete(this.variableSchemaKey(option)),
      };
    };
    const registerMacroLike = (
      name: string,
      replacement: string | ((...values: string[]) => unknown),
    ) => {
      this.macroLike.set(name, replacement);
      return { unregister: () => this.macroLike.delete(name) };
    };
    const unregisterMacroLike = (name: string) => this.macroLike.delete(name);
    const initializeGlobal = (name: string, value: unknown) => {
      global[name] = value;
      installed.set(name, value);
      if (
        (typeof value === "object" && value !== null) ||
        typeof value === "function"
      ) {
        nativeRuntimeGlobals.add(value);
      }
      const initialized = Promise.resolve(value);
      this.initializedGlobals.set(name, initialized);
      void this.emit(`global_${name}_initialized`, value);
    };
    const waitGlobalInitialized = async (name: string) => {
      if (Object.prototype.hasOwnProperty.call(global, name)) return;
      await new Promise<void>((resolve) => {
        this.addListener(`global_${name}_initialized`, () => resolve(), true);
      });
    };
    const nativeMvuParser = async (_message: string, oldData: JsonRecord) =>
      clone(oldData);
    this.nativeMvuParser = nativeMvuParser;
    const mvu = {
      events: mvuEvents,
      getMvuData: (
        option: VariableOption = { type: "message", message_id: "latest" },
      ) => getVariables(option),
      replaceMvuData: async (
        variables: JsonRecord,
        option: VariableOption = { type: "message", message_id: "latest" },
      ) => {
        const before = getVariables(option);
        await this.emit(mvuEvents.VARIABLE_UPDATE_STARTED, before);
        replaceVariables(variables, option);
        const updated = getVariables(option);
        await this.emit(mvuEvents.VARIABLE_UPDATE_ENDED, updated, before);
        await this.emit(mvuEvents.BEFORE_MESSAGE_UPDATE, {
          variables: updated,
          message_content: "",
        });
        document.dispatchEvent(
          new CustomEvent(mvuEvents.VARIABLE_UPDATE_ENDED, {
            detail: clone(updated),
          }),
        );
        return updated;
      },
      parseMessage: nativeMvuParser,
      isDuringExtraAnalysis: () => false,
    };
    this.initializedGlobals.set("Mvu", Promise.resolve(mvu));
    const getScriptButtons = () =>
      clone(this.buttons.get(this.requireActiveScript().key) ?? []);
    const replaceScriptButtons = (
      buttons: Array<{ name: string; visible: boolean }>,
    ) => {
      this.buttons.set(
        this.requireActiveScript().key,
        buttons.map((button) => ({
          name: String(button.name),
          visible: button.visible !== false,
        })),
      );
      this.publishButtons();
    };
    const updateScriptButtonsWith = async (
      updater: (
        buttons: Array<{ name: string; visible: boolean }>,
      ) =>
        | Array<{ name: string; visible: boolean }>
        | Promise<Array<{ name: string; visible: boolean }>>,
    ) => {
      const result = await updater(getScriptButtons());
      replaceScriptButtons(result);
      return result;
    };
    const appendInexistentScriptButtons = (
      buttons: Array<{ name: string; visible: boolean }>,
    ) => {
      const current = getScriptButtons();
      const names = new Set(current.map((button) => button.name));
      replaceScriptButtons([
        ...current,
        ...buttons.filter((button) => !names.has(button.name)),
      ]);
    };
    const audioState = (type: "bgm" | "ambient") => this.audio.get(type)!;
    const playAudio = (
      type: "bgm" | "ambient",
      item: { title?: string; url: string },
    ) => {
      const state = audioState(type);
      const title =
        item.title ||
        decodeURIComponent(item.url.split("/").at(-1) ?? item.url);
      if (
        !state.playlist.some(
          (candidate) =>
            candidate.url === item.url || candidate.title === title,
        )
      ) {
        state.playlist.push({ title, url: item.url });
      }
      state.current = item.url;
      state.element?.pause();
      const element = new Audio(item.url);
      element.muted = state.settings.muted;
      element.volume = _.clamp(state.settings.volume, 0, 1);
      state.element = element;
      if (state.settings.enabled) void element.play().catch(() => undefined);
    };
    const pauseAudio = (type: "bgm" | "ambient") =>
      audioState(type).element?.pause();
    const replaceAudioList = (
      type: "bgm" | "ambient",
      items: Array<{ title?: string; url: string }>,
    ) => {
      audioState(type).playlist = items.map((item) => ({
        title:
          item.title ||
          decodeURIComponent(item.url.split("/").at(-1) ?? item.url),
        url: item.url,
      }));
    };
    const appendAudioList = (
      type: "bgm" | "ambient",
      items: Array<{ title?: string; url: string }>,
    ) => {
      const state = audioState(type);
      const urls = new Set(state.playlist.map((item) => item.url));
      state.playlist.push(
        ...items
          .filter((item) => !urls.has(item.url))
          .map((item) => ({
            title:
              item.title ||
              decodeURIComponent(item.url.split("/").at(-1) ?? item.url),
            url: item.url,
          })),
      );
    };
    const getChatMessages = (
      range: string | number,
      option: {
        role?: "all" | "system" | "assistant" | "user";
        hide_state?: "all" | "hidden" | "unhidden";
        include_swipes?: boolean;
      } = {},
    ) => {
      const messages = this.adapter.getMessages();
      return selectMessageIndexes(range, messages.length)
        .map((index) => this.messageView(messages[index]!, index))
        .filter(
          (message) =>
            option.role === undefined ||
            option.role === "all" ||
            message.role === option.role,
        )
        .map((message) =>
          option.include_swipes
            ? message
            : _.omit(
                message,
                "swipe_id",
                "swipes",
                "swipes_data",
                "swipes_info",
              ),
        );
    };
    const createChatMessages = async (
      messages: Array<{
        role: "system" | "assistant" | "user";
        message: string;
        data?: JsonRecord;
      }>,
      option: {
        insert_at?: number | "end";
        insert_before?: number | "end";
      } = {},
    ) => {
      const insertBefore = option.insert_at ?? option.insert_before ?? "end";
      if (
        insertBefore !== "end" &&
        insertBefore !== this.adapter.getMessages().length
      ) {
        throw new Error(
          "SillyTavernN currently persists new script messages at the end of the conversation; middle insertion is unavailable.",
        );
      }
      for (const input of messages) {
        if (input.role === "system") {
          throw new Error(
            "Creating a visible system floor is unsupported because SillyTavernN keeps system prompts outside the user/assistant transcript.",
          );
        }
        const created = await this.adapter.createMessage({
          role: input.role,
          content: String(input.message),
          ...(this.adapter.getMessages().at(-1)?.id
            ? { parentMessageId: this.adapter.getMessages().at(-1)!.id }
            : {}),
        });
        if (input.data !== undefined) {
          const variables = asRecord(clone(input.data));
          this.context.variables.messages[created.id] = variables;
          this.queuePersist("message", variables, { messageId: created.id });
        }
        const floor = this.adapter.getMessages().length - 1;
        await this.emit(
          input.role === "user"
            ? tavernEvents.MESSAGE_SENT
            : tavernEvents.MESSAGE_RECEIVED,
          floor,
          "extension",
        );
        await this.emit(
          input.role === "user"
            ? tavernEvents.USER_MESSAGE_RENDERED
            : tavernEvents.CHARACTER_MESSAGE_RENDERED,
          floor,
        );
      }
      await this.adapter.refreshMessages();
    };
    const deleteChatMessages = async (messageIds: number[]) => {
      const current = this.adapter.getMessages();
      const normalized = [
        ...new Set(
          messageIds
            .map((id) => (id < 0 ? current.length + id : id))
            .filter(
              (id) => Number.isInteger(id) && id >= 0 && id < current.length,
            ),
        ),
      ].sort((left, right) => right - left);
      for (const floor of normalized) {
        const message = this.adapter.getMessages()[floor];
        if (!message) continue;
        await this.adapter.deleteMessage(message);
        delete this.context.variables.messages[message.id];
        await this.emit(tavernEvents.MESSAGE_DELETED, floor);
      }
      await this.adapter.refreshMessages();
    };
    const rotateChatMessages = async (
      begin: number,
      middle: number,
      end: number,
    ) => {
      if (begin === middle || middle === end) return;
      throw new Error(
        "Rotating persisted chat floors is unavailable because SillyTavernN preserves stable message identities and parent links.",
      );
    };
    const worldbooks = this.context.worldbooks ?? [];
    const getLorebookSettings = () => ({
      selected_global_lorebooks: worldbooks
        .filter((worldbook) =>
          worldbook.bindings.some((binding) => binding.scopeType === "global"),
        )
        .map((worldbook) => worldbook.name),
      scan_depth: 4,
      context_percentage: 25,
      budget_cap: 0,
      min_activations: 0,
      max_depth: 0,
      max_recursion_steps: 0,
      insertion_strategy: "evenly" as const,
      include_names: false,
      recursive: true,
      case_sensitive: false,
      match_whole_words: false,
      use_group_scoring: false,
      overflow_alert: false,
    });
    const getCharLorebooks = () => {
      const names = worldbooks
        .filter((worldbook) =>
          worldbook.bindings.some(
            (binding) =>
              binding.scopeType === "card" &&
              binding.scopeId === this.context.conversation.cardId,
          ),
        )
        .map((worldbook) => worldbook.name);
      return { primary: names[0] ?? null, additional: names.slice(1) };
    };
    const getLorebookEntries = async (name: string) => {
      const worldbook = worldbooks.find(
        (candidate) => candidate.name === name || candidate.id === name,
      );
      if (!worldbook) throw new Error(`Unknown worldbook '${name}'.`);
      return worldbook.entries.map((entry, index) => {
        const metadata = asRecord(entry.metadata);
        const extensions = asRecord(metadata.extensions);
        const insertionPosition =
          typeof metadata.insertionPosition === "string"
            ? metadata.insertionPosition
            : "before-card";
        const position = {
          "before-card": "before_character_definition",
          "after-card": "after_character_definition",
          "before-examples": "before_example_messages",
          "after-examples": "after_example_messages",
          "before-history": "before_author_note",
          "after-history": "after_author_note",
          "at-depth": `at_depth_as_${
            typeof metadata.insertionRole === "string"
              ? metadata.insertionRole
              : "system"
          }`,
        }[insertionPosition];
        const secondaryLogic = {
          any: "and_any",
          all: "and_all",
          "not-any": "not_any",
          "not-all": "not_all",
        }[
          typeof metadata.secondaryLogic === "string"
            ? metadata.secondaryLogic
            : "any"
        ];
        return {
          uid: entry.legacyUid ?? index,
          display_index:
            typeof extensions.display_index === "number"
              ? extensions.display_index
              : index,
          comment:
            typeof metadata.label === "string"
              ? metadata.label
              : `条目 ${String(index + 1)}`,
          enabled: entry.enabled,
          type:
            metadata.constant === true
              ? "constant"
              : extensions.vectorized === true
                ? "vectorized"
                : "selective",
          position: position ?? "before_character_definition",
          depth:
            typeof metadata.insertionDepth === "number"
              ? metadata.insertionDepth
              : null,
          order:
            typeof metadata.legacyInsertionOrder === "number"
              ? metadata.legacyInsertionOrder
              : entry.position,
          probability:
            typeof extensions.probability === "number"
              ? extensions.probability
              : 100,
          keys: clone(entry.keys),
          logic: secondaryLogic ?? "and_any",
          filters: Array.isArray(metadata.secondaryKeys)
            ? clone(metadata.secondaryKeys)
            : [],
          scan_depth:
            typeof metadata.scanDepth === "number"
              ? metadata.scanDepth
              : "same_as_global",
          case_sensitive:
            typeof metadata.caseSensitive === "boolean"
              ? metadata.caseSensitive
              : "same_as_global",
          match_whole_words:
            typeof metadata.matchWholeWords === "boolean"
              ? metadata.matchWholeWords
              : "same_as_global",
          use_group_scoring:
            typeof extensions.use_group_scoring === "boolean"
              ? extensions.use_group_scoring
              : "same_as_global",
          automation_id:
            typeof extensions.automation_id === "string"
              ? extensions.automation_id
              : null,
          exclude_recursion: metadata.excludeRecursion === true,
          prevent_recursion: metadata.preventRecursion === true,
          delay_until_recursion:
            metadata.delayUntilRecursion === true ? true : false,
          content: entry.content,
          group: typeof extensions.group === "string" ? extensions.group : "",
          group_prioritized: extensions.group_override === true,
          group_weight:
            typeof extensions.group_weight === "number"
              ? extensions.group_weight
              : 100,
          sticky:
            typeof extensions.sticky === "number" && extensions.sticky > 0
              ? extensions.sticky
              : null,
          cooldown:
            typeof extensions.cooldown === "number" && extensions.cooldown > 0
              ? extensions.cooldown
              : null,
          delay:
            typeof extensions.delay === "number" && extensions.delay > 0
              ? extensions.delay
              : null,
        };
      });
    };
    const injectPrompts = (
      prompts: Array<{
        id?: string;
        role: "system" | "assistant" | "user";
        content: string;
        depth?: number;
        filter?: () => boolean | Promise<boolean>;
      }>,
      options: { once?: boolean } = {},
    ) => {
      const id = createBrowserIdentifier();
      this.injections.set(id, {
        prompts: prompts.map((prompt) => ({
          role: prompt.role,
          content: prompt.content,
          depth: prompt.depth ?? 0,
          ...(prompt.filter ? { filter: prompt.filter } : {}),
        })),
        once: options.once === true,
      });
      return { uninject: () => this.injections.delete(id) };
    };
    const substituteMacros = (text: string) => {
      if (this.context.settings?.developer.macrosEnabled === false) return text;
      let result = text
        .replaceAll(
          "{{lastMessageId}}",
          String(this.adapter.getMessages().length - 1),
        )
        .replaceAll(
          "{{char}}",
          this.context.sources.find((source) => source.scope === "card")
            ?.name ?? "",
        );
      for (const [name, replacement] of this.macroLike) {
        const pattern = new RegExp(
          `\\{\\{${name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?:::(.*?))?\\}\\}`,
          "gu",
        );
        result = result.replace(pattern, (_match, parameter: string = "") =>
          String(
            typeof replacement === "function"
              ? replacement(...parameter.split("::"))
              : replacement,
          ),
        );
      }
      return result;
    };
    const cardSources = this.context.sources.filter(
      (source) => source.scope === "card",
    );
    const presetSources = this.context.sources.filter(
      (source) => source.scope === "preset",
    );
    const currentPreset = () => this.context.preset;
    const getPreset = (name = "in_use") => {
      const preset = currentPreset();
      if (!preset) return null;
      if (name !== "in_use" && name !== preset.name) return null;
      return clone(preset.value);
    };
    const replacePreset = async (
      name: string,
      value: Record<string, unknown>,
    ) => {
      const preset = currentPreset();
      if (!preset || (name !== "in_use" && name !== preset.name)) {
        throw new Error(`Unknown preset '${name}'.`);
      }
      if (!this.adapter.replacePreset) {
        throw new Error(
          "The current host cannot persist Tavern Helper presets.",
        );
      }
      const updated = await this.adapter.replacePreset({
        presetId: preset.id,
        expectedRevision: preset.revision,
        preset: clone(value),
      });
      this.context.preset = updated;
      const source = presetSources.find(
        (candidate) => candidate.id === updated.id,
      );
      if (source) {
        source.name = updated.name;
        source.revision = updated.revision;
      }
      return clone(updated.value);
    };
    const updatePresetWith = async (
      name: string,
      updater: (
        preset: Record<string, unknown>,
      ) => Record<string, unknown> | Promise<Record<string, unknown>>,
    ) => {
      const preset = getPreset(name);
      if (!preset) throw new Error(`Unknown preset '${name}'.`);
      return replacePreset(name, await updater(preset));
    };
    const helper = {
      getChatMessages,
      setChatMessages: (
        messages: Array<Record<string, unknown> & { message_id: number }>,
      ) => this.setChatMessages(messages),
      setChatMessage: (
        values: { message?: string; data?: JsonRecord },
        messageId: number,
      ) => this.setChatMessages([{ message_id: messageId, ...values }]),
      createChatMessages,
      deleteChatMessages,
      rotateChatMessages,
      getLastMessageId: () => this.adapter.getMessages().length - 1,
      getMessageId: () => this.adapter.getMessages().length - 1,
      getCurrentMessageId: () => this.adapter.getMessages().length - 1,
      getAllVariables,
      registerVariableSchema,
      getLorebookSettings,
      setLorebookSettings: () => undefined,
      getLorebooks: () => worldbooks.map((worldbook) => worldbook.name),
      getWorldbookNames: () => worldbooks.map((worldbook) => worldbook.name),
      getGlobalWorldbookNames: () =>
        getLorebookSettings().selected_global_lorebooks,
      getCharLorebooks,
      getCharWorldbookNames: getCharLorebooks,
      getCurrentCharPrimaryLorebook: () => getCharLorebooks().primary,
      getChatLorebook: () =>
        worldbooks.find((worldbook) =>
          worldbook.bindings.some(
            (binding) =>
              binding.scopeType === "conversation" &&
              binding.scopeId === this.context.conversation.id,
          ),
        )?.name ?? null,
      getChatWorldbookName: () =>
        worldbooks.find((worldbook) =>
          worldbook.bindings.some(
            (binding) =>
              binding.scopeType === "conversation" &&
              binding.scopeId === this.context.conversation.id,
          ),
        )?.name ?? null,
      getLorebookEntries,
      getWorldbook: getLorebookEntries,
      getCharacterNames: () => cardSources.map((source) => source.name),
      getCharacterIds: () => cardSources.map((source) => source.id),
      getCurrentCharacterName: () => cardSources[0]?.name ?? null,
      getCurrentCharacterId: () => cardSources[0]?.id ?? null,
      getPreset,
      getPresetNames: () =>
        clone(
          this.context.presetNames ??
            presetSources.map((source) => source.name),
        ),
      getLoadedPresetName: () =>
        currentPreset()?.name ?? presetSources[0]?.name ?? "",
      loadPreset: (name: string) => name === currentPreset()?.name,
      replacePreset,
      createOrReplacePreset: replacePreset,
      updatePresetWith,
      getVariables,
      replaceVariables,
      updateVariablesWith,
      insertOrAssignVariables,
      insertVariables,
      deleteVariable,
      generate: (config: JsonRecord) => this.generate(config),
      generateRaw: (config: JsonRecord) => this.generate(config),
      injectPrompts,
      uninjectPrompts: (ids: string[]) =>
        ids.forEach((id) => this.injections.delete(id)),
      registerMacroLike,
      unregisterMacroLike,
      initializeGlobal,
      waitGlobalInitialized,
      playAudio,
      pauseAudio,
      getAudioList: (type: "bgm" | "ambient") =>
        clone(audioState(type).playlist),
      replaceAudioList,
      appendAudioList,
      getAudioSettings: (type: "bgm" | "ambient") =>
        clone(audioState(type).settings),
      setAudioSettings: (
        type: "bgm" | "ambient",
        settings: Partial<{
          enabled: boolean;
          mode: "repeat_one" | "repeat_all" | "shuffle" | "play_one_and_stop";
          muted: boolean;
          volume: number;
        }>,
      ) => {
        Object.assign(audioState(type).settings, settings);
        const element = audioState(type).element;
        if (element) {
          element.muted = audioState(type).settings.muted;
          element.volume = _.clamp(audioState(type).settings.volume, 0, 1);
        }
      },
      getCurrentAudio: (type: "bgm" | "ambient") => {
        const state = audioState(type);
        const current = state.playlist.find(
          (item) => item.url === state.current,
        );
        return {
          src: state.current,
          title: current?.title ?? "",
          playing: state.element ? !state.element.paused : false,
          progress: state.element?.currentTime ?? 0,
        };
      },
      getTavernHelperVersion: () => `${TAVERN_HELPER_COMPAT_VERSION}-native`,
      getTavernHelperExtensionId: () => "stn-native-tavern-helper",
      getTavernVersion: () => "SillyTavernN",
      substitudeMacros: substituteMacros,
      errorCatched:
        <T extends unknown[], R>(fn: (...args: T) => R) =>
        (...args: T) => {
          try {
            return fn(...args);
          } catch (error) {
            this.adapter.notify(errorMessage(error), "warning");
            throw error;
          }
        },
    };
    const scriptApi = {
      getButtonEvent: (name: string) => this.buttonEvent(name),
      getScriptButtons,
      replaceScriptButtons,
      updateScriptButtonsWith,
      appendInexistentScriptButtons,
      getScriptId: () => this.requireActiveScript().script.id,
      getScriptName: () => this.requireActiveScript().script.name,
      getScriptInfo: () => {
        const owner = this.requireActiveScript();
        return this.scriptInfo.get(owner.key) ?? owner.script.info;
      },
      replaceScriptInfo: (info: string) => {
        const owner = this.requireActiveScript();
        this.scriptInfo.set(owner.key, String(info));
      },
      getAllEnabledScriptButtons: () =>
        Object.fromEntries(
          this.context.sources.flatMap((source) =>
            source.bundle.scripts
              .filter((script) => source.trusted && script.enabled)
              .map((script) => {
                const key = scriptKey(source.scope, source.id, script.id);
                return [
                  script.id,
                  (this.buttons.get(key) ?? [])
                    .filter((button) => button.visible)
                    .map((button, index) => ({
                      button_id: `${key}:${String(index)}`,
                      button_name: button.name,
                    })),
                ];
              }),
          ),
        ),
    };
    const eventApi = {
      eventOn,
      eventOnButton: eventOn,
      eventOnce,
      eventMakeFirst,
      eventMakeLast,
      eventEmit,
      eventEmitAndWait: eventEmit,
      eventRemoveListener: (event: string, listener: EventListener) =>
        this.removeListener(event, listener),
      eventClearEvent: (event: string) => this.listeners.delete(event),
      eventClearListener: (listener: EventListener) => {
        for (const event of this.listeners.keys())
          this.removeListener(event, listener);
      },
      eventClearAll: () => this.listeners.clear(),
    };
    const tavernHelperObject = {
      ...helper,
      ...scriptApi,
      ...eventApi,
      tavern_events: tavernEvents,
      iframe_events: iframeEvents,
      _bind: {
        _eventOn: eventOn,
        _eventOnButton: eventOn,
        _eventMakeFirst: eventMakeFirst,
        _eventMakeLast: eventMakeLast,
        _eventOnce: eventOnce,
        _eventEmit: eventEmit,
        _eventEmitAndWait: eventEmit,
        _eventRemoveListener: (event: string, listener: EventListener) =>
          this.removeListener(event, listener),
        _eventClearEvent: (event: string) => this.listeners.delete(event),
        _eventClearListener: (listener: EventListener) => {
          for (const event of this.listeners.keys())
            this.removeListener(event, listener);
        },
        _eventClearAll: () => this.listeners.clear(),
        _initializeGlobal: initializeGlobal,
        _waitGlobalInitialized: waitGlobalInitialized,
        _registerMacroLike: registerMacroLike,
        _getButtonEvent: scriptApi.getButtonEvent,
        _getScriptButtons: getScriptButtons,
        _replaceScriptButtons: replaceScriptButtons,
        _updateScriptButtonsWith: updateScriptButtonsWith,
        _appendInexistentScriptButtons: appendInexistentScriptButtons,
        _getScriptName: scriptApi.getScriptName,
        _getScriptInfo: scriptApi.getScriptInfo,
        _replaceScriptInfo: scriptApi.replaceScriptInfo,
        _getVariables: getVariables,
        _getAllVariables: getAllVariables,
        _replaceVariables: replaceVariables,
        _updateVariablesWith: updateVariablesWith,
        _insertOrAssignVariables: insertOrAssignVariables,
        _insertVariables: insertVariables,
        _deleteVariable: deleteVariable,
        _getScriptId: scriptApi.getScriptId,
        _getCurrentMessageId: getBoundCurrentMessageId,
      },
    };
    const popupType = {
      TEXT: 1,
      CONFIRM: 2,
      INPUT: 3,
      DISPLAY: 4,
      CROP: 5,
    };
    const extensionSettings = this.extensionVariables.get("sillytavern") ?? {};
    this.extensionVariables.set("sillytavern", extensionSettings);
    const connection = this.adapter.connection;
    const chatCompletionSettings: JsonRecord = {
      chat_completion_source: "custom",
      custom_url: connection?.baseUrl ?? "",
      custom_model: connection?.model ?? "",
      openai_model: connection?.model ?? "",
      stream_openai:
        this.context.preset?.value.settings &&
        typeof this.context.preset.value.settings === "object" &&
        !Array.isArray(this.context.preset.value.settings)
          ? asRecord(this.context.preset.value.settings).should_stream !== false
          : true,
      ...(connection?.hasApiKey ? { api_key_present: true } : {}),
    };
    const presetSettings = asRecord(this.context.preset?.value.settings);
    chatCompletionSettings.openai_max_tokens =
      presetSettings.max_completion_tokens;
    chatCompletionSettings.temp_openai = presetSettings.temperature;
    chatCompletionSettings.top_p_openai = presetSettings.top_p;
    const sillyTavern = {
      mainApi: "openai",
      chatCompletionSettings,
      name1: "User",
      name2:
        this.context.sources.find((source) => source.scope === "card")?.name ??
        "Assistant",
      characters: this.context.sources
        .filter((source) => source.scope === "card")
        .map((source) => ({ name: source.name, avatar: source.id })),
      extensionSettings,
      getCurrentChatId: () => this.context.conversation.id,
      getChatCompletionModel: () =>
        typeof chatCompletionSettings.custom_model === "string"
          ? chatCompletionSettings.custom_model
          : "",
      saveChat: async () => {
        this.persistLegacyChatVariables();
        await this.flushPersistence();
      },
      saveSettingsDebounced: () =>
        this.queuePersist("extension", extensionSettings, {
          extensionId: "sillytavern",
        }),
      getRequestHeaders: () => ({ "Content-Type": "application/json" }),
      ToolManager: {
        isToolCallingSupported: () => false,
      },
      registerFunctionTool: () => undefined,
      unregisterFunctionTool: () => undefined,
      POPUP_TYPE: popupType,
      POPUP_RESULT: {
        AFFIRMATIVE: 1,
        NEGATIVE: 0,
        CANCELLED: -1,
      },
      callGenericPopup: async (
        content: unknown,
        type: number,
        inputValue = "",
      ) => {
        const message =
          typeof content === "string"
            ? content
            : content instanceof Element
              ? (content.textContent ?? "")
              : String(content);
        if (type === popupType.CONFIRM) {
          const result = tavernHelperConfirmResult(window.confirm(message));
          // Some legacy scripts mutate SillyTavern.chat after a negative
          // confirmation without calling saveChat(). Persist that mutation
          // after their awaited popup continuation has run.
          window.setTimeout(() => {
            if (this.disposed) return;
            this.persistLegacyChatVariables();
          }, 0);
          return result;
        }
        if (type === popupType.INPUT)
          return window.prompt(message, inputValue) ?? undefined;
        window.alert(message);
        return true;
      },
      getContext: () => sillyTavern,
    };
    Object.defineProperty(sillyTavern, "chat", {
      configurable: false,
      enumerable: true,
      get: () =>
        this.adapter
          .getMessages()
          .map((message, index) => this.legacyChatView(message, index)),
    });
    expose("$", ownerAwareJQuery);
    expose("jQuery", ownerAwareJQuery);
    expose("_", _);
    expose("Vue", Vue);
    expose("YAML", YAML);
    expose("z", z);
    expose("toastr", scriptToastr);
    expose("Mvu", mvu);
    expose("TavernHelper", tavernHelperObject);
    expose("SillyTavern", sillyTavern);
    Object.entries(tavernHelperObject).forEach(([name, value]) =>
      expose(name, value),
    );
    return () => {
      roster.querySelectorAll("[data-stn-native-runtime]").forEach((item) => {
        if ((item as HTMLElement).dataset.stnNativeRuntime === this.runtimeId) {
          item.remove();
        }
      });
      if (roster.dataset.stnNative === "true" && !roster.hasChildNodes()) {
        roster.remove();
      }
      for (const [name, descriptor] of previous) {
        if (global[name] !== installed.get(name)) continue;
        const priorValue: unknown = descriptor?.value as unknown;
        if (
          descriptor &&
          !(
            ((typeof priorValue === "object" && priorValue !== null) ||
              typeof priorValue === "function") &&
            nativeRuntimeGlobals.has(priorValue)
          )
        ) {
          Object.defineProperty(global, name, descriptor);
        } else {
          delete global[name];
        }
      }
    };
  }
}
