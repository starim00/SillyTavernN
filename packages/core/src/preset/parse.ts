import {
  PromptPresetSchema,
  type Diagnostic,
  type GenerationSettings,
  type JsonObject,
  type JsonValue,
  type PromptPreset,
  type PromptTemplate,
} from "@stn/contracts";

import {
  isJsonObject,
  parseSafeJson,
  pickUnknownFields,
  sanitizeJsonValue,
} from "../import/safe-json.js";
import {
  readArray,
  readBoolean,
  readNumber,
  readString,
  readStringArray,
} from "../import/value-readers.js";
import { detectPresetFormat, MASTER_SECTIONS } from "./detect.js";
import type {
  PresetDetection,
  PresetFormat,
  PresetParseOptions,
  PresetSectionPreview,
  PromptPresetPreview,
} from "./types.js";

const PROMPT_FIELDS = [
  "id",
  "identifier",
  "name",
  "role",
  "content",
  "prompt",
  "text",
  "enabled",
  "marker",
  "system_prompt",
  "order",
  "position",
  "injection_position",
  "injection_depth",
] as const;

const ROOT_KNOWN_FIELDS: Readonly<Record<PresetFormat, readonly string[]>> = {
  "sillytavern-n": ["spec", "spec_version", "data"],
  openai: [
    "name",
    "prompts",
    "prompt_order",
    "temperature",
    "top_p",
    "top_k",
    "min_p",
    "top_a",
    "frequency_penalty",
    "presence_penalty",
    "repetition_penalty",
    "openai_max_context",
    "openai_max_tokens",
    "max_context_unlocked",
    "n",
    "seed",
    "stream_openai",
    "stop",
  ],
  "text-generation": [
    "name",
    "temp",
    "temperature",
    "top_p",
    "top_k",
    "min_p",
    "typical_p",
    "top_a",
    "tfs",
    "rep_pen",
    "rep_pen_range",
    "freq_pen",
    "presence_pen",
    "sampler_order",
    "mirostat_mode",
    "mirostat_tau",
    "mirostat_eta",
    "seed",
    "stop",
  ],
  kobold: [
    "name",
    "temp",
    "top_p",
    "top_k",
    "min_p",
    "typical",
    "top_a",
    "tfs",
    "rep_pen",
    "rep_pen_range",
    "sampler_order",
    "mirostat",
    "mirostat_tau",
    "mirostat_eta",
    "grammar",
    "use_default_badwordsids",
  ],
  novelai: [
    "name",
    "temperature",
    "top_p",
    "top_k",
    "min_p",
    "typical_p",
    "top_a",
    "tail_free_sampling",
    "repetition_penalty",
    "repetition_penalty_range",
    "repetition_penalty_frequency",
    "repetition_penalty_presence",
    "order",
    "seed",
    "prefix",
  ],
  instruct: [
    "name",
    "input_sequence",
    "output_sequence",
    "system_sequence",
    "first_input_sequence",
    "last_input_sequence",
    "first_output_sequence",
    "last_output_sequence",
    "last_system_sequence",
    "input_suffix",
    "output_suffix",
    "system_suffix",
    "stop_sequence",
    "story_string_prefix",
    "story_string_suffix",
    "activation_regex",
    "macro",
    "names_behavior",
    "wrap",
  ],
  context: [
    "name",
    "story_string",
    "chat_start",
    "example_separator",
    "use_stop_strings",
    "names_as_stop_strings",
    "story_string_depth",
    "story_string_position",
    "story_string_role",
  ],
  system: ["name", "content", "post_history"],
  reasoning: ["name", "prefix", "suffix", "separator"],
  "start-reply": ["name", "value", "show"],
  "prompt-manager-full": ["version", "type", "data"],
  "prompt-manager-character": ["version", "type", "data"],
  master: [...MASTER_SECTIONS, "name", "type", "preset_format"],
  unknown: [],
};

