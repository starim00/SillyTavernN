import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { ProviderEvent } from "@stn/contracts";
import type {
  ProviderMessage,
  ProviderMessageToolCall,
  ProviderTool,
} from "@stn/providers";
import { StorageError, type AgentRun, type Worldbook } from "@stn/storage";

import { envelope, type ServerContext } from "../context.js";
import { prepareConversationPrompt } from "../prompt-service.js";
import {
  conversationToolsByName,
  modelConversationTools,
  type ConversationTool,
} from "../conversation-tools.js";

const connectionSchema = z
  .object({
    name: z.string().trim().min(1).max(256),
    protocol: z.enum(["openai-compatible", "text-completion", "fake"]),
    baseUrl: z.string().trim().max(2048),
    model: z.string().trim().min(1).max(512),
    headers: z.record(z.string(), z.string()).default({}),
    apiKey: z.string().max(16_384).optional(),
    nativeToolCalling: z.boolean().default(false),
  })
  .strict();

const promptRequestSchema = z
  .object({
    connectionId: z.string().trim().min(1).default("fake"),
    presetId: z.string().trim().min(1).optional(),
    settings: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const generationRequestSchema = promptRequestSchema
  .extend({
    messagesOverride: z
      .array(
        z
          .object({
            role: z.enum(["system", "assistant", "user", "tool"]),
            content: z.string().max(2_000_000),
          })
          .strict(),
      )
      .max(20_000)
      .optional(),
    injects: z
      .array(
        z
          .object({
            role: z.enum(["system", "assistant", "user"]),
            content: z.string().max(2_000_000),
            depth: z.number().int().min(0).max(10_000).default(0),
          })
          .strict(),
      )
      .max(512)
      .default([]),
  })
  .strict();
const maxConversationToolTurns = 4;

const providerConversationTools: readonly ProviderTool[] =
  modelConversationTools.map(({ name, description, inputSchema }) => ({
    name,
    description,
    inputSchema,
  }));

function writeEvent(
  reply: { raw: { write: (value: string) => boolean } },
  event: ProviderEvent | { type: string; [key: string]: unknown },
): void {
  reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
}

function generationObjective(messages: readonly ProviderMessage[]): string {
  const latestUserMessage = messages.findLast(
    (message) => message.role === "user",
  );
  const objective =
    latestUserMessage?.content.trim() ||
    "Generate the next ordinary assistant reply.";
  return objective.slice(0, 20_000);
}

function injectCompatibilityMessages(
  messages: readonly ProviderMessage[],
  injects: readonly {
    role: "system" | "assistant" | "user";
    content: string;
    depth: number;
  }[],
): ProviderMessage[] {
  const result = [...messages];
  for (const injection of injects) {
    const index = Math.max(0, result.length - injection.depth);
    result.splice(index, 0, {
      role: injection.role,
      content: injection.content,
    });
  }
  return result;
}

function toolContextMessage(
  worldbooks: readonly Worldbook[],
  participants: readonly { id: string; name: string; role: string }[],
): ProviderMessage {
  const catalog = worldbooks.map((worldbook) => ({
    id: worldbook.id,
    name: worldbook.name,
    revision: worldbook.revision,
  }));
  const participantCatalog = participants.map((participant) => ({
    id: participant.id,
    name: participant.name,
    role: participant.role,
  }));
  return {
    role: "system",
    content:
      "Conversation tools are available as an optional part of this ordinary chat response. " +
      "Reads execute immediately. Every create, update, or delete call is only a proposal " +
      "and must never be described as applied before the user confirms it. Make at most " +
      "one write proposal in this response; after a proposal is pending, later tool calls " +
      "are rejected. Worldbook update and delete additionally require the target entry's " +
      "human-granted AI edit permission. chat.messages.list returns ordered message IDs " +
      "and short previews for selecting a summary range, defaulting to 50 and capped at 200. " +
      "Use only worldbooks and participants in these conversation-scoped catalogs. " +
      `Worldbooks: ${JSON.stringify(catalog)} Participants: ${JSON.stringify(participantCatalog)}`,
  };
}

function startGenerationToolRun(
  context: ServerContext,
  input: {
    generationId: string;
    conversationId: string;
    connectionId: string;
    model: string;
    messages: readonly ProviderMessage[];
  },
): {
  readonly run: AgentRun;
  readonly worldbooks: readonly Worldbook[];
  readonly participants: readonly { id: string; name: string; role: string }[];
} {
  const created = context.agents.createRun({
    id: `generation-tool-${input.generationId}`,
    conversationId: input.conversationId,
    requestedBy: "local-user",
    provider: input.connectionId,
    model: input.model,
    objective: generationObjective(input.messages),
    idempotencyKey: `generation:${input.generationId}:tool-run`,
    maxSteps: maxConversationToolTurns,
  }).run;
  const run = context.agents.transitionRun(created.id, ["queued"], "running", {
    currentStep: 1,
  });
  return {
    run,
    worldbooks: context.agents.listAccessibleWorldbooks(run.id),
    participants: context.store
      .listConversationParticipants(run.conversationId)
      .map(({ id, name, role }) => ({ id, name, role })),
  };
}

function toolError(error: unknown): { code: string; message: string } {
  if (error instanceof StorageError) {
    return { code: error.code, message: error.message };
  }
  return {
    code: "AGENT_TOOL_EXECUTION_FAILED",
    message: error instanceof Error ? error.message : String(error),
  };
}

function referencedResourceIsAccessible(
  tool: ConversationTool,
  argumentsValue: Record<string, unknown>,
  accessibleWorldbookIds: ReadonlySet<string>,
): boolean {
  if (!tool.name.startsWith("worldbook.")) return true;
  if (tool.name === "worldbook.list") return true;
  return (
    typeof argumentsValue.worldbookId === "string" &&
    accessibleWorldbookIds.has(argumentsValue.worldbookId)
  );
}

export async function registerProviderRoutes(
  app: FastifyInstance,
  context: ServerContext,
): Promise<void> {
  app.get("/api/providers/connections", async () =>
    envelope(await context.providers.list()),
  );

  app.post("/api/providers/connections", async (request, reply) => {
    const input = connectionSchema.parse(request.body);
    const id = randomUUID();
    const apiKeyRef = input.apiKey ? `provider:${id}` : null;
    if (input.apiKey && apiKeyRef) {
      await context.vault.set(apiKeyRef, input.apiKey);
    }
    try {
      const created = context.store.createProviderConnection({
        id,
        name: input.name,
        protocol: input.protocol,
        baseUrl: input.baseUrl,
        model: input.model,
        headers: input.headers,
        apiKeyRef,
        nativeToolCalling: input.nativeToolCalling,
      });
      return reply
        .code(201)
        .send(envelope(await context.providers.dto(created)));
    } catch (error) {
      if (apiKeyRef) await context.vault.delete(apiKeyRef);
      throw error;
    }
  });

  app.patch<{ Params: { id: string } }>(
    "/api/providers/connections/:id",
    async (request) => {
      const input = connectionSchema
        .partial()
        .extend({ expectedRevision: z.number().int().nonnegative() })
        .strict()
        .parse(request.body);
      const current = context.store.getProviderConnection(request.params.id);
      const newApiKeyRef =
        input.apiKey === undefined || input.apiKey.length === 0
          ? null
          : `provider:${current.id}:${randomUUID()}`;
      if (newApiKeyRef !== null && input.apiKey !== undefined) {
        await context.vault.set(newApiKeyRef, input.apiKey);
      }
      let updated: ReturnType<
        ServerContext["store"]["updateProviderConnection"]
      >;
      try {
        updated = context.store.updateProviderConnection({
          id: current.id,
          expectedRevision: input.expectedRevision,
          patch: {
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.protocol === undefined
              ? {}
              : { protocol: input.protocol }),
            ...(input.baseUrl === undefined ? {} : { baseUrl: input.baseUrl }),
            ...(input.model === undefined ? {} : { model: input.model }),
            ...(input.headers === undefined ? {} : { headers: input.headers }),
            ...(input.nativeToolCalling === undefined
              ? {}
              : { nativeToolCalling: input.nativeToolCalling }),
            ...(input.apiKey === undefined ? {} : { apiKeyRef: newApiKeyRef }),
          },
        });
      } catch (error) {
        if (newApiKeyRef !== null) {
          await context.vault.delete(newApiKeyRef);
        }
        throw error;
      }
      if (
        input.apiKey !== undefined &&
        current.apiKeyRef !== null &&
        current.apiKeyRef !== newApiKeyRef
      ) {
        await context.vault.delete(current.apiKeyRef);
      }
      return envelope(await context.providers.dto(updated));
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/providers/connections/:id/test",
    async (request) => {
      const provider = await context.providers.get(request.params.id);
      return envelope(await provider.testConnection(request.signal));
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/providers/connections/:id/models",
    async (request) => {
      const provider = await context.providers.get(request.params.id);
      return envelope(await provider.listModels(request.signal));
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/conversations/:id/prompt-preview",
    async (request) => {
      const input = promptRequestSchema.parse(request.body);
      const provider = await context.providers.get(input.connectionId);
      const capabilities = provider.capabilities();
      return envelope(
        prepareConversationPrompt(context.store, {
          conversationId: request.params.id,
          ...(input.presetId === undefined ? {} : { presetId: input.presetId }),
          ...(input.settings === undefined ? {} : { settings: input.settings }),
          ...(capabilities.maxContextTokens === undefined
            ? {}
            : {
                maxContextTokens: capabilities.maxContextTokens,
              }),
        }),
      );
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/conversations/:id/generate",
    async (request, reply) => {
      const input = generationRequestSchema.parse(request.body);
      const provider = await context.providers.get(input.connectionId);
      const capabilities = provider.capabilities();
      const prompt = prepareConversationPrompt(context.store, {
        conversationId: request.params.id,
        ...(input.presetId === undefined ? {} : { presetId: input.presetId }),
        ...(input.settings === undefined ? {} : { settings: input.settings }),
        ...(capabilities.maxContextTokens === undefined
          ? {}
          : { maxContextTokens: capabilities.maxContextTokens }),
      });
      const compatibilityMessages = injectCompatibilityMessages(
        input.messagesOverride ?? prompt.messages,
        input.injects,
      );
      const generationId = randomUUID();
      const toolRun = capabilities.nativeToolCalling
        ? startGenerationToolRun(context, {
            generationId,
            conversationId: request.params.id,
            connectionId: input.connectionId,
            model: provider.id,
            messages: compatibilityMessages,
          })
        : undefined;
      const requestMessages: readonly ProviderMessage[] =
        toolRun === undefined
          ? compatibilityMessages
          : [
              toolContextMessage(toolRun.worldbooks, toolRun.participants),
              ...compatibilityMessages,
            ];
      const accessibleWorldbookIds = new Set(
        toolRun?.worldbooks.map((worldbook) => worldbook.id) ?? [],
      );
      const controller = new AbortController();
      context.generations.set(generationId, {
        id: generationId,
        conversationId: request.params.id,
        controller,
      });
      reply.hijack();
      reply.raw.statusCode = 200;
      reply.raw.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
      reply.raw.setHeader("Connection", "keep-alive");
      reply.raw.flushHeaders();
      const onClose = () => {
        if (!reply.raw.writableEnded) {
          controller.abort(new Error("Generation client disconnected."));
        }
      };
      reply.raw.once("close", onClose);
      writeEvent(reply, {
        type: "generation-id",
        generationId,
      });

      let content = "";
      const alternativeContent = new Map<number, string>();
      let completed = false;
      let providerFailed = false;
      let providerCancelled = false;
      let finishReason: "stop" | "length" | "tool-calls" | "cancelled" | null =
        null;
      let providerError:
        { code: string; message: string; retryable: boolean } | undefined;
      let persistedMessage: { id: string; revision: number } | undefined;
      let toolExecutionClosed = false;
      try {
        let providerMessages = [...requestMessages];
        for (let turn = 0; turn < maxConversationToolTurns; turn += 1) {
          const providerRequestId =
            turn === 0 ? generationId : `${generationId}-tool-${String(turn)}`;
          const readToolCalls: ProviderMessageToolCall[] = [];
          const readToolMessages: ProviderMessage[] = [];
          let turnText = "";
          let canContinueWithReadResults = true;
          completed = false;

          for await (const event of provider.generate(
            {
              requestId: providerRequestId,
              messages: providerMessages,
              textPrompt:
                input.injects.length === 0 &&
                input.messagesOverride === undefined
                  ? prompt.textPrompt
                  : compatibilityMessages
                      .map((message) => `${message.role}: ${message.content}`)
                      .join("\n\n"),
              settings: prompt.generation,
              ...(toolRun === undefined
                ? {}
                : { tools: providerConversationTools }),
              metadata: {
                conversationId: request.params.id,
                ...(prompt.presetId === undefined
                  ? {}
                  : { presetId: prompt.presetId }),
                promptSegmentIds: prompt.segments.map((segment) => segment.id),
                ...(toolRun === undefined
                  ? {}
                  : {
                      agentRunId: toolRun.run.id,
                      agentRunStep: turn + 1,
                    }),
              },
            },
            controller.signal,
          )) {
            const choiceIndex =
              "choiceIndex" in event &&
              typeof event.choiceIndex === "number" &&
              Number.isInteger(event.choiceIndex) &&
              event.choiceIndex >= 0
                ? event.choiceIndex
                : 0;
            if (choiceIndex === 0) {
              writeEvent(reply, event);
            }
            if (event.type === "text-delta") {
              if (choiceIndex === 0) {
                content += event.delta;
                turnText += event.delta;
              } else {
                alternativeContent.set(
                  choiceIndex,
                  `${alternativeContent.get(choiceIndex) ?? ""}${event.delta}`,
                );
              }
            }
            if (choiceIndex !== 0) continue;
            if (event.type === "error") {
              completed = false;
              providerFailed = true;
              providerError = {
                code: event.code,
                message: event.message,
                retryable: event.retryable,
              };
            }
            if (event.type === "finish") {
              finishReason = event.reason;
              completed = event.reason !== "cancelled";
              providerCancelled = event.reason === "cancelled";
            }
            if (event.type !== "tool-call-complete" || toolRun === undefined) {
              continue;
            }

            const tool = conversationToolsByName.get(event.name);
            if (tool === undefined) {
              canContinueWithReadResults = false;
              writeEvent(reply, {
                type: "tool-rejected",
                generationId,
                runId: toolRun.run.id,
                providerRequestId,
                providerCallId: event.callId,
                toolName: event.name,
                code: "TOOL_NOT_OFFERED",
                message:
                  "The provider requested a tool that was not offered for ordinary chat.",
              });
              continue;
            }
            if (toolExecutionClosed) {
              canContinueWithReadResults = false;
              writeEvent(reply, {
                type: "tool-rejected",
                generationId,
                runId: toolRun.run.id,
                providerRequestId,
                providerCallId: event.callId,
                toolName: event.name,
                code: "AGENT_RUN_WAITING_CONFIRMATION",
                message:
                  "A write proposal is already waiting for confirmation; later tool calls were not executed.",
              });
              continue;
            }
            if (
              !referencedResourceIsAccessible(
                tool,
                event.arguments,
                accessibleWorldbookIds,
              )
            ) {
              canContinueWithReadResults = false;
              writeEvent(reply, {
                type: "tool-rejected",
                generationId,
                runId: toolRun.run.id,
                providerRequestId,
                providerCallId: event.callId,
                toolName: event.name,
                code: "WORLD_BOOK_NOT_AVAILABLE",
                message:
                  "The requested worldbook is not available to this conversation.",
              });
              continue;
            }
            try {
              const result = context.agents.executeTool({
                runId: toolRun.run.id,
                idempotencyKey:
                  `${toolRun.run.id}:turn:${String(turn + 1)}:` +
                  `provider:${event.callId}`,
                toolName: event.name,
                arguments: event.arguments,
                ...(tool.effect === "read" ? {} : { proposalOnly: true }),
              });
              if (tool.effect === "read") {
                const resultValue = result.result ?? null;
                readToolCalls.push({
                  id: event.callId,
                  name: event.name,
                  arguments: event.arguments,
                });
                readToolMessages.push({
                  role: "tool",
                  content: JSON.stringify(resultValue),
                  name: event.name,
                  toolCallId: event.callId,
                });
                writeEvent(reply, {
                  type: "tool-result",
                  generationId,
                  runId: toolRun.run.id,
                  providerRequestId,
                  providerCallId: event.callId,
                  toolCall: result.call,
                  result: resultValue,
                });
              } else {
                if (result.call.status !== "awaiting_confirmation") {
                  throw new StorageError(
                    "AGENT_PROPOSAL_REQUIRED",
                    "An ordinary-chat write tool must remain pending until user confirmation.",
                    500,
                  );
                }
                toolExecutionClosed = true;
                canContinueWithReadResults = false;
                writeEvent(reply, {
                  type: "tool-proposal",
                  generationId,
                  providerRequestId,
                  run: context.agents.getRun(toolRun.run.id),
                  toolCall: result.call,
                });
              }
            } catch (error) {
              canContinueWithReadResults = false;
              const structured = toolError(error);
              writeEvent(reply, {
                type: "tool-rejected",
                generationId,
                runId: toolRun.run.id,
                providerRequestId,
                providerCallId: event.callId,
                toolName: event.name,
                ...structured,
              });
            }
          }

          if (
            toolRun === undefined ||
            providerFailed ||
            providerCancelled ||
            controller.signal.aborted ||
            toolExecutionClosed ||
            !canContinueWithReadResults ||
            readToolCalls.length === 0
          ) {
            break;
          }
          if (turn + 1 >= maxConversationToolTurns) {
            writeEvent(reply, {
              type: "tool-rejected",
              generationId,
              runId: toolRun.run.id,
              code: "TOOL_TURN_LIMIT_REACHED",
              message:
                "The ordinary-chat generation reached its read-tool continuation limit.",
            });
            break;
          }

          providerMessages = [
            ...providerMessages,
            {
              role: "assistant",
              content: turnText,
              toolCalls: readToolCalls,
            },
            ...readToolMessages,
          ];
          const current = context.agents.getRun(toolRun.run.id);
          context.agents.transitionRun(current.id, ["running"], "running", {
            currentStep: current.currentStep + 1,
          });
        }
        if (content.length > 0 && !toolExecutionClosed) {
          const incomplete =
            !completed ||
            providerFailed ||
            providerCancelled ||
            controller.signal.aborted ||
            finishReason === "length";
          const message = context.store.addAssistantMessage({
            conversationId: request.params.id,
            content,
          });
          const alternatives = [...alternativeContent.entries()]
            .filter(
              ([choiceIndex, alternative]) => choiceIndex > 0 && alternative,
            )
            .sort(([left], [right]) => left - right)
            .map(([, alternative]) => alternative);
          if (alternatives.length > 0) {
            context.store.addSwipe({
              messageId: message.id,
              content,
              selected: true,
            });
            alternatives.forEach((alternative) => {
              context.store.addSwipe({
                messageId: message.id,
                content: alternative,
              });
            });
          }
          persistedMessage = {
            id: message.id,
            revision:
              message.revision +
              (alternatives.length > 0 ? alternatives.length + 1 : 0),
          };
          writeEvent(reply, {
            type: "message-persisted",
            messageId: message.id,
            revision: persistedMessage.revision,
            ...(alternatives.length === 0 ? {} : { alternatives }),
            ...(incomplete
              ? {
                  incomplete: true,
                  reason:
                    finishReason === "length"
                      ? "length"
                      : providerCancelled || controller.signal.aborted
                        ? "cancelled"
                        : "error",
                  ...(providerError === undefined
                    ? {}
                    : {
                        errorCode: providerError.code,
                        errorMessage: providerError.message,
                      }),
                }
              : {}),
          });
        }
      } catch (error) {
        providerFailed = true;
        providerError = {
          code: "GENERATION_STREAM_FAILED",
          message: error instanceof Error ? error.message : String(error),
          retryable: false,
        };
        if (
          content.length > 0 &&
          !toolExecutionClosed &&
          persistedMessage === undefined
        ) {
          const message = context.store.addAssistantMessage({
            conversationId: request.params.id,
            content,
          });
          const alternatives = [...alternativeContent.entries()]
            .filter(
              ([choiceIndex, alternative]) => choiceIndex > 0 && alternative,
            )
            .sort(([left], [right]) => left - right)
            .map(([, alternative]) => alternative);
          if (alternatives.length > 0) {
            context.store.addSwipe({
              messageId: message.id,
              content,
              selected: true,
            });
            alternatives.forEach((alternative) => {
              context.store.addSwipe({
                messageId: message.id,
                content: alternative,
              });
            });
          }
          writeEvent(reply, {
            type: "message-persisted",
            messageId: message.id,
            revision:
              message.revision +
              (alternatives.length > 0 ? alternatives.length + 1 : 0),
            incomplete: true,
            reason: controller.signal.aborted ? "cancelled" : "error",
            errorCode: providerError.code,
            errorMessage: providerError.message,
            ...(alternatives.length === 0 ? {} : { alternatives }),
          });
        }
        writeEvent(reply, { type: "error", ...providerError });
      } finally {
        if (toolRun !== undefined) {
          try {
            const current = context.agents.getRun(toolRun.run.id);
            if (controller.signal.aborted || providerCancelled) {
              context.agents.cancelRun(current.id, current.requestedBy);
            } else if (
              current.status === "queued" ||
              current.status === "running"
            ) {
              context.agents.transitionRun(
                current.id,
                [current.status],
                providerFailed ? "failed" : "completed",
                { currentStep: current.currentStep },
              );
            }
          } catch (error) {
            const structured = toolError(error);
            writeEvent(reply, {
              type: "error",
              code: "AGENT_RUN_FINALIZE_FAILED",
              message: structured.message,
              retryable: false,
            });
          }
        }
        context.generations.delete(generationId);
        reply.raw.removeListener("close", onClose);
        if (!reply.raw.writableEnded) reply.raw.end();
      }
      return reply;
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/generations/:id/abort",
    async (request) => {
      const generation = context.generations.get(request.params.id);
      if (generation) {
        generation.controller.abort(
          new Error("Generation stopped by the local user."),
        );
      }
      return envelope({ id: request.params.id, stopped: Boolean(generation) });
    },
  );
}
