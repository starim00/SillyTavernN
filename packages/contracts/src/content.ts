import { z } from "zod";

import {
  AssetReferenceSchema,
  CompatibilityEnvelopeSchema,
  DateTimeSchema,
  EntityIdSchema,
  JsonObjectSchema,
  RevisionSchema,
} from "./common.js";

export const ParticipantKindSchema = z.enum([
  "character",
  "narrator",
  "user",
  "entity",
]);

export const ParticipantSchema = z
  .object({
    id: EntityIdSchema,
    name: z.string().trim().min(1).max(512),
    kind: ParticipantKindSchema,
    aliases: z.array(z.string().trim().min(1).max(512)),
    description: z.string(),
    personality: z.string(),
    scenario: z.string(),
    firstMessage: z.string(),
    alternateGreetings: z.array(z.string()),
    exampleDialogue: z.string(),
    systemPrompt: z.string(),
    postHistoryInstructions: z.string(),
    tags: z.array(z.string().trim().min(1).max(256)),
    avatarAssetId: EntityIdSchema.optional(),
    extensions: JsonObjectSchema,
    compatibility: CompatibilityEnvelopeSchema.optional(),
  })
  .strict();

export type Participant = z.infer<typeof ParticipantSchema>;

export const PersonaSchema = z
  .object({
    id: EntityIdSchema,
    name: z.string().trim().min(1).max(512),
    description: z.string(),
    title: z.string().max(512),
    isDefault: z.boolean(),
    revision: RevisionSchema,
    createdAt: DateTimeSchema,
    updatedAt: DateTimeSchema,
  })
  .strict();

export type Persona = z.infer<typeof PersonaSchema>;

export const CardKindSchema = z.enum([
  "character",
  "ensemble",
  "scenario",
  "world",
]);

export type CardKind = z.infer<typeof CardKindSchema>;

export const CardSchema = z
  .object({
    id: EntityIdSchema,
    kind: CardKindSchema,
    name: z.string().trim().min(1).max(512),
    description: z.string(),
    scenario: z.string(),
    worldDescription: z.string(),
    participants: z.array(ParticipantSchema),
    narrator: ParticipantSchema.optional(),
    greeting: z.string(),
    alternateGreetings: z.array(z.string()),
    exampleDialogue: z.string(),
    systemPrompt: z.string(),
    postHistoryInstructions: z.string(),
    creator: z.string().max(512),
    creatorNotes: z.string(),
    version: z.string().max(256),
    tags: z.array(z.string().trim().min(1).max(256)),
    assets: z.array(AssetReferenceSchema),
    worldbookIds: z.array(EntityIdSchema),
    extensions: JsonObjectSchema,
    compatibility: CompatibilityEnvelopeSchema.optional(),
    createdAt: DateTimeSchema,
    updatedAt: DateTimeSchema,
  })
  .strict()
  .superRefine((card, context) => {
    const ids = new Set<string>();
    for (const participant of [
      ...card.participants,
      ...(card.narrator ? [card.narrator] : []),
    ]) {
      if (ids.has(participant.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate participant id: ${participant.id}`,
          path: ["participants"],
        });
      }
      ids.add(participant.id);
    }
  });

export type Card = z.infer<typeof CardSchema>;

export const WorldbookBindingSchema = z
  .object({
    scope: z.enum(["global", "card", "conversation", "participant", "persona"]),
    targetId: EntityIdSchema.optional(),
  })
  .strict()
  .superRefine((binding, context) => {
    if (binding.scope !== "global" && !binding.targetId) {
      context.addIssue({
        code: "custom",
        message: "A non-global binding requires targetId",
        path: ["targetId"],
      });
    }
  });

export const WorldbookInsertionPositionSchema = z.enum([
  "before-card",
  "after-card",
  "author-note-top",
  "author-note-bottom",
  "at-depth",
  "examples-top",
  "examples-bottom",
  "outlet",
]);

export const WorldbookInjectionRoleSchema = z.enum([
  "system",
  "user",
  "assistant",
]);

export const WorldbookEntrySchema = z
  .object({
    id: EntityIdSchema,
    legacyUid: z.union([z.string(), z.number().int()]).optional(),
    label: z.string().max(1024),
    content: z.string(),
    primaryKeys: z.array(z.string()),
    secondaryKeys: z.array(z.string()),
    secondaryLogic: z.enum(["any", "all", "not-any", "not-all"]),
    selective: z.boolean(),
    constant: z.boolean(),
    disabled: z.boolean(),
    agentEditable: z.boolean().default(false),
    caseSensitive: z.boolean(),
    matchWholeWords: z.boolean(),
    scanDepth: z.number().int().positive().max(10_000).optional(),
    recursion: z.boolean(),
    preventRecursion: z.boolean(),
    excludeRecursion: z.boolean().optional(),
    delayUntilRecursion: z.boolean().optional(),
    useRegex: z.boolean().optional(),
    legacyInsertionOrder: z.number().finite().optional(),
    insertionPosition: WorldbookInsertionPositionSchema.optional(),
    outletName: z.string().max(1024).optional(),
    insertionDepth: z.number().int().nonnegative().max(10_000).optional(),
    insertionRole: WorldbookInjectionRoleSchema.optional(),
    position: z.enum([
      "before-card",
      "after-card",
      "before-examples",
      "after-examples",
      "before-history",
      "after-history",
    ]),
    order: z.number().finite(),
    priority: z.number().finite(),
    extensions: JsonObjectSchema,
    compatibility: CompatibilityEnvelopeSchema.optional(),
    revision: RevisionSchema,
  })
  .strict();

export type WorldbookEntry = z.infer<typeof WorldbookEntrySchema>;

export const WorldbookSchema = z
  .object({
    id: EntityIdSchema,
    name: z.string().trim().min(1).max(512),
    description: z.string(),
    entries: z.array(WorldbookEntrySchema),
    bindings: z.array(WorldbookBindingSchema),
    scanDepth: z.number().int().positive().max(10_000),
    recursionLimit: z.number().int().nonnegative().max(32),
    // Deprecated compatibility metadata. Agent write authorization is
    // evaluated per WorldbookEntry.
    agentEditable: z.boolean(),
    revision: RevisionSchema,
    extensions: JsonObjectSchema,
    compatibility: CompatibilityEnvelopeSchema.optional(),
    createdAt: DateTimeSchema,
    updatedAt: DateTimeSchema,
  })
  .strict();

export type Worldbook = z.infer<typeof WorldbookSchema>;
