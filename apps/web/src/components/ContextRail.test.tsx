import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { createDemoWorkspace } from "../data/demoWorkspace";
import type {
  AgentProposal,
  PromptPreset,
  RegexScope,
} from "../domain/workspace";
import { RegexRail, WorldbookRail } from "./ContextRail";
import { LegacyManagementModal } from "./LegacyManagementModal";
import { PresetSettingsRail } from "./PresetSettingsRail";
import { WorkspaceModals } from "./WorkspaceModals";

function renderRailFixture(
  proposal: AgentProposal | null,
  presetOverride?: PromptPreset,
  regexScopesOverride?: RegexScope[],
  includeIndependentRails = true,
): string {
  const state = createDemoWorkspace();
  const conversation = state.conversations.find(
    (candidate) => candidate.id === state.selectedConversationId,
  )!;
  const worldbookIds = new Set(conversation.worldbookIds);
  const noop = vi.fn();

  return renderToStaticMarkup(
    <>
      <PresetSettingsRail
        open
        presets={[presetOverride ?? state.presets[0]!]}
        selectedPresetId={(presetOverride ?? state.presets[0]!).id}
        onSelectPreset={noop}
        onDeletePreset={noop}
        onTogglePrompt={async () => undefined}
        onSavePrompt={async () => undefined}
        onSaveGeneration={async () => undefined}
        onInsertPrompt={async () => undefined}
        onDetachPrompt={async () => undefined}
        onReorderPrompts={async () => undefined}
        onClose={noop}
      />
      {includeIndependentRails ? (
        <>
          <RegexRail
            card={state.cards.find(
              (candidate) => candidate.id === conversation.cardId,
            )}
            preset={presetOverride ?? state.presets[0]}
            regexScopes={regexScopesOverride ?? state.regexScopes}
            expanded={regexScopesOverride !== undefined}
            onToggle={noop}
            onSaveRegexScope={async () => undefined}
          />
          <WorldbookRail
            worldbooks={state.worldbooks.filter((worldbook) =>
              worldbookIds.has(worldbook.id),
            )}
            expanded={state.expandedPanels.worldbooks}
            onToggle={noop}
            onPermission={noop}
            onSaveWorldbookEntry={async () => undefined}
          />
        </>
      ) : null}
      <WorkspaceModals
        modal={proposal ? { kind: "agent_proposal" } : { kind: "closed" }}
        apiOnline={false}
        cards={state.cards}
        selectedCard={state.cards.find(
          (candidate) => candidate.id === conversation.cardId,
        )}
        preset={presetOverride ?? state.presets[0]}
        expandedPanels={state.expandedPanels}
        personas={state.personas}
        plugins={state.plugins}
        legacyHostPlugins={{}}
        worldbooks={state.worldbooks}
        activeWorldbooks={state.worldbooks.filter((worldbook) =>
          worldbookIds.has(worldbook.id),
        )}
        agentProposal={proposal}
        providerConnections={state.providerConnections}
        selectedProviderId={state.selectedProviderId}
        onClose={noop}
        onCreateConversation={async () => undefined}
        onImport={async () => undefined}
        onInstallPlugin={async () => undefined}
        onTogglePlugin={async () => undefined}
        onPermission={async () => undefined}
        onSelectProvider={noop}
        onSaveProvider={async () => state.providerConnections[0]!}
        onExportProvider={async () => ({
          format: "sillytavern-n.provider-connection",
          version: 1,
          connection: {
            name: "test",
            protocol: "openai-compatible",
            baseUrl: "http://example.test/v1",
            model: "test-model",
            headers: {},
            nativeToolCalling: false,
          },
        })}
        onLoadProviderModels={async () => []}
        onConfirmToolProposal={noop}
        onRejectToolProposal={noop}
        onUndoToolProposal={noop}
      />
    </>,
  );
}

