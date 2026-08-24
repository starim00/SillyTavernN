import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createServer, type ServerApplication } from "./app.js";
import { AuthManager } from "./auth.js";

const applications: ServerApplication[] = [];

afterEach(async () => {
  await Promise.all(applications.splice(0).map(({ app }) => app.close()));
});

describe("server authentication", () => {
  it("generates a password configuration and protects API routes", async () => {
    const dataDirectory = await mkdtemp(path.join(tmpdir(), "stn-auth-"));
    const created = await createServer({
      dataDirectory,
      databasePath: ":memory:",
      seedDevelopmentData: false,
      authentication: true,
    });
    applications.push(created);

    const configuration = JSON.parse(
      await readFile(path.join(dataDirectory, "config.json"), "utf8"),
    ) as {
      auth: { password: { algorithm: string; hash: string }; revision: number };
    };
    expect(configuration.auth.password.algorithm).toBe("scrypt");
    expect(configuration.auth.password.hash).toBeTruthy();
    expect(configuration.auth.revision).toBe(1);

    const denied = await created.app.inject({
      method: "GET",
      url: "/api/health",
    });
    expect(denied.statusCode).toBe(401);
    expect(denied.json()).toMatchObject({ error: { code: "AUTH_REQUIRED" } });

    const status = await created.app.inject({
      method: "GET",
      url: "/api/auth/status",
    });
    expect(status.json()).toEqual({ data: { authenticated: false } });
  });

  it("logs in, changes the password, and invalidates the previous session", async () => {
    const dataDirectory = await mkdtemp(
      path.join(tmpdir(), "stn-auth-change-"),
    );
    const initialized = await AuthManager.initialize(dataDirectory);
    const knownPassword = initialized.generatedPassword!;

    const created = await createServer({
      dataDirectory,
      databasePath: ":memory:",
      seedDevelopmentData: false,
      authentication: true,
    });
    applications.push(created);

    const login = await created.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: knownPassword },
    });
    expect(login.statusCode).toBe(200);
    const oldCookie = login.headers["set-cookie"] as string;

    const changed = await created.app.inject({
      method: "POST",
      url: "/api/auth/password",
      headers: { cookie: oldCookie },
      payload: {
        currentPassword: knownPassword,
        newPassword: "replacement-password",
      },
    });
    expect(changed.statusCode).toBe(200);
    const newCookie = changed.headers["set-cookie"] as string;

    expect(
      (
        await created.app.inject({
          method: "GET",
          url: "/api/health",
          headers: { cookie: oldCookie },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await created.app.inject({
          method: "GET",
          url: "/api/health",
          headers: { cookie: newCookie },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await created.app.inject({
          method: "POST",
          url: "/api/auth/login",
          payload: { password: "replacement-password" },
        })
      ).statusCode,
    ).toBe(200);
  });

  it("marks the session cookie secure when the internal proxy reports HTTPS", async () => {
    const dataDirectory = await mkdtemp(
      path.join(tmpdir(), "stn-auth-forwarded-https-"),
    );
    const initialized = await AuthManager.initialize(dataDirectory);
    const created = await createServer({
      dataDirectory,
      databasePath: ":memory:",
      seedDevelopmentData: false,
      authentication: true,
    });
    applications.push(created);

    const login = await created.app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "x-forwarded-proto": "https" },
      payload: { password: initialized.generatedPassword! },
    });

    expect(login.statusCode).toBe(200);
    expect(login.headers["set-cookie"]).toContain("; Secure");
  });
});
