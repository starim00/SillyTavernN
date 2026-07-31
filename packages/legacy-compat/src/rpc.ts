import { z, type ZodType } from "zod";

import type { JsonObject, JsonValue } from "@stn/contracts";

import type {
  LegacyActor,
  LegacyCapability,
  LegacyCapabilityGrant,
} from "./types.js";

export const legacyRpcRequestSchema = z
  .object({
    protocol: z.literal("stn.legacy.v1"),
    id: z.string().trim().min(1).max(512),
    pluginId: z.string().trim().min(1).max(256),
    actor: z.enum(["legacy-plugin", "embedded-script"]),
    method: z.string().trim().min(1).max(256),
    capability: z.string().trim().min(1).max(512),
    params: z.unknown(),
  })
  .strict();

export type LegacyRpcRequest = z.infer<typeof legacyRpcRequestSchema>;

export const legacyRpcResponseSchema = z.discriminatedUnion("ok", [
  z
    .object({
      protocol: z.literal("stn.legacy.v1"),
      id: z.string(),
      ok: z.literal(true),
      result: z.unknown(),
    })
    .strict(),
  z
    .object({
      protocol: z.literal("stn.legacy.v1"),
      id: z.string(),
      ok: z.literal(false),
      error: z
        .object({
          code: z.string(),
          message: z.string(),
          capability: z.string().optional(),
        })
        .strict(),
    })
    .strict(),
]);

export type LegacyRpcResponse = z.infer<typeof legacyRpcResponseSchema>;

function errorResponse(
  id: string,
  code: string,
  message: string,
  capability?: string,
): LegacyRpcResponse {
  return {
    protocol: "stn.legacy.v1",
    id,
    ok: false,
    error: {
      code,
      message,
      ...(capability === undefined ? {} : { capability }),
    },
  };
}

export function deniedLegacyCapability(
  request: LegacyRpcRequest,
  message = "The legacy extension does not have this capability.",
): LegacyRpcResponse {
  return errorResponse(
    request.id,
    "ERR_LEGACY_CAPABILITY_DENIED",
    message,
    request.capability,
  );
}

export interface LegacyRpcDispatchContext {
  readonly pluginId: string;
  readonly actor: LegacyActor;
  readonly signal?: AbortSignal;
  readonly safeMode?: boolean;
}

export interface LegacyRpcHandlerContext extends LegacyRpcDispatchContext {
  readonly requestId: string;
}

export interface LegacyRpcMethodDefinition<TParams = unknown> {
  readonly method: string;
  readonly capability: LegacyCapability;
  readonly actors: readonly LegacyActor[];
  readonly paramsSchema?: ZodType<TParams>;
  readonly maxResultBytes?: number;
  readonly requiresGrant?: boolean;
  readonly handler: (
    params: TParams,
    context: LegacyRpcHandlerContext,
  ) => unknown;
}

function grantKey(
  pluginId: string,
  actor: LegacyActor,
  capability: LegacyCapability,
): string {
  return `${pluginId}\0${actor}\0${capability}`;
}

function assertCloneableResult(value: unknown, maximumBytes: number): unknown {
  const normalized = value === undefined ? null : value;
  let serialized: string;
  try {
    serialized = JSON.stringify(normalized);
  } catch {
    throw new Error("Legacy RPC result is not serializable.");
  }
  if (new TextEncoder().encode(serialized).byteLength > maximumBytes) {
    throw new Error("Legacy RPC result exceeded its size limit.");
  }
  return normalized;
}

export class LegacyCapabilityBroker {
  readonly #methods = new Map<string, LegacyRpcMethodDefinition>();
  readonly #grants = new Map<string, LegacyCapabilityGrant>();

