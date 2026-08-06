import type { ExtensionManifest, NativeCapability } from "./manifest.js";

export type ExtensionHookName =
  | "prompt.beforeAssemble"
  | "prompt.afterAssemble"
  | "generation.beforeRequest"
  | "generation.afterResponse"
  | "message.beforeRender";

export interface ExtensionHookContext<TPayload = unknown> {
  readonly extensionId: string;
  readonly hook: ExtensionHookName;
  readonly signal: AbortSignal;
  payload: TPayload;
}

export type ExtensionHook<TPayload = unknown> = (
  context: ExtensionHookContext<TPayload>,
) => Promise<TPayload | void> | TPayload | void;

export interface ExtensionRuntimeTransport {
  activate(signal: AbortSignal): Promise<void>;
  invokeHook<TPayload>(
    hook: ExtensionHookName,
    payload: TPayload,
    signal: AbortSignal,
  ): Promise<TPayload | void>;
  deactivate(signal: AbortSignal): Promise<void>;
  terminate(): Promise<void> | void;
  reset?(): void;
}

export interface ExtensionRuntime {
  readonly manifest: ExtensionManifest;
  readonly enabled: boolean;
  readonly hooks: Partial<Record<ExtensionHookName, ExtensionHook>>;
  readonly activate?: (signal: AbortSignal) => void | Promise<void>;
  readonly deactivate?: (signal: AbortSignal) => void | Promise<void>;
  readonly transport?: ExtensionRuntimeTransport;
}

export interface ExtensionFailure {
  readonly extensionId: string;
  readonly phase: ExtensionHookName | "activate" | "deactivate";
  readonly message: string;
  readonly code?: string;
}

export interface HookDispatchResult<TPayload> {
  readonly payload: TPayload;
  readonly failures: readonly ExtensionFailure[];
}

function runWithAbort<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  const abortError = () =>
    signal.reason instanceof Error
      ? signal.reason
      : new Error(String(signal.reason ?? "Extension operation aborted."));
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}

function lifecycleController(
  parent: AbortSignal,
  timeoutMs = 5_000,
): { controller: AbortController; cleanup: () => void } {
  const controller = new AbortController();
  const onAbort = () => controller.abort(parent.reason);
  parent.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(
    () =>
      controller.abort(
        new Error(`Extension lifecycle timed out after ${timeoutMs} ms.`),
      ),
    timeoutMs,
  );
  return {
    controller,
    cleanup: () => {
      clearTimeout(timeout);
      parent.removeEventListener("abort", onAbort);
    },
  };
}

export class ExtensionCapabilityError extends Error {
  readonly code = "ERR_EXTENSION_CAPABILITY_DENIED";

  constructor(
    readonly extensionId: string,
    readonly capability: NativeCapability,
  ) {
    super(`Extension ${extensionId} does not have capability ${capability}.`);
  }
}

export class ExtensionKernel {
  readonly #runtimes = new Map<string, ExtensionRuntime>();
  readonly #quarantined = new Set<string>();

  constructor(
    private readonly options: { allowInlineRuntime?: boolean } = {},
  ) {}

  register(runtime: ExtensionRuntime): void {
    if (this.#runtimes.has(runtime.manifest.id)) {
      throw new Error(
        `Extension ${runtime.manifest.id} is already registered.`,
      );
    }
    if (runtime.transport === undefined && !this.options.allowInlineRuntime) {
      throw new Error(
        `Native extension ${runtime.manifest.id} requires an isolated runtime transport.`,
      );
    }
    this.#runtimes.set(runtime.manifest.id, runtime);
  }

  unregister(extensionId: string): boolean {
    this.#quarantined.delete(extensionId);
    return this.#runtimes.delete(extensionId);
  }

  isQuarantined(extensionId: string): boolean {
    return this.#quarantined.has(extensionId);
  }

  reenable(extensionId: string): void {
    const runtime = this.#runtimes.get(extensionId);
    if (runtime === undefined) {
      throw new Error(`Extension ${extensionId} is not registered.`);
    }
    runtime.transport?.reset?.();
    this.#quarantined.delete(extensionId);
  }

