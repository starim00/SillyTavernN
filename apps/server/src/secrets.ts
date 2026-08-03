import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

type SecretMap = Record<string, string>;

function asError(value: unknown): Error {
  return value instanceof Error
    ? value
    : new Error(String(value), { cause: value });
}

function safeSecretMap(value: unknown): SecretMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: SecretMap = Object.create(null) as SecretMap;
  for (const [key, secret] of Object.entries(value)) {
    if (key === "__proto__" || key === "prototype" || key === "constructor") {
      continue;
    }
    if (typeof secret === "string") result[key] = secret;
  }
  return result;
}

export class ServerSecretVault {
  readonly #file: string;
  readonly #directory: string;
  #secrets: SecretMap | undefined;
  #writeQueue: Promise<void> = Promise.resolve();

  constructor(dataDirectory: string) {
    this.#directory = path.resolve(dataDirectory);
    this.#file = path.join(this.#directory, "provider-secrets.json");
  }

  async get(reference: string | null): Promise<string | undefined> {
    if (!reference) return undefined;
    const secrets = await this.#load();
    return secrets[reference];
  }

  async set(reference: string, value: string): Promise<void> {
    if (!reference.trim()) throw new Error("Secret reference cannot be empty.");
    await this.#enqueueMutation((secrets) => {
      secrets[reference] = value;
    });
  }

  async delete(reference: string): Promise<void> {
    await this.#enqueueMutation((secrets) => {
      delete secrets[reference];
    });
  }

  async #load(): Promise<SecretMap> {
    if (this.#secrets) return this.#secrets;
    try {
      this.#secrets = safeSecretMap(
        JSON.parse(await readFile(this.#file, "utf8")) as unknown,
      );
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        this.#secrets = Object.create(null) as SecretMap;
      } else {
        throw error;
      }
    }
    return this.#secrets;
  }

  async #enqueueMutation(mutator: (secrets: SecretMap) => void): Promise<void> {
    const operation = this.#writeQueue
      .catch(() => undefined)
      .then(async () => {
        const current = await this.#load();
        const next = safeSecretMap(current);
        mutator(next);
        await this.#persist(next);
        this.#secrets = next;
      });
    this.#writeQueue = operation;
    await operation;
  }

  async #persist(secrets: SecretMap): Promise<void> {
    const temporary = path.join(
      this.#directory,
      `.provider-secrets.${process.pid.toString()}.${randomUUID()}.tmp`,
    );
    let operationError: unknown;
    let operationFailed = false;
    let cleanupError: unknown;
    try {
      await mkdir(this.#directory, { recursive: true, mode: 0o700 });
      await writeFile(temporary, `${JSON.stringify(secrets, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      await rename(temporary, this.#file);
    } catch (error) {
      operationError = error;
      operationFailed = true;
    }
    try {
      await unlink(temporary);
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? error.code
          : undefined;
      if (code !== "ENOENT") cleanupError = error;
    }
    if (operationFailed) {
      throw asError(operationError);
    }
    if (cleanupError !== undefined) {
      throw asError(cleanupError);
    }
  }
}
