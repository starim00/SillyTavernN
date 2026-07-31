import { z } from "zod";

import {
  CompatibilityEnvelopeSchema,
  DateTimeSchema,
  EntityIdSchema,
  JsonObjectSchema,
} from "./common.js";

export const PromptRoleSchema = z.enum(["system", "user", "assistant", "tool"]);

export const PromptTemplateSchema = z
  .object({
    id: EntityIdSchema,
    name: z.string().trim().min(1).max(512),
    role: PromptRoleSchema,
    content: z.string(),
    enabled: z.boolean(),
    marker: z
      .enum([
        "main",
        "world-before",
        "world-after",
        "persona-description",
        "character-description",
        "character-personality",
        "scenario",
        "examples",
        "history",
        "post-history",
        "custom",
      ])
      .optional(),
    order: z.number().finite(),
    systemPrompt: z.boolean(),
    metadata: JsonObjectSchema,
  })
  .strict();

export type PromptTemplate = z.infer<typeof PromptTemplateSchema>;

export const GenerationSettingsSchema = z
  .object({
    temperature: z.number().finite().optional(),
    topP: z.number().finite().optional(),
    topK: z.number().int().optional(),
    minP: z.number().finite().optional(),
    typicalP: z.number().finite().optional(),
    topA: z.number().finite().optional(),
    tfs: z.number().finite().optional(),
    repetitionPenalty: z.number().finite().optional(),
    repetitionPenaltyRange: z.number().int().nonnegative().optional(),
    frequencyPenalty: z.number().finite().optional(),
    presencePenalty: z.number().finite().optional(),
    maxOutputTokens: z.number().int().positive().optional(),
    seed: z.number().int().optional(),
    stop: z.array(z.string()),
    samplerOrder: z.array(z.union([z.string(), z.number().int()])),
    mirostatMode: z.number().int().nonnegative().optional(),
    mirostatTau: z.number().finite().optional(),
    mirostatEta: z.number().finite().optional(),
    stream: z.boolean().optional(),
    additional: JsonObjectSchema,
  })
  .strict();

export type GenerationSettings = z.infer<typeof GenerationSettingsSchema>;

export const PromptPresetSchema = z
  .object({
    id: EntityIdSchema,
    name: z.string().trim().min(1).max(512),
    mode: z.enum(["chat-completion", "text-generation", "native"]),
    prompts: z.array(PromptTemplateSchema),
    generation: GenerationSettingsSchema,
    extensions: JsonObjectSchema,
    compatibility: CompatibilityEnvelopeSchema.optional(),
    createdAt: DateTimeSchema,
    updatedAt: DateTimeSchema,
  })
  .strict();

export type PromptPreset = z.infer<typeof PromptPresetSchema>;

export const PromptSegmentSourceSchema = z
  .object({
    kind: z.enum([
      "preset",
      "card",
      "participant",
      "narrator",
      "worldbook",
      "conversation",
      "message",
      "artifact",
      "extension",
      "system",
    ]),
    id: EntityIdSchema.optional(),
    label: z.string().max(1024),
    detail: JsonObjectSchema,
  })
  .strict();

export const PromptSegmentSchema = z
  .object({
    id: EntityIdSchema,
    role: PromptRoleSchema,
    content: z.string(),
    source: PromptSegmentSourceSchema,
    position: z.enum([
      "system",
      "before-card",
      "card",
      "after-card",
      "before-examples",
      "examples",
      "after-examples",
      "before-history",
      "history",
      "after-history",
    ]),
    priority: z.number().finite(),
    order: z.number().finite(),
    tokenEstimate: z.number().int().nonnegative(),
    required: z.boolean(),
    truncation: z.enum(["none", "drop", "head", "tail"]),
    metadata: JsonObjectSchema,
  })
  .strict();

export type PromptSegment = z.infer<typeof PromptSegmentSchema>;
