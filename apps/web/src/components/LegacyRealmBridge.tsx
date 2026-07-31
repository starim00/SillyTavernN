import { useCallback, useEffect, useRef, type RefCallback } from "react";

import { currentWebOrigin, LEGACY_REALM_ORIGIN } from "../legacy/origin";

export const LEGACY_REALM_PROTOCOL = "stn.legacy.v1" as const;
export { LEGACY_REALM_ORIGIN };

export const LEGACY_UI_TO_CANONICAL_PLUGIN_ID = {
  "plugin-js-slash-runner": "js-slash-runner",
  "plugin-st-prompt-template": "st-prompt-template",
} as const;

export type LegacyUiPluginId = keyof typeof LEGACY_UI_TO_CANONICAL_PLUGIN_ID;
export type CanonicalLegacyPluginId =
  (typeof LEGACY_UI_TO_CANONICAL_PLUGIN_ID)[LegacyUiPluginId];

export interface LegacyRealmBridgePlugin {
  readonly id: string;
  readonly enabled: boolean;
  readonly available: boolean;
}

export interface LegacyRealmScope {
  readonly conversationId?: string;
  readonly presetId?: string;
  readonly revisionKey?: string;
}

export interface LegacyRealmRpcRequest {
  readonly protocol: typeof LEGACY_REALM_PROTOCOL;
  readonly id: string;
  readonly pluginId: CanonicalLegacyPluginId;
  readonly actor: "legacy-plugin" | "embedded-script";
  readonly method: string;
  readonly capability: string;
  readonly params: unknown;
}

export type LegacyRealmRpcResponse =
  | {
      readonly protocol: typeof LEGACY_REALM_PROTOCOL;
      readonly id: string;
      readonly ok: true;
      readonly result: unknown;
    }
  | {
      readonly protocol: typeof LEGACY_REALM_PROTOCOL;
      readonly id: string;
      readonly ok: false;
      readonly error: {
        readonly code: string;
        readonly message: string;
        readonly capability?: string;
      };
    };

export type LegacyRealmStatus =
  | {
      readonly pluginId: CanonicalLegacyPluginId;
      readonly uiPluginId: LegacyUiPluginId;
      readonly phase: "ready" | "loaded";
    }
  | {
      readonly pluginId: CanonicalLegacyPluginId;
      readonly uiPluginId: LegacyUiPluginId;
      readonly phase: "error";
      readonly stage: string;
      readonly message: string;
    };

export interface LegacyRealmPostTarget {
  postMessage(message: LegacyRealmRpcResponse, targetOrigin: string): void;
}

export interface LegacyRealmRegistration {
  readonly pluginId: CanonicalLegacyPluginId;
  readonly uiPluginId: LegacyUiPluginId;
  readonly source: LegacyRealmPostTarget;
  readonly scope?: LegacyRealmScope;
}

export type LegacyRealmRegistry = Map<
  CanonicalLegacyPluginId,
  LegacyRealmRegistration
>;

export interface LegacyRealmMessage {
  readonly origin: string;
  readonly source: LegacyRealmPostTarget | null;
  readonly data: unknown;
}

export interface LegacyRealmBridgeProps {
  readonly plugins: readonly LegacyRealmBridgePlugin[];
  readonly scope?: LegacyRealmScope;
  readonly onRpc: (
    pluginId: CanonicalLegacyPluginId,
    request: LegacyRealmRpcRequest,
  ) => Promise<LegacyRealmRpcResponse>;
  readonly onStatus?: (status: LegacyRealmStatus) => void;
}

const READY_NOTIFICATION_KEYS = ["pluginId", "protocol", "type"] as const;
const ERROR_NOTIFICATION_KEYS = [
  "message",
  "pluginId",
  "protocol",
  "stage",
  "type",
] as const;
const RPC_REQUEST_KEYS = [
  "actor",
  "capability",
  "id",
  "method",
  "params",
  "pluginId",
  "protocol",
] as const;
const RPC_SUCCESS_KEYS = ["id", "ok", "protocol", "result"] as const;
const RPC_ERROR_KEYS = ["error", "id", "ok", "protocol"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).toSorted();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function isBoundedText(value: unknown, maximumLength: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maximumLength
  );
}

