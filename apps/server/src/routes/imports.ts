import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { envelope, type ServerContext } from "../context.js";

interface UploadedFile {
  bytes: Uint8Array;
  filename?: string;
  fields: Readonly<Record<string, string>>;
}

function extractMultipartFile(body: Buffer, contentType: string): UploadedFile {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/iu.exec(contentType);
  const boundary = boundaryMatch?.[1] ?? boundaryMatch?.[2]?.trim();
  if (!boundary) throw new Error("Multipart upload has no boundary.");
  const marker = Buffer.from(`--${boundary}`);
  const fields: Record<string, string> = {};
  let file: Omit<UploadedFile, "fields"> | undefined;
  let cursor = body.indexOf(marker);
  while (cursor >= 0) {
    const headersEnd = body.indexOf(Buffer.from("\r\n\r\n"), cursor);
    if (headersEnd < 0) break;
    const headerText = body
      .subarray(cursor + marker.length + 2, headersEnd)
      .toString("utf8");
    const nextBoundary = body.indexOf(marker, headersEnd + 4);
    if (nextBoundary < 0) break;
    const fieldName = /\bname="([^"]+)"/iu.exec(headerText)?.[1];
    if (fieldName === "file") {
      const filename = /filename="([^"]*)"/iu.exec(headerText)?.[1];
      const end = Math.max(headersEnd + 4, nextBoundary - 2);
      file = {
        bytes: body.subarray(headersEnd + 4, end),
        ...(filename ? { filename } : {}),
      };
    } else if (fieldName) {
      const end = Math.max(headersEnd + 4, nextBoundary - 2);
      fields[fieldName] = body.subarray(headersEnd + 4, end).toString("utf8");
    }
    cursor = nextBoundary;
  }
  if (!file) throw new Error("Multipart upload has no file field.");
  return { ...file, fields };
}

function uploadedFile(request: {
  readonly body: unknown;
  readonly headers: Readonly<Record<string, unknown>>;
}): UploadedFile {
  const contentTypeValue = request.headers["content-type"];
  const contentType =
    typeof contentTypeValue === "string" ? contentTypeValue : "";
  if (!Buffer.isBuffer(request.body)) {
    throw new Error("Import requires a binary or multipart body.");
  }
  if (contentType.startsWith("multipart/form-data")) {
    return extractMultipartFile(request.body, contentType);
  }
  const headerName = request.headers["x-file-name"];
  const filename = Array.isArray(headerName)
    ? headerName.find((value): value is string => typeof value === "string")
    : typeof headerName === "string"
      ? headerName
      : undefined;
  return {
    bytes: request.body,
    ...(filename === undefined ? {} : { filename }),
    fields: {},
  };
}

const entityId = z.string().trim().min(1).max(256);

function requiredConversationCardId(
  file: UploadedFile,
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
  app.post("/api/worldbooks/import", (request, reply) => {
    const file = uploadedFile(request);
    return reply.code(201).send(
      envelope(
        context.imports.importWorldbook(file.bytes, {
          ...(file.filename === undefined ? {} : { filename: file.filename }),
        }),
      ),
    );
  });

  app.post<{ Querystring: { cardId?: string } }>(
    "/api/conversations/import",
    (request, reply) => {
      const file = uploadedFile(request);
      const cardId = requiredConversationCardId(
        file,
        request.query.cardId,
        request.headers["x-card-id"],
      );
      return reply.code(201).send(
        envelope(
          context.imports.importChat(file.bytes, cardId, {
            ...(file.filename === undefined ? {} : { filename: file.filename }),
          }),
        ),
      );
    },
  );

  app.post<{ Params: { cardId: string } }>(
    "/api/cards/:cardId/conversations/import",
    (request, reply) => {
      const file = uploadedFile(request);
      return reply.code(201).send(
        envelope(
          context.imports.importChat(
            file.bytes,
            entityId.parse(request.params.cardId),
            {
              ...(file.filename === undefined
                ? {}
                : { filename: file.filename }),
            },
          ),
        ),
      );
    },
  );
}
