import type { ProviderTool } from "@stn/providers";
import type { JsonObject } from "@stn/storage";

export type ToolEffect = "read" | "write" | "destructive";

export interface ConversationTool extends ProviderTool {
  readonly effect: ToolEffect;
}

const stringSchema: JsonObject = { type: "string", minLength: 1 };
const revisionSchema: JsonObject = { type: "integer", minimum: 0 };
const stringArraySchema: JsonObject = {
  type: "array",
  items: stringSchema,
};
const openObjectSchema: JsonObject = {
  type: "object",
  additionalProperties: true,
};

function objectSchema(
  properties: JsonObject,
  required: readonly string[] = [],
): JsonObject {
  return {
    type: "object",
    properties,
    required: [...required],
    additionalProperties: false,
  };
}

export const conversationTools: readonly ConversationTool[] = [
  {
    name: "worldbook.list",
    effect: "read",
    description: "List worldbooks available to the current conversation.",
    inputSchema: objectSchema({}),
  },
  {
    name: "worldbook.get",
    effect: "read",
    description: "Read worldbook metadata and paged entries.",
    inputSchema: objectSchema(
      {
        worldbookId: stringSchema,
        offset: revisionSchema,
        limit: revisionSchema,
      },
      ["worldbookId"],
    ),
  },
  {
    name: "worldbook.search",
    effect: "read",
    description: "Search available worldbook entries.",
    inputSchema: objectSchema(
      {
        worldbookId: stringSchema,
        query: stringSchema,
        limit: revisionSchema,
      },
      ["worldbookId", "query"],
    ),
  },
  {
    name: "worldbook.entry.create",
    effect: "write",
    description:
      "Propose a new read-only-by-default entry in a worldbook available to this conversation. Creation always requires human confirmation.",
    inputSchema: objectSchema(
      {
        worldbookId: stringSchema,
        expectedRevision: revisionSchema,
        entry: objectSchema(
          {
            title: { type: "string" },
            keys: stringArraySchema,
            content: stringSchema,
            enabled: { type: "boolean" },
            position: revisionSchema,
            metadata: openObjectSchema,
          },
          ["content"],
        ),
      },
      ["worldbookId", "expectedRevision", "entry"],
    ),
  },
  {
    name: "worldbook.entry.update",
    effect: "write",
    description:
      "Propose allowed field changes to one explicitly AI-editable worldbook entry. Human confirmation is still required.",
    inputSchema: objectSchema(
      {
        worldbookId: stringSchema,
        entryId: stringSchema,
        expectedRevision: revisionSchema,
        expectedEntryRevision: revisionSchema,
        patch: openObjectSchema,
      },
      [
        "worldbookId",
        "entryId",
        "expectedRevision",
        "expectedEntryRevision",
        "patch",
      ],
    ),
  },
  {
    name: "worldbook.entry.delete",
    effect: "destructive",
    description:
      "Propose deleting one explicitly AI-editable worldbook entry. Human confirmation is always required.",
    inputSchema: objectSchema(
      {
        worldbookId: stringSchema,
        entryId: stringSchema,
        expectedRevision: revisionSchema,
        expectedEntryRevision: revisionSchema,
      },
      ["worldbookId", "entryId", "expectedRevision", "expectedEntryRevision"],
    ),
  },
  {
    name: "chat.messages.list",
    effect: "read",
    description:
      "List the current conversation messages in order. Defaults to 50 items and never returns more than 200 items per call; use message IDs as summary source bounds.",
    inputSchema: objectSchema({
      offset: revisionSchema,
      limit: { type: "integer", minimum: 1, maximum: 200 },
    }),
  },
  {
    name: "chat.summary.get",
    effect: "read",
    description: "Read the current conversation summary artifact.",
    inputSchema: objectSchema({}),
  },
  {
    name: "chat.summary.create",
    effect: "write",
    description: "Propose a summary from an explicit message range.",
    inputSchema: objectSchema(
      {
        title: { type: "string" },
        content: stringSchema,
        sourceFromMessageId: stringSchema,
        sourceToMessageId: stringSchema,
        keyEvents: { type: "array", items: openObjectSchema },
        unresolvedThreads: { type: "array", items: openObjectSchema },
        characterStates: openObjectSchema,
      },
      ["content", "sourceFromMessageId", "sourceToMessageId"],
    ),
  },
  {
    name: "chat.summary.update",
    effect: "write",
    description: "Propose updating a revision-guarded summary artifact.",
    inputSchema: objectSchema(
      {
        artifactId: stringSchema,
        expectedRevision: revisionSchema,
        title: { type: "string" },
        content: { type: "string" },
        sourceFromMessageId: stringSchema,
        sourceToMessageId: stringSchema,
        keyEvents: { type: "array", items: openObjectSchema },
        unresolvedThreads: { type: "array", items: openObjectSchema },
        characterStates: openObjectSchema,
      },
      ["artifactId", "expectedRevision"],
    ),
  },
  {
    name: "character.profile.get",
    effect: "read",
    description: "Read a derived participant profile.",
    inputSchema: objectSchema({ participantId: stringSchema }, [
      "participantId",
    ]),
  },
  {
    name: "character.profile.create",
    effect: "write",
    description: "Propose a profile without changing the imported card.",
    inputSchema: objectSchema(
      {
        participantId: stringSchema,
        title: { type: "string" },
        content: stringSchema,
        traits: stringArraySchema,
        goals: stringArraySchema,
        relationships: { type: "array", items: openObjectSchema },
        facts: { type: "array", items: openObjectSchema },
      },
      ["participantId", "content"],
    ),
  },
  {
    name: "character.profile.update",
    effect: "write",
    description: "Propose changes to unlocked participant profile fields.",
    inputSchema: objectSchema(
      {
        artifactId: stringSchema,
        participantId: stringSchema,
        expectedRevision: revisionSchema,
        title: { type: "string" },
        content: { type: "string" },
        traits: stringArraySchema,
        goals: stringArraySchema,
        relationships: { type: "array", items: openObjectSchema },
        facts: { type: "array", items: openObjectSchema },
      },
      ["artifactId", "participantId", "expectedRevision"],
    ),
  },
  {
    name: "agent.change.undo",
    effect: "destructive",
    description:
      "Undo one audited, conflict-free model change by human request.",
    inputSchema: objectSchema({ auditId: stringSchema }, ["auditId"]),
  },
];

export const modelConversationTools = conversationTools.filter(
  (tool) => tool.name !== "agent.change.undo",
);

export const conversationToolsByName = new Map(
  conversationTools.map((tool) => [tool.name, tool]),
);
