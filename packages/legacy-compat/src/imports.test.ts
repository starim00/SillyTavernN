import { describe, expect, it, vi } from "vitest";

import {
  buildLegacyModuleSurfaces,
  createLegacyEventBus,
  createLegacyFacadeModule,
  resolveLegacyImportPath,
  scanLegacyStaticImports,
} from "./index.js";

describe("legacy static import scanner", () => {
  it("collects compact and conventional ESM imports", () => {
    const imports = scanLegacyStaticImports(`
      import{chat as a,eventSource as b}from"../../../../../script.js";
      import DefaultThing, { loadWorldInfo } from "../../../../../scripts/world-info.js";
      import "../../side-effect.js";
    `);

    expect(imports).toHaveLength(3);
    expect(imports[0]?.bindings).toEqual([
      { imported: "chat", local: "a", kind: "named" },
      { imported: "eventSource", local: "b", kind: "named" },
    ]);

    const surfaces = buildLegacyModuleSurfaces(
      "/scripts/extensions/third-party/Example/dist/index.js",
      imports,
    );
    expect(
      surfaces.find((surface) => surface.path === "/script.js")?.exports,
    ).toEqual(["chat", "eventSource"]);
  });

  it("normalizes exact old-client URL paths", () => {
    expect(
      resolveLegacyImportPath(
        "/scripts/extensions/third-party/JS-Slash-Runner/dist/index.js",
        "../../../../../scripts/utils.js",
      ),
    ).toBe("/scripts/utils.js");
  });

  it("does not emit an invalid star export for namespace imports", () => {
    const imports = scanLegacyStaticImports(
      'import * as host from "../../../../../script.js";',
    );
    expect(
      buildLegacyModuleSurfaces(
        "/scripts/extensions/third-party/Fixture/dist/index.js",
        imports,
      ),
    ).toEqual([{ path: "/script.js", exports: [] }]);
  });
});

describe("legacy facade generation", () => {
  it("emits named and default exports through the realm bridge", () => {
    const moduleSource = createLegacyFacadeModule({
      path: "/script.js",
      exports: ["chat", "default"],
    });
    expect(moduleSource).toContain("export const chat");
    expect(moduleSource).toContain("export default");
  });
});

describe("legacy event bus", () => {
  it("keeps makeFirst, on, makeLast, and once ordering stable", async () => {
    const bus = createLegacyEventBus();
    const calls: string[] = [];
    const once = vi.fn(() => calls.push("once"));
    bus.on("event", () => calls.push("normal"));
    bus.makeLast("event", () => calls.push("last"));
    bus.makeFirst("event", () => calls.push("first"));
    bus.once("event", once);

    await bus.emitAndWait("event");
    await bus.emitAndWait("event");

    expect(calls).toEqual([
      "first",
      "normal",
      "once",
      "last",
      "first",
      "normal",
      "last",
    ]);
    expect(once).toHaveBeenCalledTimes(1);
  });
});
