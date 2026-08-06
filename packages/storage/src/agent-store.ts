import { randomUUID } from "node:crypto";

import type { AppStore } from "./store.js";
import {
  ConflictError,
  NotFoundError,
  PermissionError,
  RunCancelledError,
  StorageError,
} from "./errors.js";
import type {
  AgentRun,
  Artifact,
  AuditRecord,
  JsonObject,
  JsonValue,
  ToolCall,
  ToolCallStatus,
  Worldbook,
  WorldbookEntry,
} from "./models.js";

type RowValue = string | number | null;
type Row = Record<string, RowValue>;

const timestamp = (): string => new Date().toISOString();
const identifier = (): string => randomUUID();

function encode(value: unknown): string {
  return JSON.stringify(value);
}

function toJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function decodeValue(value: string | null): JsonValue | null {
  return value === null ? null : (JSON.parse(value) as JsonValue);
}

function decodeObject(value: string): JsonObject {
  const parsed = JSON.parse(value) as JsonValue;
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new StorageError(
      "invalid_persisted_json",
      "Expected a persisted JSON object.",
      500,
    );
  }
  return parsed;
}

function strictKeys(
  value: JsonObject,
  allowed: readonly string[],
  toolName: string,
): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !allowedSet.has(key));
  if (unknown.length > 0) {
    throw new StorageError(
      "TOOL_ARGUMENT_INVALID",
      `Tool '${toolName}' received unsupported fields.`,
      400,
      { unknown },
    );
  }
}

function stringArgument(
  value: JsonObject,
  name: string,
  toolName: string,
): string {
  const result = value[name];
  if (typeof result !== "string" || result.trim().length === 0) {
    throw new StorageError(
      "TOOL_ARGUMENT_INVALID",
      `Tool '${toolName}' requires a non-empty string '${name}'.`,
      400,
    );
  }
  return result;
}

function optionalString(value: JsonObject, name: string): string | undefined {
  const result = value[name];
  return typeof result === "string" ? result : undefined;
}

function numberArgument(
  value: JsonObject,
  name: string,
  toolName: string,
): number {
  const result = value[name];
  if (typeof result !== "number" || !Number.isInteger(result) || result < 0) {
    throw new StorageError(
      "TOOL_ARGUMENT_INVALID",
      `Tool '${toolName}' requires a non-negative integer '${name}'.`,
      400,
    );
  }
  return result;
}

function stringArray(value: JsonObject, name: string): string[] {
  const result = value[name];
  if (result === undefined) return [];
  if (
    !Array.isArray(result) ||
    !result.every((item) => typeof item === "string")
  ) {
    throw new StorageError(
      "TOOL_ARGUMENT_INVALID",
      `'${name}' must be an array of strings.`,
      400,
    );
  }
  return result;
}

function metadataStringArray(
  value: JsonValue | undefined,
): string[] | undefined {
  return Array.isArray(value) &&
    value.every((item): item is string => typeof item === "string")
    ? value
    : undefined;
}

function sameStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function synchronizedWorldbookMetadata(
  current: JsonObject,
  patch: JsonObject | undefined,
  keys: string[] | undefined,
  title: string | undefined,
): JsonObject {
  const metadata: JsonObject = { ...current, ...patch };
  if (keys !== undefined) {
    const primaryKeys = metadataStringArray(metadata.primaryKeys);
    const secondaryKeys = metadataStringArray(metadata.secondaryKeys) ?? [];
    if (
      primaryKeys === undefined ||
      !sameStrings([...primaryKeys, ...secondaryKeys], keys)
    ) {
      metadata.primaryKeys = keys;
      metadata.secondaryKeys = [];
      metadata.selective = false;
    }
  }
  if (title !== undefined) {
    metadata.label = title;
    metadata.title = title;
  }
  return metadata;
}

export interface CreateAgentRunInput {
  readonly id?: string;
  readonly conversationId: string;
  readonly requestedBy: string;
  readonly provider: string;
  readonly model: string;
  readonly objective: string;
  readonly idempotencyKey: string;
  readonly maxSteps?: number;
}

export interface ExecuteAgentToolInput {
  readonly runId: string;
  readonly idempotencyKey: string;
  readonly toolName: string;
  readonly arguments: JsonObject;
  readonly confirmed?: boolean;
  /**
   * Records write/destructive calls as proposals. Ordinary chat generation uses
   * this so a model response can never turn into an unreviewed write.
   */
  readonly proposalOnly?: boolean;
}

export interface ExecuteAgentToolResult {
  readonly call: ToolCall;
  readonly result?: JsonValue;
  readonly replayed: boolean;
}

const toolEffects: Readonly<Record<string, "read" | "write" | "destructive">> =
  {
    "worldbook.list": "read",
    "worldbook.get": "read",
    "worldbook.search": "read",
    "worldbook.entry.create": "write",
    "worldbook.entry.update": "write",
    "worldbook.entry.delete": "destructive",
    "chat.messages.list": "read",
    "chat.summary.get": "read",
    "chat.summary.create": "write",
    "chat.summary.update": "write",
    "character.profile.get": "read",
    "character.profile.create": "write",
    "character.profile.update": "write",
    "agent.change.undo": "destructive",
  };

export class AgentStore {
  constructor(readonly store: AppStore) {}

  createRun(input: CreateAgentRunInput): {
    run: AgentRun;
    replayed: boolean;
  } {
    return this.store.database.transaction(() => {
      const existing = this.store.database.get<Row>(
        "SELECT * FROM agent_runs WHERE requested_by = ? AND idempotency_key = ?",
        input.requestedBy,
        input.idempotencyKey,
      );
      if (existing) {
        return { run: this.mapRun(existing), replayed: true };
      }
      this.store.getConversation(input.conversationId);
      const now = timestamp();
      const id = input.id ?? identifier();
      const maxSteps = Math.max(1, Math.min(input.maxSteps ?? 8, 32));
      this.store.database.run(
        `INSERT INTO agent_runs(
           id, conversation_id, status, requested_by, provider, model, objective,
           max_steps, current_step, tool_call_count, write_call_count,
           idempotency_key, created_at, updated_at
         ) VALUES (?, ?, 'queued', ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?)`,
        id,
        input.conversationId,
        input.requestedBy,
        input.provider,
        input.model,
        input.objective,
        maxSteps,
        input.idempotencyKey,
        now,
        now,
      );
      return { run: this.getRun(id), replayed: false };
    });
  }

  getRun(id: string): AgentRun {
    const row = this.store.database.get<Row>(
      "SELECT * FROM agent_runs WHERE id = ?",
      id,
    );
    if (!row) throw new NotFoundError("agent run", id);
    return this.mapRun(row);
  }

