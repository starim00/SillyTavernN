import {
  LEGACY_PLUGIN_LOCKS,
  createLegacyFacadeModule,
  type LegacyPluginLock,
} from "@stn/legacy-compat";
import Fastify, { type FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { LegacySurfaceCatalog, type InstalledPluginStatus } from "./catalog.js";
import {
  LegacyPluginInstallError,
  canonicalRepositoryUrl,
  installPinnedLegacyPlugin,
} from "./installer.js";
import { LegacyPluginStateStore } from "./plugin-state.js";
import { createLegacyRealmHtml } from "./realm.js";

// Lodash, jQuery, and Popper are observable extension host dependencies.
const lodashBrowserPath = fileURLToPath(
  import.meta.resolve("lodash/lodash.min.js"),
);
const jqueryBrowserPath = fileURLToPath(
  import.meta.resolve("jquery/dist/jquery.min.js"),
);
const popperBrowserPath = fileURLToPath(
  import.meta.resolve("@popperjs/core/dist/umd/popper.min.js"),
);
const fontAwesomeCssPath = fileURLToPath(
  import.meta.resolve("@fortawesome/fontawesome-free/css/all.min.css"),
);
const fontAwesomeWebfonts = new Map(
  [
    "fa-brands-400.ttf",
    "fa-brands-400.woff2",
    "fa-regular-400.ttf",
    "fa-regular-400.woff2",
    "fa-solid-900.ttf",
    "fa-solid-900.woff2",
    "fa-v4compatibility.ttf",
    "fa-v4compatibility.woff2",
  ].map((filename) => [
    filename,
    fileURLToPath(
      import.meta.resolve(`@fortawesome/fontawesome-free/webfonts/${filename}`),
    ),
  ]),
);

function allowedLoopbackOrigins(mainOrigin: string): readonly string[] {
  const origins = new Set([mainOrigin]);
  try {
    const parsed = new URL(mainOrigin);
    if (
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "[::1]"
    ) {
      for (const hostname of ["localhost", "127.0.0.1", "[::1]"]) {
        const alias = new URL(mainOrigin);
        alias.hostname = hostname;
        origins.add(alias.origin);
      }
    }
  } catch {
    // The configured origin remains the only allowed value.
  }
  return [...origins];
}

function scopeIdentifier(value: unknown): string | undefined {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    /^[A-Za-z0-9._:-]+$/u.test(value)
    ? value
    : undefined;
}

export interface LegacyHostOptions {
  readonly extensionsRoot: string;
  readonly mainOrigin: string;
  readonly logger?: boolean;
  readonly safeMode?: boolean;
  readonly locks?: readonly LegacyPluginLock[];
  readonly installPlugin?: typeof installPinnedLegacyPlugin;
}

export async function createLegacyHost(
  options: LegacyHostOptions,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });
  const catalog = new LegacySurfaceCatalog(options.extensionsRoot, {
    ...(options.locks === undefined ? {} : { locks: options.locks }),
    safeMode: options.safeMode ?? false,
  });
  const mainOrigins = allowedLoopbackOrigins(options.mainOrigin);
  const isAllowedMainOrigin = (value: unknown): value is string =>
    typeof value === "string" && mainOrigins.includes(value);
  await catalog.scanInstalledPlugins();
  const pluginState = await LegacyPluginStateStore.load(options.extensionsRoot);
  const installsInProgress = new Set<string>();
  const statusWithEnablement = (
    status: InstalledPluginStatus,
  ): InstalledPluginStatus => ({
    ...status,
    enabled:
      !catalog.safeMode &&
      status.verified &&
      pluginState.isEnabled(status.lock.id),
  });
  const exposedStatus = (
    pluginId: string,
  ): InstalledPluginStatus | undefined => {
    const status = catalog.getStatus(pluginId);
    return status === undefined ? undefined : statusWithEnablement(status);
  };

  app.addHook("onSend", async (request, reply, payload) => {
    const responseOrigin = isAllowedMainOrigin(request.headers.origin)
      ? request.headers.origin
      : options.mainOrigin;
    reply.header(
      "content-security-policy",
      [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' http: https:",
        "style-src 'self' 'unsafe-inline' http: https:",
        "img-src 'self' data: blob: http: https:",
        "media-src 'self' data: blob: http: https:",
        "font-src 'self' data: http: https:",
        "connect-src 'self' http: https:",
        "frame-src 'self' blob: http: https:",
        "worker-src 'self' blob:",
        `frame-ancestors ${mainOrigins.join(" ")}`,
      ].join("; "),
    );
    reply.header("referrer-policy", "no-referrer");
    reply.header("x-content-type-options", "nosniff");
    reply.header("cross-origin-resource-policy", "same-site");
    reply.header("access-control-allow-origin", responseOrigin);
    reply.header("access-control-allow-methods", "GET, POST, OPTIONS");
    reply.header("access-control-allow-headers", "Accept, Content-Type");
    reply.header("vary", "Origin");
    reply.header("cache-control", "no-store");
    return payload;
  });

  app.options("/*", (request, reply) => {
    if (!isAllowedMainOrigin(request.headers.origin)) {
      return reply.code(403).send();
    }
    return reply.code(204).send();
  });

  app.get("/health", () => ({
    ok: true,
    service: "legacy-host",
    safeMode: catalog.safeMode,
    plugins: catalog.statuses().map((status) => statusWithEnablement(status)),
  }));

  app.post<{ Params: { pluginId: string } }>(
    "/plugins/:pluginId/install",
    async (request, reply) => {
      if (!isAllowedMainOrigin(request.headers.origin)) {
        return reply.code(403).send({
          error: {
            code: "INSTALL_ORIGIN_DENIED",
            message: "Plugin installation is restricted to the main app.",
          },
        });
      }
      if (catalog.safeMode) {
        return reply.code(423).send({
          error: {
            code: "INSTALL_SAFE_MODE",
            message: "Legacy extensions are disabled in safe mode.",
          },
        });
      }
      const lock = catalog.getLock(request.params.pluginId);
      if (!lock) {
        return reply.code(404).send({
          error: {
            code: "INSTALL_TARGET_UNKNOWN",
            message: "Unknown pinned legacy plugin.",
          },
        });
      }
      const body =
        typeof request.body === "object" &&
        request.body !== null &&
        !Array.isArray(request.body)
          ? (request.body as Record<string, unknown>)
          : {};
      const requestedRepository =
        typeof body.repository === "string"
          ? canonicalRepositoryUrl(body.repository)
          : undefined;
      if (
        !requestedRepository ||
        requestedRepository !== canonicalRepositoryUrl(lock.repository)
      ) {
        return reply.code(400).send({
          error: {
            code: "INSTALL_REPOSITORY_MISMATCH",
            message:
              "The repository URL does not match the reviewed compatibility target.",
          },
        });
      }
      if (installsInProgress.has(lock.id)) {
        return reply.code(409).send({
          error: {
            code: "INSTALL_IN_PROGRESS",
            message: "This pinned plugin is already being installed.",
          },
        });
      }

      installsInProgress.add(lock.id);
      try {
        await pluginState.setEnabled(lock.id, false);
        const result = await (
          options.installPlugin ?? installPinnedLegacyPlugin
        )(options.extensionsRoot, lock);
        await catalog.scanInstalledPlugins();
        await pluginState.setEnabled(lock.id, false);
        return reply.code(result.outcome === "installed" ? 201 : 200).send({
          outcome: result.outcome,
          plugin: exposedStatus(lock.id),
          ...(result.receipt === undefined ? {} : { receipt: result.receipt }),
        });
      } catch (error) {
        const installError =
          error instanceof LegacyPluginInstallError ? error : undefined;
        return reply
          .code(installError?.code === "INSTALL_TARGET_EXISTS" ? 409 : 502)
          .send({
            error: {
              code: installError?.code ?? "INSTALL_FAILED",
              message:
                error instanceof Error
                  ? error.message
                  : "The pinned plugin installation failed.",
            },
          });
      } finally {
        installsInProgress.delete(lock.id);
      }
    },
  );

  app.post<{ Params: { pluginId: string } }>(
    "/plugins/:pluginId/enabled",
    async (request, reply) => {
      if (!isAllowedMainOrigin(request.headers.origin)) {
        return reply.code(403).send({
          error: {
            code: "ENABLE_ORIGIN_DENIED",
            message: "Plugin enablement is restricted to the main app.",
          },
        });
      }
      const lock = catalog.getLock(request.params.pluginId);
      if (!lock) {
        return reply.code(404).send({
          error: {
            code: "ENABLE_TARGET_UNKNOWN",
            message: "Unknown pinned legacy plugin.",
          },
        });
      }
      const body =
        typeof request.body === "object" &&
        request.body !== null &&
        !Array.isArray(request.body)
          ? (request.body as Record<string, unknown>)
          : {};
      if (Object.keys(body).length !== 1 || typeof body.enabled !== "boolean") {
        return reply.code(400).send({
          error: {
            code: "ENABLE_BODY_INVALID",
            message: "The request must contain exactly one boolean enabled.",
          },
        });
      }
      if (body.enabled && installsInProgress.has(lock.id)) {
        return reply.code(409).send({
          error: {
            code: "ENABLE_INSTALL_IN_PROGRESS",
            message:
              "The plugin cannot be enabled while its fixed revision is being installed.",
          },
        });
      }
      if (body.enabled && catalog.safeMode) {
        return reply.code(423).send({
          error: {
            code: "ENABLE_SAFE_MODE",
            message: "Legacy extensions are disabled in safe mode.",
          },
        });
      }
      if (body.enabled) {
        await catalog.scanInstalledPlugins();
      }
      const status = catalog.getStatus(lock.id);
      if (body.enabled && !status?.verified) {
        return reply.code(409).send({
          error: {
            code: "ENABLE_PLUGIN_UNVERIFIED",
            message:
              "The plugin must match its fixed revision and hashes before it can be enabled.",
          },
          plugin:
            status === undefined ? undefined : statusWithEnablement(status),
        });
      }
      await pluginState.setEnabled(lock.id, body.enabled);
      return reply.send({
        plugin: exposedStatus(lock.id),
      });
    },
  );

  app.get<{
    Params: { pluginId: string };
    Querystring: {
      conversationId?: string;
      presetId?: string;
      scopeRevision?: string;
      mainOrigin?: string;
    };
  }>("/realm/:pluginId", async (request, reply) => {
    if (catalog.safeMode) {
      return reply.code(423).send({
        error: "Legacy extensions are disabled in safe mode.",
      });
    }
    const lock = catalog.getLock(request.params.pluginId);
    if (!lock) {
      return reply.code(404).send({ error: "Unknown legacy plugin." });
    }
    const status = exposedStatus(lock.id);
    if (!status?.verified) {
      return reply.code(409).send({
        error: "Plugin is not installed at its pinned, verified revision.",
        status,
      });
    }
    if (!status.enabled) {
      return reply.code(423).send({
        error: "Plugin is installed but disabled by the host.",
        status,
      });
    }
    const conversationId = scopeIdentifier(request.query.conversationId);
    const presetId = scopeIdentifier(request.query.presetId);
    const targetOrigin = isAllowedMainOrigin(request.query.mainOrigin)
      ? request.query.mainOrigin
      : isAllowedMainOrigin(request.headers.origin)
        ? request.headers.origin
        : options.mainOrigin;
    return reply.type("text/html; charset=utf-8").send(
      createLegacyRealmHtml(lock, targetOrigin, {
        ...(status.manifest?.activateExport === undefined
          ? {}
          : { activateExport: status.manifest.activateExport }),
        ...(conversationId === undefined ? {} : { conversationId }),
        ...(presetId === undefined ? {} : { presetId }),
      }),
    );
  });

  app.get("/vendor/lodash.min.js", async (_request, reply) =>
    reply
      .type("text/javascript; charset=utf-8")
      .send(await readFile(lodashBrowserPath, "utf8")),
  );
  app.get("/vendor/jquery.min.js", async (_request, reply) =>
    reply
      .type("text/javascript; charset=utf-8")
      .send(await readFile(jqueryBrowserPath, "utf8")),
  );
  app.get("/vendor/popper.min.js", async (_request, reply) =>
    reply
      .type("text/javascript; charset=utf-8")
      .send(await readFile(popperBrowserPath, "utf8")),
  );
  app.get("/vendor/fontawesome/css/all.min.css", async (_request, reply) =>
    reply
      .type("text/css; charset=utf-8")
      .send(await readFile(fontAwesomeCssPath, "utf8")),
  );
  app.get<{ Params: { filename: string } }>(
    "/vendor/fontawesome/webfonts/:filename",
    async (request, reply) => {
      const webfontPath = fontAwesomeWebfonts.get(request.params.filename);
      if (!webfontPath) {
        return reply.code(404).send({ error: "Unknown Font Awesome webfont." });
      }
      return reply
        .type(
          request.params.filename.endsWith(".woff2")
            ? "font/woff2"
            : "font/ttf",
        )
        .send(await readFile(webfontPath));
    },
  );
  app.get("/version", async () => ({
    pkgVersion: "1.13.5",
    compatibilityHost: true,
  }));

  app.get("/*", async (request, reply) => {
    if (catalog.safeMode) {
      return reply.code(423).send({
        error: "Legacy extensions are disabled in safe mode.",
      });
    }
    const url = new URL(request.url, "http://legacy.invalid");
    const moduleSurface = catalog.get(url.pathname);
    if (moduleSurface) {
      return reply
        .type("text/javascript; charset=utf-8")
        .send(createLegacyFacadeModule(moduleSurface));
    }

    const requestedAsset = catalog.resolveAssetRequest(url.pathname);
    if (!requestedAsset) {
      return reply.code(404).send({ error: "Legacy resource not found." });
    }
    if (!exposedStatus(requestedAsset.lock.id)?.enabled) {
      return reply.code(423).send({
        error: "Legacy plugin is disabled by the host.",
      });
    }
    const asset = await catalog.readAssetRequest(url.pathname);
    if (!asset) {
      return reply.code(404).send({ error: "Legacy resource not found." });
    }
    return reply.type(asset.mimeType).send(asset.bytes);
  });

  return app;
}

export { LEGACY_PLUGIN_LOCKS };
