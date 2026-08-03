import {
  PromptSegmentSchema,
  type JsonObject,
  type Message,
  type Participant,
  type PromptSegment,
  type PromptTemplate,
  type WorldbookEntry,
} from "@stn/contracts";

import { applyRegexScripts } from "../regex/engine.js";
import type { RegexPlacement } from "../regex/types.js";
import { applyPromptTokenBudget, estimatePromptTokens } from "./budget.js";
import { createPromptMacroRuntime, expandPromptMacros } from "./macros.js";
import type {
  PromptAssemblyInput,
  PromptAssemblyResult,
  PromptMacroContext,
  TokenEstimator,
} from "./types.js";
import { matchWorldbookEntries } from "./worldbook.js";

const POSITION_ORDER: Readonly<Record<PromptSegment["position"], number>> = {
  system: 0,
  "before-card": 10,
  card: 20,
  "after-card": 30,
  "before-examples": 40,
  examples: 50,
  "after-examples": 60,
  "before-history": 70,
  history: 80,
  "after-history": 90,
};

type PromptMarker = NonNullable<PromptTemplate["marker"]>;

type PromptMarkerAnchor = {
  readonly template: PromptTemplate;
  readonly nextOrder: number;
};

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (const point of value) {
    hash ^= point.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function activeMessageContent(message: Message): string {
  return (
    message.swipes.find((swipe) => swipe.id === message.activeSwipeId)
      ?.content ?? ""
  );
}

function sortedParticipants(input: PromptAssemblyInput): Participant[] {
  const all = [...(input.participants ?? input.card?.participants ?? [])];
  const bindings = new Map(
    input.conversation?.participants.map((participant) => [
      participant.participantId,
      participant,
    ]) ?? [],
  );
  return all
    .filter((participant) => bindings.get(participant.id)?.enabled !== false)
    .sort((left, right) => {
      const leftOrder = bindings.get(left.id)?.speakingOrder ?? 0;
      const rightOrder = bindings.get(right.id)?.speakingOrder ?? 0;
      return leftOrder - rightOrder || left.id.localeCompare(right.id);
    });
}

function participantProfile(participant: Participant): string {
  const rows = [`[${participant.name}]`];
  if (participant.description)
    rows.push(`Description: ${participant.description}`);
  if (participant.personality)
    rows.push(`Personality: ${participant.personality}`);
  if (participant.scenario) rows.push(`Scenario: ${participant.scenario}`);
  return rows.join("\n");
}

function presetPosition(template: PromptTemplate): PromptSegment["position"] {
  switch (template.marker) {
    case "world-before":
      return "before-card";
    case "world-after":
      return "after-card";
    case "examples":
      return "examples";
    case "history":
      return "history";
    case "post-history":
      return "after-history";
    case "main":
      return "system";
    default: {
      const position = template.metadata.position;
      return typeof position === "string" && position in POSITION_ORDER
        ? (position as PromptSegment["position"])
        : template.role === "system"
          ? "system"
          : "before-history";
    }
  }
}

function positionAfterPresetMarker(
  template: PromptTemplate,
  current: PromptSegment["position"],
): PromptSegment["position"] {
  switch (template.marker) {
    case "main":
      return "system";
    case "persona-description":
    case "world-before":
      return "before-card";
    case "character-description":
    case "character-personality":
    case "scenario":
      return "card";
    case "world-after":
      return "after-card";
    case "examples":
      return "after-examples";
    case "history":
    case "post-history":
      return "after-history";
    default:
      return current;
  }
}

function dynamicMarkerAnchors(
  templates: readonly PromptTemplate[],
): ReadonlyMap<PromptMarker, PromptMarkerAnchor> {
  const anchors = new Map<PromptMarker, PromptMarkerAnchor>();
  templates.forEach((template, index) => {
    if (
      !template.enabled ||
      template.metadata.dynamicMarker !== true ||
      template.marker === undefined ||
      anchors.has(template.marker)
    ) {
      return;
    }
    const nextOrder =
      templates
        .slice(index + 1)
        .find(
          (candidate) => candidate.enabled && candidate.order > template.order,
        )?.order ?? template.order + 1;
    anchors.set(template.marker, { template, nextOrder });
  });
  return anchors;
}

function markerInsertionOrder(
  anchor: PromptMarkerAnchor,
  index: number,
  count: number,
): number {
  const fraction = (index + 1) / (count + 1);
  return (
    anchor.template.order +
    (anchor.nextOrder - anchor.template.order) * fraction
  );
}

function worldbookMarker(
  entry: WorldbookEntry,
): "world-before" | "world-after" | undefined {
  switch (worldbookPosition(entry)) {
    case "before-card":
      return "world-before";
    case "after-card":
      return "world-after";
    default:
      return undefined;
  }
}

function macroContext(
  input: PromptAssemblyInput,
  participants: readonly Participant[],
): PromptMacroContext {
  const characters = participants.filter(
    (participant) => participant.kind !== "user",
  );
  const firstCharacter = characters[0];
  const user = participants.find((participant) => participant.kind === "user");
  const lastUserMessage =
    input.currentInput ??
    [...(input.messages ?? [])]
      .filter(
        (message) => message.state === "complete" && message.role === "user",
      )
      .sort(
        (left, right) =>
          left.sequence - right.sequence || left.id.localeCompare(right.id),
      )
      .map(activeMessageContent)
      .at(-1);
  return {
    userName: input.userName ?? user?.name ?? "User",
    ...(characters.length === 0
      ? {}
      : {
          characterName:
            characters.length === 1
              ? (firstCharacter?.name ?? "")
              : characters.map((participant) => participant.name).join(", "),
        }),
    participantNames: characters.map((participant) => participant.name),
    ...(input.card?.narrator?.name === undefined
      ? {}
      : { narratorName: input.card.narrator.name }),
    ...(input.card?.name === undefined ? {} : { cardName: input.card.name }),
    ...(input.card?.description === undefined &&
    firstCharacter?.description === undefined
      ? {}
      : {
          description:
            input.card?.description ?? firstCharacter?.description ?? "",
        }),
    ...(firstCharacter?.personality === undefined
      ? {}
      : { personality: firstCharacter.personality }),
    ...(input.card?.scenario === undefined &&
    firstCharacter?.scenario === undefined
      ? {}
      : {
          scenario: input.card?.scenario ?? firstCharacter?.scenario ?? "",
        }),
    ...(input.card?.worldDescription === undefined
      ? {}
      : { worldDescription: input.card.worldDescription }),
    ...(input.persona === undefined ? {} : { persona: input.persona }),
    ...(lastUserMessage === undefined ? {} : { lastUserMessage }),
    ...(input.macros === undefined ? {} : { custom: input.macros }),
  };
}

function sourceDetail(
  detail: JsonObject | undefined,
  currentInput: boolean,
): JsonObject {
  return {
    ...(detail ?? {}),
    ...(currentInput ? { currentInput: true } : {}),
  };
}

function regexSubstitutions(
  macros: PromptMacroContext,
): Readonly<Record<string, string>> {
  const character = macros.characterName ?? macros.cardName ?? "";
  const participants = macros.participantNames?.join(", ") ?? character;
  return {
    ...(macros.custom ?? {}),
    user: macros.userName ?? "User",
    char: character,
    character,
    group: participants,
    participants,
    narrator: macros.narratorName ?? "",
    card: macros.cardName ?? "",
    description: macros.description ?? "",
    personality: macros.personality ?? "",
    scenario: macros.scenario ?? "",
    persona: macros.persona ?? "",
    lastUserMessage: macros.lastUserMessage ?? "",
  };
}

function worldbookPosition(entry: WorldbookEntry): PromptSegment["position"] {
  switch (entry.insertionPosition) {
    case "before-card":
      return "before-card";
    case "after-card":
      return "after-card";
    case "examples-top":
      return "before-examples";
    case "examples-bottom":
      return "after-examples";
    case "author-note-top":
      return "before-history";
    case "author-note-bottom":
      return "after-history";
    case "at-depth":
      return "history";
    case "outlet":
    case undefined:
      return entry.position;
  }
}

function atDepthHistoryOrder(
  requestedDepth: number,
  historyLength: number,
  matchIndex: number,
  matchCount: number,
): number {
  const depth = Math.max(0, Math.floor(requestedDepth));
  const boundary = Math.max(0, historyLength - depth);
  const stableOffset = ((matchIndex + 1) / (matchCount + 1) - 0.5) / 2;
  return boundary - 0.5 + stableOffset;
}

export function assemblePrompt(
  input: PromptAssemblyInput,
): PromptAssemblyResult {
  const participants = sortedParticipants(input);
  const macroRuntime = input.macroRuntime ?? createPromptMacroRuntime();
  const baseMacros = macroContext(input, participants);
  const messages = [...(input.messages ?? [])]
    .filter(
      (message) =>
        message.state !== "draft" && activeMessageContent(message).length > 0,
    )
    .sort(
      (left, right) =>
        left.sequence - right.sequence || left.id.localeCompare(right.id),
    );
  const historyText = messages.map(activeMessageContent);
  if (input.currentInput !== undefined) {
    historyText.push(input.currentInput);
  }
  const matches = matchWorldbookEntries(input.worldbooks ?? [], historyText);
  const baseSubstitutions = regexSubstitutions(baseMacros);
  const outletContents = new Map<string, string[]>();
  for (const match of matches) {
    const outletName = match.entry.outletName?.trim();
    if (match.entry.insertionPosition !== "outlet" || !outletName) {
      continue;
    }
    let content = expandPromptMacros(match.entry.content, baseMacros, {
      runtime: macroRuntime,
    });
    if (input.regexScripts !== undefined) {
      content = applyRegexScripts(content, input.regexScripts, {
        placement: 5,
        target: "prompt",
        depth: match.entry.insertionDepth ?? 0,
        substitutions: baseSubstitutions,
      });
    }
    if (!content) {
      continue;
    }
    const macroName = `outlet::${outletName.toLocaleLowerCase()}`;
    const current = outletContents.get(macroName) ?? [];
    current.push(content);
    outletContents.set(macroName, current);
  }
  const outletMacros = Object.fromEntries(
    [...outletContents].map(([name, contents]) => [
      name,
      contents.join("\n\n"),
    ]),
  );
  const macros: PromptMacroContext =
    Object.keys(outletMacros).length === 0
      ? baseMacros
      : {
          ...baseMacros,
          custom: {
            ...(baseMacros.custom ?? {}),
            ...outletMacros,
          },
        };
  const substitutions = regexSubstitutions(macros);
  const estimate: TokenEstimator = input.estimateTokens ?? estimatePromptTokens;
  const assembled: PromptSegment[] = [];
  let ordinal = 0;

  const add = (value: {
    role: PromptSegment["role"];
    content: string;
    source: PromptSegment["source"];
    position: PromptSegment["position"];
    priority: number;
    order: number;
    required?: boolean;
    truncation?: PromptSegment["truncation"];
    metadata?: JsonObject;
    currentInput?: boolean;
    regex?: {
      placement: RegexPlacement;
      depth?: number;
    };
  }): void => {
    let content = expandPromptMacros(value.content, macros, {
      runtime: macroRuntime,
    });
    if (value.regex !== undefined && input.regexScripts !== undefined) {
      content = applyRegexScripts(content, input.regexScripts, {
        placement: value.regex.placement,
        target: "prompt",
        ...(value.regex.depth === undefined
          ? {}
          : { depth: value.regex.depth }),
        substitutions,
      });
    }
    if (!content && !value.currentInput) {
      return;
    }
    ordinal += 1;
    const segment = PromptSegmentSchema.parse({
      id: `segment-${ordinal.toString().padStart(4, "0")}-${stableHash(
        `${value.source.kind}:${value.source.id ?? ""}:${content}`,
      )}`,
      role: value.role,
      content,
      source: value.source,
      position: value.position,
      priority: value.priority,
      order: value.order,
      tokenEstimate: estimate(content),
      required: value.required ?? false,
      truncation: value.truncation ?? "drop",
      metadata: sourceDetail(value.metadata, value.currentInput ?? false),
    });
    assembled.push(segment);
  };

  if (input.systemInstruction) {
    add({
      role: "system",
      content: input.systemInstruction,
      source: { kind: "system", label: "System instruction", detail: {} },
      position: "system",
      priority: 10_000,
      order: -10_000,
      required: true,
      truncation: "head",
    });
  }

  const presetTemplates = [...(input.preset?.prompts ?? [])].sort(
    (left, right) =>
      left.order - right.order || left.id.localeCompare(right.id),
  );
  const markerAnchors = dynamicMarkerAnchors(presetTemplates);
  const hasDynamicMarkers = presetTemplates.some(
    (template) => template.enabled && template.metadata.dynamicMarker === true,
  );
  let personaInserted = false;
  let legacyPresetPosition: PromptSegment["position"] = "system";
  for (const template of presetTemplates) {
    if (!template.enabled) {
      continue;
    }
    if (template.metadata.dynamicMarker === true) {
      if (template.marker === "persona-description" && input.persona?.trim()) {
        const anchor = markerAnchors.get("persona-description");
        if (anchor?.template === template) {
          add({
            role: template.role,
            content: input.persona,
            source: {
              kind: "persona",
              ...(input.personaId ? { id: input.personaId } : {}),
              label: "Persona",
              detail: {
                presetId: input.preset?.id ?? "",
                markerId: template.id,
              },
            },
            position: "before-card",
            priority: 700,
            order: markerInsertionOrder(anchor, 0, 1),
            truncation: "tail",
            metadata: { dynamicMarker: "persona-description" },
          });
          personaInserted = true;
        }
      }
      legacyPresetPosition = positionAfterPresetMarker(
        template,
        legacyPresetPosition,
      );
      continue;
    }
    add({
      role: template.role,
      content: template.content,
      source: {
        kind: "preset",
        id: template.id,
        label: template.name,
        detail: { presetId: input.preset?.id ?? "" },
      },
      position: hasDynamicMarkers
        ? legacyPresetPosition
        : presetPosition(template),
      priority: template.systemPrompt ? 9_000 : 500,
      order: template.order,
      required: template.systemPrompt,
      truncation: template.systemPrompt ? "head" : "drop",
      metadata: template.metadata,
    });
  }

  if (input.persona?.trim() && !personaInserted) {
    add({
      role: "system",
      content: input.persona,
      source: {
        kind: "persona",
        ...(input.personaId ? { id: input.personaId } : {}),
        label: "Persona",
        detail: { fallback: true },
      },
      position: "before-card",
      priority: 700,
      order: -1,
      truncation: "tail",
    });
  }

  if (input.card?.systemPrompt) {
    add({
      role: "system",
      content: input.card.systemPrompt,
      source: {
        kind: "card",
        id: input.card.id,
        label: `${input.card.name} system prompt`,
        detail: {},
      },
      position: "system",
      priority: 9_500,
      order: -5_000,
      required: true,
      truncation: "head",
    });
  }

  if (input.card) {
    const cardContent = [
      input.card.description,
      input.card.scenario ? `Scenario: ${input.card.scenario}` : "",
      input.card.worldDescription
        ? `World: ${input.card.worldDescription}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    add({
      role: "system",
      content: cardContent,
      source: {
        kind: "card",
        id: input.card.id,
        label: input.card.name,
        detail: { cardKind: input.card.kind },
      },
      position: "card",
      priority: 800,
      order: 0,
      truncation: "tail",
    });
  }

  participants
    .filter((participant) => participant.kind !== "user")
    .forEach((participant, index) => {
      add({
        role: "system",
        content: participantProfile(participant),
        source: {
          kind: participant.kind === "narrator" ? "narrator" : "participant",
          id: participant.id,
          label: participant.name,
          detail: { participantKind: participant.kind },
        },
        position: "card",
        priority: 750,
        order: index + 1,
        truncation: "tail",
      });
    });

  if (input.card?.narrator) {
    add({
      role: "system",
      content: participantProfile(input.card.narrator),
      source: {
        kind: "narrator",
        id: input.card.narrator.id,
        label: input.card.narrator.name,
        detail: {},
      },
      position: "card",
      priority: 760,
      order: participants.length + 1,
      truncation: "tail",
    });
  }

  const exampleTexts = [
    input.card?.exampleDialogue,
    ...participants.map((participant) => participant.exampleDialogue),
    input.card?.narrator?.exampleDialogue,
  ].filter((value): value is string => Boolean(value));
  if (exampleTexts.length > 0) {
    add({
      role: "system",
      content: exampleTexts.join("\n\n"),
      source: {
        kind: "card",
        ...(input.card ? { id: input.card.id } : {}),
        label: "Dialogue examples",
        detail: {},
      },
      position: "examples",
      priority: 300,
      order: 0,
      truncation: "tail",
    });
  }

  const anchoredWorldbookOrders = new Map<(typeof matches)[number], number>();
  for (const marker of ["world-before", "world-after"] as const) {
    const anchor = markerAnchors.get(marker);
    if (anchor === undefined) {
      continue;
    }
    const anchored = matches
      .filter((match) => worldbookMarker(match.entry) === marker)
      .sort(
        (left, right) =>
          left.entry.order - right.entry.order ||
          left.worldbookId.localeCompare(right.worldbookId) ||
          left.entry.id.localeCompare(right.entry.id),
      );
    anchored.forEach((match, index) => {
      anchoredWorldbookOrders.set(
        match,
        markerInsertionOrder(anchor, index, anchored.length),
      );
    });
  }
  const historyLength =
    messages.length + (input.currentInput === undefined ? 0 : 1);
  matches.forEach((match, matchIndex) => {
    const insertionDepth = match.entry.insertionDepth ?? 0;
    const insertionPosition = match.entry.insertionPosition;
    if (insertionPosition === "outlet") {
      return;
    }
    add({
      role: match.entry.insertionRole ?? "system",
      content: match.entry.content,
      source: {
        kind: "worldbook",
        id: match.entry.id,
        label: `${match.worldbookName}: ${match.entry.label}`,
        detail: {
          worldbookId: match.worldbookId,
          depth: match.depth,
          matchedKeys: [...match.matchedKeys],
          ...(insertionPosition === undefined ? {} : { insertionPosition }),
          insertionDepth,
          insertionRole: match.entry.insertionRole ?? "system",
        },
      },
      position: worldbookPosition(match.entry),
      priority: 600 + match.entry.priority,
      order:
        insertionPosition === "at-depth"
          ? atDepthHistoryOrder(
              insertionDepth,
              historyLength,
              matchIndex,
              matches.length,
            )
          : (anchoredWorldbookOrders.get(match) ?? match.entry.order),
      truncation: "drop",
      regex: { placement: 5, depth: insertionDepth },
    });
  });

  const lastUserMessage = [...messages]
    .reverse()
    .find((message) => message.role === "user");
  for (const [messageIndex, message] of messages.entries()) {
    const current =
      input.currentInput === undefined && message === lastUserMessage;
    const messageDepth =
      messages.length -
      1 -
      messageIndex +
      (input.currentInput === undefined ? 0 : 1);
    add({
      role: message.role,
      content: activeMessageContent(message),
      source: {
        kind: "message",
        id: message.id,
        label: message.author.displayName ?? message.role,
        detail: { sequence: message.sequence },
      },
      position: "history",
      priority: current ? 10_000 : 200 + message.sequence,
      order: messageIndex,
      required: current,
      truncation: current ? "tail" : "drop",
      metadata: {},
      currentInput: current,
      ...(message.role === "user" || message.role === "assistant"
        ? {
            regex: {
              placement: message.role === "user" ? 1 : 2,
              depth: messageDepth,
            },
          }
        : {}),
    });
  }

  if (input.currentInput !== undefined) {
    add({
      role: "user",
      content: input.currentInput,
      source: {
        kind: "conversation",
        ...(input.conversation ? { id: input.conversation.id } : {}),
        label: "Current input",
        detail: {},
      },
      position: "history",
      priority: 10_000,
      order: messages.length,
      required: true,
      truncation: "tail",
      metadata: {},
      currentInput: true,
      regex: { placement: 1, depth: 0 },
    });
  }

  const postHistory = [
    input.card?.postHistoryInstructions,
    ...participants.map((participant) => participant.postHistoryInstructions),
    input.card?.narrator?.postHistoryInstructions,
  ].filter((value): value is string => Boolean(value));
  if (postHistory.length > 0) {
    add({
      role: "system",
      content: postHistory.join("\n\n"),
      source: {
        kind: "card",
        ...(input.card ? { id: input.card.id } : {}),
        label: "Post-history instructions",
        detail: {},
      },
      position: "after-history",
      priority: 850,
      order: 0,
      required: true,
      truncation: "head",
    });
  }

  assembled.push(...(input.extensionSegments ?? []));
  assembled.sort(
    (left, right) =>
      POSITION_ORDER[left.position] - POSITION_ORDER[right.position] ||
      left.order - right.order ||
      left.id.localeCompare(right.id),
  );

  if (!input.tokenBudget) {
    const totalTokenEstimate = assembled.reduce(
      (sum, segment) => sum + segment.tokenEstimate,
      0,
    );
    return {
      segments: assembled,
      trace: {
        assembled,
        included: assembled,
        dropped: [],
        matchedWorldbookEntries: matches,
        totalTokenEstimate,
        overBudget: false,
      },
    };
  }

  const budgeted = applyPromptTokenBudget(
    assembled,
    input.tokenBudget,
    estimate,
  );
  return {
    segments: budgeted.segments,
    trace: {
      assembled,
      included: budgeted.segments,
      dropped: budgeted.dropped,
      matchedWorldbookEntries: matches,
      totalTokenEstimate: budgeted.totalTokenEstimate,
      availableTokens: budgeted.availableTokens,
      overBudget: budgeted.overBudget,
    },
  };
}