function parseRpcRequest(
  data: unknown,
  pluginId: CanonicalLegacyPluginId,
): LegacyRealmRpcRequest | null {
  if (
    !isRecord(data) ||
    !hasExactKeys(data, RPC_REQUEST_KEYS) ||
    data.protocol !== LEGACY_REALM_PROTOCOL ||
    data.pluginId !== pluginId ||
    (data.actor !== "legacy-plugin" && data.actor !== "embedded-script") ||
    !isBoundedText(data.id, 512) ||
    !isBoundedText(data.method, 256) ||
    !isBoundedText(data.capability, 512)
  ) {
    return null;
  }
  return {
    protocol: LEGACY_REALM_PROTOCOL,
    id: data.id,
    pluginId,
    actor: data.actor,
    method: data.method,
    capability: data.capability,
    params: data.params,
  };
}

function isRpcResponse(
  value: unknown,
  requestId: string,
): value is LegacyRealmRpcResponse {
  if (
    !isRecord(value) ||
    value.protocol !== LEGACY_REALM_PROTOCOL ||
    value.id !== requestId
  ) {
    return false;
  }
  if (value.ok === true) {
    return hasExactKeys(value, RPC_SUCCESS_KEYS);
  }
  if (
    value.ok !== false ||
    !hasExactKeys(value, RPC_ERROR_KEYS) ||
    !isRecord(value.error)
  ) {
    return false;
  }
  const errorKeys = Object.keys(value.error).toSorted();
  const expectedErrorKeys =
    value.error.capability === undefined
      ? ["code", "message"]
      : ["capability", "code", "message"];
  return (
    errorKeys.length === expectedErrorKeys.length &&
    errorKeys.every((key, index) => key === expectedErrorKeys[index]) &&
    isBoundedText(value.error.code, 256) &&
    isBoundedText(value.error.message, 4_096) &&
    (value.error.capability === undefined ||
      isBoundedText(value.error.capability, 512))
  );
}

function errorResponse(
  id: string,
  code: string,
  message: string,
): LegacyRealmRpcResponse {
  return {
    protocol: LEGACY_REALM_PROTOCOL,
    id,
    ok: false,
    error: { code, message },
  };
}

function findRegistration(
  registry: LegacyRealmRegistry,
  source: LegacyRealmPostTarget,
): LegacyRealmRegistration | null {
  for (const registration of registry.values()) {
    if (registration.source === source) {
      return registration;
    }
  }
  return null;
}

function cloneLegacyRealmScope(
  scope: LegacyRealmScope | undefined,
): LegacyRealmScope | undefined {
  if (scope === undefined) {
    return undefined;
  }
  return Object.freeze({
    ...(scope.conversationId === undefined
      ? {}
      : { conversationId: scope.conversationId }),
    ...(scope.presetId === undefined ? {} : { presetId: scope.presetId }),
    ...(scope.revisionKey === undefined
      ? {}
      : { revisionKey: scope.revisionKey }),
  });
}

function bindTrustedCurrentReadScope(
  request: LegacyRealmRpcRequest,
  registration: LegacyRealmRegistration,
): LegacyRealmRpcRequest | null {
  if (
    request.method === "character.current.read" ||
    request.method === "character.scripts.read" ||
    request.method === "chat.snapshot"
  ) {
    const conversationId = registration.scope?.conversationId;
    return isBoundedText(conversationId, 256)
      ? { ...request, params: { conversationId } }
      : null;
  }
  if (
    request.method === "preset.current.read" ||
    request.method === "preset.scripts.read"
  ) {
    const presetId = registration.scope?.presetId;
    return isBoundedText(presetId, 256)
      ? { ...request, params: { presetId } }
      : null;
  }
  return request;
}

