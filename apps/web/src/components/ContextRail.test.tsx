import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { createDemoWorkspace } from "../data/demoWorkspace";
import type {
  AgentProposal,
  PromptPreset,
  RegexScope,
} from "../domain/workspace";
import { ContextRail, ExtensionsDrawer } from "./ContextRail";
import { PresetSettingsRail } from "./PresetSettingsRail";

function renderRail(
  proposal: AgentProposal | null,
  presetOverride?: PromptPreset,
  regexScopesOverride?: RegexScope[],
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
        onInsertPrompt={async () => undefined}
        onDetachPrompt={async () => undefined}
        onReorderPrompts={async () => undefined}
        onClose={noop}
      />
      <ContextRail
        open
        card={state.cards.find(
          (candidate) => candidate.id === conversation.cardId,
        )}
        worldbooks={state.worldbooks.filter((worldbook) =>
          worldbookIds.has(worldbook.id),
        )}
        preset={presetOverride ?? state.presets[0]}
        regexScopes={regexScopesOverride ?? state.regexScopes}
        promptTrace={state.promptTrace}
        proposal={proposal}
        expandedPanels={{
          ...state.expandedPanels,
          preset: true,
          regex: regexScopesOverride !== undefined,
        }}
        onTogglePanel={noop}
        onClose={noop}
        onPermission={noop}
        onSaveWorldbookEntry={async () => undefined}
        onSaveRegexScope={async () => undefined}
        onConfirmToolProposal={noop}
        onRejectToolProposal={noop}
        onUndoToolProposal={noop}
      />
    </>,
  );
}

describe("ContextRail", () => {
  it("keeps card context and installed plugin menus in separate drawers", () => {
    const state = createDemoWorkspace();
    const noop = vi.fn();
    const contextHtml = renderRail(null);
    const extensionsHtml = renderToStaticMarkup(
      <ExtensionsDrawer
        open
        plugins={state.plugins}
        pluginRealms={<iframe title="插件运行菜单" />}
        onClose={noop}
        onOpenPlugins={noop}
      />,
    );

    expect(contextHtml).toContain('aria-label="上下文菜单"');
    expect(contextHtml).toContain("当前角色卡、正则、世界书与提示词轨迹");
    expect(contextHtml).not.toContain("兼容插件");
    expect(contextHtml).not.toContain("<iframe");

    expect(extensionsHtml).toContain('aria-label="扩展菜单"');
    expect(extensionsHtml).toContain("已安装插件及插件提供的功能菜单");
    expect(extensionsHtml).toContain("JS-Slash-Runner");
    expect(extensionsHtml).toContain("ST-Prompt-Template");
    expect(extensionsHtml).toContain('title="插件运行菜单"');
    expect(extensionsHtml).not.toContain("当前会话");
    expect(extensionsHtml).not.toContain("正则 ·");
    expect(extensionsHtml).not.toContain("世界书");
  });

  it("shows concrete worldbook entries with independent AI edit controls", () => {
    const state = createDemoWorkspace();
    const html = renderRail(state.agentProposal);

    expect(html).toContain("旧港钟楼");
    expect(html).toContain("北侧浅滩");
    expect(html).toContain("条目修订 3");
    expect(html).toContain("AI 禁止编辑");
    expect(html).toContain("AI 可编辑");
    expect(html).toContain("允许 AI 编辑");
    expect(html).toContain("禁止 AI 编辑");
    expect(html).toContain("关键词召回");
    expect(html).toContain("永久启用");
    expect(html).toContain("已停用");
    expect(html).toContain("编辑条目");
    expect(html).toContain("默认（沿用原始位置）");
  });

  it("keeps chat tool decisions in context without an independent Agent window", () => {
    const state = createDemoWorkspace();
    const awaiting = renderRail(state.agentProposal);
    const applied = renderRail({
      ...state.agentProposal!,
      status: "applied",
      auditId: "audit-demo",
      afterRevision: state.agentProposal!.beforeRevision + 1,
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

    expect(html).toContain("正则 · 1");
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
      ...state.agentProposal!,
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
      beforeRevision: worldbook.revision,
      targetEntryId: entry.id,
      targetEntryTitle: entry.title,
      beforeEntryRevision: entry.revision,
      diffLines: ["~ 内容：更新后的正文"],
      status: "awaiting_confirmation",
    };

    const html = renderRail(proposal);

    expect(html).toContain(`更新条目：${entry.title}`);
    expect(html).toContain(entry.id);
    expect(html).toContain(`世界书修订 ${worldbook.revision}`);
    expect(html).toContain(`条目修订 ${entry.revision}`);
    expect(html).toContain("~ 内容：更新后的正文");
  });
});
