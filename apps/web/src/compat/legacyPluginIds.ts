export const LEGACY_UI_TO_CANONICAL_PLUGIN_ID = {
  "plugin-js-slash-runner": "js-slash-runner",
  "plugin-st-prompt-template": "st-prompt-template",
} as const;

export type LegacyUiPluginId = keyof typeof LEGACY_UI_TO_CANONICAL_PLUGIN_ID;
export type CanonicalLegacyPluginId =
  (typeof LEGACY_UI_TO_CANONICAL_PLUGIN_ID)[LegacyUiPluginId];

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