  async #quarantine(runtime: ExtensionRuntime): Promise<void> {
    this.#quarantined.add(runtime.manifest.id);
    await runtime.transport?.terminate();
  }

  list(): readonly ExtensionRuntime[] {
    return [...this.#runtimes.values()].sort(
      (left, right) =>
        left.manifest.loadingOrder - right.manifest.loadingOrder ||
        left.manifest.id.localeCompare(right.manifest.id),
    );
  }

  requireCapability(extensionId: string, capability: NativeCapability): void {
    const runtime = this.#runtimes.get(extensionId);
    if (
      !runtime?.enabled ||
      !runtime.manifest.capabilities.includes(capability)
    ) {
      throw new ExtensionCapabilityError(extensionId, capability);
    }
  }

  async activateAll(
    signal = new AbortController().signal,
  ): Promise<readonly ExtensionFailure[]> {
    const failures: ExtensionFailure[] = [];
    for (const runtime of this.list()) {
      if (
        !runtime.enabled ||
        this.#quarantined.has(runtime.manifest.id) ||
        (runtime.transport === undefined && !runtime.activate)
      ) {
        continue;
      }
      if (signal.aborted) {
        throw signal.reason;
      }
      const lifecycle = lifecycleController(signal);
      try {
        if (runtime.transport !== undefined) {
          await runWithAbort(
            runtime.transport.activate(lifecycle.controller.signal),
            lifecycle.controller.signal,
          );
        } else {
          await runtime.activate?.(lifecycle.controller.signal);
        }
      } catch (error) {
        await this.#quarantine(runtime);
        failures.push({
          extensionId: runtime.manifest.id,
          phase: "activate",
          message: error instanceof Error ? error.message : String(error),
          code: "EXTENSION_ACTIVATE_FAILED",
        });
      } finally {
        lifecycle.cleanup();
      }
    }
    return failures;
  }

  async deactivateAll(
    signal = new AbortController().signal,
  ): Promise<readonly ExtensionFailure[]> {
    const failures: ExtensionFailure[] = [];
    for (const runtime of this.list().toReversed()) {
      if (
        !runtime.enabled ||
        (runtime.transport === undefined && !runtime.deactivate)
      ) {
        continue;
      }
      if (signal.aborted) {
        throw signal.reason;
      }
      const lifecycle = lifecycleController(signal);
      try {
        if (runtime.transport !== undefined) {
          await runWithAbort(
            runtime.transport.deactivate(lifecycle.controller.signal),
            lifecycle.controller.signal,
          );
        } else {
          await runtime.deactivate?.(lifecycle.controller.signal);
        }
      } catch (error) {
        failures.push({
          extensionId: runtime.manifest.id,
          phase: "deactivate",
          message: error instanceof Error ? error.message : String(error),
          code: "EXTENSION_DEACTIVATE_FAILED",
        });
      } finally {
        lifecycle.cleanup();
        await runtime.transport?.terminate();
      }
    }
    return failures;
  }

  async dispatch<TPayload>(
    hook: ExtensionHookName,
    initialPayload: TPayload,
    options: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<HookDispatchResult<TPayload>> {
    const failures: ExtensionFailure[] = [];
    let payload = initialPayload;
    const timeoutMs = options.timeoutMs ?? 1_500;

    const runtimes = [...this.#runtimes.values()]
      .filter(
        (runtime) =>
          runtime.enabled &&
          !this.#quarantined.has(runtime.manifest.id) &&
          (runtime.transport !== undefined ||
            runtime.hooks[hook] !== undefined),
      )
      .sort(
        (left, right) =>
          left.manifest.loadingOrder - right.manifest.loadingOrder ||
          left.manifest.id.localeCompare(right.manifest.id),
      );

    for (const runtime of runtimes) {
      if (options.signal?.aborted) {
        throw options.signal.reason;
      }

      const controller = new AbortController();
      const timeout = setTimeout(
        () =>
          controller.abort(
            new Error(`Extension hook timed out after ${timeoutMs} ms.`),
          ),
        timeoutMs,
      );
      const abortListener = () => controller.abort(options.signal?.reason);
      options.signal?.addEventListener("abort", abortListener, { once: true });

      try {
        const result =
          runtime.transport !== undefined
            ? await runWithAbort(
                runtime.transport.invokeHook(hook, payload, controller.signal),
                controller.signal,
              )
            : await runtime.hooks[hook]?.({
                extensionId: runtime.manifest.id,
                hook,
                signal: controller.signal,
                payload,
              });
        if (result !== undefined) {
          payload = result as TPayload;
        }
      } catch (error) {
        await this.#quarantine(runtime);
        failures.push({
          extensionId: runtime.manifest.id,
          phase: hook,
          message: error instanceof Error ? error.message : String(error),
          code: "EXTENSION_HOOK_FAILED",
        });
      } finally {
        clearTimeout(timeout);
        options.signal?.removeEventListener("abort", abortListener);
      }
    }

    return { payload, failures };
  }
}