  listRuns(conversationId?: string): AgentRun[] {
    const rows = conversationId
      ? this.store.database.all<Row>(
          "SELECT * FROM agent_runs WHERE conversation_id = ? ORDER BY created_at DESC, id",
          conversationId,
        )
      : this.store.database.all<Row>(
          "SELECT * FROM agent_runs ORDER BY created_at DESC, id",
        );
    return rows.map((row) => this.mapRun(row));
  }

  transitionRun(
    id: string,
    expected: readonly AgentRun["status"][],
    status: AgentRun["status"],
    patch: {
      currentStep?: number;
      error?: JsonObject | null;
    } = {},
  ): AgentRun {
    return this.store.database.transaction(() => {
      const current = this.getRun(id);
      if (!expected.includes(current.status)) {
        throw new ConflictError(
          `Agent run '${id}' cannot move from '${current.status}' to '${status}'.`,
          { expected, actual: current.status },
        );
      }
      const now = timestamp();
      this.store.database.run(
        `UPDATE agent_runs
         SET status = ?, current_step = ?, updated_at = ?
         WHERE id = ? AND status = ?`,
        status,
        patch.currentStep ?? current.currentStep,
        now,
        id,
        current.status,
      );
      return this.getRun(id);
    });
  }

  cancelRun(id: string, requestedBy: string): AgentRun {
    return this.store.database.transaction(() => {
      const current = this.getRun(id);
      if (current.requestedBy !== requestedBy) {
        throw new PermissionError(
          "Only the user who started a run may cancel it.",
        );
      }
      if (["completed", "failed", "cancelled"].includes(current.status)) {
        return current;
      }
      const now = timestamp();
      this.store.database.run(
        `UPDATE agent_runs
         SET status = 'cancelled', cancelled_at = ?, updated_at = ?
         WHERE id = ?`,
        now,
        now,
        id,
      );
      this.store.database.run(
        `UPDATE tool_calls
         SET status = 'cancelled',
             error_json = ?,
             updated_at = ?
         WHERE run_id = ? AND status IN ('proposed','awaiting_confirmation','running')`,
        encode({ code: "AGENT_RUN_CANCELLED" }),
        now,
        id,
      );
      return this.getRun(id);
    });
  }

  getToolCall(id: string): ToolCall {
    const row = this.store.database.get<Row>(
      "SELECT * FROM tool_calls WHERE id = ?",
      id,
    );
    if (!row) throw new NotFoundError("tool call", id);
    return this.mapToolCall(row);
  }

  listToolCalls(runId: string): ToolCall[] {
    this.getRun(runId);
    return this.store.database
      .all<Row>(
        "SELECT * FROM tool_calls WHERE run_id = ? ORDER BY created_at, id",
        runId,
      )
      .map((row) => this.mapToolCall(row));
  }

  executeTool(input: ExecuteAgentToolInput): ExecuteAgentToolResult {
    let deferredError: unknown;
    const response = this.store.database.transaction(() => {
      const existingBeforeRun = this.store.database.get<Row>(
        "SELECT * FROM tool_calls WHERE run_id = ? AND idempotency_key = ?",
        input.runId,
        input.idempotencyKey,
      );
      const run = this.assertRunActive(
        input.runId,
        input.toolName === "agent.change.undo" ||
          existingBeforeRun?.status === "succeeded",
      );
      const effect = toolEffects[input.toolName];
      if (!effect) {
        throw new StorageError(
          "TOOL_NOT_FOUND",
          `Agent tool '${input.toolName}' is not registered.`,
          404,
        );
      }
      const existing = this.store.database.get<Row>(
        "SELECT * FROM tool_calls WHERE run_id = ? AND idempotency_key = ?",
        input.runId,
        input.idempotencyKey,
      );
      let effectiveArguments = input.arguments;
      if (existing) {
        const call = this.mapToolCall(existing);
        if (call.toolName !== input.toolName) {
          throw new ConflictError(
            "An idempotency key cannot be reused for a different tool.",
          );
        }
        if (call.status === "succeeded") {
          return {
            call,
            ...(call.result === null ? {} : { result: call.result }),
            replayed: true,
          };
        }
        if (
          call.status !== "awaiting_confirmation" ||
          input.confirmed !== true
        ) {
          return { call, replayed: true };
        }
        // A confirmation always executes the persisted proposal. Request
        // arguments cannot be substituted after the user has reviewed it.
        effectiveArguments = this.rebasePermissionRevision(call, run);
      }

      const now = timestamp();
      const callId = existing ? String(existing.id) : identifier();
      if (!existing) {
        this.store.database.run(
          `INSERT INTO tool_calls(
             id, run_id, idempotency_key, tool_name, arguments_json, status,
             effect, requires_confirmation, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, 'proposed', ?, 0, ?, ?)`,
          callId,
          input.runId,
          input.idempotencyKey,
          input.toolName,
          encode(input.arguments),
          effect,
          now,
          now,
        );
      } else if (
        encode(effectiveArguments) !== String(existing.arguments_json)
      ) {
        // Enabling Agent edits is itself a revisioned human action. Rebase only
        // that single, verified permission revision so the exact pending
        // proposal remains confirmable; dispatch still checks the live revision.
        this.store.database.run(
          "UPDATE tool_calls SET arguments_json = ?, updated_at = ? WHERE id = ?",
          encode(effectiveArguments),
          now,
          callId,
        );
      }

      try {
        const requirement = this.confirmationRequirement(input.toolName);
        const mustRemainProposal =
          input.proposalOnly === true && effect !== "read";
        if ((requirement || mustRemainProposal) && input.confirmed !== true) {
          this.store.database.run(
            `UPDATE tool_calls
             SET status = 'awaiting_confirmation',
                 requires_confirmation = 1,
                 updated_at = ?
             WHERE id = ?`,
            now,
            callId,
          );
          this.store.database.run(
            "UPDATE agent_runs SET status = 'waiting_confirmation', updated_at = ? WHERE id = ?",
            now,
            run.id,
          );
          return { call: this.getToolCall(callId), replayed: false };
        }

        return this.store.database.transaction(() => {
          const latestRun = this.assertRunActive(
            input.runId,
            input.toolName === "agent.change.undo",
          );
          const nextToolCount = latestRun.toolCallCount + 1;
          const nextWriteCount =
            effect === "read"
              ? latestRun.writeCallCount
              : latestRun.writeCallCount + 1;
          if (nextToolCount > 16) {
            throw new StorageError(
              "AGENT_TOOL_CALL_LIMIT_REACHED",
              "The Agent run exceeded its tool-call limit.",
              409,
            );
          }
          if (nextWriteCount > 5) {
            throw new StorageError(
              "AGENT_WRITE_LIMIT_REACHED",
              "The Agent run exceeded its write-call limit.",
              409,
            );
          }
          this.store.database.run(
            `UPDATE tool_calls
             SET status = 'running',
                 confirmed_at = CASE WHEN ? = 1 THEN ? ELSE confirmed_at END,
                 error_json = NULL,
                 updated_at = ?
             WHERE id = ?`,
            input.confirmed ? 1 : 0,
            now,
            now,
            callId,
          );
          const result = toJson(
            this.dispatchTool(run, callId, input.toolName, effectiveArguments),
          );
          this.store.database.run(
            `UPDATE tool_calls
             SET status = 'succeeded', result_json = ?, updated_at = ?
             WHERE id = ?`,
            encode(result),
            timestamp(),
            callId,
          );
          const nextStatus: AgentRun["status"] =
            input.toolName === "agent.change.undo" ||
            (existing?.status === "awaiting_confirmation" &&
              input.confirmed === true)
              ? "completed"
              : "running";
          this.store.database.run(
            `UPDATE agent_runs
             SET status = ?,
                 tool_call_count = ?,
                 write_call_count = ?,
                 updated_at = ?
             WHERE id = ?`,
            nextStatus,
            nextToolCount,
            nextWriteCount,
            timestamp(),
            run.id,
          );
          return {
            call: this.getToolCall(callId),
            result,
            replayed: false,
          };
        });
      } catch (error) {
        const structured = {
          code:
            error instanceof StorageError
              ? error.code
              : "AGENT_TOOL_EXECUTION_FAILED",
          message: error instanceof Error ? error.message : String(error),
        };
        const keepPending =
          existing !== undefined &&
          input.confirmed === true &&
          error instanceof StorageError &&
          error.code === "WORLD_BOOK_ENTRY_NOT_AGENT_EDITABLE";
        this.store.database.run(
          `UPDATE tool_calls
           SET status = ?, error_json = ?, updated_at = ?
           WHERE id = ?`,
          keepPending ? "awaiting_confirmation" : "failed",
          encode(structured),
          timestamp(),
          callId,
        );
        deferredError = error;
        return { call: this.getToolCall(callId), replayed: false };
      }
    });
    if (deferredError !== undefined) {
      throw deferredError instanceof Error
        ? deferredError
        : new Error("Agent tool execution failed.", {
            cause: deferredError,
          });
    }
    return response;
  }

