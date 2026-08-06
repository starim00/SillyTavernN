import { Worker } from "node:worker_threads";

import type {
  importConversation,
  importPortableCard,
  importWorldbookJson,
  ImportOptions,
} from "@stn/core";
import { StorageError } from "@stn/storage";

type ImportOperation = "card" | "worldbook" | "conversation";
type ImportWorkerResult =
  | ReturnType<typeof importPortableCard>
  | ReturnType<typeof importWorldbookJson>
  | ReturnType<typeof importConversation>;

const workerSource = String.raw`
  const { parentPort, workerData } = require("node:worker_threads");
  const { readFile } = require("node:fs/promises");
  void (async () => {
    try {
      const [core, bytes] = await Promise.all([
        import(workerData.coreUrl),
        readFile(workerData.path),
      ]);
      const value = workerData.operation === "card"
        ? core.importPortableCard(bytes, workerData.options)
        : workerData.operation === "worldbook"
          ? core.importWorldbookJson(bytes, workerData.options)
          : core.importConversation(bytes, workerData.options);
      parentPort.postMessage({ ok: true, value });
    } catch (error) {
      parentPort.postMessage({
        ok: false,
        code: typeof error?.code === "string" ? error.code : "IMPORT_PARSE_FAILED",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  })();
`;

export async function parseImportFile(
  filePath: string,
  operation: ImportOperation,
  options: ImportOptions,
): Promise<ImportWorkerResult> {
  const worker = new Worker(workerSource, {
    eval: true,
    workerData: {
      coreUrl: import.meta.resolve("@stn/core"),
      path: filePath,
      operation,
      options,
    },
    resourceLimits: { maxOldGenerationSizeMb: 128 },
  });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      void worker.terminate();
      reject(
        new StorageError(
          "IMPORT_WORKER_TIMEOUT",
          "Import parsing exceeded 30 seconds.",
          422,
        ),
      );
    }, 30_000);
    const finish = () => clearTimeout(timeout);
    worker.once(
      "message",
      (message: {
        ok: boolean;
        value?: ImportWorkerResult;
        code?: string;
        message?: string;
      }) => {
        finish();
        void worker.terminate();
        if (message.ok && message.value !== undefined) resolve(message.value);
        else {
          reject(
            new StorageError(
              message.code ?? "IMPORT_PARSE_FAILED",
              message.message ?? "Import parsing failed.",
              422,
            ),
          );
        }
      },
    );
    worker.once("error", (error) => {
      finish();
      const message = error instanceof Error ? error.message : String(error);
      reject(
        new StorageError(
          "IMPORT_WORKER_FAILURE",
          `Import worker failed: ${message}`,
          422,
        ),
      );
    });
    worker.once("exit", (code) => {
      if (code !== 0) {
        finish();
        reject(
          new StorageError(
            "IMPORT_WORKER_FAILURE",
            `Import worker exited with code ${String(code)}.`,
            422,
          ),
        );
      }
    });
  });
}
