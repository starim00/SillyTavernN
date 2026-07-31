export const EXTENSION_EVENTS = [
  "APP_READY",
  "SETTINGS_LOADED",
  "CHARACTER_SELECTED",
  "CHARACTER_UPDATED",
  "CHAT_OPENED",
  "CHAT_CHANGED",
  "MESSAGE_SENT",
  "MESSAGE_RECEIVED",
  "MESSAGE_UPDATED",
  "GENERATION_STARTED",
  "BEFORE_PROMPT_BUILD",
  "AFTER_PROMPT_BUILD",
  "BEFORE_MODEL_REQUEST",
  "MODEL_STREAM_CHUNK",
  "GENERATION_ENDED",
  "GENERATION_STOPPED",
  "PRESET_CHANGED",
  "EXTENSION_ACTIVATED",
  "EXTENSION_DEACTIVATED",
] as const;

export type ExtensionEventName = (typeof EXTENSION_EVENTS)[number];

export interface ExtensionEventContext<TPayload = unknown> {
  readonly event: ExtensionEventName;
  readonly extensionId: string;
  readonly payload: TPayload;
  readonly signal: AbortSignal;
}

export type ExtensionEventListener<TPayload = unknown> = (
  context: ExtensionEventContext<TPayload>,
) => unknown;

export interface ExtensionEventFailure {
  readonly extensionId: string;
  readonly event: ExtensionEventName;
  readonly message: string;
}

interface ListenerRecord {
  readonly extensionId: string;
  readonly listener: ExtensionEventListener;
  readonly once: boolean;
  readonly order: number;
  readonly sequence: number;
}

export class ExtensionEventBus {
  readonly #listeners = new Map<ExtensionEventName, ListenerRecord[]>();
  #sequence = 0;

  on<TPayload>(
    extensionId: string,
    event: ExtensionEventName,
    listener: ExtensionEventListener<TPayload>,
    options: { once?: boolean; order?: number } = {},
  ): () => void {
    const record: ListenerRecord = {
      extensionId,
      listener: listener as ExtensionEventListener,
      once: options.once ?? false,
      order: options.order ?? 0,
      sequence: this.#sequence++,
    };
    const records = this.#listeners.get(event) ?? [];
    records.push(record);
    records.sort(
      (left, right) =>
        left.order - right.order ||
        left.extensionId.localeCompare(right.extensionId) ||
        left.sequence - right.sequence,
    );
    this.#listeners.set(event, records);
    return () => this.remove(event, record);
  }

  once<TPayload>(
    extensionId: string,
    event: ExtensionEventName,
    listener: ExtensionEventListener<TPayload>,
  ): () => void {
    return this.on(extensionId, event, listener, { once: true });
  }

  removeExtension(extensionId: string): void {
    for (const event of EXTENSION_EVENTS) {
      const remaining = (this.#listeners.get(event) ?? []).filter(
        (record) => record.extensionId !== extensionId,
      );
      this.#listeners.set(event, remaining);
    }
  }

  async emit<TPayload>(
    event: ExtensionEventName,
    payload: TPayload,
    options: { signal?: AbortSignal } = {},
  ): Promise<readonly ExtensionEventFailure[]> {
    const failures: ExtensionEventFailure[] = [];
    const controller = new AbortController();
    const abort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) {
      abort();
    }

    try {
      for (const record of [...(this.#listeners.get(event) ?? [])]) {
        if (controller.signal.aborted) {
          throw controller.signal.reason;
        }
        try {
          await record.listener({
            event,
            extensionId: record.extensionId,
            payload,
            signal: controller.signal,
          });
        } catch (error) {
          failures.push({
            extensionId: record.extensionId,
            event,
            message: error instanceof Error ? error.message : String(error),
          });
        } finally {
          if (record.once) {
            this.remove(event, record);
          }
        }
      }
    } finally {
      options.signal?.removeEventListener("abort", abort);
    }
    return failures;
  }

  private remove(event: ExtensionEventName, target: ListenerRecord): void {
    this.#listeners.set(
      event,
      (this.#listeners.get(event) ?? []).filter((record) => record !== target),
    );
  }
}
