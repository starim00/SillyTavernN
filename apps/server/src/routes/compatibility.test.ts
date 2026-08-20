import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createServer, type ServerApplication } from "../app.js";

const applications: ServerApplication[] = [];

async function application(): Promise<ServerApplication> {
  const dataDirectory = await mkdtemp(
    path.join(tmpdir(), "stn-tavern-helper-"),
  );
  const created = await createServer({
    dataDirectory,
    databasePath: ":memory:",
    seedDevelopmentData: false,
  });
  applications.push(created);
  return created;
}

afterEach(async () => {
  await Promise.all(applications.splice(0).map(({ app }) => app.close()));
});

describe("native Tavern Helper compatibility routes", () => {
  it("persists the native workbench settings and global scripts", async () => {
    const server = await application();
    const card = server.context.store.createCard({
      id: "card-helper-workbench",
      kind: "character",
      name: "Workbench fixture",
    }).card;
    const conversation = server.context.store.createConversation({
      id: "conversation-helper-workbench",
      title: "Workbench",
      cardId: card.id,
    });
    const settings = {
      render: {
        enabled: true,
        depth: 12,
        ignoreHiddenMessages: true,
        collapseCodeBlocks: "all",
        allowBlobUrls: true,
        syntaxHighlighting: false,
        cleanupProtection: true,
        streaming: true,
      },
      optimize: {
        limitRenderedMessages: true,
        carryWorldbookOnCardUpdate: true,
        exportLatestWorldbook: true,
        recommendedWorldbookSettings: true,
        maximizePresetContext: false,
      },
      developer: {
        macrosEnabled: true,
        liveListenerEnabled: false,
        liveListenerUrl: "",
        liveListenerInterval: 1000,
        errorPopups: true,
      },
    };
    const savedSettings = await server.app.inject({
      method: "PUT",
      url: "/api/compatibility/tavern-helper/settings",
      payload: settings,
    });
    expect(savedSettings.statusCode).toBe(200);

    const savedScripts = await server.app.inject({
      method: "PUT",
      url: "/api/compatibility/tavern-helper/scripts",
      payload: {
        scope: "global",
        id: "global",
        scripts: [
          {
            id: "global-helper-script",
            name: "Global helper",
            content: "console.info('global helper');",
            info: "Created in the native workbench",
            declaredEnabled: true,
            enabled: true,
            buttonEnabled: false,
            buttons: [],
            data: {},
            sourcePath: "native:editor",
          },
        ],
      },
    });
    expect(savedScripts.statusCode).toBe(200);

    const granted = await server.app.inject({
      method: "PUT",
      url: "/api/compatibility/tavern-helper/grants",
      payload: { scope: "global", id: "global", granted: true },
    });
    expect(granted.statusCode).toBe(200);

    const loaded = await server.app.inject({
      method: "GET",
      url: `/api/compatibility/tavern-helper?conversationId=${conversation.id}`,
    });
    expect(loaded.statusCode).toBe(200);
    const loadedData = loaded.json<{
      data: {
        settings: { render: { depth: number; collapseCodeBlocks: string } };
        sources: Array<{
          scope: string;
          id: string;
          trusted: boolean;
          bundle: { scripts: Array<{ id: string; name: string }> };
        }>;
      };
    }>().data;
    expect(loadedData).toMatchObject({
      settings: { render: { depth: 12, collapseCodeBlocks: "all" } },
    });
    expect(
      loadedData.sources.find((source) => source.scope === "global"),
    ).toMatchObject({
      scope: "global",
      id: "global",
      trusted: true,
      bundle: {
        scripts: [{ id: "global-helper-script", name: "Global helper" }],
      },
    });
  });

  it("loads card scripts, grants the whole source, and persists scoped variables", async () => {
    const server = await application();
    const card = server.context.store.createCard({
      id: "card-helper-fixture",
      kind: "character",
      name: "Native helper fixture",
      legacyPayload: {
        normalized: {
          extensions: {
            tavern_helper: {
              scripts: [
                {
                  type: "script",
                  id: "script-helper-fixture",
                  name: "Clean-room helper script",
                  enabled: true,
                  content: "eventOn(getButtonEvent('Run'), () => undefined);",
                  info: "",
                  button: {
                    enabled: true,
                    buttons: [{ name: "Run", visible: true }],
                  },
                  data: { initial: true },
                },
              ],
              variables: { cardValue: 1 },
            },
          },
        },
      },
    }).card;
    const conversation = server.context.store.createConversation({
      id: "conversation-helper-fixture",
      title: "Helper compatibility",
      cardId: card.id,
    });
    const message = server.context.store.addUserMessage({
      id: "message-helper-fixture",
      conversationId: conversation.id,
      content: "Hello",
    });
    const worldbook = server.context.store.createWorldbook({
      id: "worldbook-helper-fixture",
      name: "Helper lore",
      source: "import",
      entries: [
        {
          id: "entry-helper-fixture",
          content: "Initial variable declaration",
          enabled: true,
          metadata: { label: "[InitVar]" },
        },
      ],
    });
    server.context.store.bindWorldbook({
      worldbookId: worldbook.id,
      scopeType: "card",
      scopeId: card.id,
    });

    const initial = await server.app.inject({
      method: "GET",
      url: `/api/compatibility/tavern-helper?conversationId=${conversation.id}`,
    });
    expect(initial.statusCode).toBe(200);
    expect((initial.json() as { data: unknown }).data).toMatchObject({
      sources: [
        {
          scope: "card",
          id: card.id,
          trusted: false,
          bundle: {
            scripts: [
              {
                id: "script-helper-fixture",
                enabled: true,
                buttonEnabled: true,
                buttons: [{ name: "Run", visible: true }],
              },
            ],
          },
        },
      ],
      worldbooks: [
        {
          id: worldbook.id,
          name: "Helper lore",
          bindings: [{ scopeType: "card", scopeId: card.id }],
          entries: [
            {
              id: "entry-helper-fixture",
              enabled: true,
              content: "Initial variable declaration",
            },
          ],
        },
      ],
      variables: {
        character: { cardValue: 1 },
        scripts: {
          "card:card-helper-fixture:script-helper-fixture": {
            initial: true,
          },
        },
      },
    });

    const granted = await server.app.inject({
      method: "PUT",
      url: "/api/compatibility/tavern-helper/grants",
      payload: { scope: "card", id: card.id, granted: true },
    });
    expect(granted.statusCode).toBe(200);
    expect(
      (granted.json() as { data: { granted: boolean } }).data.granted,
    ).toBe(true);

    const saved = await server.app.inject({
      method: "PUT",
      url: "/api/compatibility/tavern-helper/state",
      payload: {
        conversationId: conversation.id,
        namespace: "message",
        messageId: message.id,
        variables: { stat_data: { favor: 5 } },
      },
    });
    expect(saved.statusCode).toBe(200);
    const savedSettings = await server.app.inject({
      method: "PUT",
      url: "/api/compatibility/tavern-helper/state",
      payload: {
        conversationId: conversation.id,
        namespace: "extension",
        extensionId: "sillytavern",
        variables: { mvu_settings: { enabled: true } },
      },
    });
    expect(savedSettings.statusCode).toBe(200);

    const reloaded = await server.app.inject({
      method: "GET",
      url: `/api/compatibility/tavern-helper?conversationId=${conversation.id}`,
    });
    expect((reloaded.json() as { data: unknown }).data).toMatchObject({
      sources: [{ id: card.id, trusted: true }],
      variables: {
        messages: {
          [message.id]: { stat_data: { favor: 5 } },
        },
        extensions: {
          sillyTavern: { mvu_settings: { enabled: true } },
        },
      },
    });
  });

  it("keeps MVU message state isolated between conversations on one card", async () => {
    const server = await application();
    const card = server.context.store.createCard({
      id: "card-cross-conversation-state",
      kind: "character",
      name: "Cross-conversation state card",
    }).card;
    const first = server.context.store.createConversation({
      id: "conversation-cross-conversation-first",
      title: "First state conversation",
      cardId: card.id,
    });
    const firstMessage = server.context.store.addAssistantMessage({
      id: "message-cross-conversation-first",
      conversationId: first.id,
      content: "Opening",
    });
    server.context.store.setExtensionSetting(
      "stn.tavern-helper",
      `variables:message:${firstMessage.id}`,
      {
        initialized_lorebooks: { "Cross-conversation state card": [] },
        stat_data: { world: { day: 12 }, system: { created: true } },
      },
    );

    const second = server.context.store.createConversation({
      id: "conversation-cross-conversation-second",
      title: "New state conversation",
      cardId: card.id,
    });
    const response = await server.app.inject({
      method: "GET",
      url: `/api/compatibility/tavern-helper?conversationId=${second.id}`,
    });

    expect(response.statusCode).toBe(200);
    expect(
      (
        response.json() as {
          data: { variables: { character: unknown } };
        }
      ).data.variables.character,
    ).toEqual({});
  });

  it("returns the complete ordered message history for compatibility scripts", async () => {
    const server = await application();
    const card = server.context.store.createCard({
      id: "card-complete-helper-history",
      kind: "character",
      name: "Complete helper history card",
    }).card;
    const conversation = server.context.store.createConversation({
      id: "conversation-complete-helper-history",
      title: "Complete helper history",
      cardId: card.id,
    });
    const messageIds = Array.from({ length: 61 }, (_, index) => {
      const input = {
        id: `message-complete-helper-${String(index).padStart(2, "0")}`,
        conversationId: conversation.id,
        content: `Message ${String(index)}`,
        createdAt: new Date(Date.UTC(2026, 7, 20, 0, index)).toISOString(),
      };
      return index % 2 === 0
        ? server.context.store.addAssistantMessage(input).id
        : server.context.store.addUserMessage(input).id;
    });

    const response = await server.app.inject({
      method: "GET",
      url: `/api/compatibility/tavern-helper/history?conversationId=${conversation.id}`,
    });

    expect(response.statusCode).toBe(200);
    const history = (
      response.json() as {
        data: { id: string; role: string; content: string }[];
      }
    ).data;
    expect(history).toHaveLength(61);
    expect(history.map((message) => message.id)).toEqual(messageIds);
    expect(history[0]).toMatchObject({
      role: "assistant",
      content: "Message 0",
    });
    expect(history.at(-1)).toMatchObject({
      role: "assistant",
      content: "Message 60",
    });
  });

  it("rejects message-variable writes outside the active conversation", async () => {
    const server = await application();
    const card = server.context.store.createCard({
      id: "card-helper-boundary",
      kind: "character",
      name: "Boundary card",
    }).card;
    const first = server.context.store.createConversation({
      id: "conversation-helper-first",
      title: "First",
      cardId: card.id,
    });
    const second = server.context.store.createConversation({
      id: "conversation-helper-second",
      title: "Second",
      cardId: card.id,
    });
    const foreignMessage = server.context.store.addUserMessage({
      id: "message-helper-foreign",
      conversationId: second.id,
      content: "Foreign",
    });

    const response = await server.app.inject({
      method: "PUT",
      url: "/api/compatibility/tavern-helper/state",
      payload: {
        conversationId: first.id,
        namespace: "message",
        messageId: foreignMessage.id,
        variables: { invalid: true },
      },
    });
    expect(response.statusCode).toBe(400);
    expect(
      (response.json() as { error: { message: string } }).error.message,
    ).toContain("must belong to this conversation");
  });

  it("prepares trusted prompt messages with detached worldbook directives", async () => {
    const server = await application();
    const card = server.context.store.createCard({
      id: "card-prompt-template",
      kind: "character",
      name: "Prompt template card",
    }).card;
    const conversation = server.context.store.createConversation({
      id: "conversation-prompt-template",
      title: "Prompt template",
      cardId: card.id,
    });
    server.context.store.addUserMessage({
      conversationId: conversation.id,
      content: "Question",
    });
    server.context.store.persistAssistantGeneration({
      conversationId: conversation.id,
      content: "Answer",
      reasoningText: "Private provider reasoning",
      status: "complete",
      finishReason: "stop",
    });
    const worldbook = server.context.store.createWorldbook({
      id: "worldbook-prompt-template",
      name: "Template directives",
      source: "import",
      entries: [
        {
          id: "entry-prompt-template",
          content: "Injected <%= variables.value %>",
          enabled: false,
          metadata: { label: "[GENERATE:BEFORE]" },
        },
      ],
    });
    server.context.store.bindWorldbook({
      worldbookId: worldbook.id,
      scopeType: "card",
      scopeId: card.id,
    });
    server.context.store.setExtensionSetting(
      "stn.tavern-helper",
      `card:${card.id}`,
      true,
    );

    const response = await server.app.inject({
      method: "POST",
      url: "/api/compatibility/prompt-template/prepare",
      payload: {
        conversationId: conversation.id,
        connectionId: "fake",
      },
    });
    expect(response.statusCode).toBe(200);
    expect((response.json() as { data: unknown }).data).toMatchObject({
      enabled: true,
      directives: [
        {
          id: "entry-prompt-template",
          title: "[GENERATE:BEFORE]",
          enabled: false,
        },
      ],
    });
    const messages = (
      response.json() as {
        data: { messages: Array<Record<string, unknown>> };
      }
    ).data.messages;
    expect(messages.at(-1)).toEqual({
      role: "assistant",
      content: "Answer",
    });

    const generation = await server.app.inject({
      method: "POST",
      url: `/api/conversations/${conversation.id}/generate`,
      payload: {
        connectionId: "fake",
        messagesOverride: messages,
      },
    });
    expect(generation.statusCode).toBe(200);
  });
});
