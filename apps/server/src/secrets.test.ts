import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import type * as FsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fsControls = vi.hoisted(() => ({
  failNextRename: false,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    rename: async (source: string, destination: string) => {
      if (fsControls.failNextRename) {
        fsControls.failNextRename = false;
        throw new Error("injected rename failure");
      }
      return actual.rename(source, destination);
    },
  };
});

const { ServerSecretVault } = await import("./secrets.js");

describe("ServerSecretVault", () => {
  let dataDirectory: string;

  beforeEach(async () => {
    dataDirectory = await mkdtemp(path.join(os.tmpdir(), "stn-secrets-"));
    fsControls.failNextRename = false;
  });

  afterEach(async () => {
    await rm(dataDirectory, { recursive: true, force: true });
  });

  it("recovers after a failed rename and keeps memory and disk consistent", async () => {
    const vault = new ServerSecretVault(dataDirectory);

    await vault.set("provider", "old-secret");
    fsControls.failNextRename = true;

    await expect(vault.set("provider", "new-secret")).rejects.toThrow(
      "injected rename failure",
    );

    expect(await vault.get("provider")).toBe("old-secret");
    expect(
      JSON.parse(
        await readFile(
          path.join(dataDirectory, "provider-secrets.json"),
          "utf8",
        ),
      ),
    ).toEqual({ provider: "old-secret" });
    expect(
      (await readdir(dataDirectory)).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);

    await vault.set("provider", "new-secret");
    expect(await vault.get("provider")).toBe("new-secret");
    expect(
      JSON.parse(
        await readFile(
          path.join(dataDirectory, "provider-secrets.json"),
          "utf8",
        ),
      ),
    ).toEqual({ provider: "new-secret" });
    expect(
      (await stat(path.join(dataDirectory, "provider-secrets.json"))).mode &
        0o777,
    ).toBe(0o600);
  });

  it("serializes concurrent updates without losing fields", async () => {
    const vault = new ServerSecretVault(dataDirectory);

    await Promise.all([
      vault.set("first", "one"),
      vault.set("second", "two"),
      vault.set("third", "three"),
    ]);

    expect(
      JSON.parse(
        await readFile(
          path.join(dataDirectory, "provider-secrets.json"),
          "utf8",
        ),
      ),
    ).toEqual({ first: "one", second: "two", third: "three" });
  });
});
