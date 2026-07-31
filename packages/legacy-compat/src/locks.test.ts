import { describe, expect, it } from "vitest";

import {
  LEGACY_PLUGIN_LOCKS,
  getPinnedLegacyModuleSurfaces,
  isLegacyPluginAssetAllowed,
} from "./index.js";

describe("pinned legacy compatibility contracts", () => {
  it("records exact entry, worker, and lazy runtime assets without bundling either plugin", () => {
    const runner = LEGACY_PLUGIN_LOCKS["js-slash-runner"];
    const template = LEGACY_PLUGIN_LOCKS["st-prompt-template"];

    expect(runner.entrySha256).toBe(
      "14a920868d1081dd9cd5bb0a17c3cc54e7fbf4c3eed8d74a4e4712645c8fafab",
    );
    expect(
      runner.requiredAssets.find(
        (asset) => asset.path === "lib/tailwindcss.min.js",
      )?.sha256,
    ).toBe("3573a896869009f2ab0ea9870ba0279cb8bda0dd45d710a83950367d19ee7ea9");
    expect(template.requiredAssets.map((asset) => asset.path)).toEqual(
      expect.arrayContaining([
        "dist/editor.worker.js",
        "dist/ejs.workers.js",
        "libs/faker.mjs",
      ]),
    );
    expect(isLegacyPluginAssetAllowed(template, "dist/editor.worker.js")).toBe(
      true,
    );
    expect(isLegacyPluginAssetAllowed(template, "dist/1118.index.js")).toBe(
      true,
    );
    expect(isLegacyPluginAssetAllowed(template, "libs/buffer.mjs")).toBe(true);
    expect(isLegacyPluginAssetAllowed(template, "../secrets.json")).toBe(false);
  });

  it("contains the reviewed exact URL-tree ESM surfaces used by both pins", () => {
    const runner = getPinnedLegacyModuleSurfaces("js-slash-runner");
    const template = getPinnedLegacyModuleSurfaces("st-prompt-template");

    expect(
      runner.find((surface) => surface.path === "/script.js")?.exports,
    ).toEqual(expect.arrayContaining(["Generate", "chat", "eventSource"]));
    expect(
      runner.find(
        (surface) =>
          surface.path ===
          "/scripts/slash-commands/SlashCommandCommonEnumsProvider.js",
      )?.exports,
    ).toEqual(expect.arrayContaining(["commonEnumProviders", "enumIcons"]));
    expect(
      template.find((surface) => surface.path === "/scripts/reasoning.js")
        ?.exports,
    ).toEqual(expect.arrayContaining(["updateReasoningUI"]));
    expect(
      template.find(
        (surface) => surface.path === "/scripts/extensions/regex/engine.js",
      )?.exports,
    ).toEqual(expect.arrayContaining(["getRegexedString"]));
  });
});
