import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { LegacyPluginStateStore } from "./plugin-state.js";

const stateFilename = ".stn-plugin-state.json";

async function fixtureRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "stn-plugin-state-"));
}

async function persistedState(root: string): Promise<unknown> {
  return JSON.parse(
    await readFile(path.join(root, stateFilename), "utf8"),
  ) as unknown;
}

describe("legacy plugin state store", () => {
  it("defaults every valid plugin id to disabled without creating a file", async () => {
    const root = await fixtureRoot();
    const store = await LegacyPluginStateStore.load(root);

    expect(store.isEnabled("js-slash-runner")).toBe(false);
    expect(store.isEnabled("st-prompt-template")).toBe(false);
    expect(await readdir(root)).toEqual([]);
  });

  it("persists explicit state and restores it in a rebuilt store", async () => {
    const root = await fixtureRoot();
    const first = await LegacyPluginStateStore.load(root);

    await first.setEnabled("js-slash-runner", true);
    await first.setEnabled("st-prompt-template", false);

    expect(await persistedState(root)).toEqual({
      schemaVersion: 1,
      plugins: {
        "js-slash-runner": true,
        "st-prompt-template": false,
      },
    });

    const rebuilt = await LegacyPluginStateStore.load(root);
    expect(rebuilt.isEnabled("js-slash-runner")).toBe(true);
    expect(rebuilt.isEnabled("st-prompt-template")).toBe(false);
  });

  it("serializes concurrent writes and preserves state for other ids", async () => {
    const root = await fixtureRoot();
    const store = new LegacyPluginStateStore(root);

    await Promise.all([
      store.setEnabled("plugin-one", true),
      store.setEnabled("plugin-two", true),
      store.setEnabled("plugin-one", false),
    ]);

    expect(store.isEnabled("plugin-one")).toBe(false);
    expect(store.isEnabled("plugin-two")).toBe(true);
    expect(await persistedState(root)).toEqual({
      schemaVersion: 1,
      plugins: {
        "plugin-one": false,
        "plugin-two": true,
      },
    });
    expect(
      (await readdir(root)).filter((entry) => entry.endsWith(".tmp")),
    ).toEqual([]);
  });

  it("fails closed on corrupt state and only replaces it after an explicit set", async () => {
    const root = await fixtureRoot();
    const statePath = path.join(root, stateFilename);
    const corrupt = '{"schemaVersion":1,"plugins":';
    await writeFile(statePath, corrupt);

    const store = await LegacyPluginStateStore.load(root);
    expect(store.isEnabled("js-slash-runner")).toBe(false);
    expect(await readFile(statePath, "utf8")).toBe(corrupt);

    await store.setEnabled("js-slash-runner", true);
    expect(await persistedState(root)).toEqual({
      schemaVersion: 1,
      plugins: { "js-slash-runner": true },
    });
  });

  it("fails closed on incompatible or invalid documents", async () => {
    const cases = [
      {
        schemaVersion: 2,
        plugins: { "js-slash-runner": true },
      },
      {
        schemaVersion: 1,
        plugins: { "js-slash-runner": "yes" },
      },
      {
        schemaVersion: 1,
        plugins: { "../escape": true },
      },
      {
        schemaVersion: 1,
        plugins: { "js-slash-runner": true },
        unexpected: true,
      },
    ];

    for (const document of cases) {
      const root = await fixtureRoot();
      const statePath = path.join(root, stateFilename);
      const original = JSON.stringify(document);
      await writeFile(statePath, original);

      const store = await LegacyPluginStateStore.load(root);
      expect(store.isEnabled("js-slash-runner")).toBe(false);
      expect(await readFile(statePath, "utf8")).toBe(original);
    }
  });

  it("rejects ids that could escape or ambiguously address the state file", async () => {
    const root = await fixtureRoot();
    const store = await LegacyPluginStateStore.load(root);

    for (const invalid of [
      "",
      "../escape",
      "Uppercase",
      "contains space",
      "/absolute",
      "a".repeat(129),
    ]) {
      expect(() => store.isEnabled(invalid)).toThrow(TypeError);
      await expect(store.setEnabled(invalid, true)).rejects.toBeInstanceOf(
        TypeError,
      );
    }
    await expect(
      store.setEnabled("fixture", "true" as unknown as boolean),
    ).rejects.toBeInstanceOf(TypeError);
    expect(await readdir(root)).toEqual([]);
  });
});
