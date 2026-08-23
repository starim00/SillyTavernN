import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";

import {
  BASELINE_LEGACY_SURFACES,
  LEGACY_PLUGIN_LOCKS,
  buildLegacyModuleSurfaces,
  isLegacyPluginAssetAllowed,
  parseLegacyExtensionManifest,
  scanLegacyStaticImports,
  type LegacyModuleSurface,
  type NormalizedLegacyExtensionManifest,
  type LegacyPluginAssetContract,
  type LegacyPluginLock,
} from "@stn/legacy-compat";

export interface InstalledPluginStatus {
  readonly lock: LegacyPluginLock;
  readonly installed: boolean;
  readonly verified: boolean;
  readonly enabled: boolean;
  readonly manifest?: NormalizedLegacyExtensionManifest;
  readonly reason?: string;
}

export interface LegacyCatalogOptions {
  readonly locks?: readonly LegacyPluginLock[];
  readonly safeMode?: boolean;
}

export interface ResolvedLegacyAsset {
  readonly lock: LegacyPluginLock;
  readonly filePath: string;
  readonly relativePath: string;
  readonly expectedSha256: string;
}

export interface VerifiedLegacyAsset {
  readonly lock: LegacyPluginLock;
  readonly relativePath: string;
  readonly bytes: Buffer;
  readonly mimeType: string;
  readonly sha256: string;
}

function digest(source: string | Uint8Array): string {
  return createHash("sha256").update(source).digest("hex");
}

const LEGACY_ASSET_MIME_TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function assetMimeType(relativePath: string): string {
  return (
    LEGACY_ASSET_MIME_TYPES[path.extname(relativePath).toLowerCase()] ??
    "application/octet-stream"
  );
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative.length > 0 &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function isSafeAssetPath(assetPath: string): boolean {
  return (
    assetPath.length > 0 &&
    !assetPath.startsWith("/") &&
    !assetPath.includes("\\") &&
    !assetPath.includes("\0") &&
    !assetPath
      .split("/")
      .some((segment) => segment === "" || segment === "." || segment === "..")
  );
}

function lockedAsset(
  lock: LegacyPluginLock,
  relativePath: string,
): LegacyPluginAssetContract | undefined {
  if (!isLegacyPluginAssetAllowed(lock, relativePath)) {
    return undefined;
  }
  return lock.requiredAssets.find((asset) => asset.path === relativePath);
}

async function readVerifiedAsset(
  pluginRoot: string,
  asset: LegacyPluginAssetContract,
): Promise<Buffer> {
  if (!isSafeAssetPath(asset.path)) {
    throw new Error(`Pinned asset path is invalid: ${asset.path}.`);
  }

  const resolvedRoot = path.resolve(pluginRoot);
  const resolvedFile = path.resolve(resolvedRoot, asset.path);
  if (!isWithin(resolvedRoot, resolvedFile)) {
    throw new Error(`Pinned asset escapes the plugin root: ${asset.path}.`);
  }

  const rootMetadata = await lstat(resolvedRoot);
  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
    throw new Error("The pinned plugin root must be a real directory.");
  }

  const segments = asset.path.split("/");
  let current = resolvedRoot;
  let fileIdentity: { readonly dev: number; readonly ino: number } | undefined;
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    const metadata = await lstat(current);
    const isLast = index === segments.length - 1;
    if (
      metadata.isSymbolicLink() ||
      (isLast ? !metadata.isFile() : !metadata.isDirectory())
    ) {
      throw new Error(
        `Pinned asset must contain only real directories and a regular file: ${asset.path}.`,
      );
    }
    if (isLast) {
      fileIdentity = { dev: metadata.dev, ino: metadata.ino };
    }
  }
  if (!fileIdentity) {
    throw new Error(`Pinned asset path is empty: ${asset.path}.`);
  }

  const canonicalRoot = await realpath(resolvedRoot);
  const canonicalFile = await realpath(resolvedFile);
  if (!isWithin(canonicalRoot, canonicalFile)) {
    throw new Error(
      `Pinned asset resolves outside the plugin root: ${asset.path}.`,
    );
  }

  const source = await readFile(canonicalFile);
  const finalMetadata = await lstat(resolvedFile);
  if (
    finalMetadata.isSymbolicLink() ||
    !finalMetadata.isFile() ||
    finalMetadata.dev !== fileIdentity.dev ||
    finalMetadata.ino !== fileIdentity.ino
  ) {
    throw new Error(
      `Pinned asset changed while it was being read: ${asset.path}.`,
    );
  }

  const actual = digest(source);
  if (actual !== asset.sha256) {
    throw new Error(
      `Asset hash mismatch for ${asset.path}: expected ${asset.sha256}, got ${actual}.`,
    );
  }
  return source;
}