function toObject(value: unknown): JsonObject {
  const sanitized = sanitizeJsonValue(value);
  if (!isJsonObject(sanitized)) {
    throw new Error("Preset import requires a JSON object");
  }
  return sanitized;
}

function filenameName(filename: string | undefined): string | undefined {
  return filename?.replace(/\.[^.]+$/u, "").trim() || undefined;
}

function sourceVersion(root: JsonObject): string | undefined {
  const version = root.version ?? root.spec_version;
  return typeof version === "string" || typeof version === "number"
    ? String(version)
    : undefined;
}

function defaultIdFactory(): (kind: string) => string {
  let sequence = 0;
  return (kind) => {
    sequence += 1;
    const value =
      typeof globalThis.crypto?.randomUUID === "function"
        ? globalThis.crypto.randomUUID()
        : `${Date.now().toString(36)}-${sequence.toString(36)}`;
    return `${kind}-${value}`;
  };
}

function roleOf(value: JsonValue | undefined): PromptTemplate["role"] {
  if (
    value === "system" ||
    value === "user" ||
    value === "assistant" ||
    value === "tool"
  ) {
    return value;
  }
  if (value === "model") return "assistant";
  if (value === 1 || value === "1") return "user";
  if (value === 2 || value === "2") return "assistant";
  if (value === 3 || value === "3") return "tool";
  return "system";
}

function markerOf(
  value: string | undefined,
): PromptTemplate["marker"] | undefined {
  switch (value?.toLowerCase().replaceAll("_", "-")) {
    case "main":
    case "main-prompt":
      return "main";
    case "world-before":
    case "worldinfobefore":
    case "world-info-before":
      return "world-before";
    case "world-after":
    case "worldinfoafter":
    case "world-info-after":
      return "world-after";
    case "personadescription":
    case "persona-description":
      return "persona-description";
    case "chardescription":
    case "char-description":
    case "character-description":
      return "character-description";
    case "charpersonality":
    case "char-personality":
    case "character-personality":
      return "character-personality";
    case "scenario":
      return "scenario";
    case "examples":
    case "dialogueexamples":
    case "dialogue-examples":
      return "examples";
    case "history":
    case "chathistory":
    case "chat-history":
      return "history";
    case "post-history":
    case "posthistory":
      return "post-history";
    default:
      return value ? "custom" : undefined;
  }
}

function markerForPrompt(
  value: JsonObject,
  identifier: string,
): PromptTemplate["marker"] | undefined {
  const raw = value.marker;
  if (
    raw === undefined ||
    raw === null ||
    raw === false ||
    raw === 0 ||
    raw === "0" ||
    raw === "false"
  ) {
    return undefined;
  }
  if (raw === true || raw === 1 || raw === "1" || raw === "true") {
    return markerOf(identifier);
  }
  return typeof raw === "string" ? markerOf(raw) : undefined;
}

function isDynamicMarker(value: JsonObject): boolean {
  const raw = value.marker;
  return !(
    raw === undefined ||
    raw === null ||
    raw === false ||
    raw === 0 ||
    raw === "0" ||
    raw === "false"
  );
}

interface PromptOrderValue {
  readonly identifier: string;
  readonly enabled?: boolean;
}

const OPENAI_PROMPT_ORDER_CHARACTER_ID = 100001;

function promptOrder(source: JsonValue | undefined): PromptOrderValue[] {
  if (!Array.isArray(source)) {
    return [];
  }
  const nestedOrders = source.filter(
    (item) => isJsonObject(item) && Array.isArray(item.order),
  );
  const nested =
    nestedOrders.find(
      (item) =>
        isJsonObject(item) &&
        (item.character_id === OPENAI_PROMPT_ORDER_CHARACTER_ID ||
          item.character_id === String(OPENAI_PROMPT_ORDER_CHARACTER_ID)),
    ) ?? nestedOrders[0];
  const values =
    nested && isJsonObject(nested) && Array.isArray(nested.order)
      ? nested.order
      : source;
  return values.flatMap((item) => {
    if (typeof item === "string") {
      return [{ identifier: item }];
    }
    if (!isJsonObject(item)) {
      return [];
    }
    const identifier = readString(item, "identifier", "id");
    if (!identifier) {
      return [];
    }
    const enabled = readBoolean(item, "enabled");
    return [
      {
        identifier,
        ...(enabled === undefined ? {} : { enabled }),
      },
    ];
  });
}

