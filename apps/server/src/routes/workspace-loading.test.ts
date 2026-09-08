import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { createServer, type ServerApplication } from "../app.js";

let application: ServerApplication | undefined;
type Item = {
  id: string;
  detailsLoaded?: number;
  entries?: unknown[];
  entryCount: number;
  payload?: unknown;
};
afterEach(async () => {
  await application?.app.close();
});

it("serves compact directories and retrieves only the requested editable detail", async () => {
  application = await createServer({
    dataDirectory: await mkdtemp(path.join(tmpdir(), "stn-loading-")),
    databasePath: ":memory:",
    authentication: false,
    seedDevelopmentData: true,
  });
  const { app } = application;
  for (const route of [
    "cards",
    "conversations?limit=50",
    "worldbooks",
    "presets",
  ]) {
    const separator = route.includes("?") ? "&" : "?";
    const full = await app.inject(`/api/${route}`);
    const summary = await app.inject(`/api/${route}${separator}view=summary`);
    expect(summary.statusCode).toBe(200);
    expect(summary.body).not.toContain('"legacyPayload"');
    expect(summary.body).not.toContain('"payload"');
    const items = (response: typeof full) =>
      route.startsWith("conversations")
        ? response.json<{ data: { items: Item[] } }>().data.items
        : response.json<{ data: Item[] }>().data;
    expect(items(summary).map((item: { id: string }) => item.id)).toEqual(
      items(full).map((item: { id: string }) => item.id),
    );
    if (route === "worldbooks" || route === "presets") {
      const first = items(summary)[0]!;
      expect(first.detailsLoaded).toBe(0);
      expect(first.entries).toBeUndefined();
      const detail = await app.inject(`/api/${route}/${first.id}`);
      expect(detail.statusCode).toBe(200);
      expect(detail.json<{ data: Item }>().data.id).toBe(first.id);
      expect(detail.body).not.toContain('"legacyPayload"');
      if (route === "worldbooks")
        expect(detail.json<{ data: Item }>().data.entries).toHaveLength(
          first.entryCount,
        );
      else expect(detail.json<{ data: Item }>().data.payload).toBeDefined();
    }
  }
});
