import {
  LEGACY_PLUGIN_PROFILES,
  getLegacyPluginProfileByUiId,
  type LegacyPluginProfile,
} from "@stn/legacy-compat/profiles";

export const LEGACY_UI_TO_CANONICAL_PLUGIN_ID = {
  [LEGACY_PLUGIN_PROFILES["js-slash-runner"].uiId]:
    LEGACY_PLUGIN_PROFILES["js-slash-runner"].id,
  [LEGACY_PLUGIN_PROFILES["st-prompt-template"].uiId]:
    LEGACY_PLUGIN_PROFILES["st-prompt-template"].id,
} as const;

export type LegacyUiPluginId = keyof typeof LEGACY_UI_TO_CANONICAL_PLUGIN_ID;
export type CanonicalLegacyPluginId =
  (typeof LEGACY_UI_TO_CANONICAL_PLUGIN_ID)[LegacyUiPluginId];

export const TAVERN_HELPER_COMPAT_VERSION =
  LEGACY_PLUGIN_PROFILES["js-slash-runner"].manifestVersion;

export function canonicalLegacyPluginId(
  uiPluginId: string,
): CanonicalLegacyPluginId | null {
  return Object.prototype.hasOwnProperty.call(
    LEGACY_UI_TO_CANONICAL_PLUGIN_ID,
    uiPluginId,
  )
    ? LEGACY_UI_TO_CANONICAL_PLUGIN_ID[uiPluginId as LegacyUiPluginId]
    : null;
}

export function legacyPluginProfile(
  uiPluginId: string,
): LegacyPluginProfile | null {
  return getLegacyPluginProfileByUiId(uiPluginId) ?? null;
}
