import { describe, expect, it } from "vitest";

import { parseLegacyExtensionManifest } from "./manifest.js";

describe("legacy extension manifest compatibility", () => {
  it("normalizes the pinned host shape independently from the native SDK", () => {
    const manifest = parseLegacyExtensionManifest(
      {
        display_name: "Clean-room fixture",
        loading_order: 7,
        requires: ["dependency"],
        dependencies: ["dependency", "compatibility-helper"],
        optional: [],
        js: "dist/index.js",
        css: "dist/index.css",
        author: "fixture",
        version: "1.0.0",
        i18n: { en: "i18n/en.json" },
      },
      { directoryName: "Fixture Extension" },
    );

    expect(manifest).toMatchObject({
      id: "fixture-extension",
      scripts: ["dist/index.js"],
      styles: ["dist/index.css"],
      requires: ["dependency", "compatibility-helper"],
    });
  });

  it("rejects traversal in executable and localization paths", () => {
    expect(() =>
      parseLegacyExtensionManifest(
        {
          display_name: "Unsafe",
          js: "../outside.js",
          version: "1",
        },
        { directoryName: "unsafe" },
      ),
    ).toThrow();
  });
});