  private dispatchTool(
    run: AgentRun,
    callId: string,
    toolName: string,
    args: JsonObject,
  ): unknown {
    switch (toolName) {
      case "worldbook.list":
        strictKeys(args, [], toolName);
        return this.accessibleWorldbooks(run.conversationId).map(
          (worldbook) => {
            const entries = this.store.listWorldbookEntries(worldbook.id);
            return {
              id: worldbook.id,
              name: worldbook.name,
              revision: worldbook.revision,
              entryCount: entries.length,
              agentEditableEntryCount: entries.filter(
                (entry) => entry.agentEditable,
              ).length,
            };
          },
        );
      case "worldbook.get":
        strictKeys(args, ["worldbookId", "offset", "limit"], toolName);
        return this.worldbookGet(run, args, toolName);
      case "worldbook.search":
        strictKeys(args, ["worldbookId", "query", "limit"], toolName);
        return this.worldbookSearch(run, args, toolName);
      case "worldbook.entry.create":
        strictKeys(
          args,
          ["worldbookId", "expectedRevision", "entry"],
          toolName,
        );
        return this.worldbookCreate(run, callId, args, toolName);
      case "worldbook.entry.update":
        strictKeys(
          args,
          [
            "worldbookId",
            "entryId",
            "expectedRevision",
            "expectedEntryRevision",
            "patch",
          ],
          toolName,
        );
        return this.worldbookUpdate(run, callId, args, toolName);
      case "worldbook.entry.delete":
        strictKeys(
          args,
          [
            "worldbookId",
            "entryId",
            "expectedRevision",
            "expectedEntryRevision",
          ],
          toolName,
        );
        return this.worldbookDelete(run, callId, args, toolName);
      case "chat.messages.list":
        strictKeys(args, ["offset", "limit"], toolName);
        return this.messagesList(run, args, toolName);
      case "chat.summary.get":
        strictKeys(args, [], toolName);
        return this.artifactGet(
          "chat_summary",
          "conversation",
          run.conversationId,
        );
      case "chat.summary.create":
        strictKeys(
          args,
          [
            "title",
            "content",
            "sourceFromMessageId",
            "sourceToMessageId",
            "keyEvents",
            "unresolvedThreads",
            "characterStates",
          ],
          toolName,
        );
        return this.summaryCreate(run, callId, args, toolName);
      case "chat.summary.update":
        strictKeys(
          args,
          [
            "artifactId",
            "expectedRevision",
            "title",
            "content",
            "sourceFromMessageId",
            "sourceToMessageId",
            "keyEvents",
            "unresolvedThreads",
            "characterStates",
          ],
          toolName,
        );
        return this.summaryUpdate(run, callId, args, toolName);
      case "character.profile.get":
        strictKeys(args, ["participantId"], toolName);
        return this.profileGet(run, args, toolName);
      case "character.profile.create":
        strictKeys(
          args,
          [
            "participantId",
            "title",
            "content",
            "traits",
            "goals",
            "relationships",
            "facts",
          ],
          toolName,
        );
        return this.profileCreate(run, callId, args, toolName);
      case "character.profile.update":
        strictKeys(
          args,
          [
            "artifactId",
            "participantId",
            "expectedRevision",
            "title",
            "content",
            "traits",
            "goals",
            "relationships",
            "facts",
          ],
          toolName,
        );
        return this.profileUpdate(run, callId, args, toolName);
      case "agent.change.undo":
        strictKeys(args, ["auditId"], toolName);
        return this.undoChange(run, callId, args, toolName);
      default:
        throw new StorageError(
          "TOOL_NOT_FOUND",
          `Agent tool '${toolName}' is not registered.`,
          404,
        );
    }
  }

  private confirmationRequirement(toolName: string): boolean {
    return toolEffects[toolName] !== "read";
  }

  private messagesList(
    run: AgentRun,
    args: JsonObject,
    toolName: string,
  ): unknown {
    const offset =
      args.offset === undefined ? 0 : numberArgument(args, "offset", toolName);
    const limit =
      args.limit === undefined ? 50 : numberArgument(args, "limit", toolName);
    if (limit < 1 || limit > 200) {
      throw new StorageError(
        "TOOL_ARGUMENT_INVALID",
        "chat.messages.list limit must be between 1 and 200.",
        400,
      );
    }
    const messages = this.store.listMessages(run.conversationId);
    const items = messages
      .slice(offset, offset + limit)
      .map((message, index) => ({
        id: message.id,
        order: offset + index,
        role: message.role,
        participantId: message.participantId,
        createdAt: message.createdAt,
        preview: message.content.replace(/\s+/g, " ").trim().slice(0, 160),
      }));
    return {
      items,
      offset,
      limit,
      total: messages.length,
      hasMore: offset + items.length < messages.length,
    };
  }

