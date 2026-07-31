import { z } from "zod";

import { EntityIdSchema, JsonObjectSchema, JsonValueSchema } from "./common.js";

export const ProviderCapabilitiesSchema = z
  .object({
    streaming: z.boolean(),
    nativeToolCalling: z.boolean(),
    reasoning: z.boolean(),
    vision: z.boolean(),
    maxContextTokens: z.number().int().positive().optional(),
  })
  .strict();

export type ProviderCapabilities = z.infer<typeof ProviderCapabilitiesSchema>;

const ProviderEventBaseSchema = z.object({
  requestId: EntityIdSchema,
  sequence: z.number().int().nonnegative(),
});

export const ProviderEventSchema = z.discriminatedUnion("type", [
  ProviderEventBaseSchema.extend({
    type: z.literal("start"),
    model: z.string().trim().min(1),
    capabilities: ProviderCapabilitiesSchema,
  }).strict(),
  ProviderEventBaseSchema.extend({
    type: z.literal("text-delta"),
    delta: z.string(),
    choiceIndex: z.number().int().nonnegative().optional(),
  }).strict(),
  ProviderEventBaseSchema.extend({
    type: z.literal("reasoning-delta"),
    delta: z.string(),
    choiceIndex: z.number().int().nonnegative().optional(),
  }).strict(),
  ProviderEventBaseSchema.extend({
    type: z.literal("tool-call-start"),
    callId: EntityIdSchema,
    name: z.string().trim().min(1),
    choiceIndex: z.number().int().nonnegative().optional(),
  }).strict(),
  ProviderEventBaseSchema.extend({
    type: z.literal("tool-call-delta"),
    callId: EntityIdSchema,
    argumentsDelta: z.string(),
    choiceIndex: z.number().int().nonnegative().optional(),
  }).strict(),
  ProviderEventBaseSchema.extend({
    type: z.literal("tool-call-complete"),
    callId: EntityIdSchema,
    name: z.string().trim().min(1),
    arguments: JsonObjectSchema,
    choiceIndex: z.number().int().nonnegative().optional(),
  }).strict(),
  ProviderEventBaseSchema.extend({
    type: z.literal("usage"),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cachedTokens: z.number().int().nonnegative().optional(),
  }).strict(),
  ProviderEventBaseSchema.extend({
    type: z.literal("finish"),
    reason: z.enum(["stop", "length", "tool-calls", "cancelled"]),
  }).strict(),
  ProviderEventBaseSchema.extend({
    type: z.literal("error"),
    code: z.string().trim().min(1),
    message: z.string().trim().min(1),
    retryable: z.boolean(),
    detail: JsonValueSchema.optional(),
  }).strict(),
]);

export type ProviderEvent = z.infer<typeof ProviderEventSchema>;
