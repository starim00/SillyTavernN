import { describe, expect, it, vi } from "vitest";

import {
  ExtensionEventBus,
  ExtensionSettingsManager,
  ExtensionUiRegistry,
  MemoryExtensionSettingsAdapter,
} from "./index.js";

describe("native extension platform contracts", () => {
  it("orders event listeners and isolates a listener failure", async () => {
    const bus = new ExtensionEventBus();
    const calls: string[] = [];
    bus.on("late", "APP_READY", () => calls.push("late"), { order: 10 });
    bus.on("broken", "APP_READY", () => {
      throw new Error("fixture failure");
    });
    bus.on("early", "APP_READY", () => calls.push("early"), { order: -10 });

    const failures = await bus.emit("APP_READY", { ready: true });
    expect(calls).toEqual(["early", "late"]);
    expect(failures).toEqual([
      {
        extensionId: "broken",
        event: "APP_READY",
        message: "fixture failure",
      },
    ]);
  });

  it("requires ui.panel and keeps UI slots ordered without exposing a DOM", () => {
    const requireCapability = vi.fn();
    const registry = new ExtensionUiRegistry(requireCapability);
    registry.register({
      id: "panel",
      extensionId: "fixture",
      slot: "settings-section",
      order: 2,
      render: ({ data }) => data.title,
    });

    expect(registry.render("settings-section", { title: "Settings" })).toEqual([
      "Settings",
    ]);
    expect(requireCapability).toHaveBeenCalledWith("fixture", "ui.panel");
  });

  it("keeps a stable settings reference across load, update, and flush", async () => {
    const adapter = new MemoryExtensionSettingsAdapter();
    const manager = new ExtensionSettingsManager(adapter, 60_000);
    const reference = await manager.load("fixture", { enabled: false });
    const updated = manager.update("fixture", { enabled: true });
    await manager.flush("fixture");

    expect(updated).toBe(reference);
    expect(await adapter.load("fixture")).toEqual({ enabled: true });
    await manager.unload("fixture");
  });
});