  private worldbookGet(
    run: AgentRun,
    args: JsonObject,
    toolName: string,
  ): unknown {
    const worldbookId = stringArgument(args, "worldbookId", toolName);
    const worldbook = this.assertWorldbookAccess(run, worldbookId);
    const offset =
      typeof args.offset === "number" && Number.isInteger(args.offset)
        ? Math.max(0, args.offset)
        : 0;
    const limit =
      typeof args.limit === "number" && Number.isInteger(args.limit)
        ? Math.max(1, Math.min(args.limit, 100))
        : 50;
    const entries = this.store
      .listWorldbookEntries(worldbookId)
      .slice(offset, offset + limit);
    return {
      worldbook: {
        id: worldbook.id,
        name: worldbook.name,
        revision: worldbook.revision,
      },
      entries,
      offset,
      limit,
      hasMore:
        offset + entries.length <
        this.store.listWorldbookEntries(worldbookId).length,
    };
  }

  private worldbookSearch(
    run: AgentRun,
    args: JsonObject,
    toolName: string,
  ): unknown {
    const worldbookId = stringArgument(args, "worldbookId", toolName);
    this.assertWorldbookAccess(run, worldbookId);
    const query = stringArgument(args, "query", toolName);
    const limit =
      typeof args.limit === "number" && Number.isInteger(args.limit)
        ? Math.max(1, Math.min(args.limit, 100))
        : 20;
    return this.store.searchWorldbookEntries({ worldbookId, query, limit });
  }

  private worldbookCreate(
    run: AgentRun,
    callId: string,
    args: JsonObject,
    toolName: string,
  ): unknown {
    const worldbookId = stringArgument(args, "worldbookId", toolName);
    this.assertWorldbookAccess(run, worldbookId);
    const expectedRevision = numberArgument(args, "expectedRevision", toolName);
    const rawEntry = args.entry;
    if (!rawEntry || Array.isArray(rawEntry) || typeof rawEntry !== "object") {
      throw new StorageError(
        "TOOL_ARGUMENT_INVALID",
        "worldbook.entry.create requires an entry object.",
        400,
      );
    }
    const entry = rawEntry;
    strictKeys(
      entry,
      ["title", "keys", "content", "enabled", "position", "metadata"],
      toolName,
    );
    const content = stringArgument(entry, "content", toolName);
    const keys = stringArray(entry, "keys");
    const metadataPatch =
      entry.metadata &&
      !Array.isArray(entry.metadata) &&
      typeof entry.metadata === "object"
        ? entry.metadata
        : undefined;
    const title = optionalString(entry, "title");
    const metadata = synchronizedWorldbookMetadata(
      {},
      metadataPatch,
      keys,
      title,
    );
    const created = this.store.createWorldbookEntryHuman({
      worldbookId,
      expectedWorldbookRevision: expectedRevision,
      entry: {
        keys,
        content,
        enabled: entry.enabled !== false,
        ...(typeof entry.position === "number"
          ? { position: Math.floor(entry.position) }
          : {}),
        metadata,
      },
    });
    const after = { worldbook: created.worldbook, entry: created.entry };
    const auditId = this.store.insertAudit({
      runId: run.id,
      toolCallId: callId,
      actorKind: "agent",
      actorId: run.id,
      action: toolName,
      resourceType: "worldbook-entry",
      resourceId: created.entry.id,
      before: null,
      after,
      inversePatch: {
        operation: "worldbook.entry.delete",
        worldbookId,
        entryId: created.entry.id,
        expectedWorldbookRevision: created.worldbook.revision,
        expectedEntryRevision: created.entry.revision,
      },
    });
    return {
      auditId,
      worldbookId,
      entry: created.entry,
      revision: created.worldbook.revision,
      diff: [{ operation: "add", path: `/entries/${created.entry.id}` }],
    };
  }

  private worldbookUpdate(
    run: AgentRun,
    callId: string,
    args: JsonObject,
    toolName: string,
  ): unknown {
    const worldbookId = stringArgument(args, "worldbookId", toolName);
    const worldbook = this.assertWorldbookAccess(run, worldbookId);
    const entryId = stringArgument(args, "entryId", toolName);
    const beforeEntry = this.store.getWorldbookEntry(entryId);
    if (beforeEntry.worldbookId !== worldbookId) {
      throw new NotFoundError("worldbook entry", entryId);
    }
    this.assertWorldbookEntryWritable(beforeEntry);
    const rawPatch = args.patch;
    if (!rawPatch || Array.isArray(rawPatch) || typeof rawPatch !== "object") {
      throw new StorageError(
        "TOOL_ARGUMENT_INVALID",
        "worldbook.entry.update requires a patch object.",
        400,
      );
    }
    const patch = rawPatch;
    strictKeys(
      patch,
      ["title", "keys", "content", "enabled", "position", "metadata"],
      toolName,
    );
    const title = optionalString(patch, "title");
    const metadataPatch =
      patch.metadata &&
      !Array.isArray(patch.metadata) &&
      typeof patch.metadata === "object"
        ? patch.metadata
        : undefined;
    const keys =
      patch.keys === undefined ? undefined : stringArray(patch, "keys");
    const metadata = synchronizedWorldbookMetadata(
      beforeEntry.metadata,
      metadataPatch,
      keys,
      title,
    );
    const updated = this.store.updateWorldbookEntryHuman({
      worldbookId,
      entryId,
      expectedWorldbookRevision: numberArgument(
        args,
        "expectedRevision",
        toolName,
      ),
      expectedEntryRevision: numberArgument(
        args,
        "expectedEntryRevision",
        toolName,
      ),
      patch: {
        ...(keys === undefined ? {} : { keys }),
        ...(typeof patch.content === "string"
          ? { content: patch.content }
          : {}),
        ...(typeof patch.enabled === "boolean"
          ? { enabled: patch.enabled }
          : {}),
        ...(typeof patch.position === "number"
          ? { position: Math.floor(patch.position) }
          : {}),
        ...(patch.metadata === undefined &&
        title === undefined &&
        keys === undefined
          ? {}
          : { metadata }),
      },
    });
    const before = { worldbook, entry: beforeEntry };
    const after = { worldbook: updated.worldbook, entry: updated.entry };
    const auditId = this.store.insertAudit({
      runId: run.id,
      toolCallId: callId,
      actorKind: "agent",
      actorId: run.id,
      action: toolName,
      resourceType: "worldbook-entry",
      resourceId: entryId,
      before,
      after,
      inversePatch: {
        operation: "worldbook.entry.restore",
        worldbookId,
        entry: toJson(beforeEntry),
        expectedWorldbookRevision: updated.worldbook.revision,
        expectedEntryRevision: updated.entry.revision,
      },
    });
    return {
      auditId,
      entry: updated.entry,
      revision: updated.worldbook.revision,
      diff: [{ operation: "replace", path: `/entries/${entryId}` }],
    };
  }

