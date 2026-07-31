import $ from "jquery";
import _ from "lodash";
import toastr from "toastr";
import * as Vue from "vue";
import * as YAML from "yaml";
import * as z from "zod";

import type { WorkspaceMessage } from "../domain/workspace";
import type {
  TavernHelperContext,
  TavernHelperRuntimeButton,
  TavernHelperRuntimeStatus,
  TavernHelperScope,
  TavernHelperScript,
  TavernHelperSource,
  TavernHelperStateNamespace,
} from "./tavernHelperTypes";

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
  getMessages: () => WorkspaceMessage[];
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

const tavernEvents = {
  APP_READY: "app_ready",
  MESSAGE_SWIPED: "message_swiped",
  MESSAGE_SENT: "message_sent",
  MESSAGE_RECEIVED: "message_received",
  MESSAGE_EDITED: "message_edited",
  MESSAGE_DELETED: "message_deleted",
  MESSAGE_UPDATED: "message_updated",
  CHAT_CHANGED: "chat_id_changed",
  GENERATION_AFTER_COMMANDS: "GENERATION_AFTER_COMMANDS",
  GENERATION_STARTED: "generation_started",
  GENERATION_STOPPED: "generation_stopped",
  GENERATION_ENDED: "generation_ended",
  USER_MESSAGE_RENDERED: "user_message_rendered",
  CHARACTER_MESSAGE_RENDERED: "character_message_rendered",
  PRESET_CHANGED: "preset_changed",
  WORLDINFO_UPDATED: "worldinfo_updated",
  WORLD_INFO_ACTIVATED: "world_info_activated",
} as const;

const iframeEvents = {
  MESSAGE_IFRAME_RENDER_STARTED: "message_iframe_render_started",
  MESSAGE_IFRAME_RENDER_ENDED: "message_iframe_render_ended",
  GENERATION_STARTED: "js_generation_started",
  STREAM_TOKEN_RECEIVED_FULLY: "js_stream_token_received_fully",
  STREAM_TOKEN_RECEIVED_INCREMENTALLY: "js_stream_token_received_incrementally",
  GENERATION_ENDED: "js_generation_ended",
} as const;

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

export function resolveTavernHelperMessageVariables(
  update: Record<string, unknown>,
  activeSwipeIndex: number,
): JsonRecord | undefined {
  if (update.data !== undefined) return asRecord(clone(update.data));
  if (!Array.isArray(update.swipes_data)) return undefined;
  const resolvedIndex = Math.min(
    Math.max(0, activeSwipeIndex),
    Math.max(0, update.swipes_data.length - 1),
  );
  return asRecord(clone(update.swipes_data[resolvedIndex]));
}

