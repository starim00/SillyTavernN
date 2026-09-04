export type TavernHelperScope = "global" | "card" | "preset";

export type TavernHelperSettings = {
  render: {
    enabled: boolean;
    depth: number;
    ignoreHiddenMessages: boolean;
    collapseCodeBlocks: "all" | "frontend" | "none";
    allowBlobUrls: boolean;
    syntaxHighlighting: boolean;
    cleanupProtection: boolean;
    streaming: boolean;
  };
  optimize: {
    limitRenderedMessages: boolean;
    carryWorldbookOnCardUpdate: boolean;
    exportLatestWorldbook: boolean;
    recommendedWorldbookSettings: boolean;
    maximizePresetContext: boolean;
  };
  developer: {
    macrosEnabled: boolean;
    liveListenerEnabled: boolean;
    liveListenerUrl: string;
    liveListenerInterval: number;
    errorPopups: boolean;
  };
};

export type TavernHelperButton = {
  id: string;
  name: string;
  visible: boolean;
};

export type TavernHelperScript = {
  id: string;
  name: string;
  content: string;
  info: string;
  declaredEnabled: boolean;
  enabled: boolean;
  buttonEnabled: boolean;
  buttons: TavernHelperButton[];
  data: Record<string, unknown>;
  treeId?: string;
  treeName?: string;
  sourcePath: string;
};

export type TavernHelperSource = {
  scope: TavernHelperScope;
  id: string;
  name: string;
  revision: number;
  trusted: boolean;
  bundle: {
    present: boolean;
    sourcePath?: string;
    scripts: TavernHelperScript[];
    variables: Record<string, unknown>;
    diagnostics: string[];
  };
};

export type TavernHelperContext = {
  conversation: {
    id: string;
    cardId: string;
    presetId: string | null;
  };
  settings?: TavernHelperSettings;
  preset?: {
    id: string;
    name: string;
    revision: number;
    value: Record<string, unknown>;
  };
  presetNames?: string[];
  sources: TavernHelperSource[];
  worldbooks?: Array<{
    id: string;
    name: string;
    bindings: Array<{
      scopeType: "global" | "card" | "conversation" | "participant";
      scopeId: string | null;
    }>;
    entries: Array<{
      id: string;
      legacyUid: number | null;
      keys: string[];
      content: string;
      enabled: boolean;
      position: number;
      metadata: Record<string, unknown>;
    }>;
  }>;
  variables: {
    global: Record<string, unknown>;
    character: Record<string, unknown>;
    preset: Record<string, unknown>;
    chat: Record<string, unknown>;
    messages: Record<string, Record<string, unknown>>;
    scripts: Record<string, Record<string, unknown>>;
    extensions?: Record<string, Record<string, unknown>>;
  };
};

export type TavernHelperStateNamespace =
  | "global"
  | "character"
  | "preset"
  | "chat"
  | "message"
  | "script"
  | "extension";

export type TavernHelperRuntimeButton = TavernHelperButton & {
  sourceScope: TavernHelperScope;
  sourceId: string;
  scriptId: string;
  scriptName: string;
};

export type TavernHelperRuntimeStatus = {
  loading: boolean;
  loadedScriptIds: string[];
  errors: Array<{
    sourceScope: TavernHelperScope;
    sourceId: string;
    scriptId: string;
    scriptName: string;
    message: string;
  }>;
};