function executableTemplate(content: string): boolean {
  return /<%[\s\S]*?%>|<script[\s>]/iu.test(content);
}

function normalizePrompts(
  source: JsonValue | undefined,
  orderSource: JsonValue | undefined,
  id: (kind: string) => string,
  diagnostics: Diagnostic[],
): PromptTemplate[] {
  if (!Array.isArray(source)) {
    return [];
  }
  const authoritativeOrder = Array.isArray(orderSource);
  const order = promptOrder(orderSource);
  const orderByIdentifier = new Map(
    order.map((item, index) => [item.identifier, { ...item, index }]),
  );
  return source.flatMap((value, index) => {
    if (!isJsonObject(value)) {
      return [];
    }
    const identifier =
      readString(value, "identifier", "id") ?? id("prompt-template");
    const ordered = orderByIdentifier.get(identifier);
    const content = readString(value, "content", "prompt", "text") ?? "";
    const unsafe = executableTemplate(content);
    if (unsafe) {
      diagnostics.push({
        severity: "info",
        code: "EXECUTABLE_TEMPLATE_RETAINED",
        message: `Prompt '${identifier}' contains executable template syntax and requires source trust before native rendering.`,
        path: `prompts.${String(index)}`,
      });
    }
    const marker = markerForPrompt(value, identifier);
    const definitionEnabled = readBoolean(value, "enabled") ?? true;
    const enabled = authoritativeOrder
      ? ordered === undefined
        ? false
        : (ordered.enabled ?? definitionEnabled)
      : definitionEnabled;
    const metadata: JsonObject = {
      legacyIdentifier: identifier,
      legacy: pickUnknownFields(value, PROMPT_FIELDS),
      legacyDefinitionEnabled: definitionEnabled,
      ...(value.marker === undefined ? {} : { legacyMarker: value.marker }),
      ...(value.injection_position === undefined
        ? {}
        : { legacyInjectionPosition: value.injection_position }),
      ...(value.injection_depth === undefined
        ? {}
        : { legacyInjectionDepth: value.injection_depth }),
      ...(value.injection_order === undefined
        ? {}
        : { legacyInjectionOrder: value.injection_order }),
      ...(value.injection_trigger === undefined
        ? {}
        : { legacyInjectionTrigger: value.injection_trigger }),
      ...(authoritativeOrder
        ? {
            promptOrderMember: ordered !== undefined,
            ...(ordered === undefined
              ? {}
              : { promptOrderIndex: ordered.index }),
          }
        : {}),
      ...(isDynamicMarker(value) ? { dynamicMarker: true } : {}),
      ...(readString(value, "position", "injection_position")
        ? {
            position: readString(value, "position", "injection_position") ?? "",
          }
        : {}),
      ...(readNumber(value, "injection_depth") === undefined
        ? {}
        : { injectionDepth: readNumber(value, "injection_depth") ?? 0 }),
    };
    return [
      {
        id: identifier,
        name: readString(value, "name")?.trim() || identifier,
        role: roleOf(value.role),
        content,
        enabled,
        ...(marker === undefined ? {} : { marker }),
        order: ordered?.index ?? readNumber(value, "order") ?? index,
        systemPrompt: readBoolean(value, "system_prompt") ?? marker === "main",
        metadata,
      },
    ];
  });
}