function verifyExternalSurface(
  lock: LegacyPluginLock,
  observed: LegacyModuleSurface,
): string | undefined {
  const expected = lock.moduleSurfaces.find(
    (surface) => surface.path === observed.path,
  );
  if (!expected) {
    return `Unreviewed external ESM path: ${observed.path}.`;
  }
  const missing = observed.exports.filter(
    (exportName) => !expected.exports.includes(exportName),
  );
  return missing.length > 0
    ? `Unreviewed exports from ${observed.path}: ${missing.join(", ")}.`
    : undefined;
}

export class LegacySurfaceCatalog {
  readonly #surfaces = new Map<string, Set<string>>();
  readonly #statuses: InstalledPluginStatus[] = [];
  readonly #locks: readonly LegacyPluginLock[];
  readonly safeMode: boolean;

  constructor(
    readonly extensionsRoot: string,
    options: LegacyCatalogOptions = {},
  ) {
    this.#locks = options.locks ?? Object.values(LEGACY_PLUGIN_LOCKS);
    this.safeMode = options.safeMode ?? false;
    this.merge(BASELINE_LEGACY_SURFACES);
  }

  merge(surfaces: readonly LegacyModuleSurface[]): void {
    for (const surface of surfaces) {
      const current = this.#surfaces.get(surface.path) ?? new Set<string>();
      for (const exportName of surface.exports) {
        current.add(exportName);
      }
      this.#surfaces.set(surface.path, current);
    }
  }

