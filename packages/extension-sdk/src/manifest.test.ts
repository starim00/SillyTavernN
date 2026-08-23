import { describe, expect, it } from "vitest";

import {
  ExtensionDependencyError,
  parseExtensionManifest,
  resolveExtensionLoadOrder,
} from "./manifest.js";

describe("native extension manifests", () => {
  it("normalizes the native extension manifest shape", () => {
    const manifest = parseExtensionManifest({
      id: "native-fixture",
      name: "Native fixture",
      version: "1.0.0",
      apiVersion: "1",
      entry: "dist/index.js",
      styles: ["dist/index.css"],
      requires: ["dependency"],
      i18n: { en: "i18n/en.json" },
    });

    expect(manifest).toMatchObject({
      id: "native-fixture",
      scripts: ["dist/index.js"],
      styles: ["dist/index.css"],
      requires: ["dependency"],
    });
  });

  it("rejects traversal in executable and localization paths", () => {
    expect(() =>
      parseExtensionManifest({
        id: "unsafe",
        name: "Unsafe",
        version: "1",
        apiVersion: "1",
        entry: "../outside.js",
      }),
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