function generationOf(source: JsonObject): GenerationSettings {
  const generation: GenerationSettings = {
    stop: readStringArray(source, "stop", "stopping_strings"),
    samplerOrder:
      readArray(source, "sampler_order", "order")?.filter(
        (value): value is string | number =>
          typeof value === "string" ||
          (typeof value === "number" && Number.isInteger(value)),
      ) ?? [],
    additional: {},
  };
  const maxContextTokens = readNumber(source, "openai_max_context");
  if (maxContextTokens !== undefined) {
    generation.additional.maxContextTokens = Math.max(
      1,
      Math.trunc(maxContextTokens),
    );
  }
  const maxContextUnlocked = readBoolean(source, "max_context_unlocked");
  if (maxContextUnlocked !== undefined) {
    generation.additional.maxContextUnlocked = maxContextUnlocked;
  }
  const numbers: Array<
    readonly [
      keyof GenerationSettings,
      readonly string[],
      (value: number) => number,
    ]
  > = [
    ["temperature", ["temperature", "temp"], (value) => value],
    ["topP", ["top_p"], (value) => value],
    ["topK", ["top_k"], (value) => Math.trunc(value)],
    ["minP", ["min_p"], (value) => value],
    ["typicalP", ["typical_p", "typical"], (value) => value],
    ["topA", ["top_a"], (value) => value],
    ["tfs", ["tfs", "tail_free_sampling"], (value) => value],
    ["repetitionPenalty", ["repetition_penalty", "rep_pen"], (value) => value],
    [
      "repetitionPenaltyRange",
      ["repetition_penalty_range", "rep_pen_range"],
      (value) => Math.max(0, Math.trunc(value)),
    ],
    [
      "frequencyPenalty",
      ["frequency_penalty", "freq_pen", "repetition_penalty_frequency"],
      (value) => value,
    ],
    [
      "presencePenalty",
      ["presence_penalty", "presence_pen", "repetition_penalty_presence"],
      (value) => value,
    ],
    [
      "maxOutputTokens",
      ["openai_max_tokens", "max_length", "genamt"],
      (value) => Math.max(1, Math.trunc(value)),
    ],
    ["n", ["n"], (value) => Math.max(1, Math.trunc(value))],
    ["seed", ["seed"], (value) => Math.trunc(value)],
    [
      "mirostatMode",
      ["mirostat_mode", "mirostat"],
      (value) => Math.max(0, Math.trunc(value)),
    ],
    ["mirostatTau", ["mirostat_tau"], (value) => value],
    ["mirostatEta", ["mirostat_eta"], (value) => value],
  ];
  for (const [property, fields, transform] of numbers) {
    const raw = readNumber(source, ...fields);
    if (raw !== undefined) {
      Object.assign(generation, { [property]: transform(raw) });
    }
  }
  const stream = readBoolean(source, "stream", "stream_openai");
  if (stream !== undefined) {
    generation.stream = stream;
  }
  return generation;
}

function controlTemplate(
  id: string,
  name: string,
  role: PromptTemplate["role"],
  content: string,
  order: number,
  metadata: JsonObject,
  enabled = false,
  marker: PromptTemplate["marker"] = "custom",
): PromptTemplate {
  return {
    id,
    name,
    role,
    content,
    enabled,
    marker,
    order,
    systemPrompt: role === "system" && enabled,
    metadata,
  };
}

