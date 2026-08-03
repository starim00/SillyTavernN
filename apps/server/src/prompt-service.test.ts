import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  JsonObject,
  PromptPreset,
  ProviderCapabilities,
  ProviderEvent,
} from "@stn/contracts";
import type {
  ConnectionTestResult,
  ModelProvider,
  ProviderModel,
  ProviderRequest,
} from "@stn/providers";
import type { BindingScope } from "@stn/storage";

import { createServer, type ServerApplication } from "./app.js";
import {
  prepareConversationPrompt,
  type PreparedConversationPrompt,
} from "./prompt-service.js";

const applications: ServerApplication[] = [];
const now = "2026-07-29T00:00:00.000Z";

function jsonObject(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

async function application() {
  const dataDirectory = await mkdtemp(path.join(tmpdir(), "stn-prompt-"));
  const created = await createServer({
    dataDirectory,
    databasePath: ":memory:",
    seedDevelopmentData: false,
  });
  applications.push(created);
  return created;
}

class CapturingProvider implements ModelProvider {
  readonly id = "capturing-provider";
  readonly requests: ProviderRequest[] = [];

  capabilities(): ProviderCapabilities {
    return {
      streaming: true,
      nativeToolCalling: false,
      reasoning: false,
      vision: false,
      maxContextTokens: 4_096,
    };
  }

  testConnection(): Promise<ConnectionTestResult> {
    return Promise.resolve({ ok: true, model: "capture", latencyMs: 0 });
  }

  listModels(): Promise<readonly ProviderModel[]> {
    return Promise.resolve([{ id: "capture", name: "Capture", metadata: {} }]);
  }

  countTokens(input: string | readonly { content: string }[]): Promise<number> {
    const text =
      typeof input === "string"
        ? input
        : input.map((message) => message.content).join("\n");
    return Promise.resolve(Math.ceil(text.length / 4));
  }

  async *generate(request: ProviderRequest): AsyncIterable<ProviderEvent> {
    this.requests.push(request);
    yield {
      type: "start",
      requestId: request.requestId,
      sequence: 0,
      model: "capture",
      capabilities: this.capabilities(),
    };
    yield {
      type: "text-delta",
      requestId: request.requestId,
      sequence: 1,
      delta: "assembled response",
    };
    yield {
      type: "finish",
      requestId: request.requestId,
      sequence: 2,
      reason: "stop",
    };
  }
}

async function richWorkspace(applicationValue: ServerApplication) {
  const { context } = applicationValue;
  const imported = context.imports.importCard(
    JSON.stringify({
      spec: "chara_card_v3",
      spec_version: "3.0",
      data: {
        id: "card-ensemble",
        name: "Ensemble card",
        kind: "ensemble",
        description: "CARD_DESCRIPTION with {{participants}}.",
        system_prompt: "CARD_SYSTEM_MARKER",
        participants: [
          {
            id: "participant-alpha",
            name: "Alpha",
            kind: "character",
            description: "Alpha profile",
          },
          {
            id: "participant-beta",
            name: "Beta",
            kind: "character",
            description: "Beta profile",
          },
        ],
        narrator: {
          id: "participant-narrator",
          name: "Scene Voice",
          kind: "narrator",
          description: "Narrates the shared world",
        },
      },
    }),
  );
  const conversation = context.store.createConversation({
    id: "conversation-ensemble",
    title: "A shared scene",
    cardId: imported.card.id,
  });
  context.store.addUserMessage({
    id: "message-user",
    conversationId: conversation.id,
    content: "The signal opens the map.",
  });
  context.store.addAssistantMessage({
    id: "message-alpha",
    conversationId: conversation.id,
    participantId: "participant-alpha",
    content: "Alpha asks Beta and the narrator to look closer.",
  });

  const createBoundWorldbook = (
    id: string,
    scopeType: BindingScope,
    scopeId?: string,
  ) => {
    const worldbook = context.store.createWorldbook({
      id: `worldbook-${id}`,
      name: `${id} lore`,
      entries: [
        {
          id: `entry-${id}`,
          keys: ["signal"],
          content: `LORE_${id.toUpperCase()}`,
          metadata: {
            label: `${id} entry`,
            promptPosition: "before-history",
            priority: 10,
          },
        },
      ],
    });
    context.store.bindWorldbook({
      worldbookId: worldbook.id,
      scopeType,
      ...(scopeId === undefined ? {} : { scopeId }),
    });
    return worldbook.id;
  };

  const worldbookIds = [
    createBoundWorldbook("global", "global"),
    createBoundWorldbook("card", "card", imported.card.id),
    createBoundWorldbook("conversation", "conversation", conversation.id),
    createBoundWorldbook("participant", "participant", "participant-beta"),
  ];

  const preset: PromptPreset = {
    id: "preset-assembled",
    name: "Assembled preset",
    mode: "chat-completion",
    prompts: [
      {
        id: "prompt-main",
        name: "Main instruction",
        role: "system",
        content: "PRESET_MARKER",
        enabled: true,
        marker: "main",
        order: 0,
        systemPrompt: true,
        metadata: {},
      },
      {
        id: "prompt-optional",
        name: "Optional instruction",
        role: "system",
        content: "DISABLED_PRESET_MARKER",
        enabled: false,
        order: 1,
        systemPrompt: false,
        metadata: {},
      },
    ],
    generation: {
      temperature: 0.8,
      maxOutputTokens: 333,
      stop: ["PRESET_STOP"],
      samplerOrder: [],
      additional: { presetFlag: true },
    },
    extensions: {},
    createdAt: now,
    updatedAt: now,
  };
  context.store.createPreset({
    id: preset.id,
    name: preset.name,
    kind: preset.mode,
    payload: jsonObject(preset),
  });

  return { conversation, preset, worldbookIds };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(applications.splice(0).map(({ app }) => app.close()));
});

