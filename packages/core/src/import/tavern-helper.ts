import type { JsonObject, JsonValue } from "@stn/contracts";

export interface TavernHelperScriptSummary {
  readonly present: boolean;
  readonly sourcePath?: string;
  readonly treeCount: number;
  readonly scriptCount: number;
  readonly enabledScriptCount: number;
  readonly folderCount: number;
  readonly variableCount: number;
  readonly diagnostics: readonly string[];
}

export interface TavernHelperQuickAction {
  readonly id: string;
  readonly name: string;
  readonly visible: boolean;
}

export interface TavernHelperScriptDefinition {
  readonly id: string;
  readonly name: string;
  readonly content: string;
  readonly info: string;
  readonly declaredEnabled: boolean;
  readonly enabled: boolean;
  readonly buttonEnabled: boolean;
  readonly buttons: readonly TavernHelperQuickAction[];
  readonly data: JsonObject;
  readonly treeId?: string;
  readonly treeName?: string;
  readonly sourcePath: string;
}

export interface TavernHelperBundle {
  readonly present: boolean;
  readonly sourcePath?: string;
  readonly scripts: readonly TavernHelperScriptDefinition[];
  readonly variables: JsonObject;
  readonly diagnostics: readonly string[];
}

interface LocatedEnvelope {
  readonly path: string;
  readonly value: JsonValue;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function arrayAsObject(value: JsonValue): JsonObject | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries: [string, JsonValue][] = [];
  for (const item of value) {
    if (
      !Array.isArray(item) ||
      item.length !== 2 ||
      typeof item[0] !== "string"
    ) {
      return undefined;
    }
    entries.push([item[0], item[1] ?? null]);
  }
  return Object.fromEntries(entries);
}

function extensionsAt(value: JsonObject): LocatedEnvelope | undefined {
  if (Object.hasOwn(value, "tavern_helper")) {
    return {
      path: "extensions.tavern_helper",
      value: value.tavern_helper ?? null,
    };
  }
  if (
    Object.hasOwn(value, "TavernHelper_scripts") ||
    Object.hasOwn(value, "TavernHelper_characterScriptVariables")
  ) {
    return {
      path: "extensions.TavernHelper_scripts",
      value: {
        scripts: value.TavernHelper_scripts ?? [],
        variables: value.TavernHelper_characterScriptVariables ?? {},
      },
    };
  }
  return undefined;
}

function locateEnvelope(value: unknown): LocatedEnvelope | undefined {
  if (!isObject(value)) return undefined;

  const direct = extensionsAt(value);
  if (direct) return direct;

  if (isObject(value.extensions)) {
    const nested = extensionsAt(value.extensions);
    if (nested) return nested;

    if (isObject(value.extensions.legacySource)) {
      const legacySource = value.extensions.legacySource;
      if (isObject(legacySource.extensions)) {
        const legacy = extensionsAt(legacySource.extensions);
        if (legacy) {
          return {
            path: `extensions.legacySource.${legacy.path}`,
            value: legacy.value,
          };
        }
      }
      if (
        isObject(legacySource.data) &&
        isObject(legacySource.data.extensions)
      ) {
        const legacyCard = extensionsAt(legacySource.data.extensions);
        if (legacyCard) {
          return {
            path: `extensions.legacySource.data.${legacyCard.path}`,
            value: legacyCard.value,
          };
        }
      }
    }
  }

  if (isObject(value.data) && isObject(value.data.extensions)) {
    const card = extensionsAt(value.data.extensions);
    if (card) {
      return {
        path: `data.${card.path}`,
        value: card.value,
      };
    }
  }
  return undefined;
}