  private worldbookDelete(
    run: AgentRun,
    callId: string,
    args: JsonObject,
    toolName: string,
  ): unknown {
    const worldbookId = stringArgument(args, "worldbookId", toolName);
    const worldbook = this.assertWorldbookAccess(run, worldbookId);
    const entryId = stringArgument(args, "entryId", toolName);
    const beforeEntry = this.store.getWorldbookEntry(entryId);
    if (beforeEntry.worldbookId !== worldbookId) {
      throw new NotFoundError("worldbook entry", entryId);
    }
    this.assertWorldbookEntryWritable(beforeEntry);
    const deleted = this.store.deleteWorldbookEntryHuman({
      worldbookId,
      entryId,
      expectedWorldbookRevision: numberArgument(
        args,
        "expectedRevision",
        toolName,
      ),
      expectedEntryRevision: numberArgument(
        args,
        "expectedEntryRevision",
        toolName,
      ),
      confirmed: true,
    });
    const auditId = this.store.insertAudit({
      runId: run.id,
      toolCallId: callId,
      actorKind: "agent",
      actorId: run.id,
      action: toolName,
      resourceType: "worldbook-entry",
      resourceId: entryId,
      before: { worldbook, entry: beforeEntry },
      after: { worldbook: deleted.worldbook },
      inversePatch: {
        operation: "worldbook.entry.recreate",
        worldbookId,
        entry: toJson(beforeEntry),
        expectedWorldbookRevision: deleted.worldbook.revision,
      },
    });
    return {
      auditId,
      deletedEntryId: entryId,
      revision: deleted.worldbook.revision,
      diff: [{ operation: "remove", path: `/entries/${entryId}` }],
    };
  }

  private summaryCreate(
    run: AgentRun,
    callId: string,
    args: JsonObject,
    toolName: string,
  ): unknown {
    const sourceFrom = stringArgument(args, "sourceFromMessageId", toolName);
    const sourceTo = stringArgument(args, "sourceToMessageId", toolName);
    this.assertMessageRange(run.conversationId, sourceFrom, sourceTo);
    const structured: JsonObject = {
      keyEvents: args.keyEvents ?? [],
      unresolvedThreads: args.unresolvedThreads ?? [],
      characterStates:
        args.characterStates &&
        !Array.isArray(args.characterStates) &&
        typeof args.characterStates === "object"
          ? args.characterStates
          : {},
    };
    const artifact = this.createAgentArtifact({
      kind: "chat_summary",
      scopeType: "conversation",
      scopeId: run.conversationId,
      title: optionalString(args, "title") ?? "Chat summary",
      content: stringArgument(args, "content", toolName),
      metadata: structured,
      sourceFromMessageId: sourceFrom,
      sourceToMessageId: sourceTo,
    });
    const auditId = this.auditArtifact(run, callId, toolName, null, artifact, {
      operation: "artifact.delete",
      artifactId: artifact.id,
    });
    return { artifact, auditId };
  }

  private summaryUpdate(
    run: AgentRun,
    callId: string,
    args: JsonObject,
    toolName: string,
  ): unknown {
    const artifactId = stringArgument(args, "artifactId", toolName);
    const before = this.store.getArtifact(artifactId);
    if (
      before.kind !== "chat_summary" ||
      before.scopeType !== "conversation" ||
      before.scopeId !== run.conversationId
    ) {
      throw new PermissionError(
        "The summary does not belong to this conversation.",
      );
    }
    const sourceFrom =
      optionalString(args, "sourceFromMessageId") ??
      before.sourceFromMessageId ??
      "";
    const sourceTo =
      optionalString(args, "sourceToMessageId") ??
      before.sourceToMessageId ??
      "";
    this.assertMessageRange(run.conversationId, sourceFrom, sourceTo);
    const nextTitle = optionalString(args, "title");
    const nextContent = optionalString(args, "content");
    const after = this.updateAgentArtifact({
      artifactId,
      expectedRevision: numberArgument(args, "expectedRevision", toolName),
      ...(nextTitle === undefined ? {} : { title: nextTitle }),
      ...(nextContent === undefined ? {} : { content: nextContent }),
      metadata: {
        ...before.metadata,
        ...(args.keyEvents === undefined ? {} : { keyEvents: args.keyEvents }),
        ...(args.unresolvedThreads === undefined
          ? {}
          : { unresolvedThreads: args.unresolvedThreads }),
        ...(args.characterStates === undefined
          ? {}
          : { characterStates: args.characterStates }),
      },
      sourceFromMessageId: sourceFrom,
      sourceToMessageId: sourceTo,
    });
    const auditId = this.auditArtifact(run, callId, toolName, before, after, {
      operation: "artifact.restore",
      artifact: toJson(before),
      expectedRevision: after.revision,
    });
    return { artifact: after, auditId };
  }

  private profileGet(
    run: AgentRun,
    args: JsonObject,
    toolName: string,
  ): unknown {
    const participantId = stringArgument(args, "participantId", toolName);
    this.assertParticipantInConversation(run.conversationId, participantId);
    return this.artifactGet(
      "character_profile",
      "conversation-participant",
      `${run.conversationId}:${participantId}`,
    );
  }

  private profileCreate(
    run: AgentRun,
    callId: string,
    args: JsonObject,
    toolName: string,
  ): unknown {
    const participantId = stringArgument(args, "participantId", toolName);
    this.assertParticipantInConversation(run.conversationId, participantId);
    const artifact = this.createAgentArtifact({
      kind: "character_profile",
      scopeType: "conversation-participant",
      scopeId: `${run.conversationId}:${participantId}`,
      title: optionalString(args, "title") ?? "Participant profile",
      content: stringArgument(args, "content", toolName),
      metadata: {
        participantId,
        traits: args.traits ?? [],
        goals: args.goals ?? [],
        relationships: args.relationships ?? [],
        facts: args.facts ?? [],
      },
    });
    const auditId = this.auditArtifact(run, callId, toolName, null, artifact, {
      operation: "artifact.delete",
      artifactId: artifact.id,
    });
    return { artifact, auditId };
  }

