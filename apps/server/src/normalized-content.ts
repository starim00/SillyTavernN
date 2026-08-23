import {
  CardSchema,
  PromptPresetSchema,
  WorldbookSchema,
  type Card as NormalizedCard,
  type JsonObject,
  type PromptPreset as NormalizedPreset,
  type Worldbook as NormalizedWorldbook,
} from "@stn/contracts";
import type {
  Card as StoredCard,
  Preset as StoredPreset,
  Worldbook as StoredWorldbook,
} from "@stn/storage";

function jsonObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function parseCandidate<T>(
  schema: { safeParse: (value: unknown) => { success: boolean; data?: T } },
  candidates: readonly unknown[],
): T | undefined {
  for (const candidate of candidates) {
    const parsed = schema.safeParse(candidate);
    if (parsed.success) return parsed.data;
  }
  return undefined;
}

export function normalizedCard(
  card: Pick<StoredCard, "legacyPayload">,
): NormalizedCard | undefined {
  return parseCandidate(CardSchema, [normalizedCardPayload(card)]);
}

export function normalizedCardPayload(
  card: Pick<StoredCard, "legacyPayload">,
): JsonObject {
  return jsonObject(card.legacyPayload.normalized) ?? {};
}

export function normalizedWorldbook(
  worldbook: Pick<StoredWorldbook, "legacyPayload">,
): NormalizedWorldbook | undefined {
  return parseCandidate(WorldbookSchema, [worldbook.legacyPayload.normalized]);
}

export function normalizedPreset(
  preset: Pick<StoredPreset, "payload" | "legacyPayload">,
): NormalizedPreset | undefined {
  return parseCandidate(PromptPresetSchema, [
    preset.payload,
    preset.payload.normalized,
    preset.legacyPayload.normalized,
  ]);
}
