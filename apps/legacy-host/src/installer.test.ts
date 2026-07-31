import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { LegacyPluginLock } from "@stn/legacy-compat";
import { describe, expect, it } from "vitest";

import {
  canonicalRepositoryUrl,
  installPinnedLegacyPlugin,
} from "./installer.js";

const hash = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

function cleanRoomLock(files: {
  manifest: string;
  entry: string;
  style: string;
}): LegacyPluginLock {
  return {
    id: "fixture",
    displayName: "Clean-room install fixture",
    repository: "https://example.invalid/clean-room-fixture",
    commit: "0000000000000000000000000000000000000000",
    manifestVersion: "1.0.0",
    installDirectory: "Fixture",
    manifestPath: "manifest.json",
    manifestSha256: hash(files.manifest),
    entryPath: "dist/index.js",
    entrySha256: hash(files.entry),
    stylesheetPaths: ["dist/index.css"],
    requiredAssets: [
      {
        path: "manifest.json",
        sha256: hash(files.manifest),
        kind: "manifest",
      },
      {
        path: "dist/index.js",
        sha256: hash(files.entry),
        kind: "entry",
      },
      {
        path: "dist/index.css",
        sha256: hash(files.style),
        kind: "style",
      },
    ],
    assetPatterns: ["manifest.json", "dist/**"],
    moduleSurfaces: [{ path: "/script.js", exports: ["chat"] }],
    license: {
      identifier: "Test-only",
      distribution: "user-installed",
      notice: "Newly authored fixture with no third-party source.",
    },
  };
}

async function fixtureFiles(destination: string) {
  const files = {
    manifest: JSON.stringify({
      display_name: "Clean-room install fixture",
      loading_order: 1,
      requires: [],
      optional: [],
      js: "dist/index.js",
      css: "dist/index.css",
      version: "1.0.0",
    }),
    entry:
      'import { chat } from "../../../../../script.js"; export const loaded = Boolean(chat);',
    style: ".fixture { display: block; }",
  };
  await mkdir(path.join(destination, "dist"), { recursive: true });
  await writeFile(path.join(destination, "manifest.json"), files.manifest);
  await writeFile(path.join(destination, "dist/index.js"), files.entry);
  await writeFile(path.join(destination, "dist/index.css"), files.style);
  return files;
}

describe("pinned legacy plugin installer", () => {
  it("stages, verifies, records, and atomically installs a clean-room fixture", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "stn-install-test-"));
    const files = {
      manifest: JSON.stringify({
        display_name: "Clean-room install fixture",
        loading_order: 1,
        requires: [],
        optional: [],
        js: "dist/index.js",
        css: "dist/index.css",
        version: "1.0.0",
      }),
      entry:
        'import { chat } from "../../../../../script.js"; export const loaded = Boolean(chat);',
      style: ".fixture { display: block; }",
    };
    const lock = cleanRoomLock(files);
    const result = await installPinnedLegacyPlugin(root, lock, {
      now: () => "2030-01-01T00:00:00.000Z",
      checkout: async (_lock, destination) => {
        await fixtureFiles(destination);
        return lock.commit;
      },
    });

    expect(result).toMatchObject({
      outcome: "installed",
      status: { installed: true, verified: true, enabled: true },
      receipt: {
        pluginId: "fixture",
        repository: lock.repository,
        commit: lock.commit,
        installedAt: "2030-01-01T00:00:00.000Z",
      },
    });
    const receipt = JSON.parse(
      await readFile(path.join(root, "Fixture/.stn-install.json"), "utf8"),
    ) as { manifest: { sha256: string } };
    expect(receipt.manifest.sha256).toBe(lock.manifestSha256);

    expect(
      await installPinnedLegacyPlugin(root, lock, {
        checkout: async () => {
          throw new Error("An existing verified install must not refetch.");
        },
      }),
    ).toMatchObject({ outcome: "already-installed" });
  });

  it("leaves the target untouched when the fetched commit is wrong", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "stn-install-test-"));
    const files = await fixtureFiles(
      await mkdtemp(path.join(tmpdir(), "stn-install-shape-")),
    );
    const lock = cleanRoomLock(files);

    await expect(
      installPinnedLegacyPlugin(root, lock, {
        checkout: async (_lock, destination) => {
          await fixtureFiles(destination);
          return "1111111111111111111111111111111111111111";
        },
      }),
    ).rejects.toMatchObject({
      code: "INSTALL_COMMIT_MISMATCH",
    });
    await expect(access(path.join(root, "Fixture"))).rejects.toBeDefined();
  });

  it("accepts only canonical HTTPS repository roots", () => {
    expect(
      canonicalRepositoryUrl("https://gitlab.com/novi028/JS-Slash-Runner.git/"),
    ).toBe("https://gitlab.com/novi028/JS-Slash-Runner");
    expect(canonicalRepositoryUrl("http://gitlab.com/project")).toBeUndefined();
    expect(
      canonicalRepositoryUrl("https://user@gitlab.com/project"),
    ).toBeUndefined();
  });
});