  private profileUpdate(
    run: AgentRun,
    callId: string,
    args: JsonObject,
    toolName: string,
  ): unknown {
    const artifactId = stringArgument(args, "artifactId", toolName);
    const participantId = stringArgument(args, "participantId", toolName);
    this.assertParticipantInConversation(run.conversationId, participantId);
    const before = this.store.getArtifact(artifactId);
    if (
      before.kind !== "character_profile" ||
      before.scopeId !== `${run.conversationId}:${participantId}`
    ) {
      throw new PermissionError(
        "The profile does not belong to this participant.",
      );
    }
    const locked = new Set(before.lockedFields ?? []);
    const metadata = { ...before.metadata };
    for (const key of ["traits", "goals", "relationships", "facts"] as const) {
      if (!locked.has(key) && args[key] !== undefined) {
        metadata[key] = args[key];
      }
    }
    const nextTitle = locked.has("title")
      ? undefined
      : optionalString(args, "title");
    const nextContent = locked.has("content")
      ? undefined
      : optionalString(args, "content");
    const after = this.updateAgentArtifact({
      artifactId,
      expectedRevision: numberArgument(args, "expectedRevision", toolName),
      ...(nextTitle === undefined ? {} : { title: nextTitle }),
      ...(nextContent === undefined ? {} : { content: nextContent }),
      metadata,
    });
    const auditId = this.auditArtifact(run, callId, toolName, before, after, {
      operation: "artifact.restore",
      artifact: toJson(before),
      expectedRevision: after.revision,
    });
    return { artifact: after, auditId };
  }

  private undoChange(
    run: AgentRun,
    callId: string,
    args: JsonObject,
    toolName: string,
  ): unknown {
    const auditId = stringArgument(args, "auditId", toolName);
    const audit = this.store.getAuditRecord(auditId);
    if (audit.actorKind !== "agent" || audit.runId === null) {
      throw new PermissionError(
        "Only an Agent-authored change can be undone here.",
      );
    }
    if (audit.runId !== run.id) {
      throw new PermissionError(
        "A change can only be undone by the same conversation tool run that authored it.",
        {
          auditId: audit.id,
          auditRunId: audit.runId,
          runId: run.id,
        },
      );
    }
    if (audit.undoneAt) {
      throw new ConflictError(`Audit '${audit.id}' was already undone.`);
    }
    const operation = audit.inversePatch.operation;
    let result: unknown;
    if (operation === "worldbook.entry.delete") {
      const worldbookId = stringArgument(
        audit.inversePatch,
        "worldbookId",
        toolName,
      );
      const worldbook = this.assertWorldbookAccess(run, worldbookId);
      const entryId = stringArgument(audit.inversePatch, "entryId", toolName);
      const entry = this.store.getWorldbookEntry(entryId);
      if (entry.worldbookId !== worldbook.id) {
        throw new NotFoundError("worldbook entry", entryId);
      }
      this.assertWorldbookEntryWritable(entry);
      let expectedWorldbookRevision = numberArgument(
        audit.inversePatch,
        "expectedWorldbookRevision",
        toolName,
      );
      let expectedEntryRevision = numberArgument(
        audit.inversePatch,
        "expectedEntryRevision",
        toolName,
      );
      const permissionAt = entry.permissionUpdatedAt;
      if (
        (worldbook.revision !== expectedWorldbookRevision ||
          entry.revision !== expectedEntryRevision) &&
        entry.agentEditable &&
        worldbook.revision === expectedWorldbookRevision + 1 &&
        entry.revision === expectedEntryRevision + 1 &&
        typeof entry.permissionUpdatedBy === "string" &&
        typeof permissionAt === "string" &&
        Date.parse(permissionAt) >= Date.parse(audit.createdAt)
      ) {
        // A newly created entry starts read-only. Rebase only the one verified
        // human permission change needed to make its confirmed undo eligible.
        expectedWorldbookRevision = worldbook.revision;
        expectedEntryRevision = entry.revision;
      }
      const deleted = this.store.deleteWorldbookEntryHuman({
        worldbookId,
        entryId,
        expectedWorldbookRevision,
        expectedEntryRevision,
        confirmed: true,
      });
      result = { worldbook: deleted.worldbook, deletedEntryId: entryId };
    } else if (operation === "worldbook.entry.restore") {
      const worldbookId = stringArgument(
        audit.inversePatch,
        "worldbookId",
        toolName,
      );
      const worldbook = this.assertWorldbookAccess(run, worldbookId);
      const rawEntry = audit.inversePatch.entry;
      if (
        !rawEntry ||
        Array.isArray(rawEntry) ||
        typeof rawEntry !== "object"
      ) {
        throw new StorageError(
          "invalid_inverse_patch",
          "Audit inverse patch has no entry snapshot.",
          500,
        );
      }
      const snapshot = rawEntry as unknown as WorldbookEntry;
      const currentEntry = this.store.getWorldbookEntry(snapshot.id);
      if (currentEntry.worldbookId !== worldbook.id) {
        throw new NotFoundError("worldbook entry", snapshot.id);
      }
      this.assertWorldbookEntryWritable(currentEntry);
      const restored = this.store.updateWorldbookEntryHuman({
        worldbookId,
        entryId: snapshot.id,
        expectedWorldbookRevision: numberArgument(
          audit.inversePatch,
          "expectedWorldbookRevision",
          toolName,
        ),
        expectedEntryRevision: numberArgument(
          audit.inversePatch,
          "expectedEntryRevision",
          toolName,
        ),
        patch: {
          keys: snapshot.keys,
          content: snapshot.content,
          enabled: snapshot.enabled,
          position: snapshot.position,
          metadata: snapshot.metadata,
        },
      });
      result = restored;
    } else if (operation === "worldbook.entry.recreate") {
      const worldbookId = stringArgument(
        audit.inversePatch,
        "worldbookId",
        toolName,
      );
      this.assertWorldbookAccess(run, worldbookId);
      const rawEntry = audit.inversePatch.entry;
      if (
        !rawEntry ||
        Array.isArray(rawEntry) ||
        typeof rawEntry !== "object"
      ) {
        throw new StorageError(
          "invalid_inverse_patch",
          "Audit inverse patch has no entry snapshot.",
          500,
        );
      }
      const snapshot = rawEntry as unknown as WorldbookEntry;
      result = this.store.createWorldbookEntryHuman({
        worldbookId,
        expectedWorldbookRevision: numberArgument(
          audit.inversePatch,
          "expectedWorldbookRevision",
          toolName,
        ),
        entry: {
          id: snapshot.id,
          legacyUid: snapshot.legacyUid,
          keys: snapshot.keys,
          content: snapshot.content,
          enabled: snapshot.enabled,
          position: snapshot.position,
          metadata: snapshot.metadata,
        },
      });
    } else if (
      operation === "artifact.delete" ||
      operation === "artifact.restore"
    ) {
      result = this.undoArtifact(audit, toolName);
    } else {
      throw new StorageError(
        "invalid_inverse_patch",
        `Unsupported inverse operation ${JSON.stringify(operation)}.`,
        500,
      );
    }
    const undoAuditId = this.store.insertAudit({
      runId: run.id,
      toolCallId: callId,
      actorKind: "agent",
      actorId: run.id,
      action: "agent.change.undo",
      resourceType: audit.resourceType,
      resourceId: audit.resourceId,
      before: audit.after,
      after: result,
      inversePatch: { operation: "undo.not-repeatable", auditId: audit.id },
    });
    this.store.database.run(
      "UPDATE audit_log SET undone_at = ?, undo_audit_id = ? WHERE id = ? AND undone_at IS NULL",
      timestamp(),
      undoAuditId,
      audit.id,
    );
    return { auditId: undoAuditId, undoneAuditId: audit.id, result };
  }

