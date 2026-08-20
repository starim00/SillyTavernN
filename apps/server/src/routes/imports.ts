import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { envelope, type ServerContext } from "../context.js";
import { exportConversationArchive } from "../conversation-archive.js";
import { receiveImportUpload, type StagedUpload } from "../upload.js";

const entityId = z.string().trim().min(1).max(256);

function requiredConversationCardId(
  file: StagedUpload,
  queryCardId: unknown,
  headerCardId: unknown,
): string {
  return entityId.parse(
    file.fields.cardId ??
      (typeof queryCardId === "string" ? queryCardId : undefined) ??
      (typeof headerCardId === "string" ? headerCardId : undefined),
  );
}

export async function registerImportRoutes(
  app: FastifyInstance,
  context: ServerContext,
): Promise<void> {
  app.get<{
    Params: { id: string };
  }>("/api/conversations/:id/export", (request, reply) => {
    reply.header("Cache-Control", "no-store");
    return envelope(
      exportConversationArchive(
        context.store,
        entityId.parse(request.params.id),
      ),
    );
  });

  app.post("/api/worldbooks/import", async (request, reply) => {
    const file = await receiveImportUpload(request);
    try {
      return reply.code(201).send(
        envelope(
          await context.imports.importWorldbookFile(file.path, {
            ...(file.filename === undefined ? {} : { filename: file.filename }),
          }),
        ),
      );
    } finally {
      await file.cleanup();
    }
  });

  app.post<{ Querystring: { cardId?: string } }>(
    "/api/conversations/import",
    async (request, reply) => {
      const file = await receiveImportUpload(request);
      try {
        const cardId = requiredConversationCardId(
          file,
          request.query.cardId,
          request.headers["x-card-id"],
        );
        return reply.code(201).send(
          envelope(
            await context.imports.importChatFile(file.path, cardId, {
              ...(file.filename === undefined
                ? {}
                : { filename: file.filename }),
            }),
          ),
        );
      } finally {
        await file.cleanup();
      }
    },
  );

  app.post<{ Params: { cardId: string } }>(
    "/api/cards/:cardId/conversations/import",
    async (request, reply) => {
      const file = await receiveImportUpload(request);
      try {
        return reply.code(201).send(
          envelope(
            await context.imports.importChatFile(
              file.path,
              entityId.parse(request.params.cardId),
              {
                ...(file.filename === undefined
                  ? {}
                  : { filename: file.filename }),
              },
            ),
          ),
        );
      } finally {
        await file.cleanup();
      }
    },
  );
}
