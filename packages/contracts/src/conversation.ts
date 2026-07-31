import { z } from "zod";

import {
  CompatibilityEnvelopeSchema,
  DateTimeSchema,
  EntityIdSchema,
  JsonObjectSchema,
  RevisionSchema,
} from "./common.js";

export const ConversationParticipantSchema = z
  .object({
    participantId: EntityIdSchema,
    sourceCardId: EntityIdSchema.optional(),
    displayName: z.string().trim().min(1).max(512),
    enabled: z.boolean(),
    speakingOrder: z.number().int().nonnegative(),
    metadata: JsonObjectSchema,
  })
  .strict();

export type ConversationParticipant = z.infer<
  typeof ConversationParticipantSchema
>;

export const ConversationSchema = z
  .object({
    id: EntityIdSchema,
    title: z.string().trim().min(1).max(1024),
    sourceCardIds: z.array(EntityIdSchema),
    participants: z.array(ConversationParticipantSchema),
    worldbookIds: z.array(EntityIdSchema),
    personaId: EntityIdSchema.optional(),
    activeBranchId: EntityIdSchema,
    summaryArtifactId: EntityIdSchema.optional(),
    metadata: JsonObjectSchema,
    compatibility: CompatibilityEnvelopeSchema.optional(),
    revision: RevisionSchema,
    createdAt: DateTimeSchema,
    updatedAt: DateTimeSchema,
  })
  .strict();

export type Conversation = z.infer<typeof ConversationSchema>;

export const MessageAuthorSchema = z
  .object({
    kind: z.enum(["user", "assistant", "system", "tool"]),
    participantId: EntityIdSchema.optional(),
    displayName: z.string().trim().max(512).optional(),
  })
  .strict();

export const MessageSwipeSchema = z
  .object({
    id: EntityIdSchema,
    content: z.string(),
    createdAt: DateTimeSchema,
    metadata: JsonObjectSchema,
  })
  .strict();

export type MessageSwipe = z.infer<typeof MessageSwipeSchema>;

export const MessageSchema = z
  .object({
    id: EntityIdSchema,
    conversationId: EntityIdSchema,
    branchId: EntityIdSchema,
    parentMessageId: EntityIdSchema.optional(),
    sequence: z.number().int().nonnegative(),
    role: z.enum(["system", "user", "assistant", "tool"]),
    author: MessageAuthorSchema,
    swipes: z.array(MessageSwipeSchema).min(1),
    activeSwipeId: EntityIdSchema,
    state: z.enum(["draft", "complete", "cancelled", "error"]),
    toolCallId: EntityIdSchema.optional(),
    metadata: JsonObjectSchema,
    compatibility: CompatibilityEnvelopeSchema.optional(),
    revision: RevisionSchema,
    createdAt: DateTimeSchema,
    updatedAt: DateTimeSchema,
  })
  .strict()
  .superRefine((message, context) => {
    if (!message.swipes.some((swipe) => swipe.id === message.activeSwipeId)) {
      context.addIssue({
        code: "custom",
        message: "activeSwipeId must reference one of the message swipes",
        path: ["activeSwipeId"],
      });
    }
    if (message.author.kind !== message.role) {
      context.addIssue({
        code: "custom",
        message: "author.kind must match the message role",
        path: ["author", "kind"],
      });
    }
    if (
      message.author.participantId !== undefined &&
      message.role !== "assistant"
    ) {
      context.addIssue({
        code: "custom",
        message:
          "participantId is attribution metadata for assistant messages only",
        path: ["author", "participantId"],
      });
    }
  });

export type Message = z.infer<typeof MessageSchema>;
