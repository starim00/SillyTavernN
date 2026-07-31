import type { JsonObject, JsonValue } from "@stn/contracts";

export interface SafeJsonLimits {
  maxDepth: number;
  maxNodes: number;
  maxStringBytes: number;
  maxInputBytes: number;
}

export const defaultSafeJsonLimits: SafeJsonLimits = {
  maxDepth: 64,
  maxNodes: 250_000,
  maxStringBytes: 8 * 1024 * 1024,
  maxInputBytes: 32 * 1024 * 1024,
};

const forbiddenKeys = new Set(["__proto__", "prototype", "constructor"]);
const utf8 = new TextEncoder();

export class ImportSecurityError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.name = "ImportSecurityError";
    this.code = code;
  }
}

function mergedLimits(limits?: Partial<SafeJsonLimits>): SafeJsonLimits {
  return { ...defaultSafeJsonLimits, ...limits };
}

export function parseSafeJson(
  source: string | Uint8Array,
  limits?: Partial<SafeJsonLimits>,
): JsonValue {
  const applied = mergedLimits(limits);
  const text =
    typeof source === "string"
      ? source
      : new TextDecoder("utf-8", { fatal: true }).decode(source);
  if (utf8.encode(text).byteLength > applied.maxInputBytes) {
    throw new ImportSecurityError(
      "JSON_INPUT_TOO_LARGE",
      `JSON input exceeds ${applied.maxInputBytes} bytes`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(
      `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  return sanitizeJsonValue(parsed, applied);
}

export function sanitizeJsonValue(
  value: unknown,
  limits?: Partial<SafeJsonLimits>,
): JsonValue {
  const applied = mergedLimits(limits);
  let nodes = 0;

  const visit = (
    candidate: unknown,
    depth: number,
    path: string,
  ): JsonValue => {
    nodes += 1;
    if (nodes > applied.maxNodes) {
      throw new ImportSecurityError(
        "JSON_NODE_LIMIT",
        `JSON value exceeds ${applied.maxNodes} nodes`,
      );
    }
    if (depth > applied.maxDepth) {
      throw new ImportSecurityError(
        "JSON_DEPTH_LIMIT",
        `JSON value exceeds depth ${applied.maxDepth} at ${path}`,
      );
    }

    if (candidate === null || typeof candidate === "boolean") {
      return candidate;
    }
    if (typeof candidate === "string") {
      if (utf8.encode(candidate).byteLength > applied.maxStringBytes) {
        throw new ImportSecurityError(
          "JSON_STRING_TOO_LARGE",
          `String exceeds ${applied.maxStringBytes} bytes at ${path}`,
        );
      }
      return candidate;
    }
    if (typeof candidate === "number") {
      if (!Number.isFinite(candidate)) {
        throw new ImportSecurityError(
          "JSON_NON_FINITE_NUMBER",
          `Non-finite number at ${path}`,
        );
      }
      return candidate;
    }
    if (Array.isArray(candidate)) {
      return candidate.map((item, index) =>
        visit(item, depth + 1, `${path}[${String(index)}]`),
      );
    }
    if (typeof candidate === "object") {
      const result: JsonObject = Object.create(null) as JsonObject;
      for (const [key, child] of Object.entries(
        candidate as Record<string, unknown>,
      )) {
        if (forbiddenKeys.has(key)) {
          throw new ImportSecurityError(
            "JSON_FORBIDDEN_KEY",
            `Forbidden object key ${JSON.stringify(key)} at ${path}`,
          );
        }
        result[key] = visit(child, depth + 1, `${path}.${key}`);
      }
      return result;
    }
    throw new ImportSecurityError(
      "JSON_UNSUPPORTED_VALUE",
      `Unsupported JSON value at ${path}`,
    );
  };

  return visit(value, 0, "$");
}

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function cloneJsonObject(value: JsonObject): JsonObject {
  return sanitizeJsonValue(value) as JsonObject;
}

export function pickUnknownFields(
  value: JsonObject,
  knownFields: ReadonlySet<string> | readonly string[],
): JsonObject {
  const known =
    knownFields instanceof Set ? knownFields : new Set<string>(knownFields);
  const result: JsonObject = Object.create(null) as JsonObject;
  for (const [key, child] of Object.entries(value)) {
    if (!known.has(key)) {
      result[key] = child;
    }
  }
  return result;
}
