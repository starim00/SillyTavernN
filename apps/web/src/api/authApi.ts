export const AUTH_REQUIRED_EVENT = "stn:auth-required";

type AuthEnvelope = { data: { authenticated: boolean } };

async function authRequest(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`/api/auth/${path}`, {
    ...init,
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(init.body === undefined
        ? {}
        : { "Content-Type": "application/json" }),
      ...init.headers,
    },
  });
}

async function responseMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as {
      error?: { code?: string; message?: string };
    };
    if (body.error?.code === "PASSWORD_INVALID") return "密码不正确。";
    if (body.error?.code === "CURRENT_PASSWORD_INVALID")
      return "当前密码不正确。";
    if (body.error?.code === "LOGIN_RATE_LIMITED")
      return "尝试次数过多，请稍后再试。";
    return body.error?.message ?? "请求失败。";
  } catch {
    return "请求失败。";
  }
}

export async function loadAuthStatus(): Promise<boolean> {
  const response = await authRequest("status");
  if (!response.ok) throw new Error("无法连接本地服务。");
  return ((await response.json()) as AuthEnvelope).data.authenticated;
}

export async function login(password: string): Promise<void> {
  const response = await authRequest("login", {
    method: "POST",
    body: JSON.stringify({ password }),
  });
  if (!response.ok) throw new Error(await responseMessage(response));
}

export async function logout(): Promise<void> {
  const response = await authRequest("logout", { method: "POST" });
  if (!response.ok) throw new Error(await responseMessage(response));
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const response = await authRequest("password", {
    method: "POST",
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  if (!response.ok) throw new Error(await responseMessage(response));
}

export function notifyAuthenticationRequired(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
  }
}
