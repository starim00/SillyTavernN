import { afterEach, describe, expect, it, vi } from "vitest";

import { changePassword, loadAuthStatus, login, logout } from "./authApi";

const jsonResponse = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("authentication API", () => {
  it("loads session status and sends login credentials to the auth routes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: { authenticated: false } }))
      .mockResolvedValueOnce(jsonResponse({ data: { authenticated: true } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadAuthStatus()).resolves.toBe(false);
    await expect(login("test-password")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/auth/login",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({ password: "test-password" }),
      }),
    );
  });

  it("uses localized password errors and sends password changes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              code: "PASSWORD_INVALID",
              message: "Password is incorrect.",
            },
          },
          401,
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ data: { changed: true } }))
      .mockResolvedValueOnce(jsonResponse({ data: { authenticated: false } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(login("wrong")).rejects.toThrow("密码不正确。");
    await expect(
      changePassword("old-password", "new-password"),
    ).resolves.toBeUndefined();
    await expect(logout()).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/auth/password",
      expect.objectContaining({
        body: JSON.stringify({
          currentPassword: "old-password",
          newPassword: "new-password",
        }),
      }),
    );
  });
});
