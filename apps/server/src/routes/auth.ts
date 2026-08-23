import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { envelope } from "../context.js";
import type { AuthManager } from "../auth.js";

const LoginSchema = z.object({
  password: z.string().min(1).max(256),
});

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(8).max(256),
});

interface FailedLoginState {
  failures: number;
  blockedUntil: number;
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  auth: AuthManager,
): Promise<void> {
  const failedLogins = new Map<string, FailedLoginState>();

  app.get("/api/auth/status", async (request) =>
    envelope({
      authenticated: auth.verifySession(
        auth.sessionFromCookie(request.headers.cookie),
      ),
    }),
  );

  app.post("/api/auth/login", async (request, reply) => {
    const now = Date.now();
    const key = request.ip;
    const state = failedLogins.get(key);
    if (state && state.blockedUntil > now) {
      reply.header(
        "retry-after",
        String(Math.ceil((state.blockedUntil - now) / 1000)),
      );
      return reply.code(429).send({
        error: {
          code: "LOGIN_RATE_LIMITED",
          message: "Too many failed login attempts. Try again shortly.",
        },
      });
    }

    const { password } = LoginSchema.parse(request.body);
    if (!(await auth.verifyPassword(password))) {
      const failures = (state?.failures ?? 0) + 1;
      failedLogins.set(key, {
        failures,
        blockedUntil: failures >= 5 ? now + 60_000 : 0,
      });
      return reply.code(401).send({
        error: { code: "PASSWORD_INVALID", message: "Password is incorrect." },
      });
    }

    failedLogins.delete(key);
    reply.header(
      "set-cookie",
      auth.cookieHeader(auth.createSession(), request.protocol === "https"),
    );
    return envelope({ authenticated: true });
  });

  app.post("/api/auth/logout", async (request, reply) => {
    reply.header(
      "set-cookie",
      auth.clearCookieHeader(request.protocol === "https"),
    );
    return envelope({ authenticated: false });
  });

  app.post("/api/auth/password", async (request, reply) => {
    if (!auth.verifySession(auth.sessionFromCookie(request.headers.cookie))) {
      return reply.code(401).send({
        error: {
          code: "AUTH_REQUIRED",
          message: "Authentication is required.",
        },
      });
    }
    const { currentPassword, newPassword } = ChangePasswordSchema.parse(
      request.body,
    );
    try {
      await auth.changePassword(currentPassword, newPassword);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "CURRENT_PASSWORD_INVALID"
      ) {
        return reply.code(401).send({
          error: {
            code: "CURRENT_PASSWORD_INVALID",
            message: "Current password is incorrect.",
          },
        });
      }
      throw error;
    }
    reply.header(
      "set-cookie",
      auth.cookieHeader(auth.createSession(), request.protocol === "https"),
    );
    return envelope({ changed: true });
  });
}
