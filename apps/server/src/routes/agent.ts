import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { envelope, type ServerContext } from "../context.js";

/**
 * AgentStore is the persistence and authorization kernel for ordinary-chat
 * model tools. These routes intentionally expose only execution and recovery
 * operations; runs are created by conversation generation itself.
 */
export async function registerAgentRoutes(
  app: FastifyInstance,
  context: ServerContext,
): Promise<void> {
  app.get("/api/agent/runs", async (request) => {
    const input = z
      .object({
        conversationId: z.string().trim().min(1).max(256).optional(),
      })
      .strict()
      .parse(request.query);
    return envelope(context.agents.listRuns(input.conversationId));
  });

  app.get<{ Params: { id: string } }>("/api/agent/runs/:id", async (request) =>
    envelope({
      run: context.agents.getRun(request.params.id),
      toolCalls: context.agents.listToolCalls(request.params.id),
      audit: context.store.listAuditRecords({ runId: request.params.id }),
    }),
  );

  app.post<{ Params: { id: string } }>(
    "/api/agent/runs/:id/cancel",
    async (request) =>
      envelope(context.agents.cancelRun(request.params.id, "local-user")),
  );

  app.post<{ Params: { id: string } }>(
    "/api/agent/runs/:id/tools",
    async (request, reply) => {
      const input = z
        .object({
          idempotencyKey: z.string().trim().min(1).max(512),
          toolName: z.string().trim().min(1).max(256),
          arguments: z.record(z.string(), z.unknown()),
          confirmed: z.boolean().default(false),
        })
        .strict()
        .parse(request.body);
      try {
        return envelope(
          context.agents.executeTool({
            runId: request.params.id,
            idempotencyKey: input.idempotencyKey,
            toolName: input.toolName,
            arguments: input.arguments as never,
            confirmed: input.confirmed,
          }),
        );
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "confirmation_required"
        ) {
          return reply.code(409).send({
            error: {
              code: "CONFIRMATION_REQUIRED",
              message:
                error instanceof Error
                  ? error.message
                  : "The conversation tool requires human confirmation.",
            },
          });
        }
        throw error;
      }
    },
  );
}
