import { z } from "zod";

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export const JsonPrimitiveSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    JsonPrimitiveSchema,
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

export const JsonObjectSchema: z.ZodType<JsonObject> = z.record(
  z.string(),
  JsonValueSchema,
);

export const EntityIdSchema = z.string().trim().min(1).max(256);
export const RevisionSchema = z.number().int().nonnegative();
export const DateTimeSchema = z.string().trim().min(1).max(128);

export const CompatibilityEnvelopeSchema = z
  .object({
    sourceFormat: z.string().trim().min(1).max(128),
    sourceVersion: z.string().trim().max(128).optional(),
    originalFilename: z.string().trim().max(1024).optional(),
    unknownFields: JsonObjectSchema,
  })
  .strict();

export type CompatibilityEnvelope = z.infer<typeof CompatibilityEnvelopeSchema>;

export const AssetReferenceSchema = z
  .object({
    id: EntityIdSchema,
    path: z.string().trim().min(1).max(2048),
    mediaType: z.string().trim().min(1).max(256),
    size: z.number().int().nonnegative(),
    kind: z.enum(["avatar", "background", "icon", "audio", "other"]),
    title: z.string().trim().max(512).optional(),
    hash: z.string().trim().max(256).optional(),
  })
  .strict();

export type AssetReference = z.infer<typeof AssetReferenceSchema>;

export const DiagnosticSchema = z
  .object({
    severity: z.enum(["info", "warning", "error"]),
    code: z.string().trim().min(1).max(128),
    message: z.string().trim().min(1).max(4096),
    path: z.string().trim().max(2048).optional(),
  })
  .strict();

export type Diagnostic = z.infer<typeof DiagnosticSchema>;
