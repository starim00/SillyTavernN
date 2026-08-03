import type { ExtensionHookName, ExtensionRuntimeTransport } from "./kernel.js";

const DEFAULT_PAYLOAD_LIMIT = 2 * 1024 * 1024;

type RuntimeRequest = {
  id: number;
  type: "activate" | "invoke" | "deactivate";
  hook?: ExtensionHookName;
  payload?: unknown;
};

type RuntimeResponse = {
  id: number;
  ok: boolean;
  payload?: unknown;
  error?: { code: string; message: string };
};

export interface ExtensionWorkerLike {
  postMessage(message: unknown): void;
  addEventListener(
    type: "message" | "error" | "messageerror",
    listener: (event: { data?: unknown; message?: string }) => void,
  ): void;
  removeEventListener(
    type: "message" | "error" | "messageerror",
    listener: (event: { data?: unknown; message?: string }) => void,
  ): void;
  terminate(): void | Promise<void>;
}

export interface WorkerExtensionRuntimeOptions {
  readonly createWorker: () => ExtensionWorkerLike;
  readonly requestBytes?: number;
  readonly responseBytes?: number;
}

function cloneSize(value: unknown): number {
  const cloned = structuredClone(value);
  const serialized = JSON.stringify(cloned);
  return new TextEncoder().encode(serialized ?? "null").byteLength;
}

export class WorkerExtensionRuntime implements ExtensionRuntimeTransport {
  readonly #pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  readonly #requestBytes: number;
  readonly #responseBytes: number;
  #worker: ExtensionWorkerLike | undefined;
  #nextId = 1;
  #terminated = false;

  constructor(private readonly options: WorkerExtensionRuntimeOptions) {
    this.#requestBytes = options.requestBytes ?? DEFAULT_PAYLOAD_LIMIT;
    this.#responseBytes = options.responseBytes ?? DEFAULT_PAYLOAD_LIMIT;
  }

  #onMessage = (event: { data?: unknown }): void => {
    const response = event.data as RuntimeResponse | undefined;
    if (
      response === undefined ||
      typeof response.id !== "number" ||
      typeof response.ok !== "boolean"
    ) {
      void this.#fail(
        new Error("Extension worker returned an invalid protocol message."),
      );
      return;
    }
    const pending = this.#pending.get(response.id);
    if (pending === undefined) return;
    this.#pending.delete(response.id);
    if (!response.ok) {
      pending.reject(
        new Error(
          response.error?.message ?? "Extension worker request failed.",
        ),
      );
      return;
    }
    try {
      if (cloneSize(response.payload) > this.#responseBytes) {
        throw new Error("Extension worker response exceeds 2 MiB.");
      }
      pending.resolve(response.payload);
    } catch (error) {
      pending.reject(error instanceof Error ? error : new Error(String(error)));
    }
  };

  #onFailure = (event: { message?: string }): void => {
    void this.#fail(new Error(event.message ?? "Extension worker crashed."));
  };

  #ensureWorker(): ExtensionWorkerLike {
    if (this.#terminated) {
      throw new Error("Extension worker is terminated and quarantined.");
    }
    if (this.#worker === undefined) {
      this.#worker = this.options.createWorker();
      this.#worker.addEventListener("message", this.#onMessage);
      this.#worker.addEventListener("error", this.#onFailure);
      this.#worker.addEventListener("messageerror", this.#onFailure);
    }
    return this.#worker;
  }

  async #fail(error: Error): Promise<void> {
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
    await this.terminate();
  }

  #request(
    request: Omit<RuntimeRequest, "id">,
    signal: AbortSignal,
  ): Promise<unknown> {
    if (cloneSize(request) > this.#requestBytes) {
      return Promise.reject(
        new Error("Extension worker request exceeds 2 MiB."),
      );
    }
    const abortError = () =>
      signal.reason instanceof Error
        ? signal.reason
        : new Error(String(signal.reason ?? "Extension request aborted."));
    if (signal.aborted) return Promise.reject(abortError());
    const id = this.#nextId++;
    const worker = this.#ensureWorker();
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        this.#pending.delete(id);
        reject(abortError());
      };
      signal.addEventListener("abort", onAbort, { once: true });
      this.#pending.set(id, {
        resolve: (value) => {
          signal.removeEventListener("abort", onAbort);
          resolve(value);
        },
        reject: (error) => {
          signal.removeEventListener("abort", onAbort);
          reject(error);
        },
      });
      try {
        worker.postMessage({ ...request, id } satisfies RuntimeRequest);
      } catch (error) {
        this.#pending.delete(id);
        signal.removeEventListener("abort", onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  async activate(signal: AbortSignal): Promise<void> {
    await this.#request({ type: "activate" }, signal);
  }

  async invokeHook<TPayload>(
    hook: ExtensionHookName,
    payload: TPayload,
    signal: AbortSignal,
  ): Promise<TPayload | void> {
    return (await this.#request(
      { type: "invoke", hook, payload },
      signal,
    )) as TPayload | void;
  }

  async deactivate(signal: AbortSignal): Promise<void> {
    await this.#request({ type: "deactivate" }, signal);
  }

  async terminate(): Promise<void> {
    if (this.#terminated) return;
    this.#terminated = true;
    const worker = this.#worker;
    this.#worker = undefined;
    if (worker !== undefined) {
      worker.removeEventListener("message", this.#onMessage);
      worker.removeEventListener("error", this.#onFailure);
      worker.removeEventListener("messageerror", this.#onFailure);
      await worker.terminate();
    }
    const error = new Error("Extension worker was terminated.");
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
  }
}

export interface ExtensionWorkerImplementation {
  activate?: () => void | Promise<void>;
  hooks?: Partial<Record<ExtensionHookName, (payload: unknown) => unknown>>;
  deactivate?: () => void | Promise<void>;
}

export function installExtensionWorkerHost(
  scope: {
    addEventListener(
      type: "message",
      listener: (event: { data?: unknown }) => void,
    ): void;
    postMessage(message: unknown): void;
  },
  implementation: ExtensionWorkerImplementation,
): void {
  scope.addEventListener("message", (event) => {
    const request = event.data as RuntimeRequest | undefined;
    if (request === undefined || typeof request.id !== "number") return;
    void (async () => {
      try {
        let payload: unknown;
        if (request.type === "activate") await implementation.activate?.();
        else if (request.type === "deactivate")
          await implementation.deactivate?.();
        else if (request.type === "invoke" && request.hook !== undefined) {
          payload = await implementation.hooks?.[request.hook]?.(
            request.payload,
          );
        } else {
          throw new Error("Invalid extension worker request.");
        }
        scope.postMessage({
          id: request.id,
          ok: true,
          payload,
        } satisfies RuntimeResponse);
      } catch (error) {
        scope.postMessage({
          id: request.id,
          ok: false,
          error: {
            code: "EXTENSION_RUNTIME_FAILURE",
            message: error instanceof Error ? error.message : String(error),
          },
        } satisfies RuntimeResponse);
      }
    })();
  });
}
