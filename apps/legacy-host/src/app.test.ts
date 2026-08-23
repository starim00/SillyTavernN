import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { LegacyPluginLock } from "@stn/legacy-compat";
import { describe, expect, it } from "vitest";

import { createLegacyHost } from "./app.js";
import { LegacySurfaceCatalog } from "./catalog.js";

const hash = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

async function createFixture(
  entry = 'import { chat } from "../../../../../script.js"; export const loaded = Boolean(chat);',
): Promise<{ root: string; lock: LegacyPluginLock }> {
  const root = await mkdtemp(path.join(tmpdir(), "stn-legacy-"));
  const pluginRoot = path.join(root, "Fixture");
  await mkdir(path.join(pluginRoot, "dist"), { recursive: true });
  const manifest = JSON.stringify({
    display_name: "Clean-room fixture",
    loading_order: 1,
    requires: [],
    optional: [],
    js: "dist/index.js",
    css: "dist/index.css",
    version: "1.0.0",
  });
  const stylesheet = ".fixture { display: block; }";
  await writeFile(path.join(pluginRoot, "manifest.json"), manifest);
  await writeFile(path.join(pluginRoot, "dist/index.js"), entry);
  await writeFile(path.join(pluginRoot, "dist/index.css"), stylesheet);

  return {
    root,
    lock: {
      id: "fixture",
      uiId: "plugin-fixture",
      displayName: "Clean-room fixture",
      shortName: "Fixture",
      repository: "https://example.invalid/clean-room-fixture",
      commit: "0000000000000000000000000000000000000000",
      manifestVersion: "1.0.0",
      executionOwner: "legacy",
      legacyRealmRole: "full-runtime",
      capabilities: [],
      nativeDescription: "Clean-room test fixture.",
      installDirectory: "Fixture",
      manifestPath: "manifest.json",
      manifestSha256: hash(manifest),
      entryPath: "dist/index.js",
      entrySha256: hash(entry),
      stylesheetPaths: ["dist/index.css"],
      requiredAssets: [
        { path: "manifest.json", sha256: hash(manifest), kind: "manifest" },
        { path: "dist/index.js", sha256: hash(entry), kind: "entry" },
        { path: "dist/index.css", sha256: hash(stylesheet), kind: "style" },
      ],
      assetPatterns: ["manifest.json", "dist/**"],
      moduleSurfaces: [{ path: "/script.js", exports: ["chat"] }],
      license: {
        identifier: "Test-only",
        distribution: "user-installed",
        notice: "Self-authored fixture; no third-party plugin code.",
      },
    },
  };
}

