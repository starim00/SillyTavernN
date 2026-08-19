import { afterEach, describe, expect, it, vi } from "vitest";

import { createDemoWorkspace } from "../data/demoWorkspace";
import type {
  ProviderConnection,
  RegexScope,
  RegexScriptDefinition,
} from "../domain/workspace";
import {
  callLegacyRpc,
  confirmAgentProposal,
  createConversationSpace,
  generateConversation,
  importPortableFile,
  installLegacyPlugin,
  loadConversationMessages,
  loadLegacyGrants,
  loadLegacyHostHealth,
  loadPendingAgentToolProposal,
  loadProviderModels,
  loadWorkspaceFromApi,
  proposalFromGenerationToolEvent,
  reorderPresetPrompts,
  saveProviderConnection,
  saveRegexScope,
  setLegacyPluginEnabled,
  undoAgentProposal,
  updateLegacyGrant,
  updatePresetPrompt,
  updatePresetGeneration,
  updateRegexGrant,
  updateWorldbookEntry,
  updateWorldbookEntryPermission,
} from "./workspaceApi";

const jsonResponse = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const sseResponse = (chunks: string[]) => {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
        controller.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
};

const parseRequestBody = (
  body: BodyInit | null | undefined,
): Record<string, unknown> => {
  if (typeof body !== "string") {
    throw new TypeError("Expected a JSON string request body.");
  }
  return JSON.parse(body) as Record<string, unknown>;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("workspace API client", () => {
  it("patches preset generation controls without replacing prompt definitions", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          id: "preset-generation",
          name: "生成参数预设",
          revision: 8,
          payload: {
            mode: "chat-completion",
            prompts: [
              {
                id: "main",
                name: "Main",
                role: "system",
                content: "Keep context.",
                enabled: true,
                order: 0,
                systemPrompt: true,
              },
            ],
            generation: {
              temperature: 1.2,
              topP: 0.8,
              frequencyPenalty: -0.1,
              presencePenalty: 0.2,
              maxOutputTokens: 2048,
              n: 2,
              stream: false,
              stop: [],
              samplerOrder: [],
              additional: {
                maxContextTokens: 200_000,
                maxContextUnlocked: true,
              },
            },
          },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const preset = await updatePresetGeneration({
      presetId: "preset-generation",
      expectedRevision: 7,
      generation: {
        temperature: 1.2,
        n: 2,
        stream: false,
        additional: { maxContextTokens: 200_000 },
      },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/presets/preset-generation/generation",
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(
      parseRequestBody((fetchMock.mock.calls[0]?.[1] as RequestInit).body),
    ).toEqual({
      expectedRevision: 7,
      generation: {
        temperature: 1.2,
        n: 2,
        stream: false,
        additional: { maxContextTokens: 200_000 },
      },
    });
    expect(preset).toMatchObject({
      revision: 8,
      generation: {
        temperature: 1.2,
        n: 2,
        stream: false,
        additional: { maxContextTokens: 200_000, maxContextUnlocked: true },
      },
      prompts: [expect.objectContaining({ id: "main" })],
    });
  });

  it("loads every imported preset prompt, including disabled optional entries", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/health") {
        return Promise.resolve(jsonResponse({ data: { ok: true } }));
      }
      if (url === "/api/presets") {
        return Promise.resolve(
          jsonResponse({
            data: [
              {
                id: "preset-imported",
                name: "导入预设",
                kind: "chat-completion",
                revision: 4,
                payload: {
                  mode: "chat-completion",
                  prompts: [
                    {
                      id: "main",
                      name: "主要指令",
                      role: "system",
                      content: "主要正文",
                      enabled: true,
                      order: 0,
                      systemPrompt: true,
                    },
                    {
                      id: "optional",
                      name: "未启用选项",
                      role: "system",
                      content: "可由用户决定是否启用",
                      enabled: false,
                      order: 1,
                      systemPrompt: true,
                      metadata: { promptOrderMember: false },
                    },
                  ],
                },
              },
            ],
          }),
        );
      }
      if (url === "/api/cards") {
        return Promise.resolve(
          jsonResponse({
            data: [
              {
                id: "card-imported",
                name: "导入角色卡",
                description: "人设与世界书合集",
                worldbookIds: ["worldbook-card", "worldbook-shared"],
              },
            ],
          }),
        );
      }
      if (url === "/api/regex/scopes") {
        return Promise.resolve(
          jsonResponse({
            data: [
              {
                scope: "global",
                id: "global",
                name: "全局正则",
                enabled: true,
                revision: 2,
                ownerRevision: null,
                scripts: [
                  {
                    id: "global-display",
                    scriptName: "全局显示清理",
                    findRegex: "/foo/gi",
                    replaceString: "bar",
                    trimStrings: [" "],
                    placement: [1, 4, 6],
                    disabled: false,
                    markdownOnly: true,
                    promptOnly: false,
                    runOnEdit: true,
                    substituteRegex: 9,
                    minDepth: 0,
                    maxDepth: null,
                  },
                ],
                diagnostics: [
                  {
                    severity: "fatal",
                    code: "UNKNOWN_SEVERITY",
                    message: "未知级别会按警告展示",
                    path: "scripts[0]",
                  },
                ],
                updatedAt: "2026-07-30T01:02:03.000Z",
              },
              {
                scope: "card",
                id: "card-imported",
                name: "导入角色卡",
                enabled: false,
                revision: 0,
                ownerRevision: 4,
                scripts: [],
                diagnostics: [],
                updatedAt: null,
              },
              {
                scope: "preset",
                id: "preset-imported",
                name: "导入预设",
                enabled: false,
                revision: 0,
                ownerRevision: 4,
                scripts: [],
                diagnostics: [],
                updatedAt: null,
              },
            ],
          }),
        );
      }
      if (
        [
          "/api/conversations?limit=50",
          "/api/personas",
          "/api/worldbooks",
          "/api/providers/connections",
        ].includes(url)
      ) {
        return Promise.resolve(
          jsonResponse(
            url.startsWith("/api/conversations")
              ? { data: { items: [], nextCursor: null } }
              : { data: [] },
          ),
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const workspace = await loadWorkspaceFromApi();

    expect(workspace.presets[0]).toMatchObject({
      id: "preset-imported",
      revision: 4,
      mode: "chat-completion",
    });
    expect(workspace.presets[0]?.prompts).toEqual([
      expect.objectContaining({ id: "main", enabled: true }),
      expect.objectContaining({
        id: "optional",
        enabled: false,
        inserted: false,
        content: "可由用户决定是否启用",
      }),
    ]);
    expect(workspace.cards[0]).toMatchObject({
      id: "card-imported",
      worldbookIds: ["worldbook-card", "worldbook-shared"],
    });
    expect(workspace.regexScopes).toEqual([
      expect.objectContaining({
        scope: "global",
        id: "global",
        enabled: true,
        scripts: [
          expect.objectContaining({
            id: "global-display",
            placement: [1, 6],
            substituteRegex: 0,
          }),
        ],
        diagnostics: [
          {
            severity: "warning",
            code: "UNKNOWN_SEVERITY",
            message: "未知级别会按警告展示",
            path: "scripts[0]",
          },
        ],
      }),
      expect.objectContaining({
        scope: "card",
        id: "card-imported",
        enabled: false,
      }),
      expect.objectContaining({
        scope: "preset",
        id: "preset-imported",
        enabled: false,
      }),
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/regex/scopes",
      expect.any(Object),
    );
  });

  it("parses fragmented SSE and resolves only after message-persisted", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        sseResponse([
          'data: {"type":"generation-id","generationId":"gen-1"}\n\n',
          'data: {"type":"reasoning-delta","requestId":"gen-1","sequence":0,"delta":"先分析"}\n\n',
          'data: {"type":"text-delta","requestId":"gen-1","sequence":1,',
          '"delta":"完整"}\n\ndata: {"type":"text-delta","requestId":"gen-1",',
          '"sequence":2,"delta":"回复"}\n\n',
          'data: {"type":"finish","requestId":"gen-1","sequence":3,"reason":"stop"}\n\n',
          'data: {"type":"message-persisted","messageId":"message-9","revision":1,"providerRawFinishReason":"stop","providerSawDone":true,"providerLastFrameType":"chat.completion.chunk","providerUpstreamRequestId":"upstream-9"}\n\n',
        ]),
      );
    vi.stubGlobal("fetch", fetchMock);
    const deltas: string[] = [];
    const ids: string[] = [];
    const reasoningDeltas: string[] = [];

    const receipt = await generateConversation(
      {
        conversationId: "conversation-1",
        connectionId: "fake",
        presetId: "preset-longform",
      },
      {
        onGenerationId: (id) => ids.push(id),
        onTextDelta: (delta) => deltas.push(delta),
        onReasoningDelta: (delta) => reasoningDeltas.push(delta),
      },
    );

    expect(receipt).toEqual({
      generationId: "gen-1",
      messageId: "message-9",
      revision: 1,
      content: "完整回复",
      providerRawFinishReason: "stop",
      providerSawDone: true,
      providerLastFrameType: "chat.completion.chunk",
      providerUpstreamRequestId: "upstream-9",
    });
    expect(reasoningDeltas).toEqual(["先分析"]);
    expect(ids).toEqual(["gen-1"]);
    expect(deltas).toEqual(["完整", "回复"]);
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(parseRequestBody(request.body)).toEqual({
      connectionId: "fake",
      presetId: "preset-longform",
    });
  });

  it("accepts a tool-only generation and surfaces proposal and result events", async () => {
    const run = {
      id: "run-tool-only",
      conversationId: "conversation-1",
      status: "waiting_confirmation",
      objective: "记录新事实",
      updatedAt: "2026-07-29T10:00:00.000Z",
    };
    const toolCall = {
      id: "call-tool-only",
      runId: run.id,
      idempotencyKey: "tool-only-key",
      toolName: "worldbook.entry.create",
      arguments: {
        worldbookId: "worldbook-1",
        expectedRevision: 7,
        entry: { title: "新事实", content: "工具提案正文" },
      },
      status: "awaiting_confirmation",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse([
          'data: {"type":"generation-id","generationId":"gen-tool-only"}\n\n',
          `data: ${JSON.stringify({
            type: "tool-proposal",
            payload: { run, toolCall, text: "等待用户确认" },
          })}\n\n`,
          `data: ${JSON.stringify({
            type: "tool-result",
            payload: { runId: run.id, toolCallId: toolCall.id, pending: true },
          })}\n\n`,
          'data: {"type":"finish","reason":"tool_call"}\n\n',
        ]),
      ),
    );
    const onToolProposal = vi.fn();
    const onToolResult = vi.fn();

    const receipt = await generateConversation(
      {
        conversationId: "conversation-1",
        connectionId: "fake",
      },
      { onToolProposal, onToolResult },
    );

    expect(receipt).toEqual({
      generationId: "gen-tool-only",
      toolProposalOnly: true,
    });
    expect(onToolProposal).toHaveBeenCalledWith({
      run,
      toolCall,
      text: "等待用户确认",
    });
    expect(onToolResult).toHaveBeenCalledWith({
      runId: run.id,
      toolCallId: toolCall.id,
      pending: true,
    });
  });

  it("maps create, update, and delete chat tool calls with entry permissions", () => {
    const state = createDemoWorkspace();
    const worldbook = state.worldbooks[0]!;
    const blockedEntry = worldbook.entries[0]!;
    const editableEntry = worldbook.entries[1]!;
    const run = {
      id: "run-mapped-tools",
      conversationId: state.selectedConversationId,
      status: "waiting_confirmation" as const,
      objective: "整理本轮世界书变化",
      updatedAt: "2026-07-29T10:00:00.000Z",
    };
    const commonCall = {
      runId: run.id,
      status: "awaiting_confirmation" as const,
    };

    const created = proposalFromGenerationToolEvent(state, {
      run,
      text: run.objective,
      toolCall: {
        ...commonCall,
        id: "call-create",
        idempotencyKey: "key-create",
        toolName: "worldbook.entry.create",
        arguments: {
          worldbookId: worldbook.id,
          expectedRevision: worldbook.revision,
          entry: { title: "新条目", content: "新内容" },
        },
      },
    });
    const updated = proposalFromGenerationToolEvent(state, {
      run,
      text: run.objective,
      toolCall: {
        ...commonCall,
        id: "call-update",
        idempotencyKey: "key-update",
        toolName: "worldbook.entry.update",
        arguments: {
          worldbookId: worldbook.id,
          entryId: editableEntry.id,
          expectedRevision: worldbook.revision,
          expectedEntryRevision: editableEntry.revision,
          patch: {
            title: "更新后的浅滩",
            content: "更新后的条目正文",
          },
        },
      },
    });
    const deleted = proposalFromGenerationToolEvent(state, {
      run,
      text: run.objective,
      toolCall: {
        ...commonCall,
        id: "call-delete",
        idempotencyKey: "key-delete",
        toolName: "worldbook.entry.delete",
        arguments: {
          worldbookId: worldbook.id,
          entryId: blockedEntry.id,
          expectedRevision: worldbook.revision,
          expectedEntryRevision: blockedEntry.revision,
        },
      },
    });

    expect(created).toMatchObject({
      toolName: "worldbook.entry.create",
      status: "awaiting_confirmation",
      beforeRevision: worldbook.revision,
    });
    expect(updated).toMatchObject({
      toolName: "worldbook.entry.update",
      targetEntryId: editableEntry.id,
      targetEntryTitle: editableEntry.title,
      beforeRevision: worldbook.revision,
      beforeEntryRevision: editableEntry.revision,
      status: "awaiting_confirmation",
      title: `更新条目：${editableEntry.title}`,
    });
    expect(updated?.diffLines).toEqual([
      `~ 标题：${editableEntry.title} → 更新后的浅滩`,
      "~ 内容：更新后的条目正文",
    ]);
    expect(updated?.toolArguments).toEqual({
      worldbookId: worldbook.id,
      entryId: editableEntry.id,
      expectedRevision: worldbook.revision,
      expectedEntryRevision: editableEntry.revision,
      patch: {
        title: "更新后的浅滩",
        content: "更新后的条目正文",
      },
    });
    expect(deleted).toMatchObject({
      toolName: "worldbook.entry.delete",
      targetEntryId: blockedEntry.id,
      targetEntryTitle: blockedEntry.title,
      beforeRevision: worldbook.revision,
      beforeEntryRevision: blockedEntry.revision,
      status: "blocked",
      title: `删除条目：${blockedEntry.title}`,
    });
    expect(deleted?.diffLines).toContain(`- 条目 ID：${blockedEntry.id}`);
    expect(deleted?.toolArguments).toEqual({
      worldbookId: worldbook.id,
      entryId: blockedEntry.id,
      expectedRevision: worldbook.revision,
      expectedEntryRevision: blockedEntry.revision,
    });
  });

  it("rejects a partial preview when the stream reports an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          sseResponse([
            'data: {"type":"generation-id","generationId":"gen-error"}\n\n',
            'data: {"type":"text-delta","requestId":"gen-error","sequence":1,"delta":"半条"}\n\n',
            'data: {"type":"error","code":"UPSTREAM_FAILED","message":"provider failed","retryable":false}\n\n',
          ]),
        ),
    );
    const deltas: string[] = [];

    await expect(
      generateConversation(
        {
          conversationId: "conversation-1",
          connectionId: "fake",
        },
        { onTextDelta: (delta) => deltas.push(delta) },
      ),
    ).rejects.toMatchObject({
      name: "WorkspaceApiError",
      code: "UPSTREAM_FAILED",
    });
    expect(deltas).toEqual(["半条"]);
  });

  it("returns and preserves a partial reply when the server persisted it", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          sseResponse([
            'data: {"type":"generation-id","generationId":"gen-partial"}\n\n',
            'data: {"type":"text-delta","requestId":"gen-partial","sequence":1,"delta":"已经生成的内容"}\n\n',
            'data: {"type":"error","code":"PROVIDER_REQUEST_FAILED","message":"upstream disconnected","retryable":true}\n\n',
            'data: {"type":"message-persisted","messageId":"message-partial","revision":1,"incomplete":true,"reason":"error","errorCode":"PROVIDER_REQUEST_FAILED","errorMessage":"upstream disconnected"}\n\n',
          ]),
        ),
    );

    await expect(
      generateConversation({
        conversationId: "conversation-1",
        connectionId: "cpa",
      }),
    ).resolves.toEqual({
      generationId: "gen-partial",
      messageId: "message-partial",
      revision: 1,
      content: "已经生成的内容",
      incomplete: true,
      reason: "error",
      errorCode: "PROVIDER_REQUEST_FAILED",
      errorMessage: "upstream disconnected",
    });
  });

  it("exposes only user input and model replies in the message stream", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          data: {
            items: [
              {
                id: "message-user",
                conversationId: "conversation-1",
                role: "user",
                content: "Hello.",
                displayContent: "<strong>Hello.</strong>",
                appliedRegexScriptIds: ["card-user-display"],
              },
              {
                id: "message-system",
                conversationId: "conversation-1",
                role: "system",
                content: "Private runtime context.",
              },
              {
                id: "message-assistant",
                conversationId: "conversation-1",
                role: "assistant",
                content: "Welcome.",
                displayContent: "Displayed welcome.",
                appliedRegexScriptIds: ["preset-assistant-display"],
              },
              {
                id: "message-tool",
                conversationId: "conversation-1",
                role: "tool",
                content: "Private tool result.",
              },
            ],
            nextCursor: null,
          },
        }),
      ),
    );

    const messages = await loadConversationMessages(
      "conversation-1",
      "preset display/1",
    );
    expect(messages).toEqual([
      expect.objectContaining({
        id: "message-user",
        role: "user",
        content: "Hello.",
        displayContent: "<strong>Hello.</strong>",
        appliedRegexScriptIds: ["card-user-display"],
      }),
      expect.objectContaining({
        id: "message-assistant",
        role: "assistant",
        content: "Welcome.",
        displayContent: "Displayed welcome.",
        appliedRegexScriptIds: ["preset-assistant-display"],
      }),
    ]);
    expect(fetch).toHaveBeenCalledWith(
      "/api/conversations/conversation-1/messages?limit=100&presetId=preset+display%2F1",
      expect.any(Object),
    );
    expect(messages[0]?.content).toBe("Hello.");
  });

  it("submits an API key but never adds it to the returned connection", async () => {
    const returned: ProviderConnection = {
      id: "provider-1",
      name: "Local",
      protocol: "openai-compatible",
      baseUrl: "http://127.0.0.1:1234/v1",
      model: "local-model",
      headers: {},
      hasApiKey: true,
      nativeToolCalling: true,
      revision: 1,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: returned }, 201));
    vi.stubGlobal("fetch", fetchMock);

    const saved = await saveProviderConnection({
      name: returned.name,
      protocol: returned.protocol,
      baseUrl: returned.baseUrl,
      model: returned.model,
      headers: {},
      apiKey: "server-only-secret",
      nativeToolCalling: true,
    });

    const body = parseRequestBody(
      (fetchMock.mock.calls[0]?.[1] as RequestInit).body,
    );
    expect(body.apiKey).toBe("server-only-secret");
    expect(saved.hasApiKey).toBe(true);
    expect(saved).not.toHaveProperty("apiKey");
  });

  it("loads and normalizes models for a saved Provider connection", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: [
          { id: " model-a ", name: "Model A" },
          { id: "model-a", name: "Duplicate" },
          { id: "model-b" },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadProviderModels("provider/1")).resolves.toEqual([
      { id: "model-a", name: "Model A" },
      { id: "model-b", name: "model-b" },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/providers/connections/provider%2F1/models",
    );
  });

  it("confirms a server-backed conversation tool proposal without creating a run", async () => {
    const state = createDemoWorkspace();
    state.availability = "api";
    state.selectedProviderId = "fake";
    const worldbook = state.worldbooks[0]!;
    const run = {
      id: "run-live",
      conversationId: state.selectedConversationId,
      status: "running" as const,
      objective: "确认普通对话工具提案",
      updatedAt: "2026-07-29T00:00:00.000Z",
    };
    const proposal = proposalFromGenerationToolEvent(state, {
      run,
      text: run.objective,
      toolCall: {
        id: "call-1",
        runId: run.id,
        idempotencyKey: "proposal-key",
        toolName: "worldbook.entry.create",
        status: "awaiting_confirmation",
        arguments: {
          worldbookId: worldbook.id,
          expectedRevision: worldbook.revision,
          entry: { title: "New lore", content: "New lore content" },
        },
      },
    });
    expect(proposal).not.toBeNull();
    if (!proposal) throw new Error("Expected a worldbook proposal.");
    state.agentProposal = proposal;
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/agent/runs/run-live/tools") {
        expect(init).toMatchObject({ method: "POST" });
        return Promise.resolve(
          jsonResponse({
            data: {
              call: { id: "call-1", status: "succeeded" },
              result: { auditId: "audit-1", revision: 14 },
              replayed: false,
            },
          }),
        );
      }
      if (url === "/api/worldbooks") {
        return Promise.resolve(
          jsonResponse({
            data: [
              {
                id: worldbook.id,
                name: worldbook.name,
                agentEditable: true,
                revision: 14,
                entries: [],
              },
            ],
          }),
        );
      }
      if (url === "/api/agent/runs/run-live") {
        return Promise.resolve(
          jsonResponse({ data: { run, toolCalls: [], audit: [] } }),
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await confirmAgentProposal(state);

    expect(result).toMatchObject({
      auditId: "audit-1",
      revision: 14,
      run: { id: "run-live" },
    });
    const urls = fetchMock.mock.calls.map(([url]) => url);
    expect(urls).not.toContain("/api/agent/runs");
    const toolCall = fetchMock.mock.calls.find(
      ([url]) => url === "/api/agent/runs/run-live/tools",
    );
    expect(parseRequestBody((toolCall?.[1] as RequestInit).body)).toMatchObject(
      {
        idempotencyKey: proposal!.idempotencyKey,
        toolName: "worldbook.entry.create",
        arguments: proposal!.toolArguments,
        confirmed: true,
      },
    );
  });

  it("recovers an awaiting worldbook proposal after a workspace refresh", async () => {
    const state = createDemoWorkspace();
    state.availability = "api";
    state.agentProposal = null;
    const worldbook = state.worldbooks[0]!;
    const entry = worldbook.entries.find(
      (candidate) => candidate.agentEditable,
    )!;
    const run = {
      id: "run-pending",
      conversationId: state.selectedConversationId,
      status: "waiting_confirmation",
      objective: "恢复待确认提案",
      updatedAt: "2026-07-29T10:00:00.000Z",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.startsWith("/api/agent/runs?conversationId=")) {
          return Promise.resolve(jsonResponse({ data: [run] }));
        }
        if (url === "/api/agent/runs/run-pending") {
          return Promise.resolve(
            jsonResponse({
              data: {
                run,
                toolCalls: [
                  {
                    id: "call-pending",
                    runId: run.id,
                    idempotencyKey: "pending-key",
                    toolName: "worldbook.entry.update",
                    arguments: {
                      worldbookId: worldbook.id,
                      entryId: entry.id,
                      expectedRevision: worldbook.revision,
                      expectedEntryRevision: entry.revision,
                      patch: { content: run.objective },
                    },
                    status: "awaiting_confirmation",
                  },
                ],
                audit: [],
              },
            }),
          );
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    const pending = await loadPendingAgentToolProposal(state);

    expect(pending).toMatchObject({
      run: { id: run.id },
      proposal: {
        id: "call-pending",
        idempotencyKey: "pending-key",
        toolName: "worldbook.entry.update",
        targetEntryId: entry.id,
        beforeEntryRevision: entry.revision,
        status: "awaiting_confirmation",
      },
    });
  });

  it.each([
    {
      toolName: "chat.summary.create",
      artifactKind: "chat_summary",
      arguments: {
        content: "A compact summary of the current exchange.",
        sourceFromMessageId: "message-harbor-1",
        sourceToMessageId: "message-harbor-1",
      },
      targetLabel: "当前对话摘要",
    },
    {
      toolName: "character.profile.create",
      artifactKind: "character_profile",
      arguments: {
        participantId: "participant-harbor",
        content: "Keeps careful notes about the harbor.",
      },
      targetLabel: "港务员",
    },
  ])(
    "recovers an awaiting $artifactKind proposal after a workspace refresh",
    async ({
      toolName,
      artifactKind,
      arguments: toolArguments,
      targetLabel,
    }) => {
      const state = createDemoWorkspace();
      state.availability = "api";
      state.agentProposal = null;
      const run = {
        id: `run-pending-${artifactKind}`,
        conversationId: state.selectedConversationId,
        status: "waiting_confirmation",
        objective: "恢复派生内容提案",
        updatedAt: "2026-07-29T10:00:00.000Z",
      };
      vi.stubGlobal(
        "fetch",
        vi.fn((url: string) => {
          if (url.startsWith("/api/agent/runs?conversationId=")) {
            return Promise.resolve(jsonResponse({ data: [run] }));
          }
          if (url === `/api/agent/runs/${run.id}`) {
            return Promise.resolve(
              jsonResponse({
                data: {
                  run,
                  toolCalls: [
                    {
                      id: `call-${artifactKind}`,
                      runId: run.id,
                      idempotencyKey: `pending-${artifactKind}`,
                      toolName,
                      arguments: toolArguments,
                      status: "awaiting_confirmation",
                    },
                  ],
                  audit: [],
                },
              }),
            );
          }
          throw new Error(`Unexpected request: ${url}`);
        }),
      );

      const pending = await loadPendingAgentToolProposal(state);

      expect(pending).toMatchObject({
        run: { id: run.id },
        proposal: {
          artifactKind,
          targetLabel,
          toolName,
          status: "awaiting_confirmation",
        },
      });
    },
  );

  it("undoes through agent.change.undo and refreshes live state", async () => {
    const state = createDemoWorkspace();
    const worldbook = state.worldbooks[0]!;
    const proposal = proposalFromGenerationToolEvent(state, {
      run: {
        id: "run-live",
        conversationId: state.selectedConversationId,
        status: "waiting_confirmation",
        objective: "普通对话写入",
        updatedAt: "2026-07-29T00:00:00.000Z",
      },
      text: "普通对话写入",
      toolCall: {
        id: "call-original",
        runId: "run-live",
        idempotencyKey: "original-key",
        toolName: "worldbook.entry.create",
        status: "awaiting_confirmation",
        arguments: {
          worldbookId: worldbook.id,
          expectedRevision: worldbook.revision,
          entry: { content: "新增内容" },
        },
      },
    });
    expect(proposal).not.toBeNull();
    state.availability = "api";
    state.agentProposal = {
      ...proposal!,
      status: "applied",
      auditId: "audit-original",
    };
    state.agentRun = {
      id: "run-live",
      conversationId: state.selectedConversationId,
      status: "running",
      objective: proposal!.rationale,
      updatedAt: "2026-07-29T00:00:00.000Z",
    };
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/agent/runs/run-live/tools") {
        const body = parseRequestBody(init?.body);
        expect(body).toMatchObject({
          toolName: "agent.change.undo",
          arguments: { auditId: "audit-original" },
          confirmed: true,
        });
        return Promise.resolve(
          jsonResponse({
            data: {
              call: { id: "call-undo", status: "succeeded" },
              result: {
                auditId: "audit-undo",
                undoneAuditId: "audit-original",
              },
              replayed: false,
            },
          }),
        );
      }
      if (url === "/api/worldbooks") {
        return Promise.resolve(jsonResponse({ data: [] }));
      }
      if (url === "/api/agent/runs/run-live") {
        return Promise.resolve(
          jsonResponse({
            data: { run: state.agentRun, toolCalls: [], audit: [] },
          }),
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await undoAgentProposal(state);
    expect(result.run.id).toBe("run-live");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/worldbooks",
      expect.any(Object),
    );
  });

  it("routes portable files by fixed suffix and conservative JSON shape", async () => {
    const cases = [
      {
        file: new File(["not inspected"], "portrait.PNG"),
        kind: "card",
        route: "/api/cards/import",
      },
      {
        file: new File(["not inspected"], "portable.charx"),
        kind: "card",
        route: "/api/cards/import",
      },
      {
        file: new File(["not inspected"], "portable.zip"),
        kind: "card",
        route: "/api/cards/import",
      },
      {
        file: new File(["not even JSON"], "conversation.JSONL"),
        kind: "conversation",
        route: "/api/conversations/import",
      },
      {
        file: new File(
          [JSON.stringify({ spec: "chara_card_v3", data: { name: "Scene" } })],
          "scene.json",
        ),
        kind: "card",
        route: "/api/cards/import",
      },
      {
        file: new File(
          [
            JSON.stringify({
              name: "Harbor lore",
              entries: [{ keys: ["bell"], content: "The bell rings late." }],
            }),
          ],
          "lore.json",
        ),
        kind: "worldbook",
        route: "/api/worldbooks/import",
      },
      {
        file: new File(
          [JSON.stringify({ messages: [], title: "World-only conversation" })],
          "conversation.json",
        ),
        kind: "conversation",
        route: "/api/conversations/import",
      },
      {
        file: new File(
          [
            JSON.stringify({
              prompts: [
                {
                  identifier: "main",
                  role: "system",
                  content: "Stay in character.",
                },
              ],
              prompt_order: [
                {
                  character_id: 100001,
                  order: [{ identifier: "main", enabled: true }],
                },
              ],
              temperature: 1,
            }),
          ],
          "preset.json",
        ),
        kind: "preset",
        route: "/api/presets/import",
      },
      {
        file: new File(
          [JSON.stringify({ entries: [], name: "Ambiguous" })],
          "ambiguous.json",
        ),
        kind: "card",
        route: "/api/cards/import",
      },
    ] as const;
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      if (url === "/api/presets/import") {
        expect(init?.body).toEqual(expect.any(String));
        expect(parseRequestBody(init?.body)).toMatchObject({
          filename: "preset.json",
          conflictStrategy: "duplicate",
        });
      } else {
        expect(init?.body).toBeInstanceOf(FormData);
        if (url === "/api/conversations/import") {
          expect((init?.body as FormData).get("cardId")).toBe("card-current");
        }
      }
      return Promise.resolve(jsonResponse({ data: { receivedAt: url } }, 201));
    });
    vi.stubGlobal("fetch", fetchMock);

    for (const sample of cases) {
      const imported = await importPortableFile(sample.file, {
        conversationCardId: "card-current",
      });
      expect(imported).toEqual({
        kind: sample.kind,
        result: { receivedAt: sample.route },
      });
    }

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(
      cases.map(({ route }) => route),
    );
  });

  it("blocks chat import until a role card is selected", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      importPortableFile(new File(["not inspected"], "conversation.jsonl")),
    ).rejects.toMatchObject({
      code: "CONVERSATION_CARD_REQUIRED",
      status: 400,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("updates a scoped regex grant explicitly", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ data: { scope: "card", id: "card-1", granted: true } }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await updateRegexGrant({
      scope: "card",
      id: "card-1",
      granted: true,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/compatibility/regex-grants",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          scope: "card",
          id: "card-1",
          granted: true,
        }),
      }),
    );
  });

  it("saves one regex scope with its revision and normalizes the response", async () => {
    const script: RegexScriptDefinition = {
      id: "card-display",
      scriptName: "角色卡显示替换",
      findRegex: "/hello/gi",
      replaceString: "你好",
      trimStrings: ["\n"],
      placement: [2, 6],
      disabled: false,
      markdownOnly: true,
      promptOnly: false,
      runOnEdit: false,
      substituteRegex: 2,
      minDepth: 0,
      maxDepth: 12,
    };
    const scope: RegexScope = {
      scope: "card",
      id: "card/with space",
      name: "测试角色卡",
      enabled: false,
      revision: 5,
      ownerRevision: 9,
      scripts: [],
      diagnostics: [],
      updatedAt: null,
    };
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          ...scope,
          enabled: true,
          revision: 6,
          scripts: [{ ...script, placement: [2, 4, 6] }],
          diagnostics: [
            {
              severity: "error",
              code: "INVALID_PATTERN",
              message: "表达式无法编译",
            },
          ],
          updatedAt: "2026-07-30T02:03:04.000Z",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const saved = await saveRegexScope({
      scope,
      enabled: true,
      scripts: [script],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/regex/scopes/card/card%2Fwith%20space",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          expectedRevision: 5,
          enabled: true,
          scripts: [script],
        }),
      }),
    );
    expect(saved).toMatchObject({
      scope: "card",
      id: "card/with space",
      enabled: true,
      revision: 6,
      scripts: [
        expect.objectContaining({
          id: "card-display",
          placement: [2, 6],
          substituteRegex: 2,
        }),
      ],
      diagnostics: [
        {
          severity: "error",
          code: "INVALID_PATTERN",
          message: "表达式无法编译",
        },
      ],
      updatedAt: "2026-07-30T02:03:04.000Z",
    });
  });

  it("updates one worldbook entry permission with both revisions", async () => {
    const state = createDemoWorkspace();
    const worldbook = state.worldbooks[0]!;
    const entry = worldbook.entries[0]!;
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (
        url === `/api/worldbooks/${worldbook.id}/entries/${entry.id}/permission`
      ) {
        expect(init?.method).toBe("PATCH");
        expect(parseRequestBody(init?.body)).toEqual({
          expectedWorldbookRevision: worldbook.revision,
          expectedEntryRevision: entry.revision,
          agentEditable: true,
        });
        return Promise.resolve(
          jsonResponse({
            data: {
              worldbook: {
                id: worldbook.id,
                name: worldbook.name,
                description: worldbook.description,
                agentEditable: worldbook.agentEditable,
                revision: worldbook.revision + 1,
                imported: worldbook.imported,
                entries: [
                  {
                    ...entry,
                    agentEditable: true,
                    revision: entry.revision + 1,
                  },
                ],
              },
            },
          }),
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const updated = await updateWorldbookEntryPermission(
      worldbook,
      entry,
      true,
    );

    expect(updated.worldbook.revision).toBe(worldbook.revision + 1);
    expect(updated.entry).toMatchObject({
      id: entry.id,
      agentEditable: true,
      revision: entry.revision + 1,
    });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `/api/worldbooks/${worldbook.id}/entries/${entry.id}/permission`,
    ]);
  });

  it("saves and normalizes complete worldbook recall and insertion settings", async () => {
    const state = createDemoWorkspace();
    const worldbook = state.worldbooks[0]!;
    const entry = worldbook.entries[0]!;
    const patch = {
      title: "潮门",
      primaryKeys: ["潮汐", "/moon/iu"],
      secondaryKeys: ["旧港"],
      secondaryLogic: "all" as const,
      selective: true,
      content: "潮门在退潮时开启。",
      enabled: true,
      constant: false,
      caseSensitive: true,
      matchWholeWords: true,
      useRegex: true,
      scanDepth: 6,
      recursion: true,
      preventRecursion: true,
      excludeRecursion: false,
      delayUntilRecursion: false,
      insertionPosition: "at-depth" as const,
      outletName: null,
      insertionDepth: 3,
      insertionRole: "system" as const,
      order: 900,
      priority: 950,
    };
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      expect(url).toBe(`/api/worldbooks/${worldbook.id}/entries/${entry.id}`);
      expect(init?.method).toBe("PATCH");
      expect(parseRequestBody(init?.body)).toEqual({
        expectedWorldbookRevision: worldbook.revision,
        expectedEntryRevision: entry.revision,
        ...patch,
      });
      return Promise.resolve(
        jsonResponse({
          data: {
            worldbook: {
              id: worldbook.id,
              name: worldbook.name,
              description: worldbook.description,
              agentEditable: worldbook.agentEditable,
              revision: worldbook.revision + 1,
              imported: true,
              entries: [
                {
                  id: entry.id,
                  ...patch,
                  keys: [...patch.primaryKeys, ...patch.secondaryKeys],
                  agentEditable: false,
                  revision: entry.revision + 1,
                },
              ],
            },
          },
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const updated = await updateWorldbookEntry(worldbook, entry, patch);

    expect(updated.revision).toBe(worldbook.revision + 1);
    expect(updated.entries[0]).toMatchObject({
      title: "潮门",
      keys: ["潮汐", "/moon/iu", "旧港"],
      primaryKeys: ["潮汐", "/moon/iu"],
      secondaryKeys: ["旧港"],
      secondaryLogic: "all",
      selective: true,
      enabled: true,
      constant: false,
      scanDepth: 6,
      insertionPosition: "at-depth",
      outletName: null,
      insertionDepth: 3,
      insertionRole: "system",
      order: 900,
      priority: 950,
      agentEditable: false,
    });
  });

  it("updates and normalizes a disabled preset prompt without dropping it", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      expect(url).toBe("/api/presets/preset%2Fone/prompts/optional%20summary");
      expect(init?.method).toBe("PATCH");
      expect(parseRequestBody(init?.body)).toEqual({
        expectedRevision: 7,
        enabled: true,
        content: "新的可选摘要指令",
        role: "assistant",
      });
      return Promise.resolve(
        jsonResponse({
          data: {
            id: "preset/one",
            name: "完整预设",
            kind: "chat-completion",
            revision: 8,
            payload: {
              mode: "chat-completion",
              prompts: [
                {
                  id: "main",
                  name: "主要指令",
                  role: "system",
                  content: "主要正文",
                  enabled: true,
                  order: 0,
                  systemPrompt: true,
                },
                {
                  id: "optional summary",
                  name: "可选摘要",
                  role: "assistant",
                  content: "新的可选摘要指令",
                  enabled: true,
                  order: 1,
                  systemPrompt: true,
                  marker: "custom",
                },
              ],
            },
          },
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const updated = await updatePresetPrompt({
      presetId: "preset/one",
      promptId: "optional summary",
      expectedRevision: 7,
      enabled: true,
      content: "新的可选摘要指令",
      role: "assistant",
    });

    expect(updated).toMatchObject({
      id: "preset/one",
      revision: 8,
      mode: "chat-completion",
    });
    expect(updated.prompts).toHaveLength(2);
    expect(updated.prompts[1]).toMatchObject({
      id: "optional summary",
      enabled: true,
      content: "新的可选摘要指令",
      role: "assistant",
      marker: "custom",
    });
  });

  it("saves the complete inserted preset order atomically", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      expect(url).toBe("/api/presets/preset%2Fone/prompt-order");
      expect(init?.method).toBe("PATCH");
      expect(parseRequestBody(init?.body)).toEqual({
        expectedRevision: 8,
        promptIds: ["second", "first"],
      });
      return Promise.resolve(
        jsonResponse({
          data: {
            id: "preset/one",
            name: "完整预设",
            kind: "chat-completion",
            revision: 9,
            payload: {
              mode: "chat-completion",
              prompts: [
                {
                  id: "first",
                  name: "第一条",
                  role: "system",
                  content: "FIRST",
                  enabled: true,
                  order: 1,
                  systemPrompt: false,
                  metadata: { promptOrderMember: true },
                },
                {
                  id: "second",
                  name: "第二条",
                  role: "system",
                  content: "SECOND",
                  enabled: false,
                  order: 0,
                  systemPrompt: false,
                  metadata: { promptOrderMember: true },
                },
              ],
            },
          },
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const updated = await reorderPresetPrompts({
      presetId: "preset/one",
      expectedRevision: 8,
      promptIds: ["second", "first"],
    });

    expect(updated.revision).toBe(9);
    expect(
      [...updated.prompts]
        .sort((left, right) => left.order - right.order)
        .map((prompt) => prompt.id),
    ).toEqual(["second", "first"]);
  });

  it("creates and normalizes an API-backed conversation space", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          data: {
            id: "conversation-live",
            title: "港区群像",
            cardId: "world-harbor",
            participantIds: ["p-1", "p-2", "p-3"],
            worldbookIds: ["wb-1"],
            updatedAt: "2026-07-29T08:30:00.000Z",
          },
        },
        201,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const conversation = await createConversationSpace({
      title: "港区群像",
      cardId: "world-harbor",
    });

    expect(conversation).toMatchObject({
      id: "conversation-live",
      title: "港区群像",
      cardId: "world-harbor",
      worldbookIds: ["wb-1"],
    });
    expect(conversation).not.toHaveProperty("participantIds");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/conversations",
      expect.any(Object),
    );
    expect(
      parseRequestBody((fetchMock.mock.calls[0]?.[1] as RequestInit).body),
    ).toEqual({
      title: "港区群像",
      cardId: "world-harbor",
    });
  });

  it("rejects an API conversation without a card binding", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            data: {
              id: "conversation-invalid",
              title: "未绑定记录",
              worldbookIds: [],
            },
          },
          201,
        ),
      ),
    );

    await expect(
      createConversationSpace({
        title: "未绑定记录",
        cardId: "card-requested",
      }),
    ).rejects.toMatchObject({
      code: "INVALID_CONVERSATION_CARD",
      status: 502,
    });
  });

  it("normalizes actor-scoped legacy grants without leaking unknown fields", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/legacy/grants" && init?.method === undefined) {
        return Promise.resolve(
          jsonResponse({
            data: [
              {
                plugin_id: "st-prompt-template",
                actor: "legacy-plugin",
                capability: "settings.read",
                granted: 1,
                granted_by: "local-user",
                updated_at: "2026-07-29T09:00:00.000Z",
                provider_secret: "must-not-surface",
              },
            ],
          }),
        );
      }
      if (url === "/api/legacy/grants" && init?.method === "PUT") {
        expect(parseRequestBody(init.body)).toEqual({
          pluginId: "st-prompt-template",
          capability: "settings.write",
          granted: true,
          actor: "legacy-plugin",
        });
        return Promise.resolve(
          jsonResponse({
            data: {
              pluginId: "st-prompt-template",
              actor: "legacy-plugin",
              capability: "settings.write",
              granted: true,
              grantedBy: "local-user",
              updatedAt: "2026-07-29T09:01:00.000Z",
              apiKey: "must-not-surface",
            },
          }),
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const grants = await loadLegacyGrants();
    const updated = await updateLegacyGrant({
      pluginId: "st-prompt-template",
      capability: "settings.write",
      granted: true,
    });

    expect(grants).toEqual([
      {
        pluginId: "st-prompt-template",
        actor: "legacy-plugin",
        capability: "settings.read",
        granted: true,
        grantedBy: "local-user",
        updatedAt: "2026-07-29T09:00:00.000Z",
      },
    ]);
    expect(updated).toEqual({
      pluginId: "st-prompt-template",
      actor: "legacy-plugin",
      capability: "settings.write",
      granted: true,
      grantedBy: "local-user",
      updatedAt: "2026-07-29T09:01:00.000Z",
    });
    expect(updated).not.toHaveProperty("apiKey");
  });

  it("relays a structured legacy RPC denial instead of hiding the broker error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          protocol: "stn.legacy.v1",
          id: "rpc-denied",
          ok: false,
          error: {
            code: "ERR_LEGACY_CAPABILITY_DENIED",
            message: "Capability has not been granted.",
            capability: "settings.read",
          },
        },
        403,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await callLegacyRpc({
      protocol: "stn.legacy.v1",
      id: "rpc-denied",
      pluginId: "st-prompt-template",
      actor: "legacy-plugin",
      method: "settings.load",
      capability: "settings.read",
      params: {},
    });

    expect(response).toMatchObject({
      id: "rpc-denied",
      ok: false,
      error: {
        code: "ERR_LEGACY_CAPABILITY_DENIED",
        capability: "settings.read",
      },
    });
    expect(
      parseRequestBody((fetchMock.mock.calls[0]?.[1] as RequestInit).body),
    ).toMatchObject({
      actor: "legacy-plugin",
      method: "settings.load",
      capability: "settings.read",
    });
  });

  it("normalizes legacy host health from its separate origin", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        service: "legacy-host",
        safeMode: false,
        plugins: [
          {
            lock: {
              id: "js-slash-runner",
              displayName: "酒馆助手 / JS-Slash-Runner",
              manifestVersion: "4.8.19",
              commit: "49efcca50809be8d48bfb1776bacf952ef16991b",
              repository: "https://gitlab.com/novi028/JS-Slash-Runner",
            },
            installed: true,
            verified: true,
            enabled: true,
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const health = await loadLegacyHostHealth("http://127.0.0.1:4711/");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:4711/health",
      expect.any(Object),
    );
    expect(health).toEqual({
      ok: true,
      service: "legacy-host",
      safeMode: false,
      plugins: [
        {
          id: "js-slash-runner",
          name: "酒馆助手 / JS-Slash-Runner",
          version: "4.8.19",
          repository: "https://gitlab.com/novi028/JS-Slash-Runner",
          commit: "49efcca50809be8d48bfb1776bacf952ef16991b",
          installed: true,
          verified: true,
          enabled: true,
        },
      ],
    });
  });

  it("installs only the requested legacy repository and normalizes its receipt", async () => {
    const repository = "https://gitlab.com/novi028/JS-Slash-Runner";
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        outcome: "installed",
        plugin: {
          lock: {
            id: "js-slash-runner",
            displayName: "酒馆助手 / JS-Slash-Runner",
            manifestVersion: "4.8.19",
            repository,
            commit: "49efcca50809be8d48bfb1776bacf952ef16991b",
          },
          installed: true,
          verified: true,
          enabled: false,
        },
        receipt: {
          pluginId: "js-slash-runner",
          repository,
          commit: "49efcca50809be8d48bfb1776bacf952ef16991b",
          installedAt: "2026-07-29T09:30:00.000Z",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await installLegacyPlugin(
      "js-slash-runner",
      repository,
      "http://127.0.0.1:4711/",
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:4711/plugins/js-slash-runner/install",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ repository }),
      }),
    );
    expect(
      (fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.signal,
    ).toBeInstanceOf(AbortSignal);
    expect(result).toEqual({
      outcome: "installed",
      plugin: {
        id: "js-slash-runner",
        name: "酒馆助手 / JS-Slash-Runner",
        version: "4.8.19",
        repository,
        commit: "49efcca50809be8d48bfb1776bacf952ef16991b",
        installed: true,
        verified: true,
        enabled: false,
      },
      receipt: {
        pluginId: "js-slash-runner",
        repository,
        commit: "49efcca50809be8d48bfb1776bacf952ef16991b",
        installedAt: "2026-07-29T09:30:00.000Z",
      },
    });
  });

  it("updates host-authoritative legacy plugin enablement", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        plugin: {
          lock: {
            id: "js-slash-runner",
            displayName: "酒馆助手 / JS-Slash-Runner",
            manifestVersion: "4.8.19",
            repository: "https://gitlab.com/novi028/JS-Slash-Runner",
            commit: "49efcca50809be8d48bfb1776bacf952ef16991b",
          },
          installed: true,
          verified: true,
          enabled: true,
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const status = await setLegacyPluginEnabled(
      "js-slash-runner",
      true,
      "http://127.0.0.1:4711/",
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:4711/plugins/js-slash-runner/enabled",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ enabled: true }),
      }),
    );
    expect(status).toMatchObject({
      id: "js-slash-runner",
      installed: true,
      verified: true,
      enabled: true,
    });
  });
});