function parseStatus(
  data: unknown,
  registration: LegacyRealmRegistration,
): LegacyRealmStatus | null {
  if (
    !isRecord(data) ||
    data.protocol !== LEGACY_REALM_PROTOCOL ||
    data.pluginId !== registration.pluginId
  ) {
    return null;
  }
  if (
    (data.type === "realm.ready" || data.type === "plugin.loaded") &&
    hasExactKeys(data, READY_NOTIFICATION_KEYS)
  ) {
    return {
      pluginId: registration.pluginId,
      uiPluginId: registration.uiPluginId,
      phase: data.type === "realm.ready" ? "ready" : "loaded",
    };
  }
  if (
    data.type === "plugin.error" &&
    hasExactKeys(data, ERROR_NOTIFICATION_KEYS) &&
    isBoundedText(data.stage, 256) &&
    isBoundedText(data.message, 4_096)
  ) {
    return {
      pluginId: registration.pluginId,
      uiPluginId: registration.uiPluginId,
      phase: "error",
      stage: data.stage,
      message: data.message,
    };
  }
  return null;
}

export function canonicalLegacyPluginId(
  uiPluginId: string,
): CanonicalLegacyPluginId | null {
  return Object.prototype.hasOwnProperty.call(
    LEGACY_UI_TO_CANONICAL_PLUGIN_ID,
    uiPluginId,
  )
    ? LEGACY_UI_TO_CANONICAL_PLUGIN_ID[uiPluginId as LegacyUiPluginId]
    : null;
}

export function createLegacyRealmRegistry(): LegacyRealmRegistry {
  return new Map();
}

export function registerLegacyRealmWindow(
  registry: LegacyRealmRegistry,
  uiPluginId: LegacyUiPluginId,
  source: LegacyRealmPostTarget,
  scope?: LegacyRealmScope,
): () => void {
  const pluginId = LEGACY_UI_TO_CANONICAL_PLUGIN_ID[uiPluginId];
  const trustedScope = cloneLegacyRealmScope(scope);
  const registration: LegacyRealmRegistration = {
    pluginId,
    uiPluginId,
    source,
    ...(trustedScope === undefined ? {} : { scope: trustedScope }),
  };
  registry.set(pluginId, registration);
  return () => {
    if (registry.get(pluginId) === registration) {
      registry.delete(pluginId);
    }
  };
}

export function createLegacyRealmMessageHandler(
  registry: LegacyRealmRegistry,
  onRpc: LegacyRealmBridgeProps["onRpc"],
  onStatus?: LegacyRealmBridgeProps["onStatus"],
): (event: LegacyRealmMessage) => Promise<"ignored" | "rpc" | "status"> {
  return async (event) => {
    if (event.origin !== LEGACY_REALM_ORIGIN || event.source === null) {
      return "ignored";
    }
    const registration = findRegistration(registry, event.source);
    if (!registration) {
      return "ignored";
    }
    const status = parseStatus(event.data, registration);
    if (status) {
      onStatus?.(status);
      return "status";
    }
    const request = parseRpcRequest(event.data, registration.pluginId);
    if (!request) {
      return "ignored";
    }
    const scopedRequest = bindTrustedCurrentReadScope(request, registration);
    if (scopedRequest === null) {
      const response = errorResponse(
        request.id,
        "ERR_LEGACY_SCOPE_UNAVAILABLE",
        `No trusted host scope is registered for '${request.method}'.`,
      );
      if (registry.get(registration.pluginId) === registration) {
        registration.source.postMessage(response, LEGACY_REALM_ORIGIN);
      }
      return "rpc";
    }

    let response: LegacyRealmRpcResponse;
    try {
      const candidate = await onRpc(registration.pluginId, scopedRequest);
      response = isRpcResponse(candidate, scopedRequest.id)
        ? candidate
        : errorResponse(
            scopedRequest.id,
            "ERR_LEGACY_HOST_RESPONSE_INVALID",
            "The legacy host returned an invalid RPC response.",
          );
    } catch {
      response = errorResponse(
        scopedRequest.id,
        "ERR_LEGACY_HOST_RPC_FAILED",
        "The legacy host failed to process the RPC request.",
      );
    }

    if (registry.get(registration.pluginId) === registration) {
      registration.source.postMessage(response, LEGACY_REALM_ORIGIN);
    }
    return "rpc";
  };
}

