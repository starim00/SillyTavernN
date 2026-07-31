const defaultWebOrigin = "http://localhost:4173";
const defaultLegacyPort = "4711";

export function currentWebOrigin(): string {
  return typeof globalThis.location?.origin === "string"
    ? globalThis.location.origin
    : defaultWebOrigin;
}

export function legacyHostOrigin(webOrigin = currentWebOrigin()): string {
  const parsed = new URL(webOrigin);
  if (
    parsed.hostname === "localhost" ||
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "[::1]"
  ) {
    // Keep the plugin realm on a distinct host from the common
    // 127.0.0.1 web origin so third-party script work cannot share the
    // main workspace's same-site renderer process.
    return `http://localhost:${defaultLegacyPort}`;
  }
  return `http://localhost:${defaultLegacyPort}`;
}

export const LEGACY_REALM_ORIGIN = legacyHostOrigin();
