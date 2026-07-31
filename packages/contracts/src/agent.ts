import { z } from "zod";

import {
  DateTimeSchema,
  EntityIdSchema,
  JsonObjectSchema,
  JsonValueSchema,
  RevisionSchema,
} from "./common.js";

export const AgentRunStatusSchema = z.enum([
  "queued",
  "running",
  "waiting_confirmation",
  "completed",
  "cancelled",
  "failed",
]);

export const AgentRunSchema = z
  .object({
    id: EntityIdSchema,
    conversationId: EntityIdSchema,
    status: AgentRunStatusSchema,
    requestedBy: EntityIdSchema,
    provider: z.string().trim().min(1),
    model: z.string().trim().min(1),
    objective: z.string(),
    maxSteps: z.number().int().positive(),
    currentStep: z.number().int().nonnegative(),
    toolCallCount: z.number().int().nonnegative(),
    writeCallCount: z.number().int().nonnegative(),
    idempotencyKey: z.string().trim().min(1).max(512),
    cancelledAt: DateTimeSchema.nullable(),
    createdAt: DateTimeSchema,
    updatedAt: DateTimeSchema,
  })
  .strict();

export type AgentRun = z.infer<typeof AgentRunSchema>;

export const AgentToolDefinitionSchema = z
  .object({
    name: z.string().trim().min(1).max(256),
    description: z.string().trim().min(1).max(4096),
    inputSchema: JsonObjectSchema,
    effect: z.enum(["read", "write", "destructive"]),
    confirmation: z.enum(["never", "policy", "always"]),
    capability: z.string().trim().min(1).max(256),
  })
  .strict();

export type AgentToolDefinition = z.infer<typeof AgentToolDefinitionSchema>;

export const AgentToolCallSchema = z
  .object({
    id: EntityIdSchema,
    runId: EntityIdSchema,
    toolName: z.string().trim().min(1).max(256),
    arguments: JsonObjectSchema,
    status: z.enum([
      "proposed",
      "awaiting_confirmation",
      "running",
      "succeeded",
      "rejected",
      "cancelled",
      "failed",
    ]),
    idempotencyKey: z.string().trim().min(1).max(512),
    effect: z.enum(["read", "write", "destructive"]),
    result: JsonValueSchema.nullable(),
    error: JsonObjectSchema.nullable(),
    requiresConfirmation: z.boolean(),
    confirmedAt: DateTimeSchema.nullable(),
    createdAt: DateTimeSchema,
    updatedAt: DateTimeSchema,
  })
  .strict();

export type AgentToolCall = z.infer<typeof AgentToolCallSchema>;

export const AuditActorSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("agent"),
      actorId: EntityIdSchema,
      runId: EntityIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("legacy-extension"),
      actorId: EntityIdSchema,
      pluginId: EntityIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("user"),
      actorId: EntityIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("system"),
      actorId: EntityIdSchema,
    })
    .strict(),
]);

export const AuditRecordSchema = z
  .object({
    id: EntityIdSchema,
    runId: EntityIdSchema.nullable(),
    toolCallId: EntityIdSchema.nullable(),
    actorKind: z.enum(["human", "agent", "legacy_script", "system"]),
    actorId: EntityIdSchema,
    action: z.string().trim().min(1).max(256),
    resourceType: z.string().trim().min(1).max(256),
    resourceId: EntityIdSchema,
    before: JsonValueSchema.nullable(),
    after: JsonValueSchema.nullable(),
    inversePatch: JsonObjectSchema,
    undoneAt: DateTimeSchema.nullable(),
    undoAuditId: EntityIdSchema.nullable(),
    createdAt: DateTimeSchema,
  })
  .strict();

export type AuditRecord = z.infer<typeof AuditRecordSchema>;

export const AgentArtifactSchema = z
  .object({
    id: EntityIdSchema,
    kind: z.enum(["chat_summary", "participant_profile", "character_profile"]),
    scopeType: z.string().trim().min(1).max(256),
    scopeId: EntityIdSchema,
    title: z.string().max(512),
    content: z.string(),
    metadata: JsonObjectSchema,
    sourceFromMessageId: EntityIdSchema.nullable().optional(),
    sourceToMessageId: EntityIdSchema.nullable().optional(),
    stale: z.boolean().optional(),
    lockedFields: z.array(z.string()).optional(),
    revision: RevisionSchema,
    createdAt: DateTimeSchema,
    updatedAt: DateTimeSchema,
  })
  .strict();

export type AgentArtifact = z.infer<typeof AgentArtifactSchema>;