function templatesForSimpleFormat(
  source: JsonObject,
  format: PresetFormat,
  id: (kind: string) => string,
): PromptTemplate[] {
  if (format === "system") {
    const postHistory = readBoolean(source, "post_history") ?? false;
    return [
      controlTemplate(
        id("prompt-template"),
        readString(source, "name") ?? "System prompt",
        "system",
        readString(source, "content") ?? "",
        0,
        { presetKind: "system" },
        true,
        postHistory ? "post-history" : "main",
      ),
    ];
  }
  if (format === "context") {
    const templates = [
      controlTemplate(
        id("prompt-template"),
        `${readString(source, "name") ?? "Context"} story`,
        "system",
        readString(source, "story_string") ?? "",
        0,
        { presetKind: "context", field: "story_string" },
        true,
        "main",
      ),
    ];
    const chatStart = readString(source, "chat_start");
    if (chatStart) {
      templates.push(
        controlTemplate(
          id("prompt-template"),
          "Chat start",
          "system",
          chatStart,
          1,
          { presetKind: "context", field: "chat_start" },
          true,
          "post-history",
        ),
      );
    }
    return templates;
  }
  if (format === "instruct") {
    const controls = [
      ["system_sequence", "system"],
      ["input_sequence", "user"],
      ["output_sequence", "assistant"],
      ["stop_sequence", "system"],
    ] as const;
    return controls.flatMap(([field, role], index) => {
      const content = readString(source, field);
      return content === undefined
        ? []
        : [
            controlTemplate(
              id("prompt-template"),
              field,
              role,
              content,
              index,
              { presetKind: "instruct", field, renderControl: true },
            ),
          ];
    });
  }
  if (format === "reasoning") {
    const prefix = readString(source, "prefix") ?? "";
    const separator = readString(source, "separator") ?? "";
    const suffix = readString(source, "suffix") ?? "";
    return [
      controlTemplate(
        id("prompt-template"),
        readString(source, "name") ?? "Reasoning format",
        "assistant",
        `${prefix}{{reasoning}}${separator}${suffix}`,
        0,
        { presetKind: "reasoning", renderControl: true },
      ),
    ];
  }
  if (format === "start-reply") {
    return [
      controlTemplate(
        id("prompt-template"),
        readString(source, "name") ?? "Start Reply With",
        "assistant",
        readString(source, "value") ?? "",
        0,
        {
          presetKind: "start-reply",
          show: readBoolean(source, "show") ?? false,
        },
        readBoolean(source, "show") ?? false,
        "post-history",
      ),
    ];
  }
  return [];
}

function sectionPreview(
  kind: string,
  source: JsonObject,
  prompts: readonly PromptTemplate[],
): PresetSectionPreview {
  return {
    kind,
    name: readString(source, "name") ?? kind,
    promptCount: prompts.length,
    fields: Object.keys(source).sort(),
  };
}

function modeFor(format: PresetFormat): PromptPreset["mode"] {
  if (
    format === "text-generation" ||
    format === "kobold" ||
    format === "novelai" ||
    format === "instruct" ||
    format === "context" ||
    format === "master"
  ) {
    return "text-generation";
  }
  if (
    format === "openai" ||
    format === "prompt-manager-full" ||
    format === "prompt-manager-character"
  ) {
    return "chat-completion";
  }
  return "native";
}

function previewNative(
  root: JsonObject,
  detection: PresetDetection,
  options: PresetParseOptions,
): PromptPresetPreview {
  const data = isJsonObject(root.data) ? root.data : root;
  const parsed = PromptPresetSchema.parse(data);
  const preset =
    options.name === undefined ? parsed : { ...parsed, name: options.name };
  const unknownFields = pickUnknownFields(
    root,
    ROOT_KNOWN_FIELDS["sillytavern-n"],
  );
  return {
    detection,
    preset,
    sections: [
      {
        kind: "native",
        name: preset.name,
        promptCount: preset.prompts.length,
        fields: Object.keys(data).sort(),
      },
    ],
    diagnostics: [],
    unknownFields,
  };
}