  register<TParams>(
    definition: LegacyRpcMethodDefinition<TParams>,
  ): () => void {
    if (this.#methods.has(definition.method)) {
      throw new Error(
        `Legacy RPC method ${definition.method} is already registered.`,
      );
    }
    const normalized = Object.freeze({ ...definition });
    this.#methods.set(
      definition.method,
      normalized as LegacyRpcMethodDefinition,
    );
    return () => {
      if (this.#methods.get(definition.method) === normalized) {
        this.#methods.delete(definition.method);
      }
    };
  }

  grant(
    pluginId: string,
    actor: LegacyActor,
    capability: LegacyCapability,
  ): void {
    this.#grants.set(grantKey(pluginId, actor, capability), {
      pluginId,
      actor,
      capability,
      granted: true,
      grantedAt: new Date().toISOString(),
    });
  }

  revoke(
    pluginId: string,
    actor: LegacyActor,
    capability: LegacyCapability,
  ): void {
    this.#grants.delete(grantKey(pluginId, actor, capability));
  }

  listGrants(pluginId: string): readonly LegacyCapabilityGrant[] {
    return [...this.#grants.values()].filter(
      (grant) => grant.pluginId === pluginId,
    );
  }

  async dispatch(
    input: unknown,
    context: LegacyRpcDispatchContext,
  ): Promise<LegacyRpcResponse> {
    const parsed = legacyRpcRequestSchema.safeParse(input);
    if (!parsed.success) {
      const id =
        typeof input === "object" &&
        input !== null &&
        "id" in input &&
        typeof input.id === "string"
          ? input.id
          : "invalid";
      return errorResponse(
        id,
        "ERR_LEGACY_RPC_INVALID",
        "The legacy RPC request is invalid.",
      );
    }
    const request = parsed.data;
    if (context.safeMode) {
      return errorResponse(
        request.id,
        "ERR_LEGACY_SAFE_MODE",
        "Legacy extensions are disabled in safe mode.",
      );
    }
    if (
      request.pluginId !== context.pluginId ||
      request.actor !== context.actor
    ) {
      return errorResponse(
        request.id,
        "ERR_LEGACY_ACTOR_MISMATCH",
        "The RPC actor does not match the isolated realm.",
      );
    }
    const definition = this.#methods.get(request.method);
    if (!definition) {
      return errorResponse(
        request.id,
        "ERR_LEGACY_METHOD_NOT_FOUND",
        "The requested legacy host method is not registered.",
      );
    }
    if (
      request.capability !== definition.capability ||
      !definition.actors.includes(request.actor)
    ) {
      return deniedLegacyCapability(request);
    }
    if (
      definition.requiresGrant !== false &&
      !this.#grants.has(
        grantKey(request.pluginId, request.actor, definition.capability),
      )
    ) {
      return deniedLegacyCapability(request);
    }
    if (context.signal?.aborted) {
      return errorResponse(
        request.id,
        "ERR_LEGACY_RPC_ABORTED",
        "The legacy RPC request was aborted.",
      );
    }

    const params = definition.paramsSchema?.safeParse(request.params);
    if (params && !params.success) {
      return errorResponse(
        request.id,
        "ERR_LEGACY_ARGUMENT_INVALID",
        "The legacy RPC parameters are invalid.",
      );
    }

    try {
      const result = await definition.handler(params?.data ?? request.params, {
        ...context,
        requestId: request.id,
      });
      return {
        protocol: "stn.legacy.v1",
        id: request.id,
        ok: true,
        result: assertCloneableResult(
          result,
          definition.maxResultBytes ?? 64 * 1_024,
        ),
      };
    } catch {
      return errorResponse(
        request.id,
        "ERR_LEGACY_HANDLER_FAILED",
        "The legacy host operation failed.",
      );
    }
  }
}

export interface LegacySettingsRpcAdapter {
  load(pluginId: string): Promise<JsonObject | undefined>;
  save(pluginId: string, value: JsonObject): Promise<void>;
}

const settingsSaveSchema = z
  .object({
    value: z.record(z.string(), z.unknown()),
  })
  .strict();

export function registerLegacySettingsRpc(
  broker: LegacyCapabilityBroker,
  adapter: LegacySettingsRpcAdapter,
): readonly (() => void)[] {
  return [
    broker.register({
      method: "settings.load",
      capability: "settings.read",
      actors: ["legacy-plugin"],
      paramsSchema: z.object({}).strict(),
      handler: async (_params, context) =>
        (await adapter.load(context.pluginId)) ?? {},
    }),
    broker.register({
      method: "settings.save",
      capability: "settings.write",
      actors: ["legacy-plugin"],
      paramsSchema: settingsSaveSchema,
      handler: async (params, context) => {
        const value = params.value as JsonObject;
        await adapter.save(context.pluginId, value);
        return { saved: true } satisfies JsonValue;
      },
    }),
  ];
}
