import { describe, expect, it } from "vitest";

import {
  deniedLegacyCapability,
  isLegacyRpcResponse,
  legacyRpcCapability,
  legacyRpcRequestSchema,
  legacyRpcSuccess,
  parseLegacyRpcResponse,
} from "./protocol.js";

const request = {
  protocol: "stn.legacy.v1" as const,
  id: "fixture-request",
  pluginId: "fixture-plugin",
  actor: "legacy-plugin" as const,
  method: "settings.load",
  capability: "settings.read",
  params: {},
};

describe("legacy RPC protocol", () => {
  it("owns the method-to-capability contract", () => {
    expect(legacyRpcCapability("character.current.read")).toBe(
      "character.read",
    );
    expect(legacyRpcCapability("unknown.method")).toBeUndefined();
  });

  it("accepts the exact request shape and rejects extra or missing fields", () => {
    expect(legacyRpcRequestSchema.parse(request)).toEqual(request);
    expect(() =>
      legacyRpcRequestSchema.parse({ ...request, unexpected: true }),
    ).toThrow();
    const withoutParams = {
      protocol: request.protocol,
      id: request.id,
      pluginId: request.pluginId,
      actor: request.actor,
      method: request.method,
      capability: request.capability,
    };
    expect(() => legacyRpcRequestSchema.parse(withoutParams)).toThrow();
  });

  it("validates response ids and exact response fields", () => {
    const response = legacyRpcSuccess(request.id, { loaded: true });
    expect(parseLegacyRpcResponse(response, request.id)).toEqual(response);
    expect(isLegacyRpcResponse(response, "another-request")).toBe(false);
    expect(
      isLegacyRpcResponse({ ...response, unexpected: true }, request.id),
    ).toBe(false);
  });

  it("builds capability errors with the requested capability", () => {
    expect(deniedLegacyCapability(request)).toMatchObject({
      id: request.id,
      ok: false,
      error: {
        code: "ERR_LEGACY_CAPABILITY_DENIED",
        capability: "settings.read",
      },
    });
  });
});
