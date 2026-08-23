import {
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const CONFIG_FILENAME = "config.json";
const COOKIE_NAME = "stn_session";
const SESSION_LIFETIME_SECONDS = 30 * 24 * 60 * 60;

interface PasswordRecord {
  readonly algorithm: "scrypt";
  readonly salt: string;
  readonly hash: string;
}

interface AuthConfiguration {
  readonly password: PasswordRecord;
  readonly sessionSecret: string;
  readonly revision: number;
}

interface ApplicationConfiguration {
  readonly auth?: AuthConfiguration;
  readonly [key: string]: unknown;
}

export interface AuthInitialization {
  readonly auth: AuthManager;
  readonly generatedPassword?: string;
  readonly configPath: string;
}

function encode(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function decode(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

async function passwordRecord(password: string): Promise<PasswordRecord> {
  const salt = randomBytes(16);
  const hash = (await scrypt(password, salt, 64)) as Buffer;
  return {
    algorithm: "scrypt",
    salt: encode(salt),
    hash: encode(hash),
  };
}

async function matchesPassword(
  password: string,
  record: PasswordRecord,
): Promise<boolean> {
  const expected = decode(record.hash);
  const actual = (await scrypt(
    password,
    decode(record.salt),
    expected.length,
  )) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function isAuthConfiguration(value: unknown): value is AuthConfiguration {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const auth = value as Partial<AuthConfiguration>;
  const password = auth.password as Partial<PasswordRecord> | undefined;
  return (
    password?.algorithm === "scrypt" &&
    typeof password.salt === "string" &&
    typeof password.hash === "string" &&
    typeof auth.sessionSecret === "string" &&
    auth.sessionSecret.length >= 32 &&
    Number.isSafeInteger(auth.revision) &&
    Number(auth.revision) >= 1
  );
}

async function readConfiguration(
  configPath: string,
): Promise<ApplicationConfiguration> {
  try {
    const parsed: unknown = JSON.parse(await readFile(configPath, "utf8"));
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new Error(`${CONFIG_FILENAME} must contain a JSON object.`);
    }
    return parsed as ApplicationConfiguration;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

async function writeConfiguration(
  configPath: string,
  configuration: ApplicationConfiguration,
): Promise<void> {
  const temporaryPath = `${configPath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(
    temporaryPath,
    `${JSON.stringify(configuration, null, 2)}\n`,
    {
      encoding: "utf8",
      mode: 0o600,
    },
  );
  await rename(temporaryPath, configPath);
}

async function acquireConfigurationLock(
  configPath: string,
): Promise<() => Promise<void>> {
  const lockPath = `${configPath}.lock`;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      return async () => {
        await handle.close();
        await unlink(lockPath).catch(() => undefined);
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        const lockStat = await stat(lockPath);
        if (Date.now() - lockStat.mtimeMs > 30_000) {
          await unlink(lockPath);
          continue;
        }
      } catch {
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error(
    "Timed out waiting for the authentication configuration lock.",
  );
}

export class AuthManager {
  readonly #configPath: string;
  #configuration: AuthConfiguration;

  private constructor(configPath: string, configuration: AuthConfiguration) {
    this.#configPath = configPath;
    this.#configuration = configuration;
  }

  static async initialize(dataDirectory: string): Promise<AuthInitialization> {
    await mkdir(dataDirectory, { recursive: true });
    const configPath = path.join(dataDirectory, CONFIG_FILENAME);
    const release = await acquireConfigurationLock(configPath);
    try {
      const applicationConfiguration = await readConfiguration(configPath);
      if (isAuthConfiguration(applicationConfiguration.auth)) {
        return {
          auth: new AuthManager(configPath, applicationConfiguration.auth),
          configPath,
        };
      }
      if (applicationConfiguration.auth !== undefined) {
        throw new Error(
          `${CONFIG_FILENAME} contains an invalid authentication configuration.`,
        );
      }

      const generatedPassword = randomBytes(18).toString("base64url");
      const auth: AuthConfiguration = {
        password: await passwordRecord(generatedPassword),
        sessionSecret: encode(randomBytes(32)),
        revision: 1,
      };
      await writeConfiguration(configPath, {
        ...applicationConfiguration,
        auth,
      });
      return {
        auth: new AuthManager(configPath, auth),
        generatedPassword,
        configPath,
      };
    } finally {
      await release();
    }
  }

  async verifyPassword(password: string): Promise<boolean> {
    return matchesPassword(password, this.#configuration.password);
  }

  createSession(): string {
    const payload = encode(
      JSON.stringify({
        revision: this.#configuration.revision,
        expiresAt: Math.floor(Date.now() / 1000) + SESSION_LIFETIME_SECONDS,
        nonce: encode(randomBytes(12)),
      }),
    );
    const signature = this.#sign(payload);
    return `${payload}.${signature}`;
  }

  verifySession(token: string | undefined): boolean {
    if (!token) return false;
    const [payload, signature, extra] = token.split(".");
    if (!payload || !signature || extra !== undefined) return false;
    const expected = Buffer.from(this.#sign(payload));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
      return false;
    try {
      const parsed: unknown = JSON.parse(decode(payload).toString("utf8"));
      if (typeof parsed !== "object" || parsed === null) return false;
      const session = parsed as { revision?: unknown; expiresAt?: unknown };
      return (
        session.revision === this.#configuration.revision &&
        typeof session.expiresAt === "number" &&
        session.expiresAt > Math.floor(Date.now() / 1000)
      );
    } catch {
      return false;
    }
  }

  async changePassword(
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    if (!(await this.verifyPassword(currentPassword))) {
      throw new Error("CURRENT_PASSWORD_INVALID");
    }
    const release = await acquireConfigurationLock(this.#configPath);
    try {
      const applicationConfiguration = await readConfiguration(
        this.#configPath,
      );
      const current = applicationConfiguration.auth;
      if (
        !isAuthConfiguration(current) ||
        current.revision !== this.#configuration.revision
      ) {
        throw new Error("AUTH_CONFIGURATION_CHANGED");
      }
      const auth: AuthConfiguration = {
        ...current,
        password: await passwordRecord(newPassword),
        revision: current.revision + 1,
      };
      await writeConfiguration(this.#configPath, {
        ...applicationConfiguration,
        auth,
      });
      this.#configuration = auth;
    } finally {
      await release();
    }
  }

  cookieHeader(token: string, secure: boolean): string {
    return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_LIFETIME_SECONDS}${secure ? "; Secure" : ""}`;
  }

  clearCookieHeader(secure: boolean): string {
    return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? "; Secure" : ""}`;
  }

  sessionFromCookie(cookieHeader: string | undefined): string | undefined {
    return cookieHeader
      ?.split(";")
      .map((part) => part.trim().split("="))
      .find(([name]) => name === COOKIE_NAME)
      ?.slice(1)
      .join("=");
  }

  #sign(payload: string): string {
    return createHmac("sha256", decode(this.#configuration.sessionSecret))
      .update(payload)
      .digest("base64url");
  }
}

export const authCookieName = COOKIE_NAME;
