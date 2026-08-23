import {
  ChatCircleDots,
  Key,
  LockKey,
  SignOut,
  X,
} from "@phosphor-icons/react";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";

import {
  AUTH_REQUIRED_EVENT,
  changePassword,
  loadAuthStatus,
  login,
  logout,
} from "../api/authApi";

type AuthState = "checking" | "authenticated" | "required" | "unavailable";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "请求失败。";
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>("checking");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [securityMessage, setSecurityMessage] = useState("");

  const check = () => {
    setState("checking");
    setError("");
    void loadAuthStatus()
      .then((authenticated) =>
        setState(authenticated ? "authenticated" : "required"),
      )
      .catch(() => setState("unavailable"));
  };

  useEffect(check, []);
  useEffect(() => {
    const requireAuthentication = () => {
      setSecurityOpen(false);
      setPassword("");
      setState("required");
    };
    window.addEventListener(AUTH_REQUIRED_EVENT, requireAuthentication);
    return () =>
      window.removeEventListener(AUTH_REQUIRED_EVENT, requireAuthentication);
  }, []);

  const submitLogin = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await login(password);
      setPassword("");
      setState("authenticated");
    } catch (loginError) {
      setError(errorMessage(loginError));
    } finally {
      setSubmitting(false);
    }
  };

  const submitPasswordChange = async (event: FormEvent) => {
    event.preventDefault();
    setSecurityMessage("");
    if (newPassword.length < 8) {
      setSecurityMessage("新密码至少需要 8 个字符。");
      return;
    }
    if (newPassword !== confirmPassword) {
      setSecurityMessage("两次输入的新密码不一致。");
      return;
    }
    setSubmitting(true);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSecurityMessage("密码已修改，其他设备上的旧登录已失效。");
    } catch (changeError) {
      setSecurityMessage(errorMessage(changeError));
    } finally {
      setSubmitting(false);
    }
  };

  if (state !== "authenticated") {
    return (
      <main className="auth-screen">
        <section className="auth-card" aria-labelledby="auth-title">
          <div className="auth-card__mark" aria-hidden="true">
            <ChatCircleDots size={28} weight="fill" />
          </div>
          <div className="auth-card__heading">
            <p>SillyTavern N</p>
            <h1 id="auth-title">
              {state === "unavailable" ? "本地服务未连接" : "验证访问密码"}
            </h1>
            <span>
              {state === "unavailable"
                ? "请确认服务已启动，然后重新连接。"
                : "输入当前访问密码；首次密码会显示在启动日志中。"}
            </span>
          </div>
          {state === "unavailable" ? (
            <button
              className="button button--primary button--full"
              type="button"
              onClick={check}
            >
              重新连接
            </button>
          ) : state === "checking" ? (
            <div className="auth-card__checking" role="status">
              正在连接本地服务…
            </div>
          ) : (
            <form
              className="auth-form"
              onSubmit={(event) => void submitLogin(event)}
            >
              <label className="field">
                <span>访问密码</span>
                <input
                  autoFocus
                  autoComplete="current-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              {error ? (
                <p
                  className="auth-form__message auth-form__message--error"
                  role="alert"
                >
                  {error}
                </p>
              ) : null}
              <button
                className="button button--primary button--full"
                disabled={submitting || !password}
                type="submit"
              >
                <LockKey size={17} />
                {submitting ? "正在验证…" : "进入工作区"}
              </button>
            </form>
          )}
        </section>
      </main>
    );
  }

  return (
    <>
      {children}
      <button
        className="auth-control"
        type="button"
        aria-label="账户与密码"
        title="账户与密码"
        onClick={() => {
          setSecurityMessage("");
          setSecurityOpen(true);
        }}
      >
        <LockKey size={17} />
      </button>
      {securityOpen ? (
        <div className="modal-backdrop" role="presentation">
          <section
            className="modal-card auth-settings"
            role="dialog"
            aria-modal="true"
            aria-labelledby="security-title"
          >
            <header className="modal-card__header">
              <span className="modal-card__icon" aria-hidden="true">
                <Key size={21} />
              </span>
              <div>
                <h2 id="security-title">访问安全</h2>
                <p>修改工作区的登录密码，或退出当前会话。</p>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="关闭"
                onClick={() => setSecurityOpen(false)}
              >
                <X size={18} />
              </button>
            </header>
            <form
              className="modal-form"
              onSubmit={(event) => void submitPasswordChange(event)}
            >
              <label className="field">
                <span>当前密码</span>
                <input
                  autoComplete="current-password"
                  type="password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                />
              </label>
              <label className="field">
                <span>新密码</span>
                <input
                  autoComplete="new-password"
                  type="password"
                  minLength={8}
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
              </label>
              <label className="field">
                <span>确认新密码</span>
                <input
                  autoComplete="new-password"
                  type="password"
                  minLength={8}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                />
              </label>
              {securityMessage ? (
                <p className="auth-form__message" role="status">
                  {securityMessage}
                </p>
              ) : null}
              <div className="modal-actions auth-settings__actions">
                <button
                  className="button button--quiet"
                  type="button"
                  onClick={() =>
                    void logout().finally(() => setState("required"))
                  }
                >
                  <SignOut size={17} />
                  退出登录
                </button>
                <button
                  className="button button--primary"
                  disabled={
                    submitting ||
                    !currentPassword ||
                    !newPassword ||
                    !confirmPassword
                  }
                  type="submit"
                >
                  {submitting ? "正在保存…" : "修改密码"}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}
