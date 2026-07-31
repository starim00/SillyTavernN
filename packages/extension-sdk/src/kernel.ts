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

export interface ExtensionRuntime {
  readonly manifest: ExtensionManifest;
  readonly enabled: boolean;
  readonly hooks: Partial<Record<ExtensionHookName, ExtensionHook>>;
  readonly activate?: (signal: AbortSignal) => void | Promise<void>;
  readonly deactivate?: (signal: AbortSignal) => void | Promise<void>;
}

export interface ExtensionFailure {
  readonly extensionId: string;
  readonly phase: ExtensionHookName | "activate" | "deactivate";
  readonly message: string;
}

export interface HookDispatchResult<TPayload> {
  readonly payload: TPayload;
  readonly failures: readonly ExtensionFailure[];
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

  register(runtime: ExtensionRuntime): void {
    if (this.#runtimes.has(runtime.manifest.id)) {
      throw new Error(
        `Extension ${runtime.manifest.id} is already registered.`,
      );
    }
    this.#runtimes.set(runtime.manifest.id, runtime);
  }

  unregister(extensionId: string): boolean {
    return this.#runtimes.delete(extensionId);
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
      if (!runtime.enabled || !runtime.activate) {
        continue;
      }
      if (signal.aborted) {
        throw signal.reason;
      }
      try {
        await runtime.activate(signal);
      } catch (error) {
        failures.push({
          extensionId: runtime.manifest.id,
          phase: "activate",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return failures;
  }

  async deactivateAll(
    signal = new AbortController().signal,
  ): Promise<readonly ExtensionFailure[]> {
    const failures: ExtensionFailure[] = [];
    for (const runtime of this.list().toReversed()) {
      if (!runtime.enabled || !runtime.deactivate) {
        continue;
      }
      if (signal.aborted) {
        throw signal.reason;
      }
      try {
        await runtime.deactivate(signal);
      } catch (error) {
        failures.push({
          extensionId: runtime.manifest.id,
          phase: "deactivate",
          message: error instanceof Error ? error.message : String(error),
        });
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
      .filter((runtime) => runtime.enabled && runtime.hooks[hook])
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
        const result = await runtime.hooks[hook]?.({
          extensionId: runtime.manifest.id,
          hook,
          signal: controller.signal,
          payload,
        });
        if (result !== undefined) {
          payload = result as TPayload;
        }
      } catch (error) {
        failures.push({
          extensionId: runtime.manifest.id,
          phase: hook,
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        clearTimeout(timeout);
        options.signal?.removeEventListener("abort", abortListener);
      }
    }

    return { payload, failures };
  }
}
