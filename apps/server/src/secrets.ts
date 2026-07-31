import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

type SecretMap = Record<string, string>;

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
    const secrets = await this.#load();
    secrets[reference] = value;
    await this.#persist(secrets);
  }

  async delete(reference: string): Promise<void> {
    const secrets = await this.#load();
    delete secrets[reference];
    await this.#persist(secrets);
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

  async #persist(secrets: SecretMap): Promise<void> {
    this.#writeQueue = this.#writeQueue.then(async () => {
      await mkdir(this.#directory, { recursive: true, mode: 0o700 });
      const temporary = `${this.#file}.${process.pid.toString()}.tmp`;
      await writeFile(temporary, `${JSON.stringify(secrets, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      await chmod(temporary, 0o600);
      await rename(temporary, this.#file);
      await chmod(this.#file, 0o600);
    });
    await this.#writeQueue;
  }
}
