import { describe, expect, it, vi } from "vitest";

import type { WorkspaceMessage } from "../domain/workspace";
import type { TavernHelperContext } from "./tavernHelperTypes";
import {
  appendAssistantStatusPlaceholder,
  createTavernHelperMessageView,
  resolveTavernHelperMessageVariables,
  shouldEnsureAssistantStatusPlaceholder,
  shouldReconcileOpeningMessageVariables,
  shouldSeedOpeningMessageVariables,
  TavernHelperRuntime,
  type TavernHelperRuntimeAdapter,
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
      swipe_id: 1,
      swipes_data: [{}, variables],
    });
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

  it("adds the status placeholder only to MVU assistant messages", () => {
    expect(
      shouldEnsureAssistantStatusPlaceholder(
        { role: "assistant", content: "[开始创建]" },
        { stat_data: { world: { day: 1 } } },
      ),
    ).toBe(true);
    expect(
      shouldEnsureAssistantStatusPlaceholder(
        { role: "user", content: "Continue" },
        { stat_data: { world: { day: 1 } } },
      ),
    ).toBe(false);
    expect(
      shouldEnsureAssistantStatusPlaceholder(
        {
          role: "assistant",
          content: "[开始创建]\n\n<StatusPlaceHolderImpl/>",
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

  it("seeds a new conversation opening from the card's inherited MVU state", () => {
    expect(
      shouldSeedOpeningMessageVariables({ role: "assistant" }, undefined, {
        stat_data: { world: { day: 12 } },
      }),
    ).toBe(true);
    expect(
      shouldSeedOpeningMessageVariables(
        { role: "assistant" },
        { stat_data: { world: { day: 1 } } },
        { stat_data: { world: { day: 12 } } },
      ),
    ).toBe(false);
    expect(
      shouldSeedOpeningMessageVariables({ role: "assistant" }, undefined, {
        unrelated: true,
      }),
    ).toBe(false);
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
