import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type { LegacyPluginLock } from "@stn/legacy-compat";

import { LegacySurfaceCatalog, type InstalledPluginStatus } from "./catalog.js";

const executeFile = promisify(execFile);
const receiptFilename = ".stn-install.json";

export type LegacyPluginInstallOutcome = "installed" | "already-installed";

export interface LegacyPluginInstallReceipt {
  readonly schemaVersion: 1;
  readonly pluginId: string;
  readonly repository: string;
  readonly commit: string;
  readonly manifest: {
    readonly path: string;
    readonly version: string;
    readonly sha256: string;
  };
  readonly requiredAssets: readonly {
    readonly path: string;
    readonly sha256: string;
  }[];
  readonly installedAt: string;
  readonly nonce: string;
}

export interface LegacyPluginInstallResult {
  readonly outcome: LegacyPluginInstallOutcome;
  readonly status: InstalledPluginStatus;
  readonly receipt?: LegacyPluginInstallReceipt;
}

export interface LegacyPluginInstallerOptions {
  readonly checkout?: (
    lock: LegacyPluginLock,
    destination: string,
  ) => Promise<string>;
  readonly now?: () => string;
}

export class LegacyPluginInstallError extends Error {
  constructor(
    readonly code:
      | "INSTALL_DIRECTORY_INVALID"
      | "INSTALL_TARGET_EXISTS"
      | "INSTALL_COMMIT_MISMATCH"
      | "INSTALL_VERIFICATION_FAILED"
      | "INSTALL_GIT_FAILED",
    message: string,
  ) {
    super(message);
    this.name = "LegacyPluginInstallError";
  }
}

function safeInstallDirectory(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value);
}

async function exists(value: string): Promise<boolean> {
  try {
    await access(value);
    return true;
  } catch {
    return false;
  }
}

async function git(args: readonly string[], cwd: string): Promise<string> {
  try {
    const result = await executeFile("git", [...args], {
      cwd,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
      },
      maxBuffer: 2 * 1024 * 1024,
      timeout: 120_000,
    });
    return result.stdout.trim();
  } catch (error) {
    throw new LegacyPluginInstallError(
      "INSTALL_GIT_FAILED",
      `Unable to fetch the pinned plugin revision: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export async function checkoutPinnedGitRepository(
  lock: LegacyPluginLock,
  destination: string,
): Promise<string> {
  await git(["init", "--quiet", destination], path.dirname(destination));
  await git(
    ["-C", destination, "remote", "add", "origin", lock.repository],
    path.dirname(destination),
  );
  await git(
    [
      "-C",
      destination,
      "fetch",
      "--depth=1",
      "--no-tags",
      "origin",
      lock.commit,
    ],
    path.dirname(destination),
  );
  await git(
    ["-C", destination, "checkout", "--quiet", "--detach", "FETCH_HEAD"],
    path.dirname(destination),
  );
  return git(
    ["-C", destination, "rev-parse", "HEAD"],
    path.dirname(destination),
  );
}

function receiptFor(
  lock: LegacyPluginLock,
  installedAt: string,
): LegacyPluginInstallReceipt {
  return {
    schemaVersion: 1,
    pluginId: lock.id,
    repository: lock.repository,
    commit: lock.commit,
    manifest: {
      path: lock.manifestPath,
      version: lock.manifestVersion,
      sha256: lock.manifestSha256,
    },
    requiredAssets: lock.requiredAssets.map(({ path: assetPath, sha256 }) => ({
      path: assetPath,
      sha256,
    })),
    installedAt,
    nonce: randomUUID(),
  };
}

async function verifiedStatus(
  extensionsRoot: string,
  lock: LegacyPluginLock,
): Promise<InstalledPluginStatus> {
  const catalog = new LegacySurfaceCatalog(extensionsRoot, { locks: [lock] });
  await catalog.scanInstalledPlugins();
  const status = catalog.getStatus(lock.id);
  if (!status?.verified) {
    throw new LegacyPluginInstallError(
      "INSTALL_VERIFICATION_FAILED",
      status?.reason ?? "The pinned plugin installation could not be verified.",
    );
  }
  return status;
}

/**
 * Installs only a reviewed lock at its exact commit. The checkout is verified
 * in a sibling staging directory and moved into place only after all manifest,
 * entry, asset hash, and external ESM surface checks pass.
 */
export async function installPinnedLegacyPlugin(
  extensionsRoot: string,
  lock: LegacyPluginLock,
  options: LegacyPluginInstallerOptions = {},
): Promise<LegacyPluginInstallResult> {
  if (!safeInstallDirectory(lock.installDirectory)) {
    throw new LegacyPluginInstallError(
      "INSTALL_DIRECTORY_INVALID",
      "The pinned plugin install directory is invalid.",
    );
  }
  await mkdir(extensionsRoot, { recursive: true });
  const target = path.resolve(extensionsRoot, lock.installDirectory);
  if (path.dirname(target) !== path.resolve(extensionsRoot)) {
    throw new LegacyPluginInstallError(
      "INSTALL_DIRECTORY_INVALID",
      "The pinned plugin install directory escapes the extension root.",
    );
  }

  if (await exists(target)) {
    try {
      return {
        outcome: "already-installed",
        status: await verifiedStatus(extensionsRoot, lock),
      };
    } catch (error) {
      throw new LegacyPluginInstallError(
        "INSTALL_TARGET_EXISTS",
        `The install directory already exists but is not the verified pinned revision: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  const stagingRoot = await mkdtemp(
    path.join(path.resolve(extensionsRoot), ".stn-install-"),
  );
  const checkoutRoot = path.join(stagingRoot, lock.installDirectory);
  try {
    const observedCommit = await (
      options.checkout ?? checkoutPinnedGitRepository
    )(lock, checkoutRoot);
    if (observedCommit.trim() !== lock.commit) {
      throw new LegacyPluginInstallError(
        "INSTALL_COMMIT_MISMATCH",
        `Expected commit ${lock.commit}, received ${observedCommit.trim()}.`,
      );
    }

    await verifiedStatus(stagingRoot, lock);
    const receipt = receiptFor(
      lock,
      (options.now ?? (() => new Date().toISOString()))(),
    );
    await writeFile(
      path.join(checkoutRoot, receiptFilename),
      `${JSON.stringify(receipt, null, 2)}\n`,
      { encoding: "utf8", flag: "wx" },
    );
    await rename(checkoutRoot, target);
    const status = await verifiedStatus(extensionsRoot, lock);
    return { outcome: "installed", status, receipt };
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
}

export function canonicalRepositoryUrl(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      return undefined;
    }
    const pathname = parsed.pathname
      .replace(/\/+$/u, "")
      .replace(/\.git$/u, "");
    if (!pathname || pathname === "/") return undefined;
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${pathname}`;
  } catch {
    return undefined;
  }
}