function scriptsInTree(
  value: JsonValue,
  diagnostics: string[],
): { scripts: JsonObject[]; folder: boolean } {
  if (!isObject(value)) {
    diagnostics.push("A Tavern Helper script tree item is not an object.");
    return { scripts: [], folder: false };
  }
  if (value.type === "folder" || Array.isArray(value.scripts)) {
    if (!Array.isArray(value.scripts)) {
      diagnostics.push("A Tavern Helper folder has no scripts array.");
      return { scripts: [], folder: true };
    }
    return {
      scripts: value.scripts.filter((script): script is JsonObject => {
        if (isObject(script)) return true;
        diagnostics.push("A Tavern Helper folder contains a non-object item.");
        return false;
      }),
      folder: true,
    };
  }
  return { scripts: [value], folder: false };
}

function textField(value: JsonObject, key: string): string {
  return typeof value[key] === "string" ? value[key] : "";
}

function booleanField(
  value: JsonObject,
  key: string,
  fallback: boolean,
): boolean {
  return typeof value[key] === "boolean" ? value[key] : fallback;
}

function objectField(value: JsonObject, key: string): JsonObject {
  return isObject(value[key]) ? value[key] : {};
}

function scriptButtons(
  script: JsonObject,
  scriptId: string,
  diagnostics: string[],
): {
  readonly enabled: boolean;
  readonly buttons: TavernHelperQuickAction[];
} {
  if (!Object.hasOwn(script, "button")) {
    return { enabled: false, buttons: [] };
  }
  if (!isObject(script.button)) {
    diagnostics.push(`Tavern Helper script '${scriptId}' has invalid buttons.`);
    return { enabled: false, buttons: [] };
  }
  const source = script.button;
  if (!Array.isArray(source.buttons)) {
    if (Object.hasOwn(source, "buttons")) {
      diagnostics.push(
        `Tavern Helper script '${scriptId}' has a non-array button list.`,
      );
    }
    return { enabled: booleanField(source, "enabled", true), buttons: [] };
  }
  const buttons = source.buttons.flatMap((candidate, index) => {
    if (!isObject(candidate)) {
      diagnostics.push(
        `Tavern Helper script '${scriptId}' has an invalid button at index ${String(index)}.`,
      );
      return [];
    }
    const name = textField(candidate, "name").trim();
    if (!name) {
      diagnostics.push(
        `Tavern Helper script '${scriptId}' has an unnamed button at index ${String(index)}.`,
      );
      return [];
    }
    return [
      {
        id: `${scriptId}:${String(index)}`,
        name,
        visible: booleanField(candidate, "visible", true),
      },
    ];
  });
  return {
    enabled: booleanField(source, "enabled", true),
    buttons,
  };
}

/**
 * Normalizes the card/preset Tavern Helper envelope into first-party runtime
 * definitions. This function only reads data and never evaluates script code.
 */