export function previewPromptPreset(
  source: string | Uint8Array | JsonObject,
  options: PresetParseOptions = {},
): PromptPresetPreview {
  const root =
    typeof source === "string" || source instanceof Uint8Array
      ? parseSafeJson(source, options.jsonLimits)
      : sanitizeJsonValue(source, options.jsonLimits);
  if (!isJsonObject(root)) {
    throw new Error("Preset import requires a JSON object");
  }
  const detected = detectPresetFormat(root);
  const detection: PresetDetection =
    options.formatHint === undefined
      ? detected
      : {
          format: options.formatHint,
          confidence: "certain",
          matchedFields: detected.matchedFields,
          reason: `Explicit format hint: ${options.formatHint}`,
        };
  if (detection.format === "unknown") {
    throw new Error("Unsupported prompt preset format");
  }
  if (detection.format === "sillytavern-n") {
    return previewNative(root, detection, options);
  }

  const id = options.idFactory ?? defaultIdFactory();
  const now = options.now?.() ?? new Date().toISOString();
  const diagnostics: Diagnostic[] = [];
  const wrapperData =
    (detection.format === "prompt-manager-full" ||
      detection.format === "prompt-manager-character") &&
    isJsonObject(root.data)
      ? root.data
      : root;
  let prompts = normalizePrompts(
    wrapperData.prompts,
    wrapperData.prompt_order,
    id,
    diagnostics,
  );
  let generation = generationOf(wrapperData);
  const sections: PresetSectionPreview[] = [];

  if (detection.format === "master") {
    prompts = [];
    for (const sectionName of MASTER_SECTIONS) {
      const section = root[sectionName];
      if (!isJsonObject(section)) {
        continue;
      }
      const sectionFormat: PresetFormat =
        sectionName === "sysprompt"
          ? "system"
          : sectionName === "preset"
            ? detectPresetFormat(section).format === "unknown"
              ? "text-generation"
              : detectPresetFormat(section).format
            : sectionName === "srw"
              ? "start-reply"
              : sectionName;
      const sectionPrompts =
        sectionFormat === "openai"
          ? normalizePrompts(
              section.prompts,
              section.prompt_order,
              id,
              diagnostics,
            )
          : templatesForSimpleFormat(section, sectionFormat, id);
      prompts.push(...sectionPrompts);
      sections.push(sectionPreview(sectionName, section, sectionPrompts));
      if (sectionName === "preset") {
        generation = generationOf(section);
      }
    }
  } else if (prompts.length === 0) {
    prompts = templatesForSimpleFormat(wrapperData, detection.format, id);
  }

  if (sections.length === 0) {
    sections.push(sectionPreview(detection.format, wrapperData, prompts));
  }
  if (prompts.length === 0 && generation.samplerOrder.length === 0) {
    diagnostics.push({
      severity: "info",
      code: "PRESET_HAS_NO_PROMPTS",
      message:
        "The preset contains formatting or generation controls but no prompt templates.",
    });
  }

  const unknownFields = pickUnknownFields(
    root,
    ROOT_KNOWN_FIELDS[detection.format],
  );
  if (wrapperData !== root) {
    const nestedUnknown = pickUnknownFields(wrapperData, [
      "prompts",
      "prompt_order",
    ]);
    if (Object.keys(nestedUnknown).length > 0) {
      unknownFields.dataUnknown = nestedUnknown;
    }
  }
  const legacySource = toObject(root);
  const name =
    options.name ??
    readString(wrapperData, "name") ??
    filenameName(options.filename) ??
    `${detection.format} preset`;
  const preset: PromptPreset = PromptPresetSchema.parse({
    id: id("prompt-preset"),
    name,
    mode: modeFor(detection.format),
    prompts,
    generation,
    extensions: {
      presetFormat: detection.format,
      legacySource,
      ...(wrapperData.prompt_order === undefined
        ? {}
        : { promptOrder: wrapperData.prompt_order }),
      ...(detection.format === "master"
        ? { masterSections: legacySource }
        : {}),
    },
    compatibility: {
      sourceFormat: detection.format,
      ...(sourceVersion(root) === undefined
        ? {}
        : { sourceVersion: sourceVersion(root) }),
      ...(options.filename === undefined
        ? {}
        : { originalFilename: options.filename }),
      unknownFields,
    },
    createdAt: now,
    updatedAt: now,
  });

  return {
    detection,
    preset,
    sections,
    diagnostics,
    unknownFields,
  };
}

export function importPromptPreset(
  source: string | Uint8Array | JsonObject,
  options: PresetParseOptions = {},
): PromptPreset {
  return previewPromptPreset(source, options).preset;
}
