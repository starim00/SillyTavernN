import type { JsonObject, JsonValue } from "@stn/contracts";

const forbiddenKeys = new Set(["__proto__", "constructor", "prototype"]);

function cloneSetting(value: JsonValue, depth = 0): JsonValue {
  if (depth > 64) {
    throw new Error("Extension settings exceed the maximum nesting depth.");
  }
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Extension settings cannot contain non-finite numbers.");
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => cloneSetting(item, depth + 1));
  }
  const clone: JsonObject = Object.create(null) as JsonObject;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKeys.has(key)) {
      throw new Error(`Forbidden extension setting key: ${key}.`);
    }
    clone[key] = cloneSetting(child, depth + 1);
  }
  return clone;
}

function replaceObject(target: JsonObject, source: JsonObject): void {
  for (const key of Object.keys(target)) {
    delete target[key];
  }
  for (const [key, value] of Object.entries(source)) {
    target[key] = cloneSetting(value);
  }
}

export interface ExtensionSettingsAdapter {
  load(extensionId: string): Promise<JsonObject | undefined>;
  save(extensionId: string, settings: JsonObject): Promise<void>;
  remove?(extensionId: string): Promise<void>;
}

interface SettingsSession {
  readonly reference: JsonObject;
  dirty: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

export class ExtensionSettingsManager {
  readonly #sessions = new Map<string, SettingsSession>();

  constructor(
    readonly adapter: ExtensionSettingsAdapter,
    readonly debounceMs = 250,
  ) {}

  async load(
    extensionId: string,
    defaults: JsonObject = {},
  ): Promise<JsonObject> {
    const existing = this.#sessions.get(extensionId);
    if (existing) {
      return existing.reference;
    }
    const reference: JsonObject = Object.create(null) as JsonObject;
    replaceObject(reference, defaults);
    const persisted = await this.adapter.load(extensionId);
    if (persisted) {
      for (const [key, value] of Object.entries(persisted)) {
        if (forbiddenKeys.has(key)) {
          throw new Error(`Forbidden extension setting key: ${key}.`);
        }
        reference[key] = cloneSetting(value);
      }
    }
    this.#sessions.set(extensionId, { reference, dirty: false });
    return reference;
  }

  getReference(extensionId: string): JsonObject {
    const session = this.#sessions.get(extensionId);
    if (!session) {
      throw new Error(`Extension settings are not loaded: ${extensionId}.`);
    }
    return session.reference;
  }

  update(extensionId: string, patch: JsonObject): JsonObject {
    const session = this.#sessions.get(extensionId);
    if (!session) {
      throw new Error(`Extension settings are not loaded: ${extensionId}.`);
    }
    for (const [key, value] of Object.entries(patch)) {
      if (forbiddenKeys.has(key)) {
        throw new Error(`Forbidden extension setting key: ${key}.`);
      }
      session.reference[key] = cloneSetting(value);
    }
    session.dirty = true;
    this.scheduleFlush(extensionId, session);
    return session.reference;
  }

  async flush(extensionId: string): Promise<void> {
    const session = this.#sessions.get(extensionId);
    if (!session?.dirty) {
      return;
    }
    if (session.timer) {
      clearTimeout(session.timer);
      delete session.timer;
    }
    await this.adapter.save(
      extensionId,
      cloneSetting(session.reference) as JsonObject,
    );
    session.dirty = false;
  }

  async unload(extensionId: string): Promise<void> {
    const session = this.#sessions.get(extensionId);
    if (!session) {
      return;
    }
    await this.flush(extensionId);
    if (session.timer) {
      clearTimeout(session.timer);
    }
    this.#sessions.delete(extensionId);
  }

  async reset(extensionId: string): Promise<void> {
    const session = this.#sessions.get(extensionId);
    if (session?.timer) {
      clearTimeout(session.timer);
    }
    this.#sessions.delete(extensionId);
    await this.adapter.remove?.(extensionId);
  }

  private scheduleFlush(extensionId: string, session: SettingsSession): void {
    if (session.timer) {
      clearTimeout(session.timer);
    }
    session.timer = setTimeout(() => {
      void this.flush(extensionId);
    }, this.debounceMs);
  }
}

export class MemoryExtensionSettingsAdapter implements ExtensionSettingsAdapter {
  readonly #values = new Map<string, JsonObject>();

  load(extensionId: string): Promise<JsonObject | undefined> {
    const value = this.#values.get(extensionId);
    return Promise.resolve(
      value ? (cloneSetting(value) as JsonObject) : undefined,
    );
  }

  save(extensionId: string, settings: JsonObject): Promise<void> {
    this.#values.set(extensionId, cloneSetting(settings) as JsonObject);
    return Promise.resolve();
  }

  remove(extensionId: string): Promise<void> {
    this.#values.delete(extensionId);
    return Promise.resolve();
  }
}
