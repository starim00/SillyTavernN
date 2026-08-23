import type { LegacyPluginProfile } from "./types.js";

export type {
  LegacyCapability,
  LegacyExecutionOwner,
  LegacyPluginProfile,
  LegacyRealmRole,
} from "./types.js";

export const LEGACY_PLUGIN_PROFILES = {
  "js-slash-runner": {
    id: "js-slash-runner",
    uiId: "plugin-js-slash-runner",
    displayName: "酒馆助手 / JS-Slash-Runner",
    shortName: "JS-Slash-Runner",
    manifestVersion: "4.8.19",
    repository: "https://gitlab.com/novi028/JS-Slash-Runner",
    commit: "49efcca50809be8d48bfb1776bacf952ef16991b",
    executionOwner: "native",
    legacyRealmRole: "none",
    capabilities: [
      "settings.read",
      "settings.write",
      "character.read",
      "preset.read",
    ],
    nativeDescription: "角色卡与预设脚本由内置酒馆助手接口执行。",
  },
  "st-prompt-template": {
    id: "st-prompt-template",
    uiId: "plugin-st-prompt-template",
    displayName: "Prompt Template / 提示词模板",
    shortName: "ST-Prompt-Template",
    manifestVersion: "1.17.6.8",
    repository: "https://github.com/zonde306/ST-Prompt-Template",
    commit: "c80a572839f99a2aaf3d91cf9b7ebfc202c4ef0b",
    executionOwner: "native",
    legacyRealmRole: "none",
    capabilities: [
      "settings.read",
      "settings.write",
      "character.read",
      "preset.read",
    ],
    nativeDescription: "EJS 与模板指令由原生请求管线处理。",
  },
} as const satisfies Record<string, LegacyPluginProfile>;

export type LegacyPluginId = keyof typeof LEGACY_PLUGIN_PROFILES;
export type LegacyUiPluginId =
  (typeof LEGACY_PLUGIN_PROFILES)[LegacyPluginId]["uiId"];

export function getLegacyPluginProfile(
  id: string,
): LegacyPluginProfile | undefined {
  return LEGACY_PLUGIN_PROFILES[id as LegacyPluginId];
}

export function getLegacyPluginProfileByUiId(
  uiId: string,
): LegacyPluginProfile | undefined {
  return Object.values(LEGACY_PLUGIN_PROFILES).find(
    (profile) => profile.uiId === uiId,
  );
}
