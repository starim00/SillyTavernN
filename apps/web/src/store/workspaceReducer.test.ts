import { afterEach, describe, expect, it, vi } from "vitest";
import { createDemoWorkspace } from "../data/demoWorkspace";
import type { RegexScope } from "../domain/workspace";
import { loadWorkspaceState, workspaceReducer } from "./workspaceReducer";

describe("workspaceReducer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("models the ordinary chat stream as user input and model replies only", () => {
    const state = createDemoWorkspace();
    const messages = Object.values(state.messagesByConversation).flat();
    const defaultConversation = state.conversations.find(
      (conversation) => conversation.id === state.selectedConversationId,
    );

    expect(new Set(messages.map((message) => message.role))).toEqual(
      new Set(["user", "assistant"]),
    );
    expect(defaultConversation?.cardId).toBe("world-fog-harbor");
    expect(defaultConversation).not.toHaveProperty("participantIds");
    expect(
      state.messagesByConversation["conversation-harbor"]?.[0]?.content,
    ).toContain("港务员");
  });

  it("starts the card-first flow instead of migrating old v2 navigation", () => {
    const state = createDemoWorkspace();
    const worldbooksWithoutEntries = state.worldbooks.map((worldbook) =>
      Object.fromEntries(
        Object.entries(worldbook).filter(([key]) => key !== "entries"),
      ),
    );
    vi.stubGlobal("window", {
      localStorage: {
        getItem: vi.fn(() =>
          JSON.stringify({
            version: 2,
            data: {
              worldbooks: worldbooksWithoutEntries,
            },
          }),
        ),
      },
    });

    const hydrated = loadWorkspaceState();

    expect(hydrated.selectedCardId).toBe("");
    expect(hydrated.selectedConversationId).toBe("");
    expect(hydrated.worldbooks).toEqual(state.worldbooks);
  });

  it("hydrates v3 worldbook entries saved before recall fields were added", () => {
    const state = createDemoWorkspace();
    const worldbook = state.worldbooks[0]!;
    const entry = worldbook.entries[0]!;
    vi.stubGlobal("window", {
      localStorage: {
        getItem: vi.fn(() =>
          JSON.stringify({
            version: 3,
            data: {
              worldbooks: [
                {
                  ...worldbook,
                  entries: [
                    {
                      id: entry.id,
                      title: entry.title,
                      keys: ["旧港", "钟楼"],
                      content: entry.content,
                      agentEditable: false,
                      revision: entry.revision,
                    },
                  ],
                },
              ],
            },
          }),
        ),
      },
    });

    const hydrated = loadWorkspaceState();

    expect(hydrated.worldbooks[0]?.entries[0]).toMatchObject({
      primaryKeys: ["旧港", "钟楼"],
      secondaryKeys: [],
      enabled: true,
      constant: false,
      insertionPosition: null,
      outletName: null,
      insertionRole: "system",
      order: 0,
    });
  });

  it("clears stale conversation and preset selections for an empty API workspace", () => {
    const state = createDemoWorkspace();

    const next = workspaceReducer(state, {
      type: "bootstrap/api",
      payload: {
        conversations: [],
        cards: [],
        participants: [],
        messagesByConversation: {},
        worldbooks: [],
        presets: [],
        regexScopes: [],
        providerConnections: [],
      },
    });

    expect(next.selectedConversationId).toBe("");
    expect(next.selectedPresetId).toBe("");
  });

  it("replaces a preset after one prompt is enabled or edited", () => {
    const state = createDemoWorkspace();
    const preset = state.presets[0]!;
    const optionalPrompt = preset.prompts.find((prompt) => !prompt.enabled)!;
    const updatedPreset = {
      ...preset,
      revision: preset.revision + 1,
      prompts: preset.prompts.map((prompt) =>
        prompt.id === optionalPrompt.id
          ? { ...prompt, enabled: true, content: "用户编辑后的可选正文" }
          : prompt,
      ),
    };

    const next = workspaceReducer(state, {
      type: "preset/replace",
      preset: updatedPreset,
    });

    expect(next.presets[0]?.revision).toBe(preset.revision + 1);
    expect(
      next.presets[0]?.prompts.find(
        (prompt) => prompt.id === optionalPrompt.id,
      ),
    ).toMatchObject({
      enabled: true,
      content: "用户编辑后的可选正文",
    });
  });

  it("replaces only the matching regex scope and appends a new scope", () => {
    const state = createDemoWorkspace();
    const globalScope: RegexScope = {
      scope: "global",
      id: "global",
      name: "全局正则",
      enabled: true,
      revision: 1,
      ownerRevision: null,
      scripts: [],
      diagnostics: [],
      updatedAt: null,
    };
    const cardScope: RegexScope = {
      scope: "card",
      id: "card-1",
      name: "角色卡正则",
      enabled: false,
      revision: 2,
      ownerRevision: 7,
      scripts: [],
      diagnostics: [],
      updatedAt: null,
    };
    const withScopes = {
      ...state,
      regexScopes: [globalScope, cardScope],
    };
    const enabledCardScope: RegexScope = {
      ...cardScope,
      enabled: true,
      revision: 3,
      updatedAt: "2026-07-30T03:04:05.000Z",
    };

    const replaced = workspaceReducer(withScopes, {
      type: "regexScope/replace",
      scope: enabledCardScope,
    });

    expect(replaced.regexScopes).toEqual([globalScope, enabledCardScope]);
    expect(replaced.regexScopes).toHaveLength(2);

    const presetScope: RegexScope = {
      scope: "preset",
      id: "preset-1",
      name: "预设正则",
      enabled: false,
      revision: 0,
      ownerRevision: 4,
      scripts: [],
      diagnostics: [],
      updatedAt: null,
    };
    const appended = workspaceReducer(replaced, {
      type: "regexScope/replace",
      scope: presetScope,
    });

    expect(appended.regexScopes).toEqual([
      globalScope,
      enabledCardScope,
      presetScope,
    ]);
  });

  it("switches between conversations only inside the selected card", () => {
    const base = createDemoWorkspace();
    const state = {
      ...base,
      conversations: [
        ...base.conversations,
        {
          ...base.conversations[0]!,
          id: "conversation-harbor-second",
          title: "雾港 · 第二次调查",
        },
      ],
    };
    const next = workspaceReducer(state, {
      type: "conversation/select",
      id: "conversation-harbor-second",
    });

    expect(next.selectedConversationId).toBe("conversation-harbor-second");
    expect(next.selectedCardId).toBe("world-fog-harbor");
    expect(next.agentProposal).toBeNull();
    expect(next.agentRun).toBeNull();
  });

  it("refuses to select a conversation from another card", () => {
    const state = createDemoWorkspace();
    const next = workspaceReducer(state, {
      type: "conversation/select",
      id: "conversation-archive",
    });

    expect(next).toBe(state);
    expect(next.selectedConversationId).toBe("conversation-harbor");
  });

  it("opens the most recent conversation when entering another role card", () => {
    const state = createDemoWorkspace();
    const next = workspaceReducer(state, {
      type: "card/select",
      id: "world-drifting-archive",
    });

    expect(next.selectedCardId).toBe("world-drifting-archive");
    expect(next.selectedConversationId).toBe("conversation-archive");
    expect(next.modal).toEqual({ kind: "closed" });
  });

  it("updates only the selected worldbook entry permission", () => {
    const state = createDemoWorkspace();
    const worldbook = state.worldbooks[0]!;
    const target = worldbook.entries[0]!;
    const untouched = worldbook.entries[1]!;
    const otherWorldbook = state.worldbooks[1]!;

    const next = workspaceReducer(state, {
      type: "worldbook/entry-permission",
      worldbookId: worldbook.id,
      worldbookRevision: worldbook.revision + 1,
      entry: {
        ...target!,
        agentEditable: true,
        revision: target!.revision + 1,
      },
    });

    const updatedWorldbook = next.worldbooks.find(
      (candidate) => candidate.id === worldbook.id,
    );
    expect(updatedWorldbook?.revision).toBe(worldbook.revision + 1);
    expect(updatedWorldbook?.entries[0]).toMatchObject({
      id: target.id,
      agentEditable: true,
      revision: target.revision + 1,
    });
    expect(updatedWorldbook?.entries[1]).toEqual(untouched);
    expect(next.worldbooks[1]).toEqual(otherWorldbook);
  });

  it("re-evaluates only the entry targeted by an update proposal", () => {
    const state = createDemoWorkspace();
    const worldbook = state.worldbooks[0]!;
    const unrelatedEntry = worldbook.entries[0]!;
    const targetEntry = worldbook.entries[1]!;
    state.agentProposal = {
      ...state.agentProposal!,
      worldbookId: worldbook.id,
      worldbookName: worldbook.name,
      toolName: "worldbook.entry.update",
      toolArguments: {
        worldbookId: worldbook.id,
        entryId: targetEntry.id,
        expectedRevision: worldbook.revision,
        expectedEntryRevision: targetEntry.revision,
        patch: { content: "更新" },
      },
      targetEntryId: targetEntry.id,
      targetEntryTitle: targetEntry.title,
      beforeRevision: worldbook.revision,
      beforeEntryRevision: targetEntry.revision,
      status: "awaiting_confirmation",
    };

    const unrelatedChange = workspaceReducer(state, {
      type: "worldbook/entry-permission",
      worldbookId: worldbook.id,
      worldbookRevision: worldbook.revision + 1,
      entry: {
        ...unrelatedEntry,
        agentEditable: !unrelatedEntry.agentEditable,
        revision: unrelatedEntry.revision + 1,
      },
    });

    expect(unrelatedChange.agentProposal).toMatchObject({
      status: "awaiting_confirmation",
      beforeRevision: worldbook.revision + 1,
      beforeEntryRevision: targetEntry.revision,
      targetEntryId: targetEntry.id,
    });

    const targetChange = workspaceReducer(unrelatedChange, {
      type: "worldbook/entry-permission",
      worldbookId: worldbook.id,
      worldbookRevision: worldbook.revision + 2,
      entry: {
        ...targetEntry,
        agentEditable: false,
        revision: targetEntry.revision + 1,
      },
    });

    expect(targetChange.agentProposal).toMatchObject({
      status: "blocked",
      beforeRevision: worldbook.revision + 2,
      beforeEntryRevision: targetEntry.revision + 1,
      targetEntryId: targetEntry.id,
    });
  });

  it("surfaces a live model-tool proposal in its dedicated modal", () => {
    const state = createDemoWorkspace();
    const next = workspaceReducer(state, {
      type: "agent/proposed",
      proposal: {
        ...state.agentProposal!,
        id: "call-live",
        runId: "run-live",
      },
      run: {
        id: "run-live",
        conversationId: state.selectedConversationId,
        status: "waiting_confirmation",
        objective: "记录新事实",
        updatedAt: "2026-07-29T10:00:00.000Z",
      },
    });

    expect(next.agentProposal?.id).toBe("call-live");
    expect(next.agentRun?.status).toBe("waiting_confirmation");
    expect(next.modal).toEqual({ kind: "agent_proposal" });
    expect(next.expandedPanels).not.toHaveProperty("context");
    expect(next.expandedPanels).not.toHaveProperty("agent");
  });

  it("clears a rejected model-tool proposal without creating a separate run surface", () => {
    const state = createDemoWorkspace();
    state.agentRun = {
      id: "run-rejected",
      conversationId: state.selectedConversationId,
      status: "waiting_confirmation",
      objective: "待确认写入",
      updatedAt: "2026-07-29T10:00:00.000Z",
    };

    const next = workspaceReducer(state, { type: "agent/rejected" });

    expect(next.agentProposal).toBeNull();
    expect(next.agentRun).toBeNull();
    expect(next.expandedPanels).not.toHaveProperty("agent");
  });

  it("appends a message to only the selected conversation", () => {
    const state = createDemoWorkspace();
    const beforeOther = (
      state.messagesByConversation["conversation-glasshouse"] ?? []
    ).length;
    const next = workspaceReducer(state, {
      type: "message/append",
      message: {
        id: "message-test",
        conversationId: "conversation-harbor",
        role: "user",
        content: "测试消息",
        createdLabel: "10:30",
        revision: 5,
      },
    });

    expect(
      next.messagesByConversation["conversation-harbor"]?.at(-1)?.content,
    ).toBe("测试消息");
    expect(next.messagesByConversation["conversation-glasshouse"]).toHaveLength(
      beforeOther,
    );
  });

  it("creates a card-bound conversation without inventing a current character", () => {
    const state = createDemoWorkspace();
    const next = workspaceReducer(state, {
      type: "conversation/create",
      conversation: {
        id: "conversation-empty-world",
        title: "空岛记录",
        subtitle: "无固定参与者",
        cardId: "world-drifting-archive",
        worldbookIds: [],
        updatedLabel: "刚刚",
        unreadCount: 0,
        pinned: false,
      },
    });

    expect(next.selectedConversationId).toBe("conversation-empty-world");
    expect(next.conversations[0]).not.toHaveProperty("participantIds");
    expect(next.conversations[0]?.worldbookIds).toEqual(["worldbook-archive"]);
    expect(
      next.cards.find((card) => card.id === "world-drifting-archive")
        ?.conversationCount,
    ).toBe(
      (state.cards.find((card) => card.id === "world-drifting-archive")
        ?.conversationCount ?? 0) + 1,
    );
  });

  it("removes a conversation and selects the next history in the same card", () => {
    const state = createDemoWorkspace();
    const current = state.conversations.find(
      (conversation) => conversation.id === state.selectedConversationId,
    )!;
    const sibling = {
      ...current,
      id: "conversation-delete-sibling",
      title: "Sibling history",
    };
    const withSibling = workspaceReducer(state, {
      type: "conversation/create",
      conversation: sibling,
    });
    const withDraft = {
      ...withSibling,
      draftByConversation: {
        ...withSibling.draftByConversation,
        [current.id]: "stale draft",
      },
    };

    const deleted = workspaceReducer(withDraft, {
      type: "conversation/delete",
      id: current.id,
    });

    expect(deleted.selectedConversationId).toBe(sibling.id);
    expect(deleted.conversations.some(({ id }) => id === current.id)).toBe(
      false,
    );
    expect(deleted.messagesByConversation).not.toHaveProperty(current.id);
    expect(deleted.draftByConversation).not.toHaveProperty(current.id);
    expect(
      deleted.cards.find((card) => card.id === current.cardId)
        ?.conversationCount,
    ).toBe(
      state.cards.find((card) => card.id === current.cardId)?.conversationCount,
    );
  });

  it("edits, adds Swipe candidates, selects them, and deletes a message", () => {
    const state = createDemoWorkspace();
    const message = state.messagesByConversation["conversation-harbor"]?.[0];
    expect(message).toBeDefined();

    const edited = workspaceReducer(state, {
      type: "message/update",
      messageId: message!.id,
      content: "更新后的叙事",
    });
    const withSwipe = workspaceReducer(edited, {
      type: "message/swipe-add",
      messageId: message!.id,
      swipe: { id: "swipe-2", content: "第二个候选" },
    });
    const selected = workspaceReducer(withSwipe, {
      type: "message/swipe-select",
      messageId: message!.id,
      index: 0,
    });

    expect(
      withSwipe.messagesByConversation["conversation-harbor"]?.[0]?.swipes,
    ).toHaveLength(2);
    expect(
      selected.messagesByConversation["conversation-harbor"]?.[0]?.content,
    ).toBe("更新后的叙事");

    const deleted = workspaceReducer(selected, {
      type: "message/delete",
      messageId: message!.id,
    });
    expect(
      deleted.messagesByConversation["conversation-harbor"]?.some(
        (candidate) => candidate.id === message!.id,
      ),
    ).toBe(false);
  });

  it("keeps streamed text transient and drops it without appending a half message", () => {
    const state = createDemoWorkspace();
    const before = state.messagesByConversation["conversation-harbor"] ?? [];
    const started = workspaceReducer(state, {
      type: "generation/start",
      conversationId: "conversation-harbor",
      mode: "send",
      targetMessageId: null,
    });
    const identified = workspaceReducer(started, {
      type: "generation/id",
      id: "generation-live",
    });
    const previewed = workspaceReducer(identified, {
      type: "generation/delta",
      delta: "还没有完成",
    });
    const stopped = workspaceReducer(previewed, {
      type: "generation/stopping",
    });
    const reset = workspaceReducer(stopped, { type: "generation/reset" });

    expect(previewed.generation).toMatchObject({
      generationId: "generation-live",
      preview: "还没有完成",
    });
    expect(stopped.generation.status).toBe("stopping");
    expect(reset.generation.status).toBe("idle");
    expect(reset.generation.preview).toBe("");
    expect(reset.messagesByConversation["conversation-harbor"]).toEqual(before);
  });

  it("replaces messages only after the server returns a complete snapshot", () => {
    const state = createDemoWorkspace();
    const original = state.messagesByConversation["conversation-harbor"]?.[0];
    expect(original).toBeDefined();
    const persisted = {
      ...original!,
      content: "服务器完整回复",
      revision: 41,
    };

    const next = workspaceReducer(state, {
      type: "messages/replace",
      conversationId: "conversation-harbor",
      messages: [persisted],
    });

    expect(next.messagesByConversation["conversation-harbor"]).toEqual([
      persisted,
    ]);
    expect(next.messagesByConversation["conversation-glasshouse"]).toEqual(
      state.messagesByConversation["conversation-glasshouse"],
    );
  });

  it("uses live bootstrap providers and never exposes the demo tool proposal online", () => {
    const state = createDemoWorkspace();
    const next = workspaceReducer(state, {
      type: "bootstrap/api",
      payload: {
        conversations: state.conversations,
        cards: state.cards,
        participants: state.participants,
        messagesByConversation: state.messagesByConversation,
        worldbooks: state.worldbooks,
        presets: state.presets,
        regexScopes: state.regexScopes,
        providerConnections: [
          {
            id: "provider-live",
            name: "Live",
            protocol: "openai-compatible",
            baseUrl: "http://localhost/v1",
            model: "model",
            headers: {},
            hasApiKey: true,
            nativeToolCalling: true,
            revision: 3,
          },
        ],
      },
    });

    expect(next.apiOnline).toBe(true);
    expect(next.providerConnections).toHaveLength(1);
    expect(next.agentProposal).toBeNull();
    expect(next.agentRun).toBeNull();
  });

  it("does not leak demo entities into an empty live workspace", () => {
    const state = createDemoWorkspace();
    const next = workspaceReducer(state, {
      type: "bootstrap/api",
      payload: {
        conversations: [],
        cards: [],
        participants: [],
        messagesByConversation: {},
        worldbooks: [],
        presets: [],
        regexScopes: [],
        providerConnections: [],
      },
    });

    expect(next).toMatchObject({
      source: "api",
      apiOnline: true,
      conversations: [],
      cards: [],
      participants: [],
      messagesByConversation: {},
      worldbooks: [],
      presets: [],
    });
  });

  it("upserts a Provider connection and selects it without storing a key", () => {
    const state = createDemoWorkspace();
    const provider = {
      id: "provider-new",
      name: "New",
      protocol: "text-completion" as const,
      baseUrl: "http://localhost",
      model: "model",
      headers: {},
      hasApiKey: true,
      nativeToolCalling: false,
      revision: 1,
    };
    const next = workspaceReducer(state, {
      type: "provider/upsert",
      provider,
    });

    expect(next.selectedProviderId).toBe(provider.id);
    expect(next.providerConnections).toEqual([provider]);
    expect(next.providerConnections[0]).not.toHaveProperty("apiKey");
  });
});
