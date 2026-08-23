import { z } from "zod";

export const LEGACY_REALM_PROTOCOL = "stn.legacy.v1" as const;

export const LEGACY_RPC_METHOD_CAPABILITIES = {
  "settings.load": "settings.read",
  "settings.save": "settings.write",
  "settings.get": "settings.read",
  "settings.set": "settings.write",
  "character.current.read": "character.read",
  "preset.current.read": "preset.read",
  "character.scripts.read": "character.read",
  "preset.scripts.read": "preset.read",
  "chat.snapshot": "chat.read",
  "chat.message.send": "chat.write",
} as const;

export type LegacyRpcMethod = keyof typeof LEGACY_RPC_METHOD_CAPABILITIES;

export function legacyRpcCapability(method: string): string | undefined {
  return LEGACY_RPC_METHOD_CAPABILITIES[method as LegacyRpcMethod];
}

export const legacyActorSchema = z.enum(["legacy-plugin", "embedded-script"]);
export type LegacyActor = z.infer<typeof legacyActorSchema>;

const boundedText = (maximumLength: number) =>
  z.string().trim().min(1).max(maximumLength);

export const legacyRpcRequestSchema = z
  .object({
    protocol: z.literal(LEGACY_REALM_PROTOCOL),
    id: boundedText(512),
    pluginId: boundedText(256),
    actor: legacyActorSchema,
    method: boundedText(256),
    capability: boundedText(512),
    params: z.unknown(),
  })
  .strict()
  .refine(
    (value) => Object.prototype.hasOwnProperty.call(value, "params"),
    "Legacy RPC requests must include params.",
  );

export type LegacyRpcRequest = z.infer<typeof legacyRpcRequestSchema>;

const legacyRpcSuccessSchema = z
  .object({
    protocol: z.literal(LEGACY_REALM_PROTOCOL),
    id: boundedText(512),
    ok: z.literal(true),
    result: z.unknown(),
  })
  .strict()
  .refine(
    (value) => Object.prototype.hasOwnProperty.call(value, "result"),
    "Successful legacy RPC responses must include a result.",
  );

const legacyRpcErrorSchema = z
  .object({
    protocol: z.literal(LEGACY_REALM_PROTOCOL),
    id: boundedText(512),
    ok: z.literal(false),
    error: z
      .object({
        code: boundedText(256),
        message: boundedText(4_096),
        capability: boundedText(512).optional(),
      })
      .strict(),
  })
  .strict();

export const legacyRpcResponseSchema = z.discriminatedUnion("ok", [
  legacyRpcSuccessSchema,
  legacyRpcErrorSchema,
]);

export type LegacyRpcResponse = z.infer<typeof legacyRpcResponseSchema>;

export function parseLegacyRpcResponse(
  input: unknown,
  expectedId?: string,
): LegacyRpcResponse {
  const response = legacyRpcResponseSchema.parse(input);
  if (expectedId !== undefined && response.id !== expectedId) {
    throw new Error("Legacy RPC response id does not match the request.");
  }
  return response;
}

export function isLegacyRpcResponse(
  input: unknown,
  expectedId?: string,
): input is LegacyRpcResponse {
  try {
    parseLegacyRpcResponse(input, expectedId);
    return true;
  } catch {
    return false;
  }
}

export function legacyRpcSuccess(
  id: string,
  result: unknown,
): LegacyRpcResponse {
  return {
    protocol: LEGACY_REALM_PROTOCOL,
    id,
    ok: true,
    result: result === undefined ? null : result,
  };
}

export function legacyRpcError(
  id: string,
  code: string,
  message: string,
  capability?: string,
): LegacyRpcResponse {
  return {
    protocol: LEGACY_REALM_PROTOCOL,
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
  return legacyRpcError(
    request.id,
    "ERR_LEGACY_CAPABILITY_DENIED",
    message,
    request.capability,
  );
}
