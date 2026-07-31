import type { LegacyModuleSurface } from "./types.js";

function surfaces(
  value: Readonly<Record<string, readonly string[]>>,
): readonly LegacyModuleSurface[] {
  return Object.entries(value)
    .map(([path, exports]) => ({
      path,
      exports: [...new Set(exports)].sort(),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

const scriptExports = [
  "Generate",
  "MAX_INJECTION_DEPTH",
  "activateSendButtons",
  "addCopyToCodeBlocks",
  "addOneMessage",
  "appendMediaToMessage",
  "baseChatReplace",
  "characters",
  "chat",
  "chat_metadata",
  "cleanUpMessage",
  "clearChat",
  "countOccurrences",
  "deactivateSendButtons",
  "default_avatar",
  "default_user_avatar",
  "deleteCharacter",
  "eventSource",
  "event_types",
  "extension_prompt_roles",
  "extension_prompt_types",
  "extension_prompts",
  "getBiasStrings",
  "getCharacterCardFields",
  "getCharacters",
  "getCurrentChatId",
  "getExtensionPromptByName",
  "getExtensionPromptRoleByName",
  "getMaxContextSize",
  "getOneCharacter",
  "getPastCharacterChats",
  "getRequestHeaders",
  "getThumbnailUrl",
  "getUserAvatar",
  "isOdd",
  "is_send_press",
  "main_api",
  "messageFormatting",
  "nai_settings",
  "name1",
  "name2",
  "online_status",
  "printCharacters",
  "printMessages",
  "reloadCurrentChat",
  "reloadMarkdownProcessor",
  "saveCharacterDebounced",
  "saveChatConditional",
  "saveMetadata",
  "saveSettings",
  "saveSettingsDebounced",
  "scrollChatToBottom",
  "selectCharacterById",
  "setExtensionPrompt",
  "setGenerationProgress",
  "setUserName",
  "showSwipeButtons",
  "stopGeneration",
  "substituteParams",
  "substituteParamsExtended",
  "system_avatar",
  "system_message_types",
  "this_chid",
  "unshallowCharacter",
  "updateMessageBlock",
  "user_avatar",
] as const;

const worldInfoExports = [
  "DEFAULT_DEPTH",
  "DEFAULT_WEIGHT",
  "METADATA_KEY",
  "convertCharacterBook",
  "createNewWorldInfo",
  "deleteWorldInfo",
  "getWorldInfoPrompt",
  "getWorldInfoSettings",
  "loadWorldInfo",
  "newWorldInfoEntryTemplate",
  "parseRegexFromString",
  "saveWorldInfo",
  "selected_world_info",
  "setWorldInfoButtonClass",
  "wi_anchor_position",
  "world_info",
  "world_info_case_sensitive",
  "world_info_include_names",
  "world_info_logic",
  "world_info_match_whole_words",
  "world_info_max_recursion_steps",
  "world_info_position",
  "world_info_use_group_scoring",
  "world_names",
] as const;

const commandSurfaces = {
  "/scripts/slash-commands.js": ["executeSlashCommandsWithOptions"],
  "/scripts/slash-commands/SlashCommand.js": ["SlashCommand"],
  "/scripts/slash-commands/SlashCommandArgument.js": [
    "ARGUMENT_TYPE",
    "SlashCommandArgument",
    "SlashCommandNamedArgument",
  ],
  "/scripts/slash-commands/SlashCommandCommonEnumsProvider.js": [
    "commonEnumProviders",
    "enumIcons",
  ],
  "/scripts/slash-commands/SlashCommandEnumValue.js": [
    "SlashCommandEnumValue",
    "enumTypes",
  ],
  "/scripts/slash-commands/SlashCommandParser.js": ["SlashCommandParser"],
} as const;

export const JS_SLASH_RUNNER_MODULE_SURFACES = surfaces({
  "/script.js": scriptExports,
  "/scripts/PromptManager.js": ["Prompt", "PromptCollection"],
  "/scripts/RossAscends-mods.js": ["favsToHotswap", "isMobile"],
  "/scripts/authors-note.js": [
    "NOTE_MODULE_NAME",
    "metadata_keys",
    "shouldWIAddPrompt",
  ],
  "/scripts/extensions.js": [
    "extensionTypes",
    "extension_settings",
    "getContext",
    "renderExtensionTemplateAsync",
    "saveMetadataDebounced",
  ],
  "/scripts/extensions/regex/engine.js": [
    "getRegexedString",
    "regex_placement",
  ],
  "/scripts/i18n.js": ["getCurrentLocale", "t"],
  "/scripts/macros.js": ["MacrosParser", "getLastMessageId"],
  "/scripts/openai.js": [
    "ChatCompletion",
    "Message",
    "MessageCollection",
    "getChatCompletionModel",
    "getStreamingReply",
    "isImageInliningSupported",
    "oai_settings",
    "prepareOpenAIMessages",
    "promptManager",
    "proxies",
    "sendOpenAIRequest",
    "setOpenAIMessageExamples",
    "setOpenAIMessages",
    "setupChatCompletionPromptManager",
    "tryParseStreamingError",
  ],
  "/scripts/personas.js": [
    "getUserAvatar",
    "getUserAvatars",
    "setUserAvatar",
    "user_avatar",
  ],
  "/scripts/popup.js": ["POPUP_TYPE", "callGenericPopup"],
  "/scripts/power-user.js": [
    "flushEphemeralStoppingStrings",
    "persona_description_positions",
    "power_user",
  ],
  "/scripts/preset-manager.js": ["getPresetManager"],
  "/scripts/sse-stream.js": ["getEventSourceStream"],
  "/scripts/tokenizers.js": ["getTokenCountAsync"],
  "/scripts/user.js": ["isAdmin"],
  "/scripts/utils.js": [
    "Stopwatch",
    "copyText",
    "delay",
    "download",
    "ensureImageFormatSupported",
    "getBase64Async",
    "getCharaFilename",
    "getImageSizeFromDataURL",
    "getSanitizedFilename",
    "getStringHash",
    "isDataURL",
    "showFontAwesomePicker",
    "uuidv4",
  ],
  "/scripts/world-info.js": worldInfoExports,
  ...commandSurfaces,
});

export const ST_PROMPT_TEMPLATE_MODULE_SURFACES = surfaces({
  "/lib.js": ["yaml"],
  "/script.js": scriptExports,
  "/scripts/events.js": ["eventSource", "event_types"],
  "/scripts/extensions.js": [
    "extension_settings",
    "renderExtensionTemplateAsync",
  ],
  "/scripts/extensions/regex/engine.js": [
    "getRegexedString",
    "regex_placement",
  ],
  "/scripts/group-chats.js": ["getGroupMembers", "groups", "selected_group"],
  "/scripts/openai.js": ["getChatCompletionModel", "oai_settings"],
  "/scripts/popup.js": ["POPUP_TYPE", "callGenericPopup"],
  "/scripts/power-user.js": ["power_user"],
  "/scripts/reasoning.js": ["ReasoningType", "updateReasoningUI"],
  "/scripts/tokenizers.js": ["getTokenCountAsync"],
  "/scripts/utils.js": ["copyText", "getCharaFilename"],
  "/scripts/world-info.js": worldInfoExports,
  ...commandSurfaces,
});

export const PINNED_LEGACY_MODULE_SURFACES = {
  "js-slash-runner": JS_SLASH_RUNNER_MODULE_SURFACES,
  "st-prompt-template": ST_PROMPT_TEMPLATE_MODULE_SURFACES,
} as const;

function mergeSurfaces(
  groups: readonly (readonly LegacyModuleSurface[])[],
): readonly LegacyModuleSurface[] {
  const merged = new Map<string, Set<string>>();
  for (const group of groups) {
    for (const surface of group) {
      const names = merged.get(surface.path) ?? new Set<string>();
      for (const exportName of surface.exports) {
        names.add(exportName);
      }
      merged.set(surface.path, names);
    }
  }
  return [...merged.entries()]
    .map(([path, names]) => ({ path, exports: [...names].sort() }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

export const BASELINE_LEGACY_SURFACES = mergeSurfaces([
  JS_SLASH_RUNNER_MODULE_SURFACES,
  ST_PROMPT_TEMPLATE_MODULE_SURFACES,
]);

export function getPinnedLegacyModuleSurfaces(
  pluginId: string,
): readonly LegacyModuleSurface[] {
  return (
    PINNED_LEGACY_MODULE_SURFACES[
      pluginId as keyof typeof PINNED_LEGACY_MODULE_SURFACES
    ] ?? []
  );
}
