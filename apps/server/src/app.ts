import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";

import { AgentStore, AppDatabase, AppStore, StorageError } from "@stn/storage";

import {
  defaultGenerationBudget,
  type GenerationBudget,
  type ServerContext,
} from "./context.js";
import { ImportService } from "./import-service.js";
import { ProviderRegistry } from "./provider-registry.js";
import { registerAgentRoutes } from "./routes/agent.js";
import { registerCompatibilityRoutes } from "./routes/compatibility.js";
import { registerImportRoutes } from "./routes/imports.js";
import { registerLegacyBrokerRoutes } from "./routes/legacy.js";
import { registerPresetRoutes } from "./routes/presets.js";
import { registerProviderRoutes } from "./routes/providers.js";
import { registerRegexRoutes } from "./routes/regex.js";
import { registerWorkspaceRoutes } from "./routes/workspace.js";
import { seedDevelopmentWorkspace } from "./seed.js";
import { ServerSecretVault } from "./secrets.js";

export interface ServerOptions {
  readonly dataDirectory?: string;
  readonly databasePath?: string;
  readonly corsOrigin?: string;
  readonly logger?: boolean;
  readonly seedDevelopmentData?: boolean;
  readonly generationBudget?: Partial<GenerationBudget>;
}

export interface ServerApplication {
  readonly app: FastifyInstance;
  readonly context: ServerContext;
}

export async function createServer(
  options: ServerOptions = {},
): Promise<ServerApplication> {
  const dataDirectory = path.resolve(options.dataDirectory ?? "./data");
  await mkdir(dataDirectory, { recursive: true });
  const databasePath =
    options.databasePath ?? path.join(dataDirectory, "sillytavern-n.sqlite");
  const store = new AppStore(new AppDatabase({ path: databasePath }));
  const vault = new ServerSecretVault(dataDirectory);
  const providers = new ProviderRegistry(store, vault);
  const context: ServerContext = {
    store,
    agents: new AgentStore(store),
    imports: new ImportService(store, path.join(dataDirectory, "assets")),
    providers,
    vault,
    generations: new Map(),
    generationBudget: {
      ...defaultGenerationBudget,
      ...options.generationBudget,
    },
  };
  if (options.seedDevelopmentData) {
    seedDevelopmentWorkspace(store);
  }

  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 34 * 1024 * 1024,
  });
  await app.register(cors, {
    origin: options.corsOrigin ?? "http://localhost:4173",
    credentials: false,
  });

  await app.register(multipart, {
    limits: {
      files: 1,
      fields: 8,
      parts: 9,
      fileSize: 32 * 1024 * 1024,
      fieldSize: 8 * 1024,
    },
  });

  app.addContentTypeParser(
    [
      "application/octet-stream",
      "application/zip",
      "application/x-zip-compressed",
      "image/png",
    ],
    { bodyLimit: 34 * 1024 * 1024 },
    (_request, payload, done) => done(null, payload),
  );

  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "no-referrer");
    return payload;
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed.",
          issues: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      });
    }
    if (error instanceof StorageError) {
      return reply.code(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      });
    }
    app.log.error(error);
    return reply.code(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : "Internal error",
      },
    });
  });

  await registerWorkspaceRoutes(app, context);
  await registerImportRoutes(app, context);
  await registerPresetRoutes(app, context);
  await registerProviderRoutes(app, context);
  await registerAgentRoutes(app, context);
  await registerLegacyBrokerRoutes(app, context);
  await registerCompatibilityRoutes(app, context);
  await registerRegexRoutes(app, context);

  app.get<{ Params: { filename: string } }>(
    "/api/assets/cards/:filename",
    async (request, reply) => {
      if (!/^[a-f0-9]{64}\.png$/u.test(request.params.filename)) {
        return reply.code(404).send({
          error: { code: "ASSET_NOT_FOUND", message: "Asset not found." },
        });
      }
      try {
        const content = await readFile(
          path.join(dataDirectory, "assets", "cards", request.params.filename),
        );
        return reply
          .type("image/png")
          .header("cache-control", "public, max-age=31536000, immutable")
          .send(content);
      } catch {
        return reply.code(404).send({
          error: { code: "ASSET_NOT_FOUND", message: "Asset not found." },
        });
      }
    },
  );

  app.get("/", async () => ({
    name: "SillyTavern N",
    api: "/api/health",
  }));

  app.addHook("onClose", async () => {
    for (const generation of context.generations.values()) {
      generation.controller.abort(new Error("Server is shutting down."));
    }
    context.generations.clear();
    store.close();
  });

  return { app, context };
}
