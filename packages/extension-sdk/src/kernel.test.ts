import { describe, expect, it, vi } from "vitest";

import {
  ExtensionCapabilityError,
  ExtensionKernel,
  extensionManifestSchema,
} from "./index.js";

describe("ExtensionKernel", () => {
  it("runs hooks in stable extension-id order and carries payload changes", async () => {
    const kernel = new ExtensionKernel({ allowInlineRuntime: true });
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
    const kernel = new ExtensionKernel({ allowInlineRuntime: true });
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

  it("terminates and quarantines a timed-out worker while continuing later extensions", async () => {
    const kernel = new ExtensionKernel();
    const terminate = vi.fn();
    const reset = vi.fn();
    kernel.register({
      manifest: extensionManifestSchema.parse({
        id: "a-hangs",
        name: "hangs",
        version: "1",
        apiVersion: "1",
        entry: "index.js",
        capabilities: ["prompt.hook"],
      }),
      enabled: true,
      hooks: {},
      transport: {
        activate: async () => undefined,
        invokeHook: async () => new Promise(() => undefined),
        deactivate: async () => undefined,
        terminate,
        reset,
      },
    });
    kernel.register({
      manifest: extensionManifestSchema.parse({
        id: "b-continues",
        name: "continues",
        version: "1",
        apiVersion: "1",
        entry: "index.js",
        capabilities: ["prompt.hook"],
      }),
      enabled: true,
      hooks: {},
      transport: {
        activate: async () => undefined,
        invokeHook: async <TPayload>(_hook: unknown, payload: TPayload) =>
          `${String(payload)}:continued` as TPayload,
        deactivate: async () => undefined,
        terminate: async () => undefined,
      },
    });

    await expect(
      kernel.dispatch("prompt.afterAssemble", "start", { timeoutMs: 20 }),
    ).resolves.toMatchObject({
      payload: "start:continued",
      failures: [{ extensionId: "a-hangs" }],
    });
    expect(terminate).toHaveBeenCalledOnce();
    expect(kernel.isQuarantined("a-hangs")).toBe(true);
    kernel.reenable("a-hangs");
    expect(reset).toHaveBeenCalledOnce();
    expect(kernel.isQuarantined("a-hangs")).toBe(false);
  });
});
