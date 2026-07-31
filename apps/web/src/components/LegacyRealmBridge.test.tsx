import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  LEGACY_REALM_ORIGIN,
  LEGACY_REALM_PROTOCOL,
  LegacyRealmBridge,
  createLegacyRealmMessageHandler,
  createLegacyRealmRegistry,
  registerLegacyRealmWindow,
  type LegacyRealmPostTarget,
  type LegacyRealmRpcRequest,
  type LegacyRealmRpcResponse,
} from "./LegacyRealmBridge";

function rpcRequest(
  overrides: Partial<LegacyRealmRpcRequest> = {},
): LegacyRealmRpcRequest {
  return {
    protocol: LEGACY_REALM_PROTOCOL,
    id: "js-slash-runner:1",
    pluginId: "js-slash-runner",
    actor: "legacy-plugin",
    method: "settings.load",
    capability: "settings.read",
    params: {},
    ...overrides,
  };
}

describe("LegacyRealmBridge", () => {
  it("mounts only enabled and available pinned plugins in isolated realms", () => {
    const html = renderToStaticMarkup(
      <LegacyRealmBridge
        scope={{
          conversationId: "conversation-fixture",
          presetId: "preset-fixture",
          revisionKey: "revision-1",
        }}
        plugins={[
          {
            id: "plugin-js-slash-runner",
            enabled: true,
            available: true,
          },
          {
            id: "plugin-st-prompt-template",
            enabled: true,
            available: false,
          },
          { id: "unknown-plugin", enabled: true, available: true },
        ]}
        onRpc={vi.fn()}
      />,
    );

    expect(html).toContain(
      'src="http://localhost:4711/realm/js-slash-runner?conversationId=conversation-fixture&amp;presetId=preset-fixture&amp;scopeRevision=revision-1&amp;mainOrigin=http%3A%2F%2Flocalhost%3A4173"',
    );
    expect(html).not.toContain("/realm/st-prompt-template");
    expect(html).not.toContain("unknown-plugin");
    expect(html).toContain('sandbox="allow-scripts allow-same-origin"');
    expect(html).toContain('class="legacy-plugin-realm"');
    expect(html).not.toContain("hidden");
    expect(html).not.toContain("allow-top-navigation");
    expect(html).not.toContain("allow-popups");
  });

  it("rejects forged origins, sources, protocols, and plugin ids", async () => {
    const registry = createLegacyRealmRegistry();
    const expectedSource = {
      postMessage: vi.fn(),
    } satisfies LegacyRealmPostTarget;
    const forgedSource = {
      postMessage: vi.fn(),
    } satisfies LegacyRealmPostTarget;
    registerLegacyRealmWindow(
      registry,
      "plugin-js-slash-runner",
      expectedSource,
    );
    const onRpc = vi.fn();
    const handler = createLegacyRealmMessageHandler(registry, onRpc);

    expect(
      await handler({
        origin: "https://attacker.invalid",
        source: expectedSource,
        data: rpcRequest(),
      }),
    ).toBe("ignored");
    expect(
      await handler({
        origin: LEGACY_REALM_ORIGIN,
        source: forgedSource,
        data: rpcRequest(),
      }),
    ).toBe("ignored");
    expect(
      await handler({
        origin: LEGACY_REALM_ORIGIN,
        source: expectedSource,
        data: { ...rpcRequest(), protocol: "stn.legacy.v0" },
      }),
    ).toBe("ignored");
    expect(
      await handler({
        origin: LEGACY_REALM_ORIGIN,
        source: expectedSource,
        data: { ...rpcRequest(), pluginId: "st-prompt-template" },
      }),
    ).toBe("ignored");

    expect(onRpc).not.toHaveBeenCalled();
    expect(expectedSource.postMessage).not.toHaveBeenCalled();
    expect(forgedSource.postMessage).not.toHaveBeenCalled();
  });

  it("forwards a valid RPC and posts its matching response to the realm", async () => {
    const registry = createLegacyRealmRegistry();
    const source = {
      postMessage: vi.fn(),
    } satisfies LegacyRealmPostTarget;
    registerLegacyRealmWindow(registry, "plugin-js-slash-runner", source);
    const response: LegacyRealmRpcResponse = {
      protocol: LEGACY_REALM_PROTOCOL,
      id: "js-slash-runner:1",
      ok: true,
      result: { theme: "light" },
    };
    const onRpc = vi.fn(async () => response);
    const handler = createLegacyRealmMessageHandler(registry, onRpc);
    const request = rpcRequest();

    expect(
      await handler({
        origin: LEGACY_REALM_ORIGIN,
        source,
        data: request,
      }),
    ).toBe("rpc");
    expect(onRpc).toHaveBeenCalledOnce();
    expect(onRpc).toHaveBeenCalledWith("js-slash-runner", request);
    expect(source.postMessage).toHaveBeenCalledWith(
      response,
      LEGACY_REALM_ORIGIN,
    );
  });

  it("overwrites forged current-read params with the scope captured at registration", async () => {
    const registry = createLegacyRealmRegistry();
    const source = {
      postMessage: vi.fn(),
    } satisfies LegacyRealmPostTarget;
    const scope = {
      conversationId: "trusted-conversation",
      presetId: "trusted-preset",
    };
    registerLegacyRealmWindow(
      registry,
      "plugin-js-slash-runner",
      source,
      scope,
    );
    scope.conversationId = "changed-after-registration";
    scope.presetId = "changed-after-registration";
    const onRpc = vi.fn(
      async (
        _pluginId: string,
        request: LegacyRealmRpcRequest,
      ): Promise<LegacyRealmRpcResponse> => ({
        protocol: LEGACY_REALM_PROTOCOL,
        id: request.id,
        ok: true,
        result: request.params,
      }),
    );
    const handler = createLegacyRealmMessageHandler(registry, onRpc);

    await handler({
      origin: LEGACY_REALM_ORIGIN,
      source,
      data: rpcRequest({
        id: "forged-character-scope",
        method: "character.current.read",
        capability: "character.read",
        params: { conversationId: "attacker-conversation", extra: true },
      }),
    });
    await handler({
      origin: LEGACY_REALM_ORIGIN,
      source,
      data: rpcRequest({
        id: "forged-preset-scope",
        method: "preset.current.read",
        capability: "preset.read",
        params: { presetId: "attacker-preset", extra: true },
      }),
    });

    expect(onRpc).toHaveBeenNthCalledWith(
      1,
      "js-slash-runner",
      expect.objectContaining({
        id: "forged-character-scope",
        params: { conversationId: "trusted-conversation" },
      }),
    );
    expect(onRpc).toHaveBeenNthCalledWith(
      2,
      "js-slash-runner",
      expect.objectContaining({
        id: "forged-preset-scope",
        params: { presetId: "trusted-preset" },
      }),
    );
    expect(source.postMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        id: "forged-character-scope",
        ok: true,
        result: { conversationId: "trusted-conversation" },
      }),
      LEGACY_REALM_ORIGIN,
    );
    expect(source.postMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        id: "forged-preset-scope",
        ok: true,
        result: { presetId: "trusted-preset" },
      }),
      LEGACY_REALM_ORIGIN,
    );
  });

  it("fails closed when a current-read request has no registered host scope", async () => {
    const registry = createLegacyRealmRegistry();
    const source = {
      postMessage: vi.fn(),
    } satisfies LegacyRealmPostTarget;
    registerLegacyRealmWindow(registry, "plugin-js-slash-runner", source);
    const onRpc = vi.fn();
    const handler = createLegacyRealmMessageHandler(registry, onRpc);

    expect(
      await handler({
        origin: LEGACY_REALM_ORIGIN,
        source,
        data: rpcRequest({
          method: "character.current.read",
          capability: "character.read",
          params: { conversationId: "attacker-conversation" },
        }),
      }),
    ).toBe("rpc");
    expect(onRpc).not.toHaveBeenCalled();
    expect(source.postMessage).toHaveBeenCalledWith(
      {
        protocol: LEGACY_REALM_PROTOCOL,
        id: "js-slash-runner:1",
        ok: false,
        error: {
          code: "ERR_LEGACY_SCOPE_UNAVAILABLE",
          message:
            "No trusted host scope is registered for 'character.current.read'.",
        },
      },
      LEGACY_REALM_ORIGIN,
    );
  });

  it("reports ready, loaded, and error notifications from the registered realm", async () => {
    const registry = createLegacyRealmRegistry();
    const source = {
      postMessage: vi.fn(),
    } satisfies LegacyRealmPostTarget;
    registerLegacyRealmWindow(registry, "plugin-st-prompt-template", source);
    const onStatus = vi.fn();
    const handler = createLegacyRealmMessageHandler(
      registry,
      vi.fn(),
      onStatus,
    );

    for (const type of ["realm.ready", "plugin.loaded"] as const) {
      expect(
        await handler({
          origin: LEGACY_REALM_ORIGIN,
          source,
          data: {
            protocol: LEGACY_REALM_PROTOCOL,
            pluginId: "st-prompt-template",
            type,
          },
        }),
      ).toBe("status");
    }
    expect(
      await handler({
        origin: LEGACY_REALM_ORIGIN,
        source,
        data: {
          protocol: LEGACY_REALM_PROTOCOL,
          pluginId: "st-prompt-template",
          type: "plugin.error",
          stage: "activate",
          message: "Plugin activation failed.",
        },
      }),
    ).toBe("status");

    expect(onStatus).toHaveBeenNthCalledWith(1, {
      pluginId: "st-prompt-template",
      uiPluginId: "plugin-st-prompt-template",
      phase: "ready",
    });
    expect(onStatus).toHaveBeenNthCalledWith(2, {
      pluginId: "st-prompt-template",
      uiPluginId: "plugin-st-prompt-template",
      phase: "loaded",
    });
    expect(onStatus).toHaveBeenNthCalledWith(3, {
      pluginId: "st-prompt-template",
      uiPluginId: "plugin-st-prompt-template",
      phase: "error",
      stage: "activate",
      message: "Plugin activation failed.",
    });
  });

  it("unregisters disabled realms without deleting a newer replacement", async () => {
    const registry = createLegacyRealmRegistry();
    const first = {
      postMessage: vi.fn(),
    } satisfies LegacyRealmPostTarget;
    const replacement = {
      postMessage: vi.fn(),
    } satisfies LegacyRealmPostTarget;
    const unregisterFirst = registerLegacyRealmWindow(
      registry,
      "plugin-js-slash-runner",
      first,
    );
    const unregisterReplacement = registerLegacyRealmWindow(
      registry,
      "plugin-js-slash-runner",
      replacement,
    );

    unregisterFirst();
    expect(registry.get("js-slash-runner")?.source).toBe(replacement);
    unregisterReplacement();
    expect(registry.size).toBe(0);

    const html = renderToStaticMarkup(
      <LegacyRealmBridge
        plugins={[
          {
            id: "plugin-js-slash-runner",
            enabled: false,
            available: true,
          },
        ]}
        onRpc={vi.fn()}
      />,
    );
    expect(html).not.toContain("<iframe");
  });

  it("does not post an in-flight RPC response after the realm is removed", async () => {
    const registry = createLegacyRealmRegistry();
    const source = {
      postMessage: vi.fn(),
    } satisfies LegacyRealmPostTarget;
    const unregister = registerLegacyRealmWindow(
      registry,
      "plugin-js-slash-runner",
      source,
    );
    let resolveRpc: ((response: LegacyRealmRpcResponse) => void) | undefined;
    const onRpc = vi.fn(
      () =>
        new Promise<LegacyRealmRpcResponse>((resolve) => {
          resolveRpc = resolve;
        }),
    );
    const handler = createLegacyRealmMessageHandler(registry, onRpc);
    const pending = handler({
      origin: LEGACY_REALM_ORIGIN,
      source,
      data: rpcRequest(),
    });

    unregister();
    resolveRpc?.({
      protocol: LEGACY_REALM_PROTOCOL,
      id: "js-slash-runner:1",
      ok: true,
      result: {},
    });
    expect(await pending).toBe("rpc");
    expect(source.postMessage).not.toHaveBeenCalled();
  });
});
