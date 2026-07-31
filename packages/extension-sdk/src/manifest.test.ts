import { describe, expect, it } from "vitest";

import {
  ExtensionDependencyError,
  parseExtensionManifest,
  resolveExtensionLoadOrder,
} from "./index.js";

describe("extension manifest compatibility", () => {
  it("normalizes a legacy manifest without treating it as trusted by default", () => {
    const manifest = parseExtensionManifest(
      {
        display_name: "Clean-room fixture",
        loading_order: 7,
        requires: ["dependency"],
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
      source: "legacy",
      id: "fixture-extension",
      scripts: ["dist/index.js"],
      styles: ["dist/index.css"],
      requires: ["dependency"],
      trustedLegacy: false,
    });
  });

  it("rejects traversal in executable and localization paths", () => {
    expect(() =>
      parseExtensionManifest(
        {
          display_name: "Unsafe",
          js: "../outside.js",
          version: "1",
        },
        { directoryName: "unsafe" },
      ),
    ).toThrow();
  });

  it("orders dependencies before loading_order and reports cycles", () => {
    const parseNative = (
      id: string,
      loadingOrder: number,
      requires: string[] = [],
    ) =>
      parseExtensionManifest({
        id,
        name: id,
        version: "1",
        apiVersion: "1",
        entry: "index.js",
        loadingOrder,
        requires,
      });

    expect(
      resolveExtensionLoadOrder([
        parseNative("consumer", -10, ["provider"]),
        parseNative("provider", 100),
        parseNative("independent", 0),
      ]).map((manifest) => manifest.id),
    ).toEqual(["independent", "provider", "consumer"]);

    expect(() =>
      resolveExtensionLoadOrder([
        parseNative("cycle-a", 0, ["cycle-b"]),
        parseNative("cycle-b", 0, ["cycle-a"]),
      ]),
    ).toThrow(ExtensionDependencyError);
  });
});
