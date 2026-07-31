import path from "node:path";

import { createLegacyHost } from "./app.js";

const port = Number(process.env.STN_LEGACY_PORT ?? 4711);
const host = process.env.STN_HOST ?? "127.0.0.1";
const dataDir = path.resolve(
  process.env.STN_DATA_DIR ?? path.join(import.meta.dirname, "../../../data"),
);
const extensionsRoot = path.join(dataDir, "extensions");
const mainOrigin = process.env.STN_WEB_ORIGIN ?? "http://localhost:4173";
const safeMode = ["1", "true", "yes"].includes(
  (process.env.STN_SAFE_MODE ?? "").toLowerCase(),
);

const app = await createLegacyHost({
  extensionsRoot,
  mainOrigin,
  safeMode,
  logger: true,
});

await app.listen({ host, port });
