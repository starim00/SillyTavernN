import {
  collectRegexScripts,
  parseRegexScripts,
  type RegexScript,
  type RegexScriptParseResult,
} from "@stn/core";
import {
  type Diagnostic,
  type JsonObject,
  type JsonValue,
} from "@stn/contracts";
import {
  ConflictError,
  NotFoundError,
  type AppStore,
  type ExtensionSetting,
} from "@stn/storage";

import { normalizedCard, normalizedPreset } from "./normalized-content.js";

export const REGEX_EXTENSION_ID = "stn.regex";
export const GLOBAL_REGEX_SCOPE_ID = "global";

export type RegexScopeKind = "global" | "card" | "preset";

export type RegexScriptDefinition = Omit<RegexScript, "source" | "sourceIndex">;

export type RegexScopeView = {
  scope: RegexScopeKind;
  id: string;
  name: string;
  enabled: boolean;
  revision: number;
  ownerRevision: number | null;
  scripts: RegexScriptDefinition[];
  diagnostics: Diagnostic[];
  updatedAt: string | null;
};

export type ConversationRegexInput = {
  conversationId: string;
  presetId?: string;
};

export type AuthorizedConversationRegex = RegexScriptParseResult & {
  substitutions: Readonly<Record<string, string>>;
};

type StoredRegexScope = {
  revision: number;
  enabled: boolean;
  scripts: JsonValue[];
};

