import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import type { FastifyRequest } from "fastify";

import { StorageError } from "@stn/storage";

const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_FIELD_BYTES = 8 * 1024;

export interface StagedUpload {
  readonly path: string;
  readonly filename?: string;
  readonly fields: Readonly<Record<string, string>>;
  readonly size: number;
  read(): Promise<Uint8Array>;
  stream(): Readable;
  cleanup(): Promise<void>;
}

async function stageStream(
  source: Readable,
  filename: string | undefined,
  fields: Readonly<Record<string, string>>,
): Promise<StagedUpload> {
  const directory = path.join(tmpdir(), "sillytavern-n-imports");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporaryPath = path.join(directory, `${randomUUID()}.upload`);
  let size = 0;
  source.on("data", (chunk: Buffer | string) => {
    size += Buffer.byteLength(chunk);
    if (size > MAX_FILE_BYTES) {
      source.destroy(
        new StorageError(
          "IMPORT_FILE_LIMIT",
          "Import file exceeds 32 MiB.",
          413,
        ),
      );
    }
  });
  try {
    await pipeline(
      source,
      createWriteStream(temporaryPath, { flags: "wx", mode: 0o600 }),
    );
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
  return {
    path: temporaryPath,
    ...(filename === undefined ? {} : { filename }),
    fields,
    size,
    read: async () => readFile(temporaryPath),
    stream: () => createReadStream(temporaryPath),
    cleanup: async () => unlink(temporaryPath).catch(() => undefined),
  };
}

export async function receiveImportUpload(
  request: FastifyRequest,
): Promise<StagedUpload> {
  if (request.isMultipart()) {
    const fields: Record<string, string> = {};
    let upload: StagedUpload | undefined;
    let fieldCount = 0;
    for await (const part of request.parts({
      limits: {
        files: 1,
        fields: 8,
        parts: 9,
        fileSize: MAX_FILE_BYTES,
        fieldSize: MAX_FIELD_BYTES,
      },
    })) {
      if (part.type === "file") {
        if (upload !== undefined) {
          part.file.resume();
          throw new StorageError(
            "IMPORT_FILE_COUNT_LIMIT",
            "Import accepts exactly one file.",
            400,
          );
        }
        upload = await stageStream(
          part.file,
          part.filename || undefined,
          fields,
        );
        if (part.file.truncated) {
          await upload.cleanup();
          throw new StorageError(
            "IMPORT_FILE_LIMIT",
            "Import file exceeds 32 MiB.",
            413,
          );
        }
      } else {
        fieldCount += 1;
        const value = String(part.value);
        if (
          fieldCount > 8 ||
          Buffer.byteLength(value, "utf8") > MAX_FIELD_BYTES
        ) {
          await upload?.cleanup();
          throw new StorageError(
            "IMPORT_FIELD_LIMIT",
            "Import form fields exceed their limits.",
            400,
          );
        }
        fields[part.fieldname] = value;
      }
    }
    if (upload === undefined) {
      throw new StorageError(
        "IMPORT_FILE_REQUIRED",
        "Import requires one file.",
        400,
      );
    }
    return { ...upload, fields };
  }

  if (!(request.body instanceof Readable)) {
    throw new StorageError(
      "IMPORT_BODY_REQUIRED",
      "Import requires a binary body.",
      400,
    );
  }
  const headerName = request.headers["x-file-name"];
  const filename = Array.isArray(headerName) ? headerName[0] : headerName;
  return stageStream(request.body, filename, {});
}
