import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const stateFilename = ".stn-plugin-state.json";
const pluginIdPattern = /^[a-z0-9][a-z0-9._-]{0,127}$/u;

export interface LegacyPluginStateDocument {
  readonly schemaVersion: 1;
  readonly plugins: Readonly<Record<string, boolean>>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertPluginId(pluginId: string): void {
  if (!pluginIdPattern.test(pluginId)) {
    throw new TypeError(
      "Legacy plugin id must contain only lowercase letters, numbers, dots, underscores, and hyphens.",
    );
  }
}

function parseDocument(source: string): Map<string, boolean> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return undefined;
  }
  if (
    !isObject(parsed) ||
    Object.keys(parsed).some(
      (key) => key !== "schemaVersion" && key !== "plugins",
    ) ||
    parsed.schemaVersion !== 1 ||
    !isObject(parsed.plugins)
  ) {
    return undefined;
  }

  const plugins = new Map<string, boolean>();
  for (const [pluginId, enabled] of Object.entries(parsed.plugins)) {
    if (!pluginIdPattern.test(pluginId) || typeof enabled !== "boolean") {
      return undefined;
    }
    plugins.set(pluginId, enabled);
  }
  return plugins;
}

function documentFor(
  plugins: ReadonlyMap<string, boolean>,
): LegacyPluginStateDocument {
  return {
    schemaVersion: 1,
    plugins: Object.fromEntries(
      [...plugins].sort(([left], [right]) => left.localeCompare(right)),
    ),
  };
}

/**
 * Persists explicit legacy-plugin enablement separately from plugin discovery.
 * Missing, corrupt, or incompatible state is treated as every plugin disabled.
 */
export class LegacyPluginStateStore {
  readonly extensionsRoot: string;
  readonly statePath: string;

  #plugins = new Map<string, boolean>();
  readonly #loaded: Promise<void>;
  #writes: Promise<void> = Promise.resolve();

  constructor(extensionsRoot: string) {
    this.extensionsRoot = path.resolve(extensionsRoot);
    this.statePath = path.join(this.extensionsRoot, stateFilename);
    this.#loaded = this.#loadFromDisk();
  }

  static async load(extensionsRoot: string): Promise<LegacyPluginStateStore> {
    return new LegacyPluginStateStore(extensionsRoot).load();
  }

  async load(): Promise<this> {
    await this.#loaded;
    return this;
  }

  isEnabled(pluginId: string): boolean {
    assertPluginId(pluginId);
    return this.#plugins.get(pluginId) === true;
  }

  async setEnabled(pluginId: string, enabled: boolean): Promise<void> {
    assertPluginId(pluginId);
    if (typeof enabled !== "boolean") {
      throw new TypeError("Legacy plugin enabled state must be a boolean.");
    }

    const update = this.#writes.then(async () => {
      await this.#loaded;
      const next = new Map(this.#plugins);
      next.set(pluginId, enabled);
      await this.#writeDocument(next);
      this.#plugins = next;
    });
    this.#writes = update.catch(() => undefined);
    return update;
  }

  async #loadFromDisk(): Promise<void> {
    try {
      const source = await readFile(this.statePath, "utf8");
      this.#plugins = parseDocument(source) ?? new Map<string, boolean>();
    } catch {
      this.#plugins = new Map<string, boolean>();
    }
  }

  async #writeDocument(plugins: ReadonlyMap<string, boolean>): Promise<void> {
    await mkdir(this.extensionsRoot, { recursive: true });
    const temporaryPath = path.join(
      this.extensionsRoot,
      `${stateFilename}.${process.pid.toString()}.${randomUUID()}.tmp`,
    );
    try {
      await writeFile(
        temporaryPath,
        `${JSON.stringify(documentFor(plugins), null, 2)}\n`,
        {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600,
        },
      );
      await rename(temporaryPath, this.statePath);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }
}