describe("legacy host", () => {
  it("allows both loopback web origins while rejecting every other origin", async () => {
    const fixture = await createFixture();
    const app = await createLegacyHost({
      extensionsRoot: fixture.root,
      mainOrigin: "http://localhost:4173",
      locks: [fixture.lock],
    });

    const aliasOrigin = "http://127.0.0.1:4173";
    const aliasHealth = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: aliasOrigin },
    });
    expect(aliasHealth.statusCode).toBe(200);
    expect(aliasHealth.headers["access-control-allow-origin"]).toBe(
      aliasOrigin,
    );
    expect(aliasHealth.headers["content-security-policy"]).toContain(
      "frame-ancestors http://localhost:4173 http://127.0.0.1:4173",
    );
    expect(aliasHealth.headers["content-security-policy"]).toContain(
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' http: https:",
    );
    expect(aliasHealth.headers["content-security-policy"]).toContain(
      "connect-src 'self' http: https:",
    );
    expect(aliasHealth.headers["content-security-policy"]).toContain(
      "media-src 'self' data: blob: http: https:",
    );

    const aliasPreflight = await app.inject({
      method: "OPTIONS",
      url: "/plugins/fixture/enabled",
      headers: {
        origin: aliasOrigin,
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      },
    });
    expect(aliasPreflight.statusCode).toBe(204);
    expect(aliasPreflight.headers["access-control-allow-origin"]).toBe(
      aliasOrigin,
    );

    const ipv6Origin = "http://[::1]:4173";
    const ipv6Health = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: ipv6Origin },
    });
    expect(ipv6Health.statusCode).toBe(200);
    expect(ipv6Health.headers["access-control-allow-origin"]).toBe(ipv6Origin);

    const foreignOrigin = "https://untrusted.example";
    const foreignPreflight = await app.inject({
      method: "OPTIONS",
      url: "/plugins/fixture/enabled",
      headers: {
        origin: foreignOrigin,
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      },
    });
    expect(foreignPreflight.statusCode).toBe(403);
    expect(foreignPreflight.headers["access-control-allow-origin"]).not.toBe(
      foreignOrigin,
    );

    const foreignEnablement = await app.inject({
      method: "POST",
      url: "/plugins/fixture/enabled",
      headers: { origin: foreignOrigin },
      payload: { enabled: true },
    });
    expect(foreignEnablement.statusCode).toBe(403);

    await app.close();
  });

  it("verifies a clean-room fixture and serves exact facades and allowlisted assets", async () => {
    const fixture = await createFixture();
    const app = await createLegacyHost({
      extensionsRoot: fixture.root,
      mainOrigin: "http://localhost:4173",
      locks: [fixture.lock],
    });

    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);
    expect(health.headers["access-control-allow-origin"]).toBe(
      "http://localhost:4173",
    );
    expect(health.json()).toMatchObject({
      ok: true,
      safeMode: false,
      plugins: [
        {
          id: "fixture",
          uiId: "plugin-fixture",
          executionOwner: "legacy",
          legacyRealmRole: "full-runtime",
          installed: true,
          verified: true,
          enabled: false,
        },
      ],
    });
    expect(
      health.json<{ plugins: Array<Record<string, unknown>> }>().plugins[0],
    ).not.toHaveProperty("lock");

    const facade = await app.inject({ method: "GET", url: "/script.js" });
    expect(facade.statusCode).toBe(200);
    expect(facade.body).toContain("export const chat");

    expect(
      await app.inject({
        method: "GET",
        url: "/scripts/extensions/third-party/Fixture/dist/index.css",
      }),
    ).toMatchObject({ statusCode: 423 });
    expect(
      await app.inject({
        method: "GET",
        url: "/realm/fixture?conversationId=conversation-fixture&presetId=preset-fixture",
      }),
    ).toMatchObject({ statusCode: 423 });

    const enabled = await app.inject({
      method: "POST",
      url: "/plugins/fixture/enabled",
      headers: { origin: "http://localhost:4173" },
      payload: { enabled: true },
    });
    expect(enabled).toMatchObject({ statusCode: 200 });
    expect(enabled.json()).toMatchObject({
      plugin: { installed: true, verified: true, enabled: true },
    });

    const asset = await app.inject({
      method: "GET",
      url: "/scripts/extensions/third-party/Fixture/dist/index.css",
    });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers["content-type"]).toContain("text/css");

    const realm = await app.inject({
      method: "GET",
      url: "/realm/fixture?conversationId=conversation-fixture&presetId=preset-fixture",
    });
    expect(realm.statusCode).toBe(200);
    expect(realm.body).toContain("dist/index.css");
    expect(realm.body).toContain(
      '<script src="/vendor/lodash.min.js"></script>',
    );
    expect(realm.body).toContain(
      '<script src="/vendor/jquery.min.js"></script>',
    );
    expect(realm.body).toContain(
      '<script src="/vendor/popper.min.js"></script>',
    );
    expect(realm.body).toContain(
      '<link rel="stylesheet" href="/vendor/fontawesome/css/all.min.css">',
    );
    expect(realm.body).toContain(
      'src="https://testingcf.jsdelivr.net/npm/vue/dist/vue.runtime.global.prod.min.js"',
    );
    expect(realm.body).toContain('data-loaded="true"');
    expect(realm.body).toContain("const commonEnumProviders");
    expect(realm.body).toContain('boolean(mode = "trueFalse")');
    expect(realm.body).toContain("ARGUMENT_TYPE");
    expect(realm.body).toContain(
      "reloadMarkdownProcessor: () => ({ makeHtml: renderLegacyMarkdown })",
    );
    expect(realm.body).toContain("uuidv4: () => crypto.randomUUID()");
    const lodash = await app.inject({
      method: "GET",
      url: "/vendor/lodash.min.js",
    });
    expect(lodash.statusCode).toBe(200);
    expect(lodash.headers["content-type"]).toContain("text/javascript");
    expect(lodash.body).toContain("VERSION");
    expect(lodash.body).toContain("4.18.1");
    const jquery = await app.inject({
      method: "GET",
      url: "/vendor/jquery.min.js",
    });
    expect(jquery.statusCode).toBe(200);
    expect(jquery.headers["content-type"]).toContain("text/javascript");
    expect(jquery.body).toContain("jQuery v3.7.1");
    const popper = await app.inject({
      method: "GET",
      url: "/vendor/popper.min.js",
    });
    expect(popper.statusCode).toBe(200);
    expect(popper.headers["content-type"]).toContain("text/javascript");
    expect(popper.body).toContain("createPopper");
    const fontAwesome = await app.inject({
      method: "GET",
      url: "/vendor/fontawesome/css/all.min.css",
    });
    expect(fontAwesome.statusCode).toBe(200);
    expect(fontAwesome.headers["content-type"]).toContain("text/css");
    expect(fontAwesome.body).toContain("Font Awesome Free 6.5.2");
    expect(fontAwesome.body).toContain(".fa-toggle-on:before");
    expect(fontAwesome.body).toContain(".fa-info-circle:before");
    expect(fontAwesome.body).toContain(".fa-pencil:before");
    expect(fontAwesome.body).toContain(".fa-ellipsis-h:before");
    expect(fontAwesome.body).toContain(".fa-trash:before");
    const fontAwesomeSolid = await app.inject({
      method: "GET",
      url: "/vendor/fontawesome/webfonts/fa-solid-900.woff2",
    });
    expect(fontAwesomeSolid.statusCode).toBe(200);
    expect(fontAwesomeSolid.headers["content-type"]).toContain("font/woff2");
    expect(fontAwesomeSolid.rawPayload.byteLength).toBeGreaterThan(100_000);
    expect(
      await app.inject({
        method: "GET",
        url: "/vendor/fontawesome/webfonts/not-allowed.woff2",
      }),
    ).toMatchObject({ statusCode: 404 });
    const version = await app.inject({
      method: "GET",
      url: "/version",
    });
    expect(version.statusCode).toBe(200);
    expect(version.json()).toEqual({
      pkgVersion: "1.13.5",
      compatibilityHost: true,
    });
    expect(realm.body).toContain(
      'window.addEventListener("unhandledrejection"',
    );
    expect(realm.body).toContain('post("settings.load", "settings.read"');
    expect(realm.body).toContain(
      '"character.current.read",\n              "character.read"',
    );
    expect(realm.body).toContain(
      '"preset.current.read",\n              "preset.read"',
    );
    expect(realm.body.indexOf("await hydrateCurrentContent()")).toBeLessThan(
      realm.body.indexOf("loadedModule = await import("),
    );
    expect(realm.body).toContain('reportCrash("activate", error)');

    await app.close();
  });

  it("never exposes a legacy realm or assets for native replacements", async () => {
    const fixture = await createFixture();
    const nativeLock: LegacyPluginLock = {
      ...fixture.lock,
      executionOwner: "native",
      legacyRealmRole: "none",
    };
    const app = await createLegacyHost({
      extensionsRoot: fixture.root,
      mainOrigin: "http://localhost:4173",
      locks: [nativeLock],
    });

    expect(
      await app.inject({
        method: "POST",
        url: "/plugins/fixture/enabled",
        headers: { origin: "http://localhost:4173" },
        payload: { enabled: true },
      }),
    ).toMatchObject({ statusCode: 409 });
    expect(
      await app.inject({ method: "GET", url: "/realm/fixture" }),
    ).toMatchObject({ statusCode: 409 });
    expect(
      await app.inject({
        method: "GET",
        url: "/scripts/extensions/third-party/Fixture/dist/index.js",
      }),
    ).toMatchObject({ statusCode: 409 });

    await app.close();
  });

  it("fails closed when a plugin is missing or an entry hash changes", async () => {
    const fixture = await createFixture();
    await writeFile(
      path.join(fixture.root, "Fixture/dist/index.js"),
      "throw new Error('changed after pin');",
    );
    const app = await createLegacyHost({
      extensionsRoot: fixture.root,
      mainOrigin: "http://localhost:4173",
      locks: [fixture.lock],
    });

    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.json()).toMatchObject({
      plugins: [
        {
          installed: true,
          verified: false,
          enabled: false,
        },
      ],
    });
    expect(
      await app.inject({ method: "GET", url: "/realm/fixture" }),
    ).toMatchObject({ statusCode: 409 });
    expect(
      await app.inject({
        method: "POST",
        url: "/plugins/fixture/enabled",
        headers: { origin: "http://localhost:4173" },
        payload: { enabled: true },
      }),
    ).toMatchObject({ statusCode: 409 });
    expect(
      await app.inject({
        method: "GET",
        url: "/scripts/extensions/third-party/Fixture/dist/index.js",
      }),
    ).toMatchObject({ statusCode: 404 });

    await app.close();
  });

  it("re-verifies the checkout immediately before enabling it", async () => {
    const fixture = await createFixture();
    const app = await createLegacyHost({
      extensionsRoot: fixture.root,
      mainOrigin: "http://localhost:4173",
      locks: [fixture.lock],
    });
    await writeFile(
      path.join(fixture.root, "Fixture/dist/index.js"),
      "throw new Error('changed after host startup');",
    );

    const enabled = await app.inject({
      method: "POST",
      url: "/plugins/fixture/enabled",
      headers: { origin: "http://localhost:4173" },
      payload: { enabled: true },
    });

    expect(enabled).toMatchObject({ statusCode: 409 });
    expect(
      (await app.inject({ method: "GET", url: "/health" })).json(),
    ).toMatchObject({
      plugins: [{ verified: false, enabled: false }],
    });
    expect(
      await app.inject({ method: "GET", url: "/realm/fixture" }),
    ).toMatchObject({ statusCode: 409 });
    await app.close();
  });

  it("reports a missing pinned plugin without preventing health or facade startup", async () => {
    const fixture = await createFixture();
    const emptyRoot = await mkdtemp(path.join(tmpdir(), "stn-legacy-empty-"));
    const app = await createLegacyHost({
      extensionsRoot: emptyRoot,
      mainOrigin: "http://localhost:4173",
      locks: [fixture.lock],
    });

    expect(
      (await app.inject({ method: "GET", url: "/health" })).json(),
    ).toMatchObject({
      ok: true,
      plugins: [{ installed: false, verified: false, enabled: false }],
    });
    expect(
      await app.inject({ method: "GET", url: "/script.js" }),
    ).toMatchObject({ statusCode: 200 });
    expect(
      await app.inject({ method: "GET", url: "/realm/fixture" }),
    ).toMatchObject({ statusCode: 409 });

    await app.close();
  });

  it("safe mode skips discovery and rejects realms, facades, and plugin assets", async () => {
    const fixture = await createFixture();
    const app = await createLegacyHost({
      extensionsRoot: fixture.root,
      mainOrigin: "http://localhost:4173",
      locks: [fixture.lock],
      safeMode: true,
    });

    expect(
      (await app.inject({ method: "GET", url: "/health" })).json(),
    ).toMatchObject({
      safeMode: true,
      plugins: [{ verified: false, enabled: false }],
    });
    for (const url of [
      "/realm/fixture",
      "/script.js",
      "/scripts/extensions/third-party/Fixture/dist/index.js",
    ]) {
      expect(await app.inject({ method: "GET", url })).toMatchObject({
        statusCode: 423,
      });
    }

    await app.close();
  });

  it("does not serve unreviewed or traversal-like plugin paths", async () => {
    const fixture = await createFixture();
    const app = await createLegacyHost({
      extensionsRoot: fixture.root,
      mainOrigin: "http://localhost:4173",
      locks: [fixture.lock],
    });

    expect(
      await app.inject({
        method: "GET",
        url: "/scripts/extensions/third-party/Fixture/private.txt",
      }),
    ).toMatchObject({ statusCode: 404 });
    expect(
      await app.inject({
        method: "GET",
        url: "/scripts/extensions/third-party/Fixture/%2e%2e/manifest.json",
      }),
    ).toMatchObject({ statusCode: 404 });

    await app.close();
  });

  it("installs only the reviewed repository and refreshes plugin health", async () => {
    const fixture = await createFixture();
    const emptyRoot = await mkdtemp(path.join(tmpdir(), "stn-legacy-empty-"));
    const app = await createLegacyHost({
      extensionsRoot: emptyRoot,
      mainOrigin: "http://localhost:4173",
      locks: [fixture.lock],
      installPlugin: async (extensionsRoot, lock) => {
        const sourceRoot = path.join(fixture.root, "Fixture");
        const targetRoot = path.join(extensionsRoot, lock.installDirectory);
        await mkdir(path.join(targetRoot, "dist"), { recursive: true });
        for (const relativePath of [
          "manifest.json",
          "dist/index.js",
          "dist/index.css",
        ]) {
          const source = await readFile(path.join(sourceRoot, relativePath));
          await writeFile(path.join(targetRoot, relativePath), source);
        }
        const catalog = new LegacySurfaceCatalog(extensionsRoot, {
          locks: [lock],
        });
        await catalog.scanInstalledPlugins();
        const status = catalog.getStatus(lock.id)!;
        return { outcome: "installed", status };
      },
    });

    const rejected = await app.inject({
      method: "POST",
      url: "/plugins/fixture/install",
      headers: { origin: "http://localhost:4173" },
      payload: { repository: "https://example.invalid/not-reviewed" },
    });
    expect(rejected).toMatchObject({ statusCode: 400 });

    const installed = await app.inject({
      method: "POST",
      url: "/plugins/fixture/install",
      headers: { origin: "http://localhost:4173" },
      payload: { repository: fixture.lock.repository },
    });
    expect(installed).toMatchObject({ statusCode: 201 });
    expect(installed.json()).toMatchObject({
      outcome: "installed",
      plugin: { installed: true, verified: true, enabled: false },
    });
    expect(
      (await app.inject({ method: "GET", url: "/health" })).json(),
    ).toMatchObject({
      plugins: [{ installed: true, verified: true, enabled: false }],
    });

    const missingOrigin = await app.inject({
      method: "POST",
      url: "/plugins/fixture/install",
      payload: { repository: fixture.lock.repository },
    });
    expect(missingOrigin).toMatchObject({ statusCode: 403 });

    const forbiddenOrigin = await app.inject({
      method: "POST",
      url: "/plugins/fixture/install",
      headers: { origin: "https://example.invalid" },
      payload: { repository: fixture.lock.repository },
    });
    expect(forbiddenOrigin).toMatchObject({ statusCode: 403 });

    const enabled = await app.inject({
      method: "POST",
      url: "/plugins/fixture/enabled",
      headers: { origin: "http://localhost:4173" },
      payload: { enabled: true },
    });
    expect(enabled.json()).toMatchObject({
      plugin: { installed: true, verified: true, enabled: true },
    });
    await app.close();

    const rebuilt = await createLegacyHost({
      extensionsRoot: emptyRoot,
      mainOrigin: "http://localhost:4173",
      locks: [fixture.lock],
    });
    expect(
      (await rebuilt.inject({ method: "GET", url: "/health" })).json(),
    ).toMatchObject({
      plugins: [{ installed: true, verified: true, enabled: true }],
    });
    expect(
      await rebuilt.inject({
        method: "POST",
        url: "/plugins/fixture/enabled",
        payload: { enabled: false },
      }),
    ).toMatchObject({ statusCode: 403 });
    expect(
      await rebuilt.inject({
        method: "POST",
        url: "/plugins/fixture/enabled",
        headers: { origin: "http://localhost:4173" },
        payload: { enabled: false },
      }),
    ).toMatchObject({ statusCode: 200 });
    expect(
      await rebuilt.inject({ method: "GET", url: "/realm/fixture" }),
    ).toMatchObject({ statusCode: 423 });
    await rebuilt.close();
  });

  it("keeps the plugin disabled across a concurrent reinstall attempt", async () => {
    const fixture = await createFixture();
    let markStarted: (() => void) | undefined;
    let finishInstall: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const finish = new Promise<void>((resolve) => {
      finishInstall = resolve;
    });
    const app = await createLegacyHost({
      extensionsRoot: fixture.root,
      mainOrigin: "http://localhost:4173",
      locks: [fixture.lock],
      installPlugin: async (extensionsRoot, lock) => {
        markStarted?.();
        await finish;
        const catalog = new LegacySurfaceCatalog(extensionsRoot, {
          locks: [lock],
        });
        await catalog.scanInstalledPlugins();
        return {
          outcome: "already-installed",
          status: catalog.getStatus(lock.id)!,
        };
      },
    });
    expect(
      await app.inject({
        method: "POST",
        url: "/plugins/fixture/enabled",
        headers: { origin: "http://localhost:4173" },
        payload: { enabled: true },
      }),
    ).toMatchObject({ statusCode: 200 });

    const installing = app.inject({
      method: "POST",
      url: "/plugins/fixture/install",
      headers: { origin: "http://localhost:4173" },
      payload: { repository: fixture.lock.repository },
    });
    await started;
    expect(
      await app.inject({
        method: "POST",
        url: "/plugins/fixture/enabled",
        headers: { origin: "http://localhost:4173" },
        payload: { enabled: true },
      }),
    ).toMatchObject({ statusCode: 409 });

    finishInstall?.();
    expect(await installing).toMatchObject({ statusCode: 200 });
    expect(
      (await app.inject({ method: "GET", url: "/health" })).json(),
    ).toMatchObject({
      plugins: [{ installed: true, verified: true, enabled: false }],
    });
    await app.close();
  });
});