  private undoArtifact(audit: AuditRecord, toolName: string): unknown {
    if (audit.inversePatch.operation === "artifact.delete") {
      const artifactId = stringArgument(
        audit.inversePatch,
        "artifactId",
        toolName,
      );
      const current = this.store.getArtifact(artifactId);
      this.store.database.run(
        "DELETE FROM artifacts WHERE id = ? AND revision = ?",
        artifactId,
        current.revision,
      );
      return { deletedArtifactId: artifactId };
    }
    const raw = audit.inversePatch.artifact;
    if (!raw || Array.isArray(raw) || typeof raw !== "object") {
      throw new StorageError(
        "invalid_inverse_patch",
        "Audit inverse patch has no artifact snapshot.",
        500,
      );
    }
    const snapshot = raw as unknown as Artifact;
    const current = this.store.getArtifact(snapshot.id);
    const expected = numberArgument(
      audit.inversePatch,
      "expectedRevision",
      toolName,
    );
    if (current.revision !== expected) {
      throw new ConflictError(
        "The artifact changed after the Agent write and cannot be force-undone.",
      );
    }
    const sourceFrom = snapshot.sourceFromMessageId ?? undefined;
    const sourceTo = snapshot.sourceToMessageId ?? undefined;
    return this.updateAgentArtifact({
      artifactId: snapshot.id,
      expectedRevision: current.revision,
      title: snapshot.title,
      content: snapshot.content,
      metadata: snapshot.metadata,
      ...(sourceFrom === undefined ? {} : { sourceFromMessageId: sourceFrom }),
      ...(sourceTo === undefined ? {} : { sourceToMessageId: sourceTo }),
      stale: snapshot.stale ?? false,
      lockedFields: snapshot.lockedFields ?? [],
    });
  }

  private artifactGet(
    kind: string,
    scopeType: string,
    scopeId: string,
  ): unknown {
    return (
      this.store.getLatestArtifact(kind, scopeType, scopeId) ?? {
        found: false,
      }
    );
  }

  private createAgentArtifact(input: {
    kind: string;
    scopeType: string;
    scopeId: string;
    title: string;
    content: string;
    metadata: JsonObject;
    sourceFromMessageId?: string;
    sourceToMessageId?: string;
  }): Artifact {
    const now = timestamp();
    const id = identifier();
    this.store.database.run(
      `INSERT INTO artifacts(
         id, kind, scope_type, scope_id, title, content, metadata_json,
         revision, source_from_message_id, source_to_message_id, stale,
         locked_fields_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 0, '[]', ?, ?)`,
      id,
      input.kind,
      input.scopeType,
      input.scopeId,
      input.title,
      input.content,
      encode(input.metadata),
      input.sourceFromMessageId ?? null,
      input.sourceToMessageId ?? null,
      now,
      now,
    );
    return this.store.getArtifact(id);
  }

  private updateAgentArtifact(input: {
    artifactId: string;
    expectedRevision: number;
    title?: string;
    content?: string;
    metadata?: JsonObject;
    sourceFromMessageId?: string;
    sourceToMessageId?: string;
    stale?: boolean;
    lockedFields?: string[];
  }): Artifact {
    const current = this.store.getArtifact(input.artifactId);
    if (current.revision !== input.expectedRevision) {
      throw new ConflictError(
        `Artifact '${current.id}' revision changed from ${String(input.expectedRevision)} to ${String(current.revision)}.`,
      );
    }
    this.store.database.run(
      `UPDATE artifacts
       SET title = ?, content = ?, metadata_json = ?,
           source_from_message_id = ?, source_to_message_id = ?,
           stale = ?, locked_fields_json = ?,
           revision = revision + 1, updated_at = ?
       WHERE id = ? AND revision = ?`,
      input.title ?? current.title,
      input.content ?? current.content,
      encode(input.metadata ?? current.metadata),
      input.sourceFromMessageId ?? current.sourceFromMessageId ?? null,
      input.sourceToMessageId ?? current.sourceToMessageId ?? null,
      (input.stale ?? current.stale ?? false) ? 1 : 0,
      encode(input.lockedFields ?? current.lockedFields ?? []),
      timestamp(),
      current.id,
      input.expectedRevision,
    );
    const changed = this.store.database.get<{ count: number }>(
      "SELECT changes() AS count",
    );
    if ((changed?.count ?? 0) !== 1) {
      throw new ConflictError(`Artifact '${current.id}' changed concurrently.`);
    }
    return this.store.getArtifact(current.id);
  }

  private auditArtifact(
    run: AgentRun,
    callId: string,
    action: string,
    before: Artifact | null,
    after: Artifact,
    inversePatch: JsonObject,
  ): string {
    return this.store.insertAudit({
      runId: run.id,
      toolCallId: callId,
      actorKind: "agent",
      actorId: run.id,
      action,
      resourceType: "artifact",
      resourceId: after.id,
      before,
      after,
      inversePatch,
    });
  }

  private accessibleWorldbooks(conversationId: string): Worldbook[] {
    return this.store.database
      .all<Row>(
        `SELECT DISTINCT w.*
         FROM worldbooks w
         JOIN worldbook_bindings b ON b.worldbook_id = w.id
         JOIN conversations c ON c.id = ?
         WHERE b.scope_type = 'global'
            OR (b.scope_type = 'conversation' AND b.scope_id = ?)
            OR (b.scope_type = 'card' AND b.scope_id = c.card_id)
            OR (
              b.scope_type = 'participant'
              AND b.scope_id IN (
                SELECT p.id
                FROM participants p
                WHERE p.card_id = c.card_id
              )
            )
         ORDER BY w.updated_at DESC, w.id`,
        conversationId,
        conversationId,
      )
      .map((row) => this.store.getWorldbook(String(row.id)));
  }

