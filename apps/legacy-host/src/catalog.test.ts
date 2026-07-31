import { createHash } from "node:crypto";
import { mkdir, mkdtemp, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { LegacyPluginLock } from "@stn/legacy-compat";
import { describe, expect, it } from "vitest";

import { LegacySurfaceCatalog } from "./catalog.js";

const digest = (value: string | Uint8Array): string =>
  createHash("sha256").update(value).digest("hex");

interface CatalogFixture {
  readonly root: string;
  readonly pluginRoot: string;
  readonly lock: LegacyPluginLock;
}

async function createCatalogFixture(): Promise<CatalogFixture> {
  const root = await mkdtemp(path.join(tmpdir(), "stn-catalog-test-"));
  const pluginRoot = path.join(root, "Fixture");
  await mkdir(path.join(pluginRoot, "dist"), { recursive: true });

  const manifest = JSON.stringify({
    display_name: "Catalog fixture",
    loading_order: 1,
    requires: [],
    optional: [],
    js: "dist/index.js",
    css: "dist/index.css",
    version: "1.0.0",
  });
  const entry =
    'import { chat } from "../../../../../script.js"; export const loaded = Boolean(chat);';
  const stylesheet = ".fixture { display: block; }";
  await writeFile(path.join(pluginRoot, "manifest.json"), manifest);
  await writeFile(path.join(pluginRoot, "dist/index.js"), entry);
  await writeFile(path.join(pluginRoot, "dist/index.css"), stylesheet);

  return {
    root,
    pluginRoot,
    lock: {
      id: "fixture",
      displayName: "Catalog fixture",
      repository: "https://example.invalid/catalog-fixture",
      commit: "0000000000000000000000000000000000000000",
      manifestVersion: "1.0.0",
      installDirectory: "Fixture",
      manifestPath: "manifest.json",
      manifestSha256: digest(manifest),
      entryPath: "dist/index.js",
      entrySha256: digest(entry),
      stylesheetPaths: ["dist/index.css"],
      requiredAssets: [
        { path: "manifest.json", sha256: digest(manifest), kind: "manifest" },
        { path: "dist/index.js", sha256: digest(entry), kind: "entry" },
        {
          path: "dist/index.css",
          sha256: digest(stylesheet),
          kind: "style",
        },
      ],
      // A broad legacy pattern must never expand the runtime asset allowlist.
      assetPatterns: ["manifest.json", "dist/**"],
      moduleSurfaces: [{ path: "/script.js", exports: ["chat"] }],
      license: {
        identifier: "Test-only",
        distribution: "user-installed",
        notice: "Newly authored fixture.",
      },
    },
  };
}

function assetUrl(relativePath: string): string {
  return `/scripts/extensions/third-party/Fixture/${relativePath}`;
}

describe("LegacySurfaceCatalog request-time asset verification", () => {
  it("returns the same locked bytes that it hashes, with a usable MIME type", async () => {
    const fixture = await createCatalogFixture();
    const catalog = new LegacySurfaceCatalog(fixture.root, {
      locks: [fixture.lock],
    });
    await catalog.scanInstalledPlugins();

    const asset = await catalog.readAssetRequest(assetUrl("dist/index.css"));

    expect(asset).toBeDefined();
    expect(Buffer.isBuffer(asset?.bytes)).toBe(true);
    expect(asset?.bytes.toString("utf8")).toBe(".fixture { display: block; }");
    expect(asset?.mimeType).toBe("text/css; charset=utf-8");
    expect(asset?.sha256).toBe(
      fixture.lock.requiredAssets.find(
        (candidate) => candidate.path === "dist/index.css",
      )?.sha256,
    );
  });

  it("rejects files that match a legacy wildcard but are not exactly locked", async () => {
    const fixture = await createCatalogFixture();
    await writeFile(
      path.join(fixture.pluginRoot, "dist/unreviewed.js"),
      "export const unreviewed = true;",
    );
    const catalog = new LegacySurfaceCatalog(fixture.root, {
      locks: [fixture.lock],
    });
    await catalog.scanInstalledPlugins();

    expect(catalog.getStatus("fixture")?.verified).toBe(true);
    expect(
      catalog.resolveAssetRequest(assetUrl("dist/unreviewed.js")),
    ).toBeUndefined();
    await expect(
      catalog.readAssetRequest(assetUrl("dist/unreviewed.js")),
    ).resolves.toBeUndefined();
  });

  it("rejects a locked file replaced by a symlink after scanning", async () => {
    const fixture = await createCatalogFixture();
    const catalog = new LegacySurfaceCatalog(fixture.root, {
      locks: [fixture.lock],
    });
    await catalog.scanInstalledPlugins();

    const entryPath = path.join(fixture.pluginRoot, "dist/index.js");
    const outsideFile = path.join(
      await mkdtemp(path.join(tmpdir(), "stn-catalog-outside-")),
      "index.js",
    );
    const expectedEntry = await catalog.readAssetRequest(
      assetUrl("dist/index.js"),
    );
    await writeFile(outsideFile, expectedEntry?.bytes ?? Buffer.alloc(0));
    await unlink(entryPath);
    await symlink(outsideFile, entryPath);

    await expect(
      catalog.readAssetRequest(assetUrl("dist/index.js")),
    ).resolves.toBeUndefined();
    expect(catalog.getStatus("fixture")).toMatchObject({
      installed: true,
      verified: false,
      enabled: false,
    });
  });

  it("rejects locked bytes changed after a successful scan", async () => {
    const fixture = await createCatalogFixture();
    const catalog = new LegacySurfaceCatalog(fixture.root, {
      locks: [fixture.lock],
    });
    await catalog.scanInstalledPlugins();
    expect(catalog.getStatus("fixture")?.verified).toBe(true);

    await writeFile(
      path.join(fixture.pluginRoot, "dist/index.css"),
      ".fixture { display: none; }",
    );

    await expect(
      catalog.readAssetRequest(assetUrl("dist/index.css")),
    ).resolves.toBeUndefined();
    expect(catalog.getStatus("fixture")?.verified).toBe(false);
  });

  it("rejects a locked path replaced by a directory after scanning", async () => {
    const fixture = await createCatalogFixture();
    const catalog = new LegacySurfaceCatalog(fixture.root, {
      locks: [fixture.lock],
    });
    await catalog.scanInstalledPlugins();

    const stylesheetPath = path.join(fixture.pluginRoot, "dist/index.css");
    await unlink(stylesheetPath);
    await mkdir(stylesheetPath);

    await expect(
      catalog.readAssetRequest(assetUrl("dist/index.css")),
    ).resolves.toBeUndefined();
    expect(catalog.getStatus("fixture")?.verified).toBe(false);
  });
});
