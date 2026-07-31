import type { JsonObject, JsonValue } from "@stn/contracts";

import { isJsonObject, parseSafeJson } from "./safe-json.js";

export type ImportKind =
  "card" | "worldbook" | "conversation" | "prompt-preset" | "unknown";

export interface ImportDetection {
  kind: ImportKind;
  format: string;
  confidence: "certain" | "likely" | "possible";
  reason: string;
}

const pngSignature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function startsWith(bytes: Uint8Array, signature: Uint8Array): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

function hasCardShape(object: JsonObject): boolean {
  const data = isJsonObject(object.data) ? object.data : object;
  return (
    (typeof object.spec === "string" &&
      object.spec.startsWith("chara_card_")) ||
    (typeof data.name === "string" &&
      (typeof data.description === "string" ||
        typeof data.first_mes === "string" ||
        Array.isArray(data.participants)))
  );
}

function hasWorldbookShape(object: JsonObject): boolean {
  if (!("entries" in object)) {
    return false;
  }
  const entries = object.entries;
  const samples = Array.isArray(entries)
    ? entries.slice(0, 4)
    : isJsonObject(entries)
      ? Object.values(entries).slice(0, 4)
      : [];
  return samples.some(
    (entry) =>
      isJsonObject(entry) &&
      (typeof entry.content === "string" ||
        Array.isArray(entry.key) ||
        Array.isArray(entry.keys)),
  );
}

function hasPresetShape(object: JsonObject): boolean {
  return (
    Array.isArray(object.prompts) ||
    Array.isArray(object.prompt_order) ||
    "temperature" in object ||
    "temp" in object ||
    "rep_pen" in object ||
    "repetition_penalty" in object ||
    "sampler_order" in object
  );
}

function hasConversationShape(value: JsonValue): boolean {
  if (Array.isArray(value)) {
    return value.some(
      (item) =>
        isJsonObject(item) &&
        (typeof item.mes === "string" ||
          typeof item.is_user === "boolean" ||
          Array.isArray(item.swipes)),
    );
  }
  return isJsonObject(value) && Array.isArray(value.messages);
}

export function detectImport(
  source: string | Uint8Array,
  filename = "",
): ImportDetection {
  const bytes =
    typeof source === "string" ? new TextEncoder().encode(source) : source;
  const lowerName = filename.toLowerCase();
  if (startsWith(bytes, pngSignature)) {
    return {
      kind: "card",
      format: "character-png",
      confidence: "certain",
      reason:
        "PNG signature; embedded card metadata is validated during import",
    };
  }
  if (
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)
  ) {
    return {
      kind: "card",
      format: "charx",
      confidence: "likely",
      reason: "ZIP container signature compatible with CharX",
    };
  }

  const text =
    typeof source === "string"
      ? source
      : new TextDecoder("utf-8", { fatal: false }).decode(source);
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      kind: "unknown",
      format: "empty",
      confidence: "certain",
      reason: "Input is empty",
    };
  }

  let value: JsonValue | undefined;
  try {
    value = parseSafeJson(trimmed);
  } catch {
    const lines = trimmed.split(/\r?\n/u).filter(Boolean);
    if (lines.length > 1) {
      try {
        const records = lines.map((line) => parseSafeJson(line));
        if (hasConversationShape(records)) {
          return {
            kind: "conversation",
            format: "sillytavern-jsonl-chat",
            confidence: "certain",
            reason: "JSONL records contain chat message fields",
          };
        }
      } catch {
        // Fall through to an unknown result.
      }
    }
  }

  if (value !== undefined) {
    if (hasConversationShape(value)) {
      return {
        kind: "conversation",
        format: Array.isArray(value) ? "json-chat" : "native-conversation",
        confidence: "certain",
        reason: "Message collection detected",
      };
    }
    if (isJsonObject(value)) {
      if (hasCardShape(value)) {
        const spec =
          typeof value.spec === "string" ? value.spec : "legacy-character-json";
        return {
          kind: "card",
          format: spec,
          confidence: "certain",
          reason: "Card identity and narrative fields detected",
        };
      }
      if (hasWorldbookShape(value)) {
        return {
          kind: "worldbook",
          format: "sillytavern-worldbook",
          confidence: "certain",
          reason: "Worldbook entry collection detected",
        };
      }
      if (hasPresetShape(value)) {
        return {
          kind: "prompt-preset",
          format: Array.isArray(value.prompts)
            ? "sillytavern-prompt-manager"
            : "text-generation-settings",
          confidence: "likely",
          reason: "Prompt or generation setting fields detected",
        };
      }
    }
  }

  return {
    kind: "unknown",
    format: lowerName.split(".").pop() ?? "unknown",
    confidence: "certain",
    reason: "No supported portable-content signature was found",
  };
}
