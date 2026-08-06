const MAX_SCRIPTS = 256;
const MAX_PATTERN_BYTES = 32 * 1024;
const MAX_INPUT_BYTES = 2 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 200;
const encoder = new TextEncoder();

type Request =
  | {
      operation: "replace";
      text: string;
      scripts: Array<{ source: string; flags: string; replacement: string }>;
    }
  | {
      operation: "find-index";
      texts: string[];
      source: string;
      flags: string;
    };

type Response = { id: number; ok: boolean; value?: unknown; error?: string };

class BrowserRegexWorker {
  #worker: Worker | undefined;
  #nextId = 1;

  #create(): Worker {
    return new Worker(new URL("./browserRegex.worker.ts", import.meta.url), {
      type: "module",
      name: "stn-regex-worker",
    });
  }

  #terminate(): void {
    this.#worker?.terminate();
    this.#worker = undefined;
  }

  #request(request: Request): Promise<unknown> {
    const worker = (this.#worker ??= this.#create());
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        cleanup();
        this.#terminate();
        reject(new Error("REGEX_TIMEOUT"));
      }, TIMEOUT_MS);
      const onMessage = (event: MessageEvent<Response>) => {
        if (event.data.id !== id) return;
        cleanup();
        if (event.data.ok) resolve(event.data.value);
        else reject(new Error(event.data.error ?? "REGEX_WORKER_FAILURE"));
      };
      const onError = () => {
        cleanup();
        this.#terminate();
        reject(new Error("REGEX_WORKER_FAILURE"));
      };
      const cleanup = () => {
        window.clearTimeout(timeout);
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
        worker.removeEventListener("messageerror", onError);
      };
      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onError);
      worker.addEventListener("messageerror", onError);
      worker.postMessage({ ...request, id });
    });
  }

  async replace(
    text: string,
    scripts: Array<{ find: RegExp; replacement: string }>,
  ): Promise<string> {
    if (
      encoder.encode(text).byteLength > MAX_INPUT_BYTES ||
      scripts.length > MAX_SCRIPTS ||
      scripts.some(
        (script) =>
          encoder.encode(script.find.source).byteLength > MAX_PATTERN_BYTES,
      )
    ) {
      return text;
    }
    try {
      const output = String(
        await this.#request({
          operation: "replace",
          text,
          scripts: scripts.map((script) => ({
            source: script.find.source,
            flags: script.find.flags,
            replacement: script.replacement,
          })),
        }),
      );
      return encoder.encode(output).byteLength > MAX_OUTPUT_BYTES
        ? text
        : output;
    } catch {
      return text;
    }
  }

  async findIndex(
    texts: string[],
    source: string,
    flags = "iu",
  ): Promise<number> {
    if (
      encoder.encode(texts.join("\n")).byteLength > MAX_INPUT_BYTES ||
      encoder.encode(source).byteLength > MAX_PATTERN_BYTES
    ) {
      return -1;
    }
    try {
      return Number(
        await this.#request({ operation: "find-index", texts, source, flags }),
      );
    } catch {
      return -1;
    }
  }
}

export const browserRegexWorker = new BrowserRegexWorker();
