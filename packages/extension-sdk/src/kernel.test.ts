import { describe, expect, it } from "vitest";

import {
  ExtensionCapabilityError,
  ExtensionKernel,
  extensionManifestSchema,
} from "./index.js";

describe("ExtensionKernel", () => {
  it("runs hooks in stable extension-id order and carries payload changes", async () => {
    const kernel = new ExtensionKernel();
    for (const id of ["z-last", "a-first"]) {
      kernel.register({
        manifest: extensionManifestSchema.parse({
          id,
          name: id,
          version: "1.0.0",
          apiVersion: "1",
          entry: "index.js",
          capabilities: ["prompt.hook"],
        }),
        enabled: true,
        hooks: {
          "prompt.afterAssemble": ({ payload }) => `${String(payload)}:${id}`,
        },
      });
    }

    await expect(
      kernel.dispatch("prompt.afterAssemble", "start"),
    ).resolves.toEqual({
      payload: "start:a-first:z-last",
      failures: [],
    });
  });

  it("denies undeclared capabilities", () => {
    const kernel = new ExtensionKernel();
    kernel.register({
      manifest: extensionManifestSchema.parse({
        id: "read-only",
        name: "Read only",
        version: "1",
        apiVersion: "1",
        entry: "index.js",
        capabilities: ["chat.read"],
      }),
      enabled: true,
      hooks: {},
    });

    expect(() => kernel.requireCapability("read-only", "chat.write")).toThrow(
      ExtensionCapabilityError,
    );
  });
});