interface LegacyRealmFrameProps {
  readonly pluginId: CanonicalLegacyPluginId;
  readonly uiPluginId: LegacyUiPluginId;
  readonly registry: LegacyRealmRegistry;
  readonly scope?: LegacyRealmScope;
}

function LegacyRealmFrame({
  pluginId,
  uiPluginId,
  registry,
  scope,
}: LegacyRealmFrameProps) {
  const unregisterRef = useRef<(() => void) | null>(null);
  const setFrame = useCallback<RefCallback<HTMLIFrameElement>>(
    (frame) => {
      unregisterRef.current?.();
      unregisterRef.current = null;
      if (frame?.contentWindow) {
        unregisterRef.current = registerLegacyRealmWindow(
          registry,
          uiPluginId,
          frame.contentWindow,
          scope,
        );
      }
    },
    [
      registry,
      scope?.conversationId,
      scope?.presetId,
      scope?.revisionKey,
      uiPluginId,
    ],
  );

  useEffect(
    () => () => {
      unregisterRef.current?.();
      unregisterRef.current = null;
    },
    [],
  );
  const realmUrl = new URL(`/realm/${pluginId}`, LEGACY_REALM_ORIGIN);
  if (scope?.conversationId) {
    realmUrl.searchParams.set("conversationId", scope.conversationId);
  }
  if (scope?.presetId) {
    realmUrl.searchParams.set("presetId", scope.presetId);
  }
  if (scope?.revisionKey) {
    realmUrl.searchParams.set("scopeRevision", scope.revisionKey);
  }
  realmUrl.searchParams.set("mainOrigin", currentWebOrigin());

  return (
    <iframe
      ref={setFrame}
      className="legacy-plugin-realm"
      data-legacy-plugin-id={pluginId}
      data-legacy-realm=""
      loading="eager"
      referrerPolicy="no-referrer"
      sandbox="allow-scripts allow-same-origin"
      src={realmUrl.toString()}
      title={`${pluginId} legacy extension realm`}
    />
  );
}

export function LegacyRealmBridge({
  plugins,
  scope,
  onRpc,
  onStatus,
}: LegacyRealmBridgeProps) {
  const registryRef = useRef<LegacyRealmRegistry>(createLegacyRealmRegistry());
  const onRpcRef = useRef(onRpc);
  const onStatusRef = useRef(onStatus);
  onRpcRef.current = onRpc;
  onStatusRef.current = onStatus;

  useEffect(() => {
    const handler = createLegacyRealmMessageHandler(
      registryRef.current,
      (pluginId, request) => onRpcRef.current(pluginId, request),
      (status) => onStatusRef.current?.(status),
    );
    const listener = (event: MessageEvent<unknown>) => {
      void handler({
        origin: event.origin,
        source: event.source as LegacyRealmPostTarget | null,
        data: event.data,
      });
    };
    window.addEventListener("message", listener);
    return () => {
      window.removeEventListener("message", listener);
      registryRef.current.clear();
    };
  }, []);

  const rendered = new Set<CanonicalLegacyPluginId>();
  return plugins.flatMap((plugin) => {
    if (!plugin.enabled || !plugin.available) {
      return [];
    }
    const pluginId = canonicalLegacyPluginId(plugin.id);
    if (pluginId === null || rendered.has(pluginId)) {
      return [];
    }
    rendered.add(pluginId);
    return [
      <LegacyRealmFrame
        key={`${pluginId}:${scope?.conversationId ?? ""}:${
          scope?.presetId ?? ""
        }:${scope?.revisionKey ?? ""}`}
        pluginId={pluginId}
        registry={registryRef.current}
        {...(scope === undefined ? {} : { scope })}
        uiPluginId={plugin.id as LegacyUiPluginId}
      />,
    ];
  });
}