export function createTavernHelperMessageView(
  message: WorkspaceMessage,
  messageId: number,
  variables: JsonRecord,
  assistantName: string,
) {
  const swipes = message.swipes?.map((swipe) => swipe.content) ?? [
    message.content,
  ];
  const activeSwipeIndex = Math.min(
    message.activeSwipeIndex ?? 0,
    Math.max(0, swipes.length - 1),
  );
  const activeVariables = clone(variables);
  return {
    message_id: messageId,
    name: message.role === "user" ? "User" : assistantName,
    role: message.role,
    is_hidden: false,
    message: message.content,
    data: activeVariables,
    extra: { stn_message_id: message.id },
    swipe_id: activeSwipeIndex,
    swipes,
    swipes_data: swipes.map((_, index) =>
      index === activeSwipeIndex ? clone(activeVariables) : {},
    ),
    swipes_info: swipes.map(() => ({})),
  };
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
  private readonly persistTimers = new Map<string, number>();
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
  private readonly runtimeId = crypto.randomUUID();
  private activeScript: RuntimeScript | null = null;
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
    this.disposed = true;
    for (const timer of this.persistTimers.values()) window.clearTimeout(timer);
    this.persistTimers.clear();
    this.listeners.clear();
    this.injections.clear();
    this.globalsCleanup?.();
    this.globalsCleanup = null;
    this.adapter.onButtonsChanged([]);
  }

  async emit(event: string, ...values: unknown[]): Promise<void> {
    const entries = [...(this.listeners.get(event) ?? [])];
    for (const entry of entries) {
      await this.withOwner(entry.owner, () => entry.listener(...values));
      if (entry.once) this.removeListener(event, entry.listener);
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
    if (
      opening.length !== 1 ||
      opening[0]?.role !== "assistant" ||
      opening[0].content.includes("<StatusPlaceHolderImpl/>")
    ) {
      return;
    }

    for (let attempt = 0; attempt < 100 && !this.disposed; attempt += 1) {
      const message = this.adapter.getMessages()[0];
      if (
        !message ||
        message.role !== "assistant" ||
        message.content.includes("<StatusPlaceHolderImpl/>")
      ) {
        return;
      }
      const variables = this.context.variables.messages[message.id] ?? {};
      const listeners = this.listeners.get(tavernEvents.MESSAGE_RECEIVED) ?? [];
      if (_.has(variables, "stat_data") && listeners.length > 0) {
        await this.emit(tavernEvents.MESSAGE_RECEIVED, 0, "assistant");
        await this.emit(
          tavernEvents.CHARACTER_MESSAGE_RENDERED,
          0,
          "assistant",
        );
        return;
      }
      await new Promise<void>((resolve) => window.setTimeout(resolve, 20));
    }
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
    const runtime = this;
    return function (this: unknown, ...args: never[]) {
      return runtime
        .withOwner(owner, () => callback.apply(this, args))
        .catch((error) => {
          runtime.reportRuntimeError(owner, error);
          return undefined;
        });
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
  ): { stop: () => void } {
    const existing = this.listeners.get(event) ?? [];
    if (!existing.some((entry) => entry.listener === listener)) {
      existing.push({ listener, owner: this.activeScript, once });
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
      throw new Error(
        `Unsupported Tavern Helper variable type '${option.type}'.`,
      );
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
    const target = this.variableStore(option);
    Object.keys(target.variables).forEach(
      (key) => delete target.variables[key],
    );
    Object.assign(target.variables, clone(variables));
    target.persist();
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
    const previous = this.persistTimers.get(key);
    if (previous !== undefined) window.clearTimeout(previous);
    const snapshot = clone(variables);
    this.persistTimers.set(
      key,
      window.setTimeout(() => {
        this.persistTimers.delete(key);
        if (this.disposed) return;
        void this.adapter
          .saveState({ namespace, variables: snapshot, ...identifiers })
          .catch((error) =>
            this.adapter.notify(
              `酒馆助手变量保存失败：${errorMessage(error)}`,
              "warning",
            ),
          );
      }, 120),
    );
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
    return createTavernHelperMessageView(
      message,
      messageId,
      this.context.variables.messages[message.id] ?? {},
      this.context.sources.find((source) => source.scope === "card")?.name ??
        "Assistant",
    );
  }

  private async setChatMessages(
    updates: Array<Record<string, unknown> & { message_id: number }>,
  ): Promise<void> {
    const messages = this.adapter.getMessages();
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
      }
    }
    await this.adapter.refreshMessages();
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
        nativeRuntimeGlobals.add(value as object);
      }
      Object.defineProperty(global, name, {
        configurable: true,
        enumerable: true,
        writable: true,
        value,
      });
    };
    const ownerAwareJQuery = new Proxy($, {
      apply: (target, thisArg, argumentsList) => {
        const owner = this.activeScript;
        const args = [...argumentsList];
        if (typeof args[0] === "function") {
          args[0] = this.bindOwner(
            owner,
            args[0] as (...values: never[]) => unknown,
          );
        }
        return Reflect.apply(target, thisArg, args);
      },
    });
    const eventOn = (event: string, listener: EventListener) =>
      this.addListener(event, listener);
    const eventOnce = (event: string, listener: EventListener) =>
      this.addListener(event, listener, true);
    const eventEmit = (event: string, ...values: unknown[]) =>
      this.emit(event, ...values);
    const getVariables = (option: VariableOption) =>
      clone(this.variableStore(option).variables);
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
      const result = _.merge(getVariables(option), clone(variables));
      replaceVariables(result, option);
      return result;
    };
    const insertVariables = (variables: JsonRecord, option: VariableOption) => {
      const result = _.defaultsDeep(getVariables(option), clone(variables));
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
      const id = crypto.randomUUID();
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
    const helper = {
      getChatMessages,
      setChatMessages: (
        messages: Array<Record<string, unknown> & { message_id: number }>,
      ) => this.setChatMessages(messages),
      getLastMessageId: () => this.adapter.getMessages().length - 1,
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
      getTavernHelperVersion: () => "4.8.19-native",
      getTavernHelperExtensionId: () => "stn-native-tavern-helper",
      getTavernVersion: () => "SillyTavernN",
      substitudeMacros: (text: string) =>
        this.context.settings?.developer.macrosEnabled === false
          ? text
          : text
              .replaceAll(
                "{{lastMessageId}}",
                String(this.adapter.getMessages().length - 1),
              )
              .replaceAll(
                "{{char}}",
                this.context.sources.find((source) => source.scope === "card")
                  ?.name ?? "",
              ),
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
      getScriptInfo: () => this.requireActiveScript().script.info,
    };
    const eventApi = {
      eventOn,
      eventOnButton: eventOn,
      eventOnce,
      eventMakeFirst: eventOn,
      eventMakeLast: eventOn,
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
    const popupType = {
      TEXT: 1,
      CONFIRM: 2,
      INPUT: 3,
      DISPLAY: 4,
      CROP: 5,
    };
    const extensionSettings = this.extensionVariables.get("sillytavern") ?? {};
    this.extensionVariables.set("sillytavern", extensionSettings);
    const sillyTavern = {
      name1: "User",
      name2:
        this.context.sources.find((source) => source.scope === "card")?.name ??
        "Assistant",
      characters: this.context.sources
        .filter((source) => source.scope === "card")
        .map((source) => ({ name: source.name, avatar: source.id })),
      extensionSettings,
      getCurrentChatId: () => this.context.conversation.id,
      getChatCompletionModel: () => this.adapter.connectionId,
      saveChat: () => Promise.resolve(),
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
        if (type === popupType.CONFIRM) return window.confirm(message);
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
        this.adapter.getMessages().map((message, index) => {
          const view = this.messageView(message, index);
          return {
            ...view,
            variables: clone(view.swipes_data),
          };
        }),
    });
    expose("$", ownerAwareJQuery);
    expose("jQuery", ownerAwareJQuery);
    expose("_", _);
    expose("Vue", Vue);
    expose("YAML", YAML);
    expose("z", z);
    expose("toastr", scriptToastr);
    expose("TavernHelper", { ...helper, ...scriptApi, ...eventApi });
    expose("SillyTavern", sillyTavern);
    expose("tavern_events", tavernEvents);
    expose("iframe_events", iframeEvents);
    Object.entries({ ...helper, ...scriptApi, ...eventApi }).forEach(
      ([name, value]) => expose(name, value),
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
        const priorValue = descriptor?.value;
        if (
          descriptor &&
          !(
            ((typeof priorValue === "object" && priorValue !== null) ||
              typeof priorValue === "function") &&
            nativeRuntimeGlobals.has(priorValue as object)
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