type LocatedScope = {
  name: string;
  ownerRevision: number | null;
  fallbackUpdatedAt: string | null;
  embedded: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function storedRegexScope(value: unknown): StoredRegexScope | undefined {
  if (
    !isRecord(value) ||
    !Number.isInteger(value.revision) ||
    (value.revision as number) < 0 ||
    typeof value.enabled !== "boolean" ||
    !Array.isArray(value.scripts)
  ) {
    return undefined;
  }
  return {
    revision: value.revision as number,
    enabled: value.enabled,
    scripts: value.scripts as JsonValue[],
  };
}

function setting(store: AppStore, key: string): ExtensionSetting | undefined {
  try {
    return store.getExtensionSetting(REGEX_EXTENSION_ID, key);
  } catch (error) {
    if (error instanceof NotFoundError) return undefined;
    throw error;
  }
}

function scopeKey(scope: RegexScopeKind, id: string): string {
  return scope === "global" ? GLOBAL_REGEX_SCOPE_ID : `${scope}:${id}`;
}

function locatedScope(
  store: AppStore,
  scope: RegexScopeKind,
  id: string,
): LocatedScope {
  if (scope === "global") {
    if (id !== GLOBAL_REGEX_SCOPE_ID) {
      throw new NotFoundError("regex scope", `${scope}:${id}`);
    }
    return {
      name: "全局正则",
      ownerRevision: null,
      fallbackUpdatedAt: null,
      embedded: { regex_scripts: [] },
    };
  }
  if (scope === "card") {
    const stored = store.getCard(id);
    const parsed = normalizedCard(stored);
    return {
      name: stored.name,
      ownerRevision: stored.revision,
      fallbackUpdatedAt: stored.updatedAt,
      embedded: parsed ?? { extensions: {} },
    };
  }
  const stored = store.getPreset(id);
  return {
    name: stored.name,
    ownerRevision: stored.revision,
    fallbackUpdatedAt: stored.updatedAt,
    embedded: normalizedPreset(stored) ?? { extensions: {} },
  };
}

function scriptDefinition(script: RegexScript): RegexScriptDefinition {
  return {
    id: script.id,
    scriptName: script.scriptName,
    findRegex: script.findRegex,
    replaceString: script.replaceString,
    trimStrings: [...script.trimStrings],
    placement: [...script.placement],
    disabled: script.disabled,
    markdownOnly: script.markdownOnly,
    promptOnly: script.promptOnly,
    runOnEdit: script.runOnEdit,
    substituteRegex: script.substituteRegex,
    minDepth: script.minDepth,
    maxDepth: script.maxDepth,
  };
}

function parsedEmbedded(
  scope: RegexScopeKind,
  embedded: unknown,
): RegexScriptParseResult {
  if (scope === "global") {
    return collectRegexScripts({ global: embedded });
  }
  if (scope === "card") {
    return collectRegexScripts({ card: embedded });
  }
  return collectRegexScripts({ preset: embedded });
}

export function resolveRegexScope(
  store: AppStore,
  scope: RegexScopeKind,
  id: string,
): RegexScopeView {
  const located = locatedScope(store, scope, id);
  const currentSetting = setting(store, scopeKey(scope, id));
  const stored = storedRegexScope(currentSetting?.value);
  const source = scope;
  const parsed =
    stored === undefined
      ? parsedEmbedded(scope, located.embedded)
      : parseRegexScripts(stored.scripts, {
          source,
          path: `${scope}.regex_scripts`,
        });
  const legacyEnabled =
    typeof currentSetting?.value === "boolean"
      ? currentSetting.value
      : undefined;

  return {
    scope,
    id,
    name: located.name,
    enabled:
      stored?.enabled ?? legacyEnabled ?? (scope === "global" ? true : false),
    revision: stored?.revision ?? 0,
    ownerRevision: located.ownerRevision,
    scripts: parsed.scripts.map(scriptDefinition),
    diagnostics: parsed.diagnostics,
    updatedAt: currentSetting?.updatedAt ?? located.fallbackUpdatedAt,
  };
}

export function listRegexScopes(store: AppStore): RegexScopeView[] {
  return [
    resolveRegexScope(store, "global", GLOBAL_REGEX_SCOPE_ID),
    ...store
      .listPresets()
      .map((preset) => resolveRegexScope(store, "preset", preset.id)),
    ...store
      .listCards()
      .map((card) => resolveRegexScope(store, "card", card.id)),
  ];
}

function scriptJson(script: RegexScriptDefinition): JsonObject {
  return {
    id: script.id,
    scriptName: script.scriptName,
    findRegex: script.findRegex,
    replaceString: script.replaceString,
    trimStrings: [...script.trimStrings],
    placement: [...script.placement],
    disabled: script.disabled,
    markdownOnly: script.markdownOnly,
    promptOnly: script.promptOnly,
    runOnEdit: script.runOnEdit,
    substituteRegex: script.substituteRegex,
    minDepth: script.minDepth,
    maxDepth: script.maxDepth,
  };
}

export function updateRegexScope(
  store: AppStore,
  input: {
    scope: RegexScopeKind;
    id: string;
    expectedRevision: number;
    enabled?: boolean;
    scripts?: RegexScriptDefinition[];
  },
): RegexScopeView {
  return store.database.transaction(() => {
    const current = resolveRegexScope(store, input.scope, input.id);
    if (current.revision !== input.expectedRevision) {
      throw new ConflictError(
        `Regex scope '${input.scope}:${input.id}' changed concurrently.`,
        {
          scope: input.scope,
          id: input.id,
          expectedRevision: input.expectedRevision,
          actualRevision: current.revision,
        },
      );
    }
    const nextScripts = input.scripts ?? current.scripts;
    const uniqueIds = new Set(nextScripts.map((script) => script.id));
    if (uniqueIds.size !== nextScripts.length) {
      throw new ConflictError(
        `Regex scope '${input.scope}:${input.id}' contains duplicate script ids.`,
        { scope: input.scope, id: input.id },
      );
    }
    store.setExtensionSetting(
      REGEX_EXTENSION_ID,
      scopeKey(input.scope, input.id),
      {
        revision: current.revision + 1,
        enabled: input.enabled ?? current.enabled,
        scripts: nextScripts.map(scriptJson),
      },
    );
    return resolveRegexScope(store, input.scope, input.id);
  });
}

export function collectAuthorizedConversationRegex(
  store: AppStore,
  input: ConversationRegexInput,
): AuthorizedConversationRegex {
  const conversation = store.getConversation(input.conversationId);
  const storedCard = store.getCard(conversation.cardId);
  const global = resolveRegexScope(store, "global", GLOBAL_REGEX_SCOPE_ID);
  const card = resolveRegexScope(store, "card", storedCard.id);
  const preset =
    input.presetId === undefined
      ? undefined
      : resolveRegexScope(store, "preset", input.presetId);

  const collected = collectRegexScripts({
    ...(global.enabled
      ? { global: { regex_scripts: global.scripts.map(scriptJson) } }
      : {}),
    ...(preset?.enabled
      ? { preset: { regex_scripts: preset.scripts.map(scriptJson) } }
      : {}),
    ...(card.enabled
      ? { card: { regex_scripts: card.scripts.map(scriptJson) } }
      : {}),
  });

  return {
    ...collected,
    substitutions: {
      card: storedCard.name,
      char: storedCard.name,
    },
  };
}