  async scanInstalledPlugins(): Promise<void> {
    this.#statuses.length = 0;
    if (this.safeMode) {
      for (const lock of this.#locks) {
        this.#statuses.push({
          lock,
          installed: false,
          verified: false,
          enabled: false,
          reason:
            "Safe mode disables all legacy extension discovery and loading.",
        });
      }
      return;
    }

    for (const lock of this.#locks) {
      const pluginRoot = path.join(this.extensionsRoot, lock.installDirectory);
      try {
        const verifiedAssets = new Map<string, Buffer>();
        for (const asset of lock.requiredAssets) {
          if (verifiedAssets.has(asset.path)) {
            throw new Error(`Duplicate pinned asset path: ${asset.path}.`);
          }
          verifiedAssets.set(
            asset.path,
            await readVerifiedAsset(pluginRoot, asset),
          );
        }

        const manifestBytes = verifiedAssets.get(lock.manifestPath);
        if (!manifestBytes) {
          throw new Error("Manifest is not listed as a required pinned asset.");
        }
        if (digest(manifestBytes) !== lock.manifestSha256) {
          throw new Error("Manifest hash does not match the pinned lock.");
        }
        const manifestSource = manifestBytes.toString("utf8");
        const manifest = parseLegacyExtensionManifest(
          JSON.parse(manifestSource),
          {
            directoryName: lock.id,
          },
        );
        if (
          manifest.id !== lock.id ||
          manifest.version !== lock.manifestVersion ||
          manifest.scripts[0] !== lock.entryPath
        ) {
          throw new Error(
            "Manifest id, version, or entry does not match the pinned lock.",
          );
        }
        if (
          manifest.styles.length !== lock.stylesheetPaths.length ||
          manifest.styles.some(
            (stylesheet, index) => stylesheet !== lock.stylesheetPaths[index],
          )
        ) {
          throw new Error(
            "Manifest stylesheet paths do not match the pinned lock.",
          );
        }
        for (const stylesheet of lock.stylesheetPaths) {
          if (!verifiedAssets.has(stylesheet)) {
            throw new Error(
              `Manifest stylesheet is not listed as a required pinned asset: ${stylesheet}.`,
            );
          }
        }

        const entryBytes = verifiedAssets.get(lock.entryPath);
        if (!entryBytes) {
          throw new Error("Entry is not listed as a required pinned asset.");
        }
        if (digest(entryBytes) !== lock.entrySha256) {
          throw new Error("Entry hash does not match the pinned lock.");
        }
        const entrySource = entryBytes.toString("utf8");
        const entryUrl = `/scripts/extensions/third-party/${lock.installDirectory}/${lock.entryPath}`;
        const pluginUrlRoot = `/scripts/extensions/third-party/${lock.installDirectory}/`;
        const observed = buildLegacyModuleSurfaces(
          entryUrl,
          scanLegacyStaticImports(entrySource),
        ).filter((surface) => !surface.path.startsWith(pluginUrlRoot));
        for (const surface of observed) {
          const failure = verifyExternalSurface(lock, surface);
          if (failure) {
            throw new Error(failure);
          }
        }

        this.merge(lock.moduleSurfaces);
        this.#statuses.push({
          lock,
          installed: true,
          verified: true,
          enabled: true,
          manifest,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.#statuses.push({
          lock,
          installed: !/ENOENT/u.test(message),
          verified: false,
          enabled: false,
          reason: message,
        });
      }
    }
  }

  get(modulePath: string): LegacyModuleSurface | undefined {
    const exports = this.#surfaces.get(modulePath);
    return exports
      ? { path: modulePath, exports: [...exports].sort() }
      : undefined;
  }

  getLock(pluginId: string): LegacyPluginLock | undefined {
    return this.#locks.find((lock) => lock.id === pluginId);
  }

  getStatus(pluginId: string): InstalledPluginStatus | undefined {
    return this.#statuses.find((status) => status.lock.id === pluginId);
  }

  statuses(): readonly InstalledPluginStatus[] {
    return this.#statuses;
  }

  /**
   * Retained for callers that only need to classify a URL. New HTTP handlers
   * must use readAssetRequest() so they send the exact bytes that were verified
   * at request time instead of reopening this path.
   */
  resolveAssetRequest(urlPath: string): ResolvedLegacyAsset | undefined {
    if (this.safeMode) {
      return undefined;
    }
    const prefix = "/scripts/extensions/third-party/";
    if (!urlPath.startsWith(prefix)) {
      return undefined;
    }
    let decoded: string;
    try {
      decoded = decodeURIComponent(urlPath.slice(prefix.length));
    } catch {
      return undefined;
    }
    const separator = decoded.indexOf("/");
    if (separator <= 0) {
      return undefined;
    }
    const installDirectory = decoded.slice(0, separator);
    const relativePath = decoded.slice(separator + 1);
    const lock = this.#locks.find(
      (candidate) => candidate.installDirectory === installDirectory,
    );
    const status = lock ? this.getStatus(lock.id) : undefined;
    if (!lock || !status?.verified) {
      return undefined;
    }
    const asset = lockedAsset(lock, relativePath);
    if (!asset) return undefined;
    const root = path.resolve(this.extensionsRoot, installDirectory);
    const filePath = path.resolve(root, relativePath);
    if (!isWithin(root, filePath)) {
      return undefined;
    }
    return {
      lock,
      filePath,
      relativePath,
      expectedSha256: asset.sha256,
    };
  }

  /**
   * Resolves, contains, rereads, and hashes a locked asset for one HTTP
   * request. The returned Buffer is the same Buffer whose SHA-256 was checked.
   */
  async readAssetRequest(
    urlPath: string,
  ): Promise<VerifiedLegacyAsset | undefined> {
    const resolved = this.resolveAssetRequest(urlPath);
    if (!resolved) return undefined;
    const asset = lockedAsset(resolved.lock, resolved.relativePath);
    if (!asset) return undefined;

    const pluginRoot = path.resolve(
      this.extensionsRoot,
      resolved.lock.installDirectory,
    );
    try {
      const bytes = await readVerifiedAsset(pluginRoot, asset);
      return {
        lock: resolved.lock,
        relativePath: resolved.relativePath,
        bytes,
        mimeType: assetMimeType(resolved.relativePath),
        sha256: resolved.expectedSha256,
      };
    } catch (error) {
      const statusIndex = this.#statuses.findIndex(
        (status) => status.lock.id === resolved.lock.id,
      );
      const status = this.#statuses[statusIndex];
      if (statusIndex >= 0 && status) {
        this.#statuses[statusIndex] = {
          ...status,
          verified: false,
          enabled: false,
          reason: error instanceof Error ? error.message : String(error),
        };
      }
      return undefined;
    }
  }
}
