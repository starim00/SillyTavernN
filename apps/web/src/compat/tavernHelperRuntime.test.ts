import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { WorkspaceMessage } from "../domain/workspace";
import type { TavernHelperContext } from "./tavernHelperTypes";
import {
  appendAssistantStatusPlaceholder,
  createTavernHelperMessageView,
  resolveTavernHelperMessageVariables,
  resolveTavernHelperFrameMessageId,
  shouldEnsureAssistantStatusPlaceholder,
  shouldReparseAssistantVariables,
  shouldReconcileOpeningMessageVariables,
  tavernHelperConfirmResult,
  TavernHelperRuntime,
  type TavernHelperRuntimeAdapter,
  validateTavernHelperVariables,
} from "./tavernHelperRuntime";

const assistantMessage: WorkspaceMessage = {
  id: "message-assistant",
  conversationId: "conversation-runtime",
  role: "assistant",
  content: "Active response",
  createdLabel: "12:00",
  revision: 1,
  activeSwipeIndex: 1,
  swipes: [
    { id: "swipe-1", content: "First response" },
    { id: "swipe-2", content: "Active response" },
  ],
};

describe("Tavern Helper message compatibility", () => {
  it("isolates event listener failures and attributes them to their script", async () => {
    const statuses: Array<{
      errors: Array<{ scriptName: string; message: string }>;
    }> = [];
    const notify = vi.fn();
    let runtimeMessages: WorkspaceMessage[] = [];
    const persistedUserMessage: WorkspaceMessage = {
      id: "persisted-user",
      conversationId: "conversation-runtime",
      role: "user",
      content: "Test message",
      createdLabel: "12:01",
      revision: 1,
    };
    const source = {
      scope: "card" as const,
      id: "card-runtime",
      name: "Fixture card",
      revision: 1,
      trusted: true,
      bundle: {
        present: true,
        scripts: [
          {
            id: "failing-script",
            name: "Failing fixture",
            content: "export {};",
            info: "",
            declaredEnabled: true,
            enabled: true,
            buttonEnabled: false,
            buttons: [],
            data: {},
            sourcePath: "fixture",
          },
        ],
        variables: {},
        diagnostics: [],
      },
    };
    const context: TavernHelperContext = {
      conversation: {
        id: "conversation-runtime",
        cardId: source.id,
        presetId: null,
      },
      sources: [source],
      variables: {
        global: {},
        character: {},
        preset: {},
        chat: {},
        messages: {},
        scripts: {},
      },
    };
    const adapter: TavernHelperRuntimeAdapter = {
      connectionId: "provider-runtime",
      getMessages: () => runtimeMessages,
      createMessage: async () => {
        throw new Error("not used");
      },
      deleteMessage: async () => undefined,
      updateMessage: async (message) => message,
      refreshMessages: async () => {
        runtimeMessages = [persistedUserMessage];
        return runtimeMessages;
      },
      generate: async () => "",
      saveState: async () => undefined,
      onButtonsChanged: () => undefined,
      onStatusChanged: (status) => statuses.push(status),
      notify,
    };
    const runtime = new TavernHelperRuntime(context, adapter);
    const followingListener = vi.fn();
    const owner = {
      source,
      script: source.bundle.scripts[0]!,
      key: "card:card-runtime:failing-script",
    };
    const internal = runtime as unknown as {
      listeners: Map<
        string,
        Array<{
          listener: (...values: unknown[]) => unknown;
          owner: typeof owner;
          once: boolean;
          priority: number;
          sequence: number;
        }>
      >;
    };
    internal.listeners.set("message_sent", [
      {
        listener: () => {
          throw new Error("fixture listener failed");
        },
        owner,
        once: true,
        priority: 0,
        sequence: 0,
      },
      {
        listener: followingListener,
        owner,
        once: false,
        priority: 0,
        sequence: 1,
      },
    ]);

    await expect(runtime.emit("message_sent", 2)).resolves.toBeUndefined();

    expect(followingListener).toHaveBeenCalledWith(2);
    expect(statuses.at(-1)?.errors).toContainEqual(
      expect.objectContaining({
        scriptName: "Failing fixture",
        message: "fixture listener failed",
      }),
    );
    expect(notify).toHaveBeenCalledWith(
      "Failing fixture 处理 message_sent 事件失败：fixture listener failed",
      "warning",
    );
    expect(internal.listeners.get("message_sent")).toHaveLength(1);

    const refreshedListener = vi.fn((messageIndex: unknown) => {
      expect(runtimeMessages[Number(messageIndex)]?.id).toBe(
        persistedUserMessage.id,
      );
    });
    internal.listeners.set("message_sent", [
      {
        listener: refreshedListener,
        owner,
        once: false,
        priority: 0,
        sequence: 2,
      },
    ]);

    await expect(
      runtime.processUserMessage(persistedUserMessage.id),
    ).resolves.toBe(true);
    expect(refreshedListener).toHaveBeenCalledWith(0);

    const messageView = (
      runtime as unknown as {
        messageView: (
          message: WorkspaceMessage,
          messageId: number,
        ) => Record<string, unknown>;
      }
    ).messageView.bind(runtime);
    const firstView = messageView(persistedUserMessage, 0);
    const secondView = messageView({ ...persistedUserMessage, revision: 2 }, 0);
    expect(secondView).toBe(firstView);
    expect(secondView).toMatchObject({
      role: "user",
      is_user: true,
      is_system: false,
    });
  });

  it("resolves the old Tavern Helper iframe floor contract", () => {
    expect(resolveTavernHelperFrameMessageId("TH-message--12--0", -1)).toBe(12);
    expect(resolveTavernHelperFrameMessageId("TH-message--7--2_1", -1)).toBe(7);
    expect(resolveTavernHelperFrameMessageId("TH-script--card--state", 4)).toBe(
      4,
    );
  });

  it("returns Tavern Helper numeric results for native confirmations", () => {
    expect(tavernHelperConfirmResult(true)).toBe(1);
    expect(tavernHelperConfirmResult(false)).toBe(0);
  });

  it("exposes the assistant name and aligns variables with the active swipe", () => {
    const variables = { stat_data: { favor: 3 } };
    const view = createTavernHelperMessageView(
      assistantMessage,
      2,
      variables,
      "Fixture card",
    );

    expect(view).toMatchObject({
      message_id: 2,
      name: "Fixture card",
      role: "assistant",
      is_user: false,
      is_system: false,
      swipe_id: 1,
      swipes_data: [{}, variables],
    });
  });

  it("persists direct mutations made through the legacy chat projection", async () => {
    vi.stubGlobal("window", {
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      setTimeout: globalThis.setTimeout.bind(globalThis),
    });
    try {
      const message: WorkspaceMessage = {
        id: "message-cleanup-floor",
        conversationId: "conversation-runtime",
        role: "assistant",
        content: "Opening",
        createdLabel: "12:00",
        revision: 1,
      };
      const context: TavernHelperContext = {
        conversation: {
          id: "conversation-runtime",
          cardId: "card-runtime",
          presetId: null,
        },
        sources: [],
        variables: {
          global: {},
          character: {},
          preset: {},
          chat: {},
          messages: {
            [message.id]: { stat_data: { score: 10 } },
          },
          scripts: {},
        },
      };
      const saveState = vi.fn(async () => undefined);
      const adapter: TavernHelperRuntimeAdapter = {
        connectionId: "provider-runtime",
        getMessages: () => [message],
        createMessage: async () => message,
        deleteMessage: async () => undefined,
        updateMessage: async (current) => current,
        refreshMessages: async () => [message],
        generate: async () => "",
        saveState,
        onButtonsChanged: () => undefined,
        onStatusChanged: () => undefined,
        notify: () => undefined,
      };
      const runtime = new TavernHelperRuntime(context, adapter);
      const internal = runtime as unknown as {
        legacyChatView: (
          current: WorkspaceMessage,
          messageId: number,
        ) => ReturnType<typeof createTavernHelperMessageView> & {
          variables: Array<Record<string, unknown>>;
        };
        persistLegacyChatVariables: () => void;
      };

      const view = internal.legacyChatView(message, 0);
      view.variables[0]!.ignore_cleanup = true;
      internal.persistLegacyChatVariables();
      await runtime.flushPersistence();

      expect(context.variables.messages[message.id]).toEqual({
        stat_data: { score: 10 },
        ignore_cleanup: true,
      });
      expect(saveState).toHaveBeenCalledWith({
        namespace: "message",
        messageId: message.id,
        variables: {
          stat_data: { score: 10 },
          ignore_cleanup: true,
        },
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("accepts MVU initialization written through swipes_data", () => {
    const initialized = {
      initialized_lorebooks: { "Fixture lorebook": [100] },
      stat_data: { world: { time: "day one" } },
    };

    expect(
      resolveTavernHelperMessageVariables(
        { swipes_data: [{ stale: true }, initialized] },
        1,
      ),
    ).toEqual(initialized);
  });

  it("preserves the MVU envelope while applying a registered schema", () => {
    const variables = validateTavernHelperVariables(
      z.object({
        stat_data: z.object({ score: z.coerce.number() }),
      }),
      {
        initialized_lorebooks: { "Fixture lorebook": [100] },
        stat_data: { score: "5" },
        schema: { type: "object" },
        display_data: { score: 4 },
        delta_data: { score: 1 },
      },
    );

    expect(variables).toEqual({
      initialized_lorebooks: { "Fixture lorebook": [100] },
      stat_data: { score: 5 },
      schema: { type: "object" },
      display_data: { score: 4 },
      delta_data: { score: 1 },
    });
  });

  it("reparses only an unchanged assistant MVU floor missing its schema", () => {
    const baseline = { stat_data: { score: 10 } };
    expect(
      shouldReparseAssistantVariables(
        "Reply <UpdateVariable>+5</UpdateVariable>",
        { stat_data: { score: 10 } },
        baseline,
      ),
    ).toBe(true);
    expect(
      shouldReparseAssistantVariables(
        "Reply <UpdateVariable>+5</UpdateVariable>",
        { stat_data: { score: 15 } },
        baseline,
      ),
    ).toBe(false);
    expect(
      shouldReparseAssistantVariables(
        "Reply <UpdateVariable>+5</UpdateVariable>",
        { stat_data: { score: 10 }, schema: { type: "object" } },
        baseline,
      ),
    ).toBe(false);
    expect(
      shouldReparseAssistantVariables(
        "Reply <UpdateVariable>+5</UpdateVariable>",
        { stat_data: {}, schema: { type: "object" } },
        baseline,
      ),
    ).toBe(true);
  });

  it("falls back to Mvu.parseMessage for an unchanged new assistant floor", async () => {
    vi.stubGlobal("window", {
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      setTimeout: globalThis.setTimeout.bind(globalThis),
      Mvu: {
        parseMessage: async (
          _content: string,
          oldData: Record<string, unknown>,
        ) => ({
          ...structuredClone(oldData),
          stat_data: { score: 15 },
          schema: { type: "object" },
        }),
      },
    });
    const messages: WorkspaceMessage[] = [
      {
        id: "opening",
        conversationId: "conversation-runtime",
        role: "assistant",
        content: "Opening",
        createdLabel: "12:00",
        revision: 1,
      },
      {
        id: "user-floor",
        conversationId: "conversation-runtime",
        role: "user",
        content: "Continue",
        createdLabel: "12:01",
        revision: 1,
      },
      {
        id: "assistant-floor",
        conversationId: "conversation-runtime",
        role: "assistant",
        content: "Reply <UpdateVariable>+5</UpdateVariable>",
        createdLabel: "12:02",
        revision: 1,
      },
    ];
    const context: TavernHelperContext = {
      conversation: {
        id: "conversation-runtime",
        cardId: "card-runtime",
        presetId: null,
      },
      sources: [],
      variables: {
        global: {},
        character: {},
        preset: {},
        chat: {},
        messages: {
          opening: { stat_data: { score: 1 } },
          "user-floor": { stat_data: { score: 10 } },
          "assistant-floor": { stat_data: { score: 10 } },
        },
        scripts: {},
      },
    };
    const savedStates: Array<{
      messageId?: string;
      variables: Record<string, unknown>;
    }> = [];
    const adapter: TavernHelperRuntimeAdapter = {
      connectionId: "provider-runtime",
      getMessages: () => messages,
      createMessage: async () => {
        throw new Error("not used");
      },
      deleteMessage: async () => undefined,
      updateMessage: async (message, content) => {
        const index = messages.findIndex(({ id }) => id === message.id);
        const updated = { ...message, content, revision: message.revision + 1 };
        messages[index] = updated;
        return updated;
      },
      refreshMessages: async () => messages,
      generate: async () => "",
      saveState: async ({ messageId, variables }) => {
        savedStates.push({
          ...(messageId ? { messageId } : {}),
          variables: structuredClone(variables),
        });
      },
      onButtonsChanged: () => undefined,
      onStatusChanged: () => undefined,
      notify: () => undefined,
    };
    const runtime = new TavernHelperRuntime(context, adapter);
    (
      runtime as unknown as {
        variableSchemas: Map<string, z.ZodType>;
      }
    ).variableSchemas.set(
      "message:*",
      z.object({ stat_data: z.object({ score: z.number() }) }),
    );

    await expect(runtime.processAssistantMessage(2)).resolves.toBe(true);
    expect(context.variables.messages["assistant-floor"]).toEqual({
      stat_data: { score: 15 },
      schema: { type: "object" },
    });
    expect(messages[2]!.content).toContain("<StatusPlaceHolderImpl/>");
    expect(savedStates.at(-1)).toEqual({
      messageId: "assistant-floor",
      variables: {
        stat_data: { score: 15 },
        schema: { type: "object" },
      },
    });

    vi.unstubAllGlobals();
  });

  it("recognizes an MVU opening message left in a half-initialized state", () => {
    expect(
      shouldReconcileOpeningMessageVariables({
        initialized_lorebooks: { "Fixture lorebook": [] },
        stat_data: {},
        schema: "registered",
      }),
    ).toBe(true);
    expect(
      shouldReconcileOpeningMessageVariables({
        initialized_lorebooks: { "Fixture lorebook": [] },
        stat_data: { world: { day: 1 } },
      }),
    ).toBe(false);
    expect(shouldReconcileOpeningMessageVariables({ stat_data: {} })).toBe(
      false,
    );
  });

  it("does not add the status placeholder to the opening assistant message", () => {
    expect(
      shouldEnsureAssistantStatusPlaceholder(
        0,
        { role: "assistant", content: "[开始创建]" },
        { stat_data: { world: { day: 1 } } },
      ),
    ).toBe(false);
    expect(
      shouldEnsureAssistantStatusPlaceholder(
        0,
        { role: "assistant", content: "A regular opening message" },
        { stat_data: { world: { day: 1 } } },
      ),
    ).toBe(false);
  });

  it("adds the status placeholder only to later MVU assistant messages", () => {
    expect(
      shouldEnsureAssistantStatusPlaceholder(
        2,
        { role: "assistant", content: "Active response" },
        { stat_data: { world: { day: 1 } } },
      ),
    ).toBe(true);
    expect(
      shouldEnsureAssistantStatusPlaceholder(
        1,
        { role: "user", content: "Continue" },
        { stat_data: { world: { day: 1 } } },
      ),
    ).toBe(false);
    expect(
      shouldEnsureAssistantStatusPlaceholder(
        2,
        {
          role: "assistant",
          content: "Active response\n\n<StatusPlaceHolderImpl/>",
        },
        { stat_data: { world: { day: 1 } } },
      ),
    ).toBe(false);
    expect(appendAssistantStatusPlaceholder("[开始创建]")).toBe(
      "[开始创建]\n\n<StatusPlaceHolderImpl/>",
    );
    expect(
      appendAssistantStatusPlaceholder(
        "[开始创建]\n\n<StatusPlaceHolderImpl/>",
      ),
    ).toBe("[开始创建]\n\n<StatusPlaceHolderImpl/>");
  });

  it("rolls a Swipe back to the previous floor before applying its update", async () => {
    vi.stubGlobal("window", {
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      setTimeout: globalThis.setTimeout.bind(globalThis),
      Mvu: {
        parseMessage: async (
          content: string,
          oldData: Record<string, unknown>,
        ) => {
          const parsed = structuredClone(oldData);
          const statData = parsed.stat_data as { score: number };
          statData.score += content.includes("Second Swipe") ? 7 : 5;
          return parsed;
        },
      },
    });

    const messages: WorkspaceMessage[] = [
      {
        id: "opening",
        conversationId: "conversation-runtime",
        role: "assistant",
        content: "Opening\n\n<StatusPlaceHolderImpl/>",
        createdLabel: "12:00",
        revision: 1,
      },
      {
        id: "user-floor",
        conversationId: "conversation-runtime",
        role: "user",
        content: "Continue",
        createdLabel: "12:01",
        revision: 1,
      },
      {
        id: "swipe-floor",
        conversationId: "conversation-runtime",
        role: "assistant",
        content: "First Swipe <UpdateVariable>+5</UpdateVariable>",
        createdLabel: "12:02",
        revision: 2,
        activeSwipeIndex: 0,
        swipes: [
          {
            id: "swipe-a",
            content: "First Swipe <UpdateVariable>+5</UpdateVariable>",
          },
          {
            id: "swipe-b",
            content: "Second Swipe <UpdateVariable>+7</UpdateVariable>",
          },
        ],
      },
    ];
    const context: TavernHelperContext = {
      conversation: {
        id: "conversation-runtime",
        cardId: "card-runtime",
        presetId: null,
      },
      sources: [],
      variables: {
        global: {},
        character: {},
        preset: {},
        chat: {},
        messages: {
          opening: { stat_data: { score: 1 } },
          "user-floor": { stat_data: { score: 10 } },
          "swipe-floor": { stat_data: { score: 99 } },
        },
        scripts: {},
      },
    };
    const savedStates: Array<{
      messageId?: string;
      variables: Record<string, unknown>;
    }> = [];
    const adapter: TavernHelperRuntimeAdapter = {
      connectionId: "provider-runtime",
      getMessages: () => messages,
      createMessage: async () => {
        throw new Error("not used");
      },
      deleteMessage: async () => undefined,
      updateMessage: async (message, content) => {
        const index = messages.findIndex(
          (candidate) => candidate.id === message.id,
        );
        const updated: WorkspaceMessage = {
          ...message,
          content,
          revision: message.revision + 1,
          ...(message.swipes
            ? {
                swipes: message.swipes.map((swipe, swipeIndex) =>
                  swipeIndex === (message.activeSwipeIndex ?? 0)
                    ? { ...swipe, content }
                    : swipe,
                ),
              }
            : {}),
        };
        messages[index] = updated;
        return updated;
      },
      refreshMessages: async () => messages,
      generate: async () => "",
      saveState: async ({ messageId, variables }) => {
        savedStates.push({
          ...(messageId ? { messageId } : {}),
          variables: structuredClone(variables),
        });
      },
      onButtonsChanged: () => undefined,
      onStatusChanged: () => undefined,
      notify: () => undefined,
    };
    const runtime = new TavernHelperRuntime(context, adapter);
    const originalEmit = runtime.emit.bind(runtime);
    const eventSnapshots: Array<{ event: string; score: number }> = [];
    vi.spyOn(runtime, "emit").mockImplementation(async (event, ...values) => {
      const variables = context.variables.messages["swipe-floor"]!;
      const statData = variables.stat_data as { score: number };
      eventSnapshots.push({ event, score: statData.score });
      await originalEmit(event, ...values);
    });

    await expect(runtime.processAssistantSwipe(2, "swipe-a")).resolves.toBe(
      true,
    );
    expect(eventSnapshots.slice(0, 2)).toEqual([
      { event: "message_swiped", score: 10 },
      { event: "character_message_rendered", score: 15 },
    ]);
    expect(
      eventSnapshots.some(({ event }) => event === "message_received"),
    ).toBe(false);
    expect(
      (
        context.variables.messages["swipe-floor"]!.stat_data as {
          score: number;
        }
      ).score,
    ).toBe(15);
    expect(messages[2]!.content).toContain("<StatusPlaceHolderImpl/>");
    expect(savedStates.at(-1)).toEqual({
      messageId: "swipe-floor",
      variables: { stat_data: { score: 15 } },
    });

    messages[2] = {
      ...messages[2]!,
      content: "Second Swipe <UpdateVariable>+7</UpdateVariable>",
      activeSwipeIndex: 1,
      revision: messages[2]!.revision + 1,
      ...(messages[2]!.swipes
        ? {
            swipes: messages[2]!.swipes.map((swipe, index) =>
              index === 1
                ? {
                    ...swipe,
                    content: "Second Swipe <UpdateVariable>+7</UpdateVariable>",
                  }
                : swipe,
            ),
          }
        : {}),
    };
    eventSnapshots.length = 0;

    await expect(runtime.processAssistantSwipe(2, "swipe-b")).resolves.toBe(
      true,
    );
    expect(eventSnapshots.slice(0, 2)).toEqual([
      { event: "message_swiped", score: 10 },
      { event: "character_message_rendered", score: 17 },
    ]);
    expect(
      eventSnapshots.some(({ event }) => event === "message_received"),
    ).toBe(false);
    expect(
      (
        context.variables.messages["swipe-floor"]!.stat_data as {
          score: number;
        }
      ).score,
    ).toBe(17);
    expect(savedStates.at(-1)).toEqual({
      messageId: "swipe-floor",
      variables: { stat_data: { score: 17 } },
    });

    vi.unstubAllGlobals();
  });
});