function renderRail(
  proposal: AgentProposal | null,
  presetOverride?: PromptPreset,
  regexScopesOverride?: RegexScope[],
): string {
  return renderRailFixture(proposal, presetOverride, regexScopesOverride);
}

function proposalFixture(
  state: ReturnType<typeof createDemoWorkspace>,
): AgentProposal {
  const worldbook = state.worldbooks[0]!;
  return {
    id: "proposal-fixture",
    idempotencyKey: "proposal-fixture",
    runId: "run-fixture",
    targetKind: "worldbook",
    worldbookId: worldbook.id,
    worldbookName: worldbook.name,
    toolName: "worldbook.entry.create",
    toolArguments: {
      worldbookId: worldbook.id,
      expectedRevision: worldbook.revision,
      entry: { content: "内容" },
    },
    title: "新增世界书条目",
    rationale: "普通对话模型工具提案",
    beforeRevision: worldbook.revision,
    afterRevision: null,
    diffLines: ["+ 内容：内容"],
    status: "awaiting_confirmation",
    auditId: null,
  };
}

describe("ContextRail", () => {
  it("renders support panels without a context drawer", () => {
    const state = createDemoWorkspace();
    const noop = vi.fn();
    const supportHtml = renderRail(null);
    const extensionsHtml = renderToStaticMarkup(
      <LegacyManagementModal
        kind="extensions"
        plugins={state.plugins}
        pluginRealms={<iframe title="插件运行菜单" />}
        onOpenPlugins={noop}
        onClose={noop}
      />,
    );

    expect(supportHtml).not.toContain("上下文菜单");
    expect(supportHtml).toContain("当前作用域");
    expect(supportHtml).toContain("当前会话");
    expect(supportHtml).not.toContain("提示词轨迹");

    expect(extensionsHtml).not.toContain("extensions-drawer");
    expect(extensionsHtml).toContain("JS-Slash-Runner");
    expect(extensionsHtml).toContain("ST-Prompt-Template");
    expect(extensionsHtml).toContain('title="插件运行菜单"');
  });

  it("shows concrete worldbook entries with combined AI edit controls", () => {
    const state = createDemoWorkspace();
    const html = renderRail(state.agentProposal);

    expect(html).toContain("旧港钟楼");
    expect(html).toContain("北侧浅滩");
    expect(html).toContain("标题（备注）");
    expect(html).toContain("触发策略");
    expect(html).toContain("永久启用");
    expect(html).toContain("关键词匹配");
    expect(html).toContain("触发概率 %");
    expect(html).toContain("100%");
    expect(html).toContain("条目修订 3");
    expect(html).toContain("AI 禁止编辑");
    expect(html).toContain("AI 可编辑");
    expect(html).toContain('aria-label="允许 AI 编辑条目 旧港钟楼"');
    expect(html).toContain('aria-label="禁止 AI 编辑条目 北侧浅滩"');
    expect(html).toContain('aria-label="停用条目 旧港钟楼"');
    expect(html).toContain('aria-label="停用条目 北侧浅滩"');
    expect(html).toContain('aria-label="启用条目 调查场景节奏"');
    expect(html).toContain(
      'aria-label="切换条目 旧港钟楼 的触发策略，当前为关键词匹配"',
    );
    expect(html).toContain("已启用");
    expect(html).toContain("已停用");
    expect(html).toContain("编辑条目");
    expect(html).toContain("默认（沿用原始位置）");
    expect(html).not.toContain("从角色卡导入 · 条目默认禁止 AI 编辑");
    expect(html).not.toContain("钟楼的机械记录与港区潮位表保持同步。");
    expect(html).not.toContain("永久启用条目无需关键词即可进入提示词。");
  });

  it("keeps chat tool decisions in a dedicated modal", () => {
    const state = createDemoWorkspace();
    const proposal = proposalFixture(state);
    const awaiting = renderRail(proposal);
    const applied = renderRail({
      ...proposal,
      status: "applied",
      auditId: "audit-demo",
      afterRevision: proposal.beforeRevision + 1,
    });
    const empty = renderRail(null);

    expect(awaiting).toContain("模型工具提案");
    expect(awaiting).toContain("确认并应用");
    expect(awaiting).toContain("拒绝提案");
    expect(applied).toContain("撤销这次写入");
    expect(empty).not.toContain("模型工具提案");

    for (const removedLabel of [
      "Agent 活动",
      "Agent 目标",
      "生成 Agent 提案",
      "运行状态",
      "取消运行",
    ]) {
      expect(`${awaiting}${applied}${empty}`).not.toContain(removedLabel);
    }
  });

  it("shows enabled and optional preset entries with editable content", () => {
    const html = renderRail(null);

    expect(html).toContain("AI 响应配置");
    expect(html).toContain("1/2 启用");
    expect(html).toContain("主要指令");
    expect(html).toContain("回合摘要（可选）");
    expect(html).toContain('title="发送角色：system"');
    expect(html.match(/class="preset-prompt__role"/g)).toHaveLength(2);
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain("停用 主要指令");
    expect(html).toContain("启用 回合摘要（可选）");
    expect(html).toContain("拖动 主要指令 调整顺序");
    expect(html).toContain("编辑正文");
    expect(html).toContain("搜索已插入条目");
    expect(html).toContain("全部 2");
    expect(html).not.toContain("保持叙事连贯");
    expect(html).not.toContain("顺序 0");
    expect(html).not.toContain("<textarea");
  });

  it("allows static system prompts to leave the current list", () => {
    const state = createDemoWorkspace();
    const preset = state.presets[0]!;
    const html = renderRail(null, {
      ...preset,
      prompts: [
        {
          ...preset.prompts[0]!,
          id: "static-system-prompt",
          name: "变量（别动）",
          systemPrompt: true,
          dynamicMarker: false,
        },
        {
          ...preset.prompts[1]!,
          id: "dynamic-system-prompt",
          name: "动态角色描述",
          systemPrompt: true,
          dynamicMarker: true,
        },
      ],
    });

    expect(html).toContain('aria-label="移出 变量（别动）"');
    expect(html).not.toContain('aria-label="移出 动态角色描述"');
  });

  it("keeps uninserted preset definitions out of the main list", () => {
    const state = createDemoWorkspace();
    const preset = state.presets[0]!;
    const html = renderRail(null, {
      ...preset,
      prompts: [
        { ...preset.prompts[0]!, inserted: true },
        { ...preset.prompts[1]!, inserted: true },
        {
          id: "optional-uninserted",
          name: "未插入的风格选项",
          role: "system",
          content: "这段正文只在插入后才参与预设条目顺序。",
          enabled: false,
          inserted: false,
          order: 2,
          systemPrompt: false,
          dynamicMarker: false,
          marker: "custom",
        },
      ],
    });

    expect(html).toContain("1/2 启用 · 1 未插入");
    expect(html).toContain('aria-label="选择要插入的预设条目"');
    expect(html).toContain(
      '<option value="optional-uninserted" selected="">未插入的风格选项</option>',
    );
    expect(html).toContain("插入后默认保持停用");
    expect(html).toContain("全部 2");
    expect(html).not.toContain("全部 3");
    expect(html.match(/未插入的风格选项/g)).toHaveLength(1);
    expect(html).not.toContain("这段正文只在插入后才参与预设条目顺序。");
  });

  it("hides collapsed content previews and labels dynamic markers compactly", () => {
    const state = createDemoWorkspace();
    const preset = state.presets[0]!;
    const longContent = "长".repeat(500);
    const html = renderRail(null, {
      ...preset,
      prompts: [
        {
          ...preset.prompts[0]!,
          content: longContent,
          dynamicMarker: true,
        },
      ],
    });

    expect(html).not.toContain("长".repeat(20));
    expect(html).toContain(">动态</span>");
    expect(html).not.toContain("这里保存的正文不会直接进入模型");
    expect(html).not.toContain("<textarea");
  });

  it("shows imported card regexes while keeping source trust separate from entry state", () => {
    const state = createDemoWorkspace();
    const card = state.cards.find(
      (candidate) => candidate.id === state.selectedCardId,
    )!;
    const preset = state.presets[0]!;
    const scopes: RegexScope[] = [
      {
        scope: "global",
        id: "global",
        name: "全局正则",
        enabled: true,
        revision: 0,
        ownerRevision: null,
        scripts: [],
        diagnostics: [],
        updatedAt: null,
      },
      {
        scope: "card",
        id: card.id,
        name: card.name,
        enabled: false,
        revision: 0,
        ownerRevision: null,
        scripts: [
          {
            id: "card-regex-1",
            scriptName: "HTML 化开场表单",
            findRegex: "/\\[开始创建\\]/g",
            replaceString: "<section>创建表单</section>",
            trimStrings: [],
            placement: [2],
            disabled: false,
            markdownOnly: true,
            promptOnly: false,
            runOnEdit: false,
            substituteRegex: 0,
            minDepth: 0,
            maxDepth: null,
          },
        ],
        diagnostics: [],
        updatedAt: null,
      },
      {
        scope: "preset",
        id: preset.id,
        name: preset.name,
        enabled: false,
        revision: 0,
        ownerRevision: preset.revision,
        scripts: [],
        diagnostics: [],
        updatedAt: null,
      },
    ];

    const html = renderRail(null, preset, scopes);

    expect(html).toContain("当前作用域 · 1");
    expect(html).toContain("全局");
    expect(html).toContain("当前角色卡");
    expect(html).toContain("当前预设");
    expect(html).toContain("HTML 化开场表单");
    expect(html).toContain("拖动 HTML 化开场表单 调整顺序");
    expect(html).toContain("编辑 HTML 化开场表单");
    expect(html).toContain("停用 HTML 化开场表单");
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).not.toContain("/\\[开始创建\\]/g");
    expect(html).not.toContain("<section>创建表单</section>");
    expect(html).not.toContain(">模型回复</span>");
    expect(html).not.toContain("上移 HTML 化开场表单");
    expect(html).not.toContain("下移 HTML 化开场表单");
    expect(html).not.toContain("<textarea");
    expect(html).toContain("来源未授权");
    expect(html).toContain("信任并启用此来源");
    expect(html).toContain("条目已完整导入");
  });

  it("identifies the exact entry and revisions for update proposals", () => {
    const state = createDemoWorkspace();
    const worldbook = state.worldbooks[0]!;
    const entry = worldbook.entries[1]!;
    const proposal: AgentProposal = {
      id: "proposal-update",
      idempotencyKey: "proposal-update",
      runId: "run-update",
      targetKind: "worldbook",
      worldbookId: worldbook.id,
      worldbookName: worldbook.name,
      toolName: "worldbook.entry.update",
      toolArguments: {
        worldbookId: worldbook.id,
        entryId: entry.id,
        expectedRevision: worldbook.revision,
        expectedEntryRevision: entry.revision,
        patch: { content: "更新后的正文" },
      },
      title: `更新条目：${entry.title}`,
      rationale: "更新普通对话中的世界书条目",
      beforeRevision: worldbook.revision,
      targetEntryId: entry.id,
      targetEntryTitle: entry.title,
      beforeEntryRevision: entry.revision,
      diffLines: ["~ 内容：更新后的正文"],
      status: "awaiting_confirmation",
      afterRevision: null,
      auditId: null,
    };

    const html = renderRail(proposal);

    expect(html).toContain(`更新条目：${entry.title}`);
    expect(html).toContain(entry.id);
    expect(html).toContain(
      `世界书：${worldbook.name} · 修订 ${worldbook.revision}`,
    );
    expect(html).toContain(`条目修订 ${entry.revision}`);
    expect(html).toContain("~ 内容：更新后的正文");
  });
});
