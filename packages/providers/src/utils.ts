import type { JsonObject, JsonValue } from "@stn/contracts";

import { ProviderConfigurationError } from "./types.js";

const TOKEN_ESTIMATE_CACHE_LIMIT = 1024;
const tokenEstimateCache = new Map<string, number>();
const asciiTokenSegment = /^[A-Za-z0-9_]+$/u;

export function estimateTokens(text: string): number {
  const cached = tokenEstimateCache.get(text);
  if (cached !== undefined) {
    tokenEstimateCache.delete(text);
    tokenEstimateCache.set(text, cached);
    return cached;
  }
  if (!text) return 0;

  const units = text.match(/[A-Za-z0-9_]+|[^\s]/gu) ?? [];
  let roughTokens = 0;
  for (const unit of units) {
    roughTokens += asciiTokenSegment.test(unit)
      ? Math.max(1, Math.ceil(unit.length / 4))
      : 1;
  }
  const estimate =
    roughTokens === 0 ? 0 : Math.max(1, Math.ceil(roughTokens * 1.15));

  tokenEstimateCache.set(text, estimate);
  while (tokenEstimateCache.size > TOKEN_ESTIMATE_CACHE_LIMIT) {
    const oldest = tokenEstimateCache.keys().next().value;
    if (oldest === undefined) break;
    tokenEstimateCache.delete(oldest);
  }
  return estimate;
}

export function joinUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.trim().replace(/\/+$/u, "");
  if (!/^https?:\/\//u.test(normalizedBase)) {
    throw new ProviderConfigurationError(
      "Provider baseUrl must use http or https.",
    );
  }
  return `${normalizedBase}/${path.replace(/^\/+/u, "")}`;
}

export function asJsonObject(value: unknown): JsonObject | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  return value as JsonObject;
}

export function diagnosticString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length === 0 ? undefined : normalized.slice(0, 2_048);
}

export function upstreamRequestIdFromHeaders(
  headers: Headers,
): string | undefined {
  for (const name of ["x-request-id", "x-openai-request-id", "request-id"]) {
    const value = diagnosticString(headers.get(name));
    if (value !== undefined) return value;
  }
  return undefined;
}

export function upstreamRequestIdFromFrame(
  frame: JsonObject,
): string | undefined {
  return (
    diagnosticString(frame.request_id) ?? diagnosticString(frame.requestId)
  );
}

export function providerFrameType(frame: JsonObject, fallback: string): string {
  return (
    diagnosticString(frame.type) ?? diagnosticString(frame.object) ?? fallback
  );
}

export function asJsonValue(value: unknown): JsonValue | undefined {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    const items = value.map(asJsonValue);
    return items.every((item) => item !== undefined)
      ? items.filter((item): item is JsonValue => item !== undefined)
      : undefined;
  }
  const object = asJsonObject(value);
  if (!object) return undefined;
  const result: JsonObject = Object.create(null) as JsonObject;
  for (const [key, child] of Object.entries(object)) {
    const parsed = asJsonValue(child);
    if (parsed === undefined) return undefined;
    result[key] = parsed;
  }
  return result;
}

export function createRequestSignal(
  outer: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timeout = setTimeout(
    () =>
      controller.abort(
        new Error(`Provider request timed out after ${timeoutMs} ms.`),
      ),
    timeoutMs,
  );
  const onAbort = () =>
    controller.abort(
      outer?.reason ?? new DOMException("Aborted", "AbortError"),
    );
  outer?.addEventListener("abort", onAbort, { once: true });
  if (outer?.aborted) onAbort();

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      outer?.removeEventListener("abort", onAbort);
    },
  };
}

export async function responseError(response: Response): Promise<Error> {
  let message = `${response.status} ${response.statusText}`.trim();
  try {
    const payload = (await response.json()) as {
      error?: { message?: string } | string;
      message?: string;
    };
    if (typeof payload.error === "string") message = payload.error;
    else if (payload.error?.message) message = payload.error.message;
    else if (payload.message) message = payload.message;
  } catch {
    // Preserve the status-based message when an endpoint returns non-JSON.
  }
  return new Error(message);
}

export async function* readSseJson(
  response: Response,
): AsyncIterable<JsonObject | "[DONE]"> {
  if (!response.body) {
    throw new Error("Provider returned a streaming response without a body.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const frames = buffer.split(/\r?\n\r?\n/u);
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      const data = frame
        .split(/\r?\n/u)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data) continue;
      if (data.trim() === "[DONE]") {
        yield "[DONE]";
        return;
      }
      const value = JSON.parse(data) as unknown;
      const object = asJsonObject(value);
      if (object) yield object;
    }
    if (done) break;
  }

  const finalData = buffer
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (finalData) {
    if (finalData.trim() === "[DONE]") {
      yield "[DONE]";
      return;
    }
    const value = JSON.parse(finalData) as unknown;
    const object = asJsonObject(value);
    if (object) yield object;
  }
}

export function safeHeaders(connection: {
  apiKey?: string;
  headers?: Readonly<Record<string, string>>;
}): Headers {
  const headers = new Headers({
    Accept: "application/json",
    "Content-Type": "application/json",
  });
  if (connection.apiKey) {
    headers.set("Authorization", `Bearer ${connection.apiKey}`);
  }
  for (const [name, value] of Object.entries(connection.headers ?? {})) {
    const normalized = name.toLowerCase();
    if (normalized === "host" || normalized === "content-length") continue;
    headers.set(name, value);
  }
  return headers;
}