describe("server prompt integration", () => {
  it("uses the active user persona for prompt text and persona-scoped lore", async () => {
    const created = await application();
    const { context } = created;
    const persona = context.store.createPersona({
      id: "persona-prompt",
      name: "Mira",
      description: "{{user}} checks every clue before acting.",
      isDefault: true,
    });
    const card = context.store.createCard({
      id: "card-persona-prompt",
      kind: "character",
      name: "Persona prompt card",
    }).card;
    const conversation = context.store.createConversation({
      id: "conversation-persona-prompt",
      title: "Persona prompt conversation",
      cardId: card.id,
    });
    const worldbook = context.store.createWorldbook({
      id: "worldbook-persona-prompt",
      name: "Persona lore",
      entries: [
        {
          id: "entry-persona-prompt",
          content: "PERSONA_LORE",
          metadata: { constant: true },
        },
      ],
    });
    context.store.bindWorldbook({
      worldbookId: worldbook.id,
      scopeType: "persona",
      scopeId: persona.id,
    });

    const prompt = await prepareConversationPrompt(context.store, {
      conversationId: conversation.id,
    });

    const personaSegment = prompt.segments.find(
      (segment) =>
        segment.source.kind === "persona" && segment.source.id === persona.id,
    );
    expect(personaSegment?.content).toBe(
      "Mira checks every clue before acting.",
    );
    expect(
      prompt.segments.some((segment) => segment.content === "PERSONA_LORE"),
    ).toBe(true);
  });

  it("adapts an ensemble, narrator, all binding scopes, preset and generation overrides", async () => {
    const created = await application();
    const fixture = await richWorkspace(created);
    const prompt = await prepareConversationPrompt(created.context.store, {
      conversationId: fixture.conversation.id,
      presetId: fixture.preset.id,
      settings: { temperature: 0.25, topP: 0.7 },
      maxContextTokens: 4_096,
    });

    expect(prompt.generation).toMatchObject({
      temperature: 0.25,
      topP: 0.7,
      maxOutputTokens: 333,
      stop: ["PRESET_STOP"],
      additional: { presetFlag: true },
    });
    expect(prompt.trace.availableTokens).toBe(4_096 - 333);
    expect(
      prompt.trace.matchedWorldbookEntries.map((match) => match.worldbookId),
    ).toEqual([...fixture.worldbookIds].sort());
    expect(
      prompt.segments
        .filter((segment) => segment.source.kind === "participant")
        .map((segment) => segment.source.label),
    ).toEqual(["Alpha", "Beta"]);
    expect(
      prompt.segments.filter((segment) => segment.source.kind === "narrator"),
    ).toHaveLength(1);
    expect(prompt.textPrompt).toContain("PRESET_MARKER");
    expect(prompt.textPrompt).not.toContain("DISABLED_PRESET_MARKER");
    expect(prompt.textPrompt).toContain("CARD_SYSTEM_MARKER");
    for (const scope of ["GLOBAL", "CARD", "CONVERSATION", "PARTICIPANT"]) {
      expect(prompt.textPrompt).toContain(`LORE_${scope}`);
    }
    expect(
      prompt.messages.map((message) => message.content).join("\n"),
    ).toContain("Alpha profile");
    expect(
      prompt.messages.map((message) => message.content).join("\n"),
    ).toContain("Beta profile");
  });

  it("returns preview trace and sends assembled chat/text prompts to the provider", async () => {
    const created = await application();
    const fixture = await richWorkspace(created);
    const provider = new CapturingProvider();
    vi.spyOn(created.context.providers, "get").mockResolvedValue(provider);

    const previewResponse = await created.app.inject({
      method: "POST",
      url: `/api/conversations/${fixture.conversation.id}/prompt-preview`,
      payload: {
        connectionId: "capture",
        presetId: fixture.preset.id,
        settings: { temperature: 0.15 },
      },
    });
    expect(previewResponse.statusCode).toBe(200);
    const preview = (
      previewResponse.json() as { data: PreparedConversationPrompt }
    ).data;
    expect(
      preview.segments.some(
        (segment) =>
          segment.source.kind === "preset" &&
          segment.content === "PRESET_MARKER",
      ),
    ).toBe(true);
    expect(preview.trace.matchedWorldbookEntries).toHaveLength(4);
    expect(preview.generation.temperature).toBe(0.15);

    const generationResponse = await created.app.inject({
      method: "POST",
      url: `/api/conversations/${fixture.conversation.id}/generate`,
      payload: {
        connectionId: "capture",
        presetId: fixture.preset.id,
        settings: { temperature: 0.15 },
      },
    });
    expect(generationResponse.statusCode).toBe(200);
    expect(generationResponse.body).toContain('"type":"message-persisted"');
    expect(provider.requests).toHaveLength(1);
    const request = provider.requests[0];
    expect(
      request?.messages.every((message) => message.name === undefined),
    ).toBe(true);
    expect(request?.settings).toMatchObject({
      temperature: 0.15,
      maxOutputTokens: 333,
    });
    const chatPrompt = request?.messages
      .map((message) => message.content)
      .join("\n");
    expect(chatPrompt).toContain("PRESET_MARKER");
    expect(chatPrompt).toContain("CARD_SYSTEM_MARKER");
    expect(chatPrompt).toContain("LORE_GLOBAL");
    expect(request?.textPrompt).toContain("PRESET_MARKER");
    expect(request?.textPrompt).toContain("LORE_PARTICIPANT");
    expect(request?.metadata).toMatchObject({
      conversationId: fixture.conversation.id,
      presetId: fixture.preset.id,
    });
  });

  it("assembles a zero-participant world-only conversation", async () => {
    const created = await application();
    const card = created.context.store.createCard({
      id: "card-world",
      kind: "world",
      name: "Empty archipelago",
      description: "WORLD_ONLY_DESCRIPTION",
      participants: [],
    }).card;
    const conversation = created.context.store.createConversation({
      id: "conversation-world",
      title: "World only",
      cardId: card.id,
    });
    created.context.store.addUserMessage({
      conversationId: conversation.id,
      content: "Describe the horizon.",
    });

    const prompt = await prepareConversationPrompt(created.context.store, {
      conversationId: conversation.id,
    });

    expect(
      prompt.segments.some(
        (segment) =>
          segment.source.kind === "participant" ||
          segment.source.kind === "narrator",
      ),
    ).toBe(false);
    expect(prompt.textPrompt).toContain("WORLD_ONLY_DESCRIPTION");
    expect(prompt.messages.some((message) => message.role === "user")).toBe(
      true,
    );
  });

  it("applies imported prompt regexes only after the card-scoped grant", async () => {
    const created = await application();
    const imported = created.context.imports.importCard(
      JSON.stringify({
        spec: "chara_card_v3",
        spec_version: "3.0",
        data: {
          id: "card-prompt-regex",
          name: "Prompt regex fixture",
          first_mes: "",
          extensions: {
            regex_scripts: [
              {
                id: "prompt-filter",
                scriptName: "Prompt filter",
                findRegex: "MODEL_RAW_TOKEN",
                replaceString: "MODEL_FILTERED_TOKEN",
                trimStrings: [],
                placement: [2],
                disabled: false,
                markdownOnly: false,
                promptOnly: true,
                runOnEdit: false,
                substituteRegex: 0,
                minDepth: null,
                maxDepth: null,
              },
            ],
          },
        },
      }),
    );
    const conversation = created.context.store.createConversation({
      id: "conversation-prompt-regex",
      title: "Prompt regex",
      cardId: imported.card.id,
    });
    created.context.store.addAssistantMessage({
      conversationId: conversation.id,
      content: "MODEL_RAW_TOKEN",
    });

    const denied = await prepareConversationPrompt(created.context.store, {
      conversationId: conversation.id,
    });
    expect(denied.textPrompt).toContain("MODEL_RAW_TOKEN");
    expect(denied.textPrompt).not.toContain("MODEL_FILTERED_TOKEN");

    created.context.store.setExtensionSetting(
      "stn.regex",
      `card:${imported.card.id}`,
      true,
    );
    const granted = await prepareConversationPrompt(created.context.store, {
      conversationId: conversation.id,
    });
    expect(granted.textPrompt).toContain("MODEL_FILTERED_TOKEN");
    expect(granted.textPrompt).not.toContain("MODEL_RAW_TOKEN");
  });

  it("uses the preset context limit without exceeding a provider limit", async () => {
    const created = await application();
    const fixture = await richWorkspace(created);
    const stored = created.context.store.getPreset(fixture.preset.id);
    created.context.store.updatePreset({
      id: stored.id,
      expectedRevision: stored.revision,
      patch: {
        payload: jsonObject({
          ...fixture.preset,
          generation: {
            ...fixture.preset.generation,
            additional: { maxContextTokens: 2_000_000 },
          },
        }),
      },
    });

    const presetLimited = await prepareConversationPrompt(
      created.context.store,
      {
        conversationId: fixture.conversation.id,
        presetId: fixture.preset.id,
      },
    );
    expect(presetLimited.trace.availableTokens).toBe(2_000_000 - 333);

    const providerLimited = await prepareConversationPrompt(
      created.context.store,
      {
        conversationId: fixture.conversation.id,
        presetId: fixture.preset.id,
        maxContextTokens: 4_096,
      },
    );
    expect(providerLimited.trace.availableTokens).toBe(4_096 - 333);
  });
});
