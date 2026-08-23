import path from "node:path";

import { createServer } from "./app.js";

const port = Number(process.env.STN_PORT ?? 4710);
const host = process.env.STN_HOST ?? "127.0.0.1";
const dataDirectory = path.resolve(
  process.env.STN_DATA_DIR ?? path.join(import.meta.dirname, "../../../data"),
);
const corsOrigin = process.env.STN_WEB_ORIGIN ?? "http://localhost:4173";
const seedDevelopmentData = process.env.STN_SEED_DEMO !== "false";

const { app } = await createServer({
  dataDirectory,
  corsOrigin,
  logger: true,
  seedDevelopmentData,
  authentication: true,
});

await app.listen({ host, port });