export function readTavernHelperBundle(value: unknown): TavernHelperBundle {
  const located = locateEnvelope(value);
  if (!located) {
    return {
      present: false,
      scripts: [],
      variables: {},
      diagnostics: [],
    };
  }
  const diagnostics: string[] = [];
  const envelope =
    (isObject(located.value) ? located.value : undefined) ??
    arrayAsObject(located.value);
  if (!envelope) {
    return {
      present: true,
      sourcePath: located.path,
      scripts: [],
      variables: {},
      diagnostics: ["The Tavern Helper envelope is not an object."],
    };
  }
  const trees = Array.isArray(envelope.scripts) ? envelope.scripts : [];
  if (Object.hasOwn(envelope, "scripts") && !Array.isArray(envelope.scripts)) {
    diagnostics.push("The Tavern Helper scripts field is not an array.");
  }
  const scripts: TavernHelperScriptDefinition[] = [];
  trees.forEach((tree, treeIndex) => {
    const inspected = scriptsInTree(tree, diagnostics);
    const treeObject = isObject(tree) ? tree : {};
    const treeId = inspected.folder
      ? textField(treeObject, "id").trim() || `folder-${String(treeIndex)}`
      : undefined;
    const treeName = inspected.folder
      ? textField(treeObject, "name").trim() || treeId
      : undefined;
    const treeEnabled = inspected.folder
      ? booleanField(treeObject, "enabled", true)
      : true;
    inspected.scripts.forEach((script, scriptIndex) => {
      const id =
        textField(script, "id").trim() ||
        `script-${String(treeIndex)}-${String(scriptIndex)}`;
      const declaredEnabled = booleanField(script, "enabled", true);
      const buttons = scriptButtons(script, id, diagnostics);
      scripts.push({
        id,
        name: textField(script, "name").trim() || id,
        content: textField(script, "content"),
        info: textField(script, "info"),
        declaredEnabled,
        enabled: treeEnabled && declaredEnabled,
        buttonEnabled: buttons.enabled,
        buttons: buttons.buttons,
        data: objectField(script, "data"),
        ...(treeId === undefined ? {} : { treeId }),
        ...(treeName === undefined ? {} : { treeName }),
        sourcePath: `${located.path}.scripts.${String(treeIndex)}${
          inspected.folder ? `.scripts.${String(scriptIndex)}` : ""
        }`,
      });
    });
  });
  const variables =
    (isObject(envelope.variables) ? envelope.variables : undefined) ??
    (isObject(envelope.variales) ? envelope.variales : undefined) ??
    {};
  if (
    (Object.hasOwn(envelope, "variables") ||
      Object.hasOwn(envelope, "variales")) &&
    !isObject(envelope.variables) &&
    !isObject(envelope.variales)
  ) {
    diagnostics.push("The Tavern Helper variables field is not an object.");
  }
  return {
    present: true,
    sourcePath: located.path,
    scripts,
    variables,
    diagnostics,
  };
}

/**
 * Inspects the public Tavern Helper envelope without evaluating script content.
 * Unknown fields stay on the imported entity; this summary only reports enough
 * metadata for a safe import decision.
 */
export function inspectTavernHelperScripts(
  value: unknown,
): TavernHelperScriptSummary {
  const located = locateEnvelope(value);
  if (!located) {
    return {
      present: false,
      treeCount: 0,
      scriptCount: 0,
      enabledScriptCount: 0,
      folderCount: 0,
      variableCount: 0,
      diagnostics: [],
    };
  }

  const diagnostics: string[] = [];
  const envelope =
    (isObject(located.value) ? located.value : undefined) ??
    arrayAsObject(located.value);
  if (!envelope) {
    return {
      present: true,
      sourcePath: located.path,
      treeCount: 0,
      scriptCount: 0,
      enabledScriptCount: 0,
      folderCount: 0,
      variableCount: 0,
      diagnostics: ["The Tavern Helper envelope is not an object."],
    };
  }

  const trees = Array.isArray(envelope.scripts) ? envelope.scripts : [];
  if (Object.hasOwn(envelope, "scripts") && !Array.isArray(envelope.scripts)) {
    diagnostics.push("The Tavern Helper scripts field is not an array.");
  }

  let scriptCount = 0;
  let enabledScriptCount = 0;
  let folderCount = 0;
  for (const tree of trees) {
    const inspected = scriptsInTree(tree, diagnostics);
    if (inspected.folder) folderCount += 1;
    for (const script of inspected.scripts) {
      scriptCount += 1;
      if (script.enabled === true) enabledScriptCount += 1;
    }
  }

  const variables =
    (isObject(envelope.variables) ? envelope.variables : undefined) ??
    (isObject(envelope.variales) ? envelope.variales : undefined);
  if (
    (Object.hasOwn(envelope, "variables") ||
      Object.hasOwn(envelope, "variales")) &&
    variables === undefined
  ) {
    diagnostics.push("The Tavern Helper variables field is not an object.");
  }

  return {
    present: true,
    sourcePath: located.path,
    treeCount: trees.length,
    scriptCount,
    enabledScriptCount,
    folderCount,
    variableCount: variables ? Object.keys(variables).length : 0,
    diagnostics,
  };
}
