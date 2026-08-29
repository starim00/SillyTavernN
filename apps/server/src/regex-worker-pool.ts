import { Worker } from "node:worker_threads";

import type {
  ApplyRegexScriptsOptions,
  PromptAssemblyInput,
  PromptAssemblyResult,
  RegexApplyResult,
  RegexScript,
} from "@stn/core";
import type { Diagnostic } from "@stn/contracts";

const MAX_SCRIPTS = 256;
const MAX_PATTERN_BYTES = 32 * 1024;
const MAX_INPUT_BYTES = 2 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const EXECUTION_TIMEOUT_MS = 200;

type WorkerRequest =
  | {
      id: number;
      operation: "apply";
      text: string;
      scripts: readonly RegexScript[];
      options: ApplyRegexScriptsOptions;
    }
  | {
      id: number;
      operation: "assemble";
      input: PromptAssemblyInput;
    };

type WorkerRequestInput =
  | Omit<Extract<WorkerRequest, { operation: "apply" }>, "id">
  | Omit<Extract<WorkerRequest, { operation: "assemble" }>, "id">;

type WorkerResponse = {
  id?: number;
  ready?: boolean;
  ok: boolean;
  value?: unknown;
  error?: string;
};

type Pending = {
  request: WorkerRequest;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

const workerSource = String.raw`
  const { parentPort, workerData } = require("node:worker_threads");
  void import(workerData.coreUrl).then((core) => {
    parentPort.postMessage({ ready: true });
    parentPort.on("message", async (request) => {
    try {
      const value = request.operation === "apply"
        ? core.applyRegexScriptsWithDiagnostics(request.text, request.scripts, request.options)
        : core.assemblePrompt(request.input);
      parentPort.postMessage({ id: request.id, ok: true, value });
    } catch (error) {
      parentPort.postMessage({
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    });
  });
`;

class PoolWorker {
  worker: Worker;
  pending: Pending | undefined;
  timer: ReturnType<typeof setTimeout> | undefined;
  ready = false;

  constructor(readonly pool: RegexWorkerPool) {
    this.worker = this.create();
  }

  create(): Worker {
    this.ready = false;
    const worker = new Worker(workerSource, {
      eval: true,
      workerData: { coreUrl: import.meta.resolve("@stn/core") },
    });
    worker.unref();
    worker.on("message", (response: WorkerResponse) => this.complete(response));
    worker.on("error", (error) =>
      this.fail(error instanceof Error ? error : new Error(String(error))),
    );
    worker.on("exit", (code) => {
      if (code !== 0 && this.pending !== undefined) {
        this.fail(new Error(`Regex worker exited with code ${String(code)}.`));
      }
    });
    return worker;
  }

  run(pending: Pending): void {
    this.pending = pending;
    this.timer = setTimeout(() => {
      const current = this.pending;
      this.pending = undefined;
      void this.worker.terminate().finally(() => {
        this.worker = this.create();
        current?.reject(new Error("REGEX_TIMEOUT"));
        this.pool.drain();
      });
    }, this.pool.executionTimeoutMs);
    this.worker.postMessage(pending.request);
  }

  complete(response: WorkerResponse): void {
    if (response.ready) {
      this.ready = true;
      this.pool.drain();
      return;
    }
    const current = this.pending;
    if (current === undefined || current.request.id !== response.id) return;
    this.clear();
    if (response.ok) current.resolve(response.value);
    else current.reject(new Error(response.error ?? "REGEX_WORKER_FAILURE"));
    this.pool.drain();
  }

  fail(error: Error): void {
    const current = this.pending;
    this.clear();
    current?.reject(new Error(`REGEX_WORKER_FAILURE: ${error.message}`));
    void this.worker.terminate().finally(() => {
      this.worker = this.create();
      this.pool.drain();
    });
  }

  clear(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = undefined;
  }

  async terminate(): Promise<void> {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.pending?.reject(new Error("REGEX_WORKER_FAILURE"));
    this.pending = undefined;
    await this.worker.terminate();
  }
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function limitDiagnostic(code: string): Diagnostic {
  return {
    severity: "warning",
    code,
    message: `Regex execution was skipped: ${code}.`,
  };
}

export class RegexWorkerPool {
  readonly #workers: PoolWorker[];
  readonly #queue: Pending[] = [];
  #nextId = 1;

  constructor(
    size = 2,
    readonly executionTimeoutMs = EXECUTION_TIMEOUT_MS,
  ) {
    this.#workers = Array.from({ length: size }, () => new PoolWorker(this));
  }

  request(request: WorkerRequestInput): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.#queue.push({
        request: { ...request, id: this.#nextId++ },
        resolve,
        reject,
      });
      this.drain();
    });
  }

  drain(): void {
    for (const worker of this.#workers) {
      if (!worker.ready || worker.pending !== undefined) continue;
      const pending = this.#queue.shift();
      if (pending === undefined) return;
      worker.run(pending);
    }
  }

  async apply(
    text: string,
    scripts: readonly RegexScript[],
    options: ApplyRegexScriptsOptions,
  ): Promise<RegexApplyResult> {
    const inputLimited =
      byteLength(text) > MAX_INPUT_BYTES ||
      scripts.length > MAX_SCRIPTS ||
      scripts.some(
        (script) => byteLength(script.findRegex) > MAX_PATTERN_BYTES,
      );
    if (inputLimited) {
      return {
        text,
        appliedScriptIds: [],
        diagnostics: [limitDiagnostic("REGEX_INPUT_LIMIT")],
      };
    }
    let output = text;
    const appliedScriptIds: string[] = [];
    const diagnostics: Diagnostic[] = [];
    for (const script of scripts) {
      try {
        const result = (await this.request({
          operation: "apply",
          text: output,
          scripts: [script],
          options,
        })) as RegexApplyResult;
        if (byteLength(result.text) > MAX_OUTPUT_BYTES) {
          return {
            text,
            appliedScriptIds: [],
            diagnostics: [limitDiagnostic("REGEX_OUTPUT_LIMIT")],
          };
        }
        output = result.text;
        appliedScriptIds.push(...result.appliedScriptIds);
        diagnostics.push(...result.diagnostics);
      } catch (error) {
        const code =
          error instanceof Error && error.message === "REGEX_TIMEOUT"
            ? "REGEX_TIMEOUT"
            : "REGEX_WORKER_FAILURE";
        diagnostics.push(limitDiagnostic(code));
      }
    }
    return {
      text: output,
      appliedScriptIds,
      diagnostics,
    };
  }

  async assemble(input: PromptAssemblyInput): Promise<PromptAssemblyResult> {
    return (await this.request({
      operation: "assemble",
      input,
    })) as PromptAssemblyResult;
  }

  async close(): Promise<void> {
    while (this.#queue.length > 0) {
      this.#queue.shift()?.reject(new Error("REGEX_WORKER_FAILURE"));
    }
    await Promise.all(this.#workers.map((worker) => worker.terminate()));
  }
}

export const regexWorkerPool = new RegexWorkerPool(2);
