import type { JsonObject, JsonValue } from "@stn/contracts";

import { isJsonObject } from "./safe-json.js";

export function readString(
  object: JsonObject,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = object[key];
    if (typeof value === "string") {
      return value;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
  }
  return undefined;
}

export function readNumber(
  object: JsonObject,
  ...keys: string[]
): number | undefined {
  for (const key of keys) {
    const value = object[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return undefined;
}

export function readBoolean(
  object: JsonObject,
  ...keys: string[]
): boolean | undefined {
  for (const key of keys) {
    const value = object[key];
    if (typeof value === "boolean") {
      return value;
    }
    if (value === 1 || value === "1" || value === "true") {
      return true;
    }
    if (value === 0 || value === "0" || value === "false") {
      return false;
    }
  }
  return undefined;
}

export function readObject(
  object: JsonObject,
  ...keys: string[]
): JsonObject | undefined {
  for (const key of keys) {
    const value = object[key];
    if (isJsonObject(value)) {
      return value;
    }
  }
  return undefined;
}

export function readArray(
  object: JsonObject,
  ...keys: string[]
): JsonValue[] | undefined {
  for (const key of keys) {
    const value = object[key];
    if (Array.isArray(value)) {
      return value;
    }
  }
  return undefined;
}

export function readStringArray(
  object: JsonObject,
  ...keys: string[]
): string[] {
  for (const key of keys) {
    const value = object[key];
    if (Array.isArray(value)) {
      return value
        .filter(
          (candidate): candidate is string =>
            typeof candidate === "string" && candidate.trim() !== "",
        )
        .map((candidate) => candidate.trim());
    }
    if (typeof value === "string") {
      return value
        .split(",")
        .map((candidate) => candidate.trim())
        .filter(Boolean);
    }
  }
  return [];
}

export function asObject(value: JsonValue | undefined): JsonObject | undefined {
  return isJsonObject(value) ? value : undefined;
}