  /**
   * Read-only conversation access view. It deliberately exposes only
   * worldbooks already bound to the run's conversation; callers cannot use it
   * to widen access.
   */
  listAccessibleWorldbooks(runId: string): Worldbook[] {
    const run = this.getRun(runId);
    return this.accessibleWorldbooks(run.conversationId);
  }

  private rebasePermissionRevision(call: ToolCall, run: AgentRun): JsonObject {
    if (
      call.toolName !== "worldbook.entry.update" &&
      call.toolName !== "worldbook.entry.delete"
    ) {
      return call.arguments;
    }
    const worldbookId = stringArgument(
      call.arguments,
      "worldbookId",
      call.toolName,
    );
    const worldbook = this.assertWorldbookAccess(run, worldbookId);
    const entryId = stringArgument(call.arguments, "entryId", call.toolName);
    const entry = this.store.getWorldbookEntry(entryId);
    if (entry.worldbookId !== worldbook.id) {
      throw new NotFoundError("worldbook entry", entryId);
    }
    const proposedRevision = numberArgument(
      call.arguments,
      "expectedRevision",
      call.toolName,
    );
    const proposedEntryRevision = numberArgument(
      call.arguments,
      "expectedEntryRevision",
      call.toolName,
    );
    if (
      worldbook.revision === proposedRevision &&
      entry.revision === proposedEntryRevision
    ) {
      return call.arguments;
    }
    const permissionAt = entry.permissionUpdatedAt;
    if (
      entry.agentEditable &&
      worldbook.revision === proposedRevision + 1 &&
      entry.revision === proposedEntryRevision + 1 &&
      typeof entry.permissionUpdatedBy === "string" &&
      typeof permissionAt === "string" &&
      Date.parse(permissionAt) >= Date.parse(call.createdAt)
    ) {
      return {
        ...call.arguments,
        expectedRevision: worldbook.revision,
        expectedEntryRevision: entry.revision,
      };
    }
    // Keep the reviewed revision unchanged. The transactional repository write
    // will reject any unrelated concurrent change as a revision conflict.
    return call.arguments;
  }

  private assertWorldbookAccess(run: AgentRun, worldbookId: string): Worldbook {
    const worldbook = this.store.getWorldbook(worldbookId);
    const accessible = this.store.database.get<{ count: number }>(
      `SELECT COUNT(*) AS count
       FROM worldbook_bindings b
       JOIN conversations c ON c.id = ?
       WHERE worldbook_id = ?
         AND (
           b.scope_type = 'global'
           OR (b.scope_type = 'conversation' AND b.scope_id = c.id)
           OR (b.scope_type = 'card' AND b.scope_id = c.card_id)
           OR (
             b.scope_type = 'participant'
             AND b.scope_id IN (
               SELECT p.id
               FROM participants p
               WHERE p.card_id = c.card_id
             )
           )
         )`,
      run.conversationId,
      worldbookId,
    );
    if ((accessible?.count ?? 0) === 0) {
      throw new PermissionError(
        "The worldbook is not available to this conversation.",
      );
    }
    return worldbook;
  }

  private assertWorldbookEntryWritable(entry: WorldbookEntry): void {
    if (!entry.agentEditable) {
      throw new StorageError(
        "WORLD_BOOK_ENTRY_NOT_AGENT_EDITABLE",
        "This worldbook entry is currently user-editable only.",
        403,
        {
          worldbookId: entry.worldbookId,
          entryId: entry.id,
          revision: entry.revision,
        },
      );
    }
  }

  private assertParticipantInConversation(
    conversationId: string,
    participantId: string,
  ): void {
    const conversation = this.store.getConversation(conversationId);
    const participant = this.store.getParticipant(participantId);
    if (participant.cardId !== conversation.cardId) {
      throw new PermissionError(
        "The participant is not part of this conversation.",
      );
    }
  }

  private assertMessageRange(
    conversationId: string,
    fromId: string,
    toId: string,
  ): void {
    const messages = this.store.listMessages(conversationId);
    const from = messages.findIndex((message) => message.id === fromId);
    const to = messages.findIndex((message) => message.id === toId);
    if (from < 0 || to < 0 || from > to) {
      throw new StorageError(
        "TOOL_ARGUMENT_INVALID",
        "The summary source range must be an ordered range in the current conversation.",
        400,
      );
    }
  }

  private assertRunActive(id: string, allowCompletedUndo = false): AgentRun {
    const run = this.getRun(id);
    if (run.status === "cancelled" || run.cancelledAt !== null) {
      throw new RunCancelledError(id);
    }
    const allowed = ["queued", "running", "waiting_confirmation"];
    if (allowCompletedUndo) allowed.push("completed");
    if (!allowed.includes(run.status)) {
      throw new ConflictError(`Agent run '${id}' is not active.`, {
        status: run.status,
      });
    }
    if (run.currentStep > run.maxSteps) {
      throw new StorageError(
        "AGENT_STEP_LIMIT_REACHED",
        "The Agent run exceeded its step limit.",
        409,
      );
    }
    return run;
  }

  private mapRun(row: Row): AgentRun {
    return {
      id: String(row.id),
      conversationId: String(row.conversation_id),
      status: String(row.status) as AgentRun["status"],
      requestedBy: String(row.requested_by),
      provider: String(row.provider),
      model: String(row.model),
      objective: String(row.objective),
      maxSteps: Number(row.max_steps),
      currentStep: Number(row.current_step),
      toolCallCount: Number(row.tool_call_count),
      writeCallCount: Number(row.write_call_count),
      idempotencyKey: String(row.idempotency_key),
      cancelledAt: row.cancelled_at === null ? null : String(row.cancelled_at),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapToolCall(row: Row): ToolCall {
    return {
      id: String(row.id),
      runId: String(row.run_id),
      idempotencyKey: String(row.idempotency_key),
      toolName: String(row.tool_name),
      arguments: decodeObject(String(row.arguments_json)),
      status: String(row.status) as ToolCallStatus,
      result: decodeValue(
        row.result_json === null ? null : String(row.result_json),
      ),
      error:
        row.error_json === null ? null : decodeObject(String(row.error_json)),
      effect:
        row.effect === "write" || row.effect === "destructive"
          ? row.effect
          : "read",
      requiresConfirmation: row.requires_confirmation === 1,
      confirmedAt: row.confirmed_at === null ? null : String(row.confirmed_at),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }
}
