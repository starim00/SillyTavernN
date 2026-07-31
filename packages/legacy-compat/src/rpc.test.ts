import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { JsonObject } from "@stn/contracts";

import { LegacyCapabilityBroker, registerLegacySettingsRpc } from "./index.js";

const request = (
  overrides: Partial<{
    id: string;
    pluginId: string;
    actor: "legacy-plugin" | "embedded-script";
    method: string;
    capability: string;
    params: unknown;
  }> = {},
) => ({
  protocol: "stn.legacy.v1" as const,
  id: "request-1",
  pluginId: "fixture",
  actor: "legacy-plugin" as const,
  method: "chat.snapshot",
  capability: "chat.read",
  params: {},
  ...overrides,
});

describe("LegacyCapabilityBroker", () => {
  it("rejects missing grants, forged actors, and capability substitution", async () => {
    const broker = new LegacyCapabilityBroker();
    broker.register({
      method: "chat.snapshot",
      capability: "chat.read",
      actors: ["legacy-plugin"],
      paramsSchema: z.object({}).strict(),
      handler: () => ({ messages: [] }),
    });

    await expect(
      broker.dispatch(request(), {
        pluginId: "fixture",
        actor: "legacy-plugin",
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "ERR_LEGACY_CAPABILITY_DENIED" },
    });

    broker.grant("fixture", "legacy-plugin", "chat.read");
    await expect(
      broker.dispatch(request({ actor: "embedded-script" }), {
        pluginId: "fixture",
        actor: "legacy-plugin",
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "ERR_LEGACY_ACTOR_MISMATCH" },
    });
    await expect(
      broker.dispatch(request({ capability: "chat.write" }), {
        pluginId: "fixture",
        actor: "legacy-plugin",
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "ERR_LEGACY_CAPABILITY_DENIED" },
    });
  });

  it("persists settings only through separately granted read and write methods", async () => {
    const values = new Map<string, JsonObject>();
    const broker = new LegacyCapabilityBroker();
    registerLegacySettingsRpc(broker, {
      load: (pluginId) => Promise.resolve(values.get(pluginId) ?? {}),
      save: (pluginId, value) => {
        values.set(pluginId, value);
        return Promise.resolve();
      },
    });
    broker.grant("fixture", "legacy-plugin", "settings.read");
    broker.grant("fixture", "legacy-plugin", "settings.write");

    await expect(
      broker.dispatch(
        request({
          method: "settings.save",
          capability: "settings.write",
          params: { value: { enabled: true } },
        }),
        { pluginId: "fixture", actor: "legacy-plugin" },
      ),
    ).resolves.toMatchObject({ ok: true, result: { saved: true } });
    await expect(
      broker.dispatch(
        request({
          method: "settings.load",
          capability: "settings.read",
        }),
        { pluginId: "fixture", actor: "legacy-plugin" },
      ),
    ).resolves.toMatchObject({ ok: true, result: { enabled: true } });
  });

  it("fails closed in safe mode even when a capability was granted", async () => {
    const broker = new LegacyCapabilityBroker();
    broker.register({
      method: "chat.snapshot",
      capability: "chat.read",
      actors: ["legacy-plugin"],
      handler: () => ({}),
    });
    broker.grant("fixture", "legacy-plugin", "chat.read");

    await expect(
      broker.dispatch(request(), {
        pluginId: "fixture",
        actor: "legacy-plugin",
        safeMode: true,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "ERR_LEGACY_SAFE_MODE" },
    });
  });
});
