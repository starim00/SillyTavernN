import type {
  Card,
  Conversation,
  Message,
  Participant,
  PromptPreset,
  Worldbook,
  WorldbookEntry,
} from "@stn/contracts";
import { describe, expect, it } from "vitest";

import type { RegexScript } from "../regex/types.js";
import { assemblePrompt } from "./assemble.js";
import { renderChatPrompt, renderTextPrompt } from "./render.js";

const now = "2026-07-29T00:00:00.000Z";

function participant(
  id: string,
  name: string,
  kind: Participant["kind"] = "character",
): Participant {
  return {
    id,
    name,
    kind,
    aliases: [],
    description: `${name} description`,
    personality: `${name} personality`,
    scenario: "",
    firstMessage: "",
    alternateGreetings: [],
    exampleDialogue: "",
    systemPrompt: "",
    postHistoryInstructions: "",
    tags: [],
    extensions: {},
  };
}

function card(
  kind: Card["kind"],
  participants: Participant[],
  overrides: Partial<Card> = {},
): Card {
  return {
    id: `card-${kind}`,
    kind,
    name: `${kind} card`,
    description: "A scene for {{user}} with {{participants}}.",
    scenario: "A deterministic test.",
    worldDescription: "",
    participants,
    greeting: "",
    alternateGreetings: [],
    exampleDialogue: "",
    systemPrompt: "",
    postHistoryInstructions: "",
    creator: "",
    creatorNotes: "",
    version: "1",
    tags: [],
    assets: [],
    worldbookIds: [],
    extensions: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function conversation(
  participants: readonly Participant[],
  order = participants,
): Conversation {
  return {
    id: "conversation-1",
    title: "Golden",
    sourceCardIds: [],
    participants: order.map((value, index) => ({
      participantId: value.id,
      displayName: value.name,
      enabled: true,
      speakingOrder: index,
      metadata: {},
    })),
    worldbookIds: [],
    activeBranchId: "branch-1",
    metadata: {},
    revision: 0,
    createdAt: now,
    updatedAt: now,
  };
}

function message(
  id: string,
  sequence: number,
  role: Message["role"],
  content: string,
  displayName: string,
): Message {
  return {
    id,
    conversationId: "conversation-1",
    branchId: "branch-1",
    sequence,
    role,
    author: {
      kind: role === "user" ? "user" : "assistant",
      displayName,
    },
    swipes: [
      {
        id: `${id}-swipe`,
        content,
        createdAt: now,
        metadata: {},
      },
    ],
    activeSwipeId: `${id}-swipe`,
    state: "complete",
    metadata: {},
    revision: 0,
    createdAt: now,
    updatedAt: now,
  };
}

function entry(
  id: string,
  primaryKeys: string[],
  content: string,
  overrides: Partial<WorldbookEntry> = {},
): WorldbookEntry {
  const { agentEditable = false, ...remainingOverrides } = overrides;
  return {
    id,
    label: id,
    content,
    primaryKeys,
    secondaryKeys: [],
    secondaryLogic: "any",
    selective: false,
    constant: false,
    disabled: false,
    agentEditable,
    caseSensitive: false,
    matchWholeWords: false,
    recursion: true,
    preventRecursion: false,
    position: "before-history",
    order: 0,
    priority: 0,
    extensions: {},
    revision: 0,
    ...remainingOverrides,
  };
}

function worldbook(entries: WorldbookEntry[]): Worldbook {
  return {
    id: "worldbook-1",
    name: "Golden lore",
    description: "",
    entries,
    bindings: [],
    scanDepth: 8,
    recursionLimit: 3,
    agentEditable: false,
    revision: 0,
    extensions: {},
    createdAt: now,
    updatedAt: now,
  };
}

function regexScript(id: string, overrides: Partial<RegexScript>): RegexScript {
  return {
    id,
    scriptName: id,
    findRegex: "",
    replaceString: "",
    trimStrings: [],
    placement: [],
    disabled: false,
    markdownOnly: false,
    promptOnly: true,
    runOnEdit: false,
    substituteRegex: 0,
    minDepth: null,
    maxDepth: null,
    source: "card",
    sourceIndex: 0,
    ...overrides,
  };
}

function golden(result: ReturnType<typeof assemblePrompt>): string[] {
  return result.segments.map(
    (segment) =>
      `${segment.position}|${segment.role}|${segment.source.kind}|${segment.source.label}|${segment.content}`,
  );
}

describe("prompt assembly goldens", () => {
  it("assembles a single-participant conversation", () => {
    const aria = participant("aria", "Aria");
    const result = assemblePrompt({
      card: card("character", [aria]),
      conversation: conversation([aria]),
      participants: [aria],
      userName: "Lin",
      messages: [
        message("m1", 0, "assistant", "Welcome.", "Aria"),
        message("m2", 1, "user", "Open the gate.", "Lin"),
      ],
    });

    expect(golden(result)).toEqual([
      "card|system|card|character card|A scene for Lin with Aria.\n\nScenario: A deterministic test.",
      "card|system|participant|Aria|[Aria]\nDescription: Aria description\nPersonality: Aria personality",
      "history|assistant|message|Aria|Welcome.",
      "history|user|message|Lin|Open the gate.",
    ]);
    expect(renderChatPrompt(result.segments)).toEqual([
      {
        role: "system",
        content:
          "A scene for Lin with Aria.\n\nScenario: A deterministic test.\n\n[Aria]\nDescription: Aria description\nPersonality: Aria personality",
        sourceSegmentIds: [result.segments[0]?.id, result.segments[1]?.id],
        metadata: { source: "card" },
      },
      {
        role: "assistant",
        content: "Welcome.",
        sourceSegmentIds: [result.segments[2]?.id],
        metadata: { source: "message" },
      },
      {
        role: "user",
        content: "Open the gate.",
        sourceSegmentIds: [result.segments[3]?.id],
        metadata: { source: "message" },
      },
    ]);
  });

  it("uses conversation speaking order for an ensemble", () => {
    const alpha = participant("alpha", "Alpha");
    const beta = participant("beta", "Beta");
    const result = assemblePrompt({
      card: card("ensemble", [alpha, beta]),
      conversation: conversation([alpha, beta], [beta, alpha]),
      participants: [alpha, beta],
      systemInstruction: "Cast: {{participants}}",
      currentInput: "Begin.",
      userName: "Lin",
    });

    expect(
      result.segments
        .filter((segment) => segment.source.kind === "participant")
        .map((segment) => segment.source.label),
    ).toEqual(["Beta", "Alpha"]);
    expect(result.segments[0]?.content).toBe("Cast: Beta, Alpha");
    expect(result.segments.at(-1)?.metadata.currentInput).toBe(true);
  });

  it("assembles narrator-only cards without inventing a character", () => {
    const narrator = participant("narrator", "The Narrator", "narrator");
    const result = assemblePrompt({
      card: card("scenario", [], { narrator }),
      conversation: conversation([]),
      currentInput: "Describe the square.",
    });

    expect(result.segments.map((segment) => segment.source.kind)).toEqual([
      "card",
      "narrator",
      "conversation",
    ]);
    expect(
      result.segments.some((segment) => segment.source.kind === "participant"),
    ).toBe(false);
  });

  it("assembles world-only cards and recursively activated lore", () => {
    const lore = worldbook([
      entry("bell", ["bell"], "The bell reveals a tide mark."),
      entry("tide", ["tide"], "The tide mark points north.", {
        recursion: false,
        order: 1,
      }),
    ]);
    const result = assemblePrompt({
      card: card("world", [], {
        description: "",
        scenario: "",
        worldDescription: "An empty archipelago.",
      }),
      conversation: conversation([]),
      worldbooks: [lore],
      currentInput: "Ring the bell.",
    });

    expect(
      result.trace.matchedWorldbookEntries.map((match) => [
        match.entry.id,
        match.depth,
      ]),
    ).toEqual([
      ["bell", 0],
      ["tide", 1],
    ]);
    expect(
      result.segments.some((segment) => segment.source.kind === "participant"),
    ).toBe(false);
    expect(
      renderTextPrompt(result.segments, {
        includeRolePrefixes: false,
        separator: "\n---\n",
      }),
    ).toContain("An empty archipelago.");
  });

  it("applies prompt and universal regexes by placement and newest-first depth", () => {
    const executionMarker = "__stnPromptAssemblyExecuted";
    delete (globalThis as unknown as Record<string, unknown>)[executionMarker];

    const result = assemblePrompt({
      messages: [
        message("m1", 0, "assistant", "assistant-old", "Model"),
        message("m2", 1, "user", "user-old", "Lin"),
      ],
      currentInput: "user-current",
      regexScripts: [
        regexScript("assistant-depth-two", {
          findRegex: "assistant-old",
          replaceString: "assistant-filtered",
          placement: [2],
          minDepth: 2,
          maxDepth: 2,
          sourceIndex: 0,
        }),
        regexScript("user-depth-one", {
          findRegex: "user-old",
          replaceString: "user-history-filtered",
          placement: [1],
          promptOnly: false,
          minDepth: 1,
          maxDepth: 1,
          sourceIndex: 1,
        }),
        regexScript("user-depth-zero", {
          findRegex: "user-current",
          replaceString: "user-current-filtered",
          placement: [1],
          minDepth: 0,
          maxDepth: 0,
          sourceIndex: 2,
        }),
        regexScript("literal-html", {
          findRegex: "^",
          replaceString:
            "<script>globalThis.__stnPromptAssemblyExecuted=true</script>",
          placement: [1],
          minDepth: 0,
          maxDepth: 0,
          sourceIndex: 3,
        }),
        regexScript("markdown-does-not-touch-prompt", {
          findRegex: "user-current-filtered",
          replaceString: "wrong-target",
          placement: [1],
          markdownOnly: true,
          promptOnly: false,
          minDepth: 0,
          maxDepth: 0,
          sourceIndex: 4,
        }),
      ],
    });

    const bySourceId = new Map(
      result.segments.map((segment) => [segment.source.id, segment]),
    );
    expect(bySourceId.get("m1")?.content).toBe("assistant-filtered");
    expect(bySourceId.get("m2")?.content).toBe("user-history-filtered");
    expect(
      result.segments.find((segment) => segment.source.kind === "conversation")
        ?.content,
    ).toBe(
      "<script>globalThis.__stnPromptAssemblyExecuted=true</script>user-current-filtered",
    );
    expect(
      (globalThis as unknown as Record<string, unknown>)[executionMarker],
    ).toBeUndefined();
  });

  it("inserts at-depth lore at history boundaries with its provider role", () => {
    const lore = worldbook([
      entry("depth-zero-later", [], "depth-zero-later TOKEN", {
        constant: true,
        insertionPosition: "at-depth",
        insertionDepth: 0,
        insertionRole: "assistant",
        order: 2,
      }),
      entry("depth-zero", [], "depth-zero TOKEN", {
        constant: true,
        insertionPosition: "at-depth",
        insertionDepth: 0,
        insertionRole: "assistant",
        order: 0,
      }),
      entry("depth-one", [], "depth-one TOKEN", {
        constant: true,
        insertionPosition: "at-depth",
        insertionDepth: 1,
        insertionRole: "user",
        order: 1,
      }),
    ]);
    const result = assemblePrompt({
      worldbooks: [lore],
      messages: [
        message("m1", 0, "assistant", "First.", "Model"),
        message("m2", 1, "user", "Second.", "Lin"),
      ],
      currentInput: "Latest.",
      regexScripts: [
        regexScript("worldbook-prompt", {
          findRegex: "TOKEN",
          replaceString: "<strong>filtered</strong>",
          placement: [5],
        }),
      ],
    });

    expect(
      result.segments
        .filter((segment) => segment.position === "history")
        .map((segment) => [segment.source.id, segment.role, segment.content]),
    ).toEqual([
      ["m1", "assistant", "First."],
      ["m2", "user", "Second."],
      ["depth-one", "user", "depth-one <strong>filtered</strong>"],
      [undefined, "user", "Latest."],
      ["depth-zero", "assistant", "depth-zero <strong>filtered</strong>"],
      [
        "depth-zero-later",
        "assistant",
        "depth-zero-later <strong>filtered</strong>",
      ],
    ]);
    expect(
      renderChatPrompt(result.segments, {
        mergeAdjacent: false,
        mergeWorldbookAtDepth: true,
      }).at(-1)?.content,
    ).toBe(
      "depth-zero <strong>filtered</strong>\n\ndepth-zero-later <strong>filtered</strong>",
    );
  });

  it("maps non-depth worldbook insertion positions without creating speakers", () => {
    const positions: ReadonlyArray<
      readonly [WorldbookEntry["insertionPosition"], WorldbookEntry["position"]]
    > = [
      ["before-card", "before-card"],
      ["after-card", "after-card"],
      ["examples-top", "before-examples"],
      ["examples-bottom", "after-examples"],
      ["author-note-top", "before-history"],
      ["author-note-bottom", "after-history"],
    ];
    const result = assemblePrompt({
      worldbooks: [
        worldbook(
          positions.map(([insertionPosition], index) =>
            entry(`position-${String(index)}`, [], insertionPosition ?? "", {
              constant: true,
              insertionPosition,
              insertionRole: index === 0 ? "assistant" : "system",
              order: index,
            }),
          ),
        ),
      ],
      currentInput: "Continue.",
    });
    const actual = new Map(
      result.segments
        .filter((segment) => segment.source.kind === "worldbook")
        .map((segment) => [segment.source.id, segment]),
    );

    positions.forEach(([, expectedPosition], index) => {
      expect(actual.get(`position-${String(index)}`)?.position).toBe(
        expectedPosition,
      );
    });
    expect(actual.get("position-0")?.role).toBe("assistant");
  });

  it("expands activated named outlets only at matching prompt macros", () => {
    const result = assemblePrompt({
      preset: {
        id: "outlet-preset",
        name: "Outlet fixture",
        mode: "chat-completion",
        prompts: [
          {
            id: "outlet-prompt",
            name: "Outlet prompt",
            role: "system",
            content:
              "Before\n{{outlet::support}}\nMissing={{outlet::missing}}\nAfter",
            enabled: true,
            order: 0,
            systemPrompt: true,
            metadata: {},
          },
        ],
        generation: { stop: [], samplerOrder: [], additional: {} },
        extensions: {},
        createdAt: now,
        updatedAt: now,
      },
      worldbooks: [
        worldbook([
          entry("outlet-one", [], "First for {{user}}", {
            constant: true,
            insertionPosition: "outlet",
            outletName: "support",
            order: 1,
          }),
          entry("outlet-two", ["signal"], "Second", {
            insertionPosition: "outlet",
            outletName: "support",
            order: 2,
          }),
          entry("outlet-without-name", [], "Must not be injected", {
            constant: true,
            insertionPosition: "outlet",
            order: 3,
          }),
          entry("regular", [], "Regular segment", {
            constant: true,
            insertionPosition: "after-card",
            order: 4,
          }),
        ]),
      ],
      currentInput: "signal",
      userName: "Mira",
    });

    expect(
      result.segments.find((segment) => segment.source.id === "outlet-prompt")
        ?.content,
    ).toBe("Before\nFirst for Mira\n\nSecond\nMissing=\nAfter");
    expect(
      result.segments
        .filter((segment) => segment.source.kind === "worldbook")
        .map((segment) => segment.source.id),
    ).toEqual(["regular"]);
    expect(
      result.trace.matchedWorldbookEntries.map((match) => match.entry.id),
    ).toEqual(["outlet-one", "outlet-two", "outlet-without-name", "regular"]);
  });

  it("inserts persona and lore at their dynamic preset marker slots", () => {
    const preset: PromptPreset = {
      id: "marker-preset",
      name: "Clean-room marker preset",
      mode: "chat-completion",
      prompts: [
        {
          id: "personaDescription",
          name: "Persona description",
          role: "system",
          content: "",
          enabled: true,
          marker: "persona-description",
          order: 100,
          systemPrompt: false,
          metadata: { dynamicMarker: true },
        },
        {
          id: "prompt-101",
          name: "Prompt 101",
          role: "system",
          content: "Prompt 101",
          enabled: true,
          order: 101,
          systemPrompt: false,
          metadata: {},
        },
        {
          id: "prompt-102",
          name: "Prompt 102",
          role: "system",
          content: "Prompt 102",
          enabled: true,
          order: 102,
          systemPrompt: false,
          metadata: {},
        },
        {
          id: "worldInfoBefore",
          name: "World before",
          role: "user",
          content: "",
          enabled: true,
          marker: "world-before",
          order: 103,
          systemPrompt: false,
          metadata: { dynamicMarker: true },
        },
        {
          id: "prompt-104",
          name: "After world before",
          role: "system",
          content: "Prompt 104",
          enabled: true,
          order: 104,
          systemPrompt: false,
          metadata: {},
        },
        {
          id: "worldInfoAfter",
          name: "World after",
          role: "system",
          content: "",
          enabled: true,
          marker: "world-after",
          order: 105,
          systemPrompt: false,
          metadata: { dynamicMarker: true },
        },
        {
          id: "prompt-106",
          name: "After world after",
          role: "system",
          content: "Prompt 106",
          enabled: true,
          order: 106,
          systemPrompt: false,
          metadata: {},
        },
      ],
      generation: { stop: [], samplerOrder: [], additional: {} },
      extensions: {},
      createdAt: now,
      updatedAt: now,
    };
    const lore = worldbook([
      entry("before-10", [], "Lore before 10", {
        constant: true,
        insertionPosition: "before-card",
        insertionRole: "assistant",
        order: 10,
      }),
      entry("before-30", [], "Lore before 30", {
        constant: true,
        insertionPosition: "before-card",
        order: 30,
      }),
      entry("after-20", [], "Lore after 20", {
        constant: true,
        insertionPosition: "after-card",
        order: 20,
      }),
    ]);

    const result = assemblePrompt({
      preset,
      persona: "Persona at marker",
      worldbooks: [lore],
      currentInput: "Continue.",
    });

    expect(
      result.segments
        .filter((segment) => segment.position === "before-card")
        .map((segment) => segment.content),
    ).toEqual([
      "Persona at marker",
      "Prompt 101",
      "Prompt 102",
      "Lore before 10",
      "Lore before 30",
      "Prompt 104",
    ]);
    expect(
      result.segments
        .filter((segment) => segment.source.kind === "worldbook")
        .map((segment) => [segment.content, segment.role]),
    ).toEqual([
      ["Lore before 10", "user"],
      ["Lore before 30", "user"],
      ["Lore after 20", "system"],
    ]);
    expect(
      result.segments
        .filter((segment) => segment.position === "after-card")
        .map((segment) => segment.content),
    ).toEqual(["Lore after 20", "Prompt 106"]);
  });
});
