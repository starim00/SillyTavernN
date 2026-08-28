/// <reference types="node" />

import { readFileSync } from "node:fs";

import { getLegacyPluginProfile } from "@stn/legacy-compat/profiles";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type {
  Participant,
  ProviderConnection,
  WorkspaceMessage,
} from "../domain/workspace";
import { createDemoWorkspace } from "../data/demoWorkspace";
import { CardConversationEntry } from "./CardConversationEntry";
import {
  composerSubmissionContent,
  ConversationComposer,
  resizeComposerTextarea,
} from "./ConversationComposer";
import {
  displayContentSegments,
  htmlDisplayContent,
  highlightDialogueText,
  isHtmlDisplayContent,
  markdownDisplayContent,
  messageDisplayHtml,
  messageDisplayInlineHtml,
  mixedDisplayContent,
  MessageCard,
  MessageStream,
  trustedDisplayDocument,
} from "./MessageStream";
import { LegacyManagementModal } from "./LegacyManagementModal";
import { MessageDeleteDialog } from "./MessageDeleteDialog";
import { ParticipantChips } from "./WorkspacePrimitives";
import { WorkspaceModals } from "./WorkspaceModals";

const workspaceStyles = readFileSync(
  new URL("../styles.css", import.meta.url),
  "utf8",
);
const appShellHtml = readFileSync(
  new URL("../../index.html", import.meta.url),
  "utf8",
);

function cssBlocks(selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return Array.from(
    workspaceStyles.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "g")),
    (match) => match[1] ?? "",
  );
}

describe("workspace components", () => {
  it("renders message deletion as an application modal instead of a native confirm", () => {
    const state = createDemoWorkspace();
    const message = Object.values(state.messagesByConversation)[0]?.[0];
    expect(message).toBeDefined();

    const html = renderToStaticMarkup(
      <MessageDeleteDialog
        message={message!}
        deleting={false}
        onCancel={() => undefined}
        onConfirm={() => undefined}
      />,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain("删除消息");
    expect(html).toContain("此操作无法撤销");
    expect(html).toContain("取消");
  });

  it("shows the complete worldbook library beside the current card combination", () => {
    const state = createDemoWorkspace();
    const card = state.cards[0]!;
    const activeWorldbooks = state.worldbooks.filter((worldbook) =>
      card.worldbookIds.includes(worldbook.id),
    );
    const html = renderToStaticMarkup(
      <WorkspaceModals
        modal={{ kind: "worldbooks" }}
        apiOnline
        cards={state.cards}
        selectedCard={card}
        plugins={state.plugins}
        legacyHostPlugins={{}}
        worldbooks={state.worldbooks}
        activeWorldbooks={activeWorldbooks}
        providerConnections={state.providerConnections}
        selectedProviderId={state.selectedProviderId}
        onClose={vi.fn()}
        onCreateConversation={vi.fn()}
        onImport={vi.fn()}
        onInstallPlugin={vi.fn()}
        onTogglePlugin={vi.fn()}
        onPermission={vi.fn()}
        onSaveCardWorldbooks={vi.fn()}
        onSelectProvider={vi.fn()}
        onSaveProvider={vi.fn()}
        onExportProvider={vi.fn()}
        onLoadProviderModels={vi.fn()}
      />,
    );

    expect(html).toContain("全部世界书");
    expect(html).toContain("当前角色卡组合");
    expect(html).toContain("保存组合");
    for (const worldbook of state.worldbooks) {
      expect(html).toContain(worldbook.name);
    }
  });

  it("explains the preserved and replaced scopes before updating a role card", () => {
    const state = createDemoWorkspace();
    const card = state.cards[0]!;
    const html = renderToStaticMarkup(
      <WorkspaceModals
        modal={{ kind: "update_card", cardId: card.id }}
        apiOnline
        cards={state.cards}
        selectedCard={card}
        plugins={state.plugins}
        legacyHostPlugins={{}}
        worldbooks={state.worldbooks}
        providerConnections={state.providerConnections}
        selectedProviderId={state.selectedProviderId}
        onClose={vi.fn()}
        onCreateConversation={vi.fn()}
        onImport={vi.fn()}
        onReplaceCard={vi.fn()}
        onInstallPlugin={vi.fn()}
        onTogglePlugin={vi.fn()}
        onPermission={vi.fn()}
        onSelectProvider={vi.fn()}
        onSaveProvider={vi.fn()}
        onExportProvider={vi.fn()}
        onLoadProviderModels={vi.fn()}
      />,
    );

    expect(html).toContain("更新角色卡");
    expect(html).toContain(card.name);
    expect(html).toContain("保留卡片身份和全部历史对话");
    expect(html).toContain("保留当前已绑定的世界书组合");
    expect(html).toContain("新文件中的正则与脚本需要重新授权");
    expect(html).toContain('accept=".json,.png,.charx,.zip"');
  });

  it("keeps the Provider editor aligned with the selected connection", () => {
    const first: ProviderConnection = {
      id: "provider-first",
      name: "第一个连接",
      protocol: "openai-compatible",
      baseUrl: "http://first.example/v1",
      model: "first-model",
      headers: {},
      hasApiKey: false,
      nativeToolCalling: false,
      revision: 1,
    };
    const second: ProviderConnection = {
      id: "provider-second",
      name: "第二个连接",
      protocol: "text-completion",
      baseUrl: "http://second.example/v1",
      model: "second-model",
      headers: {},
      hasApiKey: true,
      nativeToolCalling: true,
      revision: 2,
    };
    const renderProviderModal = (selectedProviderId: string) =>
      renderToStaticMarkup(
        <WorkspaceModals
          modal={{ kind: "providers" }}
          apiOnline
          cards={[]}
          plugins={[]}
          legacyHostPlugins={{}}
          worldbooks={[]}
          providerConnections={[first, second]}
          selectedProviderId={selectedProviderId}
          onClose={vi.fn()}
          onCreateConversation={vi.fn()}
          onImport={vi.fn()}
          onInstallPlugin={vi.fn()}
          onTogglePlugin={vi.fn()}
          onPermission={vi.fn()}
          onSelectProvider={vi.fn()}
          onSaveProvider={vi.fn()}
          onExportProvider={vi.fn()}
          onLoadProviderModels={vi.fn()}
        />,
      );

    const selectedHtml = renderProviderModal(second.id);
    expect(selectedHtml).toContain('value="第二个连接"');
    expect(selectedHtml).toContain('value="http://second.example/v1"');
    expect(selectedHtml).toContain('value="second-model"');
    expect(selectedHtml).toContain("获取模型列表");
    expect(selectedHtml).toContain("可从已保存连接的接口获取模型列表。");
    expect(selectedHtml).toContain("导入");
    expect(selectedHtml).toContain("导出时包含 API Key");
    expect(selectedHtml).toContain("默认不导出已保存的 API Key。");
    expect(selectedHtml).not.toContain('value="第一个连接"');

    const builtInHtml = renderProviderModal("fake");
    expect(builtInHtml).toContain("本地确定性 Provider 信息");
    expect(builtInHtml).toContain('value="本地服务内置"');
    expect(builtInHtml).not.toContain('value="second-model"');
  });

  it("shows a verified native replacement without legacy enablement", () => {
    const plugin = createDemoWorkspace().plugins.find(
      (candidate) => candidate.id === "plugin-js-slash-runner",
    )!;
    const profile = getLegacyPluginProfile("js-slash-runner")!;
    const html = renderToStaticMarkup(
      <LegacyManagementModal
        kind="plugins"
        online
        plugins={[plugin]}
        legacyHostPlugins={{
          "js-slash-runner": {
            id: profile.id,
            uiId: profile.uiId,
            name: profile.displayName,
            version: plugin.version,
            repository: profile.repository,
            commit: profile.commit,
            executionOwner: profile.executionOwner,
            legacyRealmRole: profile.legacyRealmRole,
            capabilities: [...profile.capabilities],
            description: profile.nativeDescription,
            installed: true,
            verified: true,
            enabled: false,
          },
        }}
        onClose={vi.fn()}
        onInstall={vi.fn()}
        onToggle={vi.fn()}
      />,
    );

    expect(html).toContain("原生接管");
    expect(html).toContain("已校验固定提交");
    expect(html).toContain("不加载上游代码");
    expect(html).toContain("固定版本已校验");
    expect(html).not.toContain("信任并启用");
    expect(html).not.toContain("安装服务不可用");
    const actionIndex = html.indexOf("固定版本已校验");
    const openingTagStart = html.lastIndexOf("<button", actionIndex);
    const openingTagEnd = html.indexOf(">", openingTagStart);
    expect(actionIndex).toBeGreaterThan(-1);
    expect(openingTagStart).toBeGreaterThan(-1);
    expect(openingTagEnd).toBeGreaterThan(openingTagStart);
    expect(html.slice(openingTagStart, openingTagEnd + 1)).toContain(
      "disabled",
    );
  });

  it("retains trust and enablement for a verified legacy-runtime plugin", () => {
    const source = createDemoWorkspace().plugins[0]!;
    const plugin = {
      ...source,
      id: "plugin-fixture",
      name: "Fixture",
      executionOwner: "legacy" as const,
      legacyRealmRole: "full-runtime" as const,
    };
    const html = renderToStaticMarkup(
      <LegacyManagementModal
        kind="plugins"
        online
        plugins={[plugin]}
        legacyHostPlugins={{
          fixture: {
            id: "fixture",
            uiId: "plugin-fixture",
            name: "Fixture",
            version: "1.0.0",
            repository: "https://example.invalid/fixture",
            commit: "0000000000000000000000000000000000000000",
            executionOwner: "legacy",
            legacyRealmRole: "full-runtime",
            capabilities: [],
            description: "Clean-room fixture.",
            installed: true,
            verified: true,
            enabled: false,
          },
        }}
        onClose={vi.fn()}
        onInstall={vi.fn()}
        onToggle={vi.fn()}
      />,
    );

    expect(html).toContain("信任并启用");
    expect(html).toContain("独立兼容域");
  });

  it("starts with role cards instead of a global conversation list", () => {
    const state = createDemoWorkspace();
    const html = renderToStaticMarkup(
      <CardConversationEntry
        cards={state.cards}
        onSelectCard={vi.fn()}
        onImport={vi.fn()}
      />,
    );

    expect(html).toContain("选择角色卡");
    expect(html).toContain("雾港设定集");
    expect(html).not.toContain("雾港 · 雨后调查");
    expect(html).toContain('<button class="card-entry-item"');
    expect(html).not.toContain('role="listitem"');
  });

  it("does not render the removed card-history interstitial", () => {
    const state = createDemoWorkspace();
    const html = renderToStaticMarkup(
      <CardConversationEntry
        cards={state.cards}
        onSelectCard={vi.fn()}
        onImport={vi.fn()}
      />,
    );

    expect(html).not.toContain('class="card-history"');
    expect(html).not.toContain("返回角色卡");
    expect(html).toContain("直接进入这张角色卡最近使用的对话");
  });

  it("keeps the ordinary composer fixed to user input", () => {
    const noop = vi.fn();
    const html = renderToStaticMarkup(
      <ConversationComposer
        draft=""
        conversations={[]}
        selectedConversationId="conversation-default"
        cardName="默认角色卡"
        onDraftChange={noop}
        onSelectConversation={noop}
        onDeleteConversation={noop}
        onCreateConversation={noop}
        onImportConversation={noop}
        onExportConversation={noop}
        onOpenCards={noop}
        onOpenHelperTool={noop}
        onSend={noop}
      />,
    );

    expect(html).toContain('placeholder="输入消息…"');
    expect(html).toContain('rows="1"');
    expect(html).toContain('id="send_textarea"');
    expect(html).toContain('id="send_but"');
    expect(html).not.toMatch(/id="send_but"[^>]*disabled/gu);
    expect(html).not.toContain("发言者");
    expect(html).not.toContain("世界叙事");
  });

  it("submits the live legacy DOM value before React draft state catches up", () => {
    const legacyValue = "<init_data>legacy card form</init_data>";

    expect(composerSubmissionContent("", legacyValue, false)).toBe(legacyValue);
    expect(composerSubmissionContent("", "", false)).toBeNull();
    expect(composerSubmissionContent("", legacyValue, true)).toBeNull();
  });

  it("grows the composer with its content, caps it, and shrinks it again", () => {
    const textarea = {
      scrollHeight: 48,
      style: {
        height: "120px",
        overflowY: "auto",
      },
    };

    resizeComposerTextarea(textarea as unknown as HTMLTextAreaElement, 180);
    expect(textarea.style.height).toBe("48px");
    expect(textarea.style.overflowY).toBe("hidden");

    textarea.scrollHeight = 260;
    resizeComposerTextarea(textarea as unknown as HTMLTextAreaElement, 180);
    expect(textarea.style.height).toBe("180px");
    expect(textarea.style.overflowY).toBe("auto");

    textarea.scrollHeight = 42;
    resizeComposerTextarea(textarea as unknown as HTMLTextAreaElement, 180);
    expect(textarea.style.height).toBe("42px");
    expect(textarea.style.overflowY).toBe("hidden");
  });

  it("keeps the composer compact across desktop and mobile styles", () => {
    const composerBlocks = cssBlocks(".composer textarea");
    const minHeights = composerBlocks.flatMap((block) => {
      const value = /min-height:\s*(\d+)px/.exec(block)?.[1];
      return value === undefined ? [] : [Number(value)];
    });

    expect(composerBlocks.length).toBeGreaterThan(0);
    expect(Math.max(...minHeights)).toBeLessThanOrEqual(48);
    expect(composerBlocks.join("\n")).toMatch(/resize:\s*none/);
  });

  it("keeps iPhone portrait controls reachable inside the safe area", () => {
    expect(appShellHtml).toContain("viewport-fit=cover");
    expect(workspaceStyles).toContain(
      "--safe-area-bottom: env(safe-area-inset-bottom, 0px)",
    );
    expect(workspaceStyles).toMatch(
      /\.topbar-action-group:first-child \.topbar-button,[\s\S]*?width:\s*44px;[\s\S]*?min-height:\s*44px;/,
    );
    expect(workspaceStyles).toMatch(
      /\.message-actions \.icon-button--compact\s*\{[\s\S]*?width:\s*44px;[\s\S]*?height:\s*44px;/,
    );
    expect(workspaceStyles).toMatch(
      /\.composer__primary-action\s*\{[\s\S]*?width:\s*44px;[\s\S]*?min-height:\s*44px;/,
    );
  });

  it("renders zero and multiple participants without a singleton character slot", () => {
    const empty = renderToStaticMarkup(<ParticipantChips participants={[]} />);
    const participants: Participant[] = [
      { id: "narrator", name: "旁白", kind: "narrator", accent: "slate" },
      { id: "archivist", name: "记录员", kind: "character", accent: "mint" },
    ];
    const ensemble = renderToStaticMarkup(
      <ParticipantChips participants={participants} />,
    );

    expect(empty).toContain("无固定参与者");
    expect(ensemble).toContain("旁白");
    expect(ensemble).toContain("记录员");
    expect(`${empty}${ensemble}`).not.toContain("currentCharacter");
  });

  it("renders every message in natural document flow without fixed-height spacers", () => {
    const messages: WorkspaceMessage[] = Array.from(
      { length: 130 },
      (_, index) => ({
        id: `message-flow-${index}`,
        conversationId: "conversation-flow",
        role: index % 2 === 0 ? "assistant" : "user",
        content:
          index === 0
            ? `长回复起点\n${"自然排列的正文。".repeat(500)}\n长回复终点`
            : `消息 ${index}`,
        createdLabel: "10:30",
        revision: 1,
      }),
    );
    const noop = vi.fn();
    const html = renderToStaticMarkup(
      <MessageStream
        conversationId="conversation-flow"
        messages={messages}
        generation={{
          status: "idle",
          mode: null,
          conversationId: null,
          generationId: null,
          targetMessageId: null,
          preview: "",
          reasoningPreview: "",
        }}
        onCopy={noop}
        onUpdate={noop}
        onDelete={noop}
        onRegenerate={noop}
        onContinue={noop}
        onSelectSwipe={noop}
      />,
    );

    expect(html.match(/data-message-id=/g)).toHaveLength(messages.length);
    expect(html).toContain('id="chat"');
    expect(html).toContain('class="message-item message-item--assistant mes"');
    expect(html).toContain('mesid="0"');
    expect(html).toContain("长回复起点");
    expect(html).toContain("长回复终点");
    expect(html).not.toContain('data-virtualized="true"');
    expect(html).not.toMatch(/aria-hidden="true" style="height:[^"]+"/);
  });

  it("keeps trusted frame names on their complete-history message floors", () => {
    const message: WorkspaceMessage = {
      id: "message-visible-floor-21",
      conversationId: "conversation-long",
      role: "assistant",
      content: "Raw status",
      displayContent: "<section>Floor 21 status</section>",
      appliedRegexScriptIds: ["card-status"],
      createdLabel: "10:30",
      revision: 1,
    };
    const noop = vi.fn();
    const html = renderToStaticMarkup(
      <MessageStream
        conversationId="conversation-long"
        messages={[message]}
        messageFloorById={{ [message.id]: 21 }}
        generation={{
          status: "idle",
          mode: null,
          conversationId: null,
          generationId: null,
          targetMessageId: null,
          preview: "",
          reasoningPreview: "",
        }}
        onCopy={noop}
        onUpdate={noop}
        onDelete={noop}
        onRegenerate={noop}
        onContinue={noop}
        onSelectSwipe={noop}
      />,
    );

    expect(html).toContain('id="TH-message--21--0"');
    expect(html).toContain('mesid="21"');
    expect(html).not.toContain('id="TH-message--0--0"');
  });

  it("does not create an inner scrollbar for ordinary message content", () => {
    for (const selector of [".message-item", ".message-item__content"]) {
      const block = cssBlocks(selector)[0] ?? "";
      expect(block).not.toMatch(
        /(?:^|;)\s*(?:overflow|overflow-y)\s*:\s*(?:auto|scroll)\b/,
      );
      expect(block).not.toMatch(/(?:^|;)\s*max-height\s*:/);
    }
  });

  it("positions conversation changes immediately instead of animating from the top", () => {
    const streamBlock = cssBlocks(".message-stream")[0] ?? "";

    expect(streamBlock).toMatch(/overflow-y:\s*auto/);
    expect(streamBlock).not.toMatch(/scroll-behavior:\s*smooth/);
  });

  it("centers the composer input on the same maximum width as message content", () => {
    const workspaceBlock = cssBlocks(".conversation-workspace")[0] ?? "";
    const messageWindowBlock = cssBlocks(".message-window")[0] ?? "";
    const inputRowBlock = cssBlocks(".composer__input-row")[0] ?? "";

    expect(workspaceBlock).toMatch(/--conversation-content-width:\s*1080px/);
    expect(messageWindowBlock).toMatch(
      /width:\s*min\(var\(--conversation-content-width\),\s*calc\(100% - 44px\)\)/,
    );
    expect(inputRowBlock).toMatch(/display:\s*grid/);
    expect(inputRowBlock).toMatch(
      /grid-template-columns:\s*78px\s+minmax\(0,\s*var\(--conversation-content-width\)\)\s+78px/,
    );
    expect(inputRowBlock).toMatch(/justify-content:\s*center/);
  });

  it("renders trusted display frames as one seamless message surface", () => {
    const frameBlock = cssBlocks(".message-item__display-frame")[0] ?? "";
    const richContentBlock = cssBlocks(".message-item__rich-content")[0] ?? "";

    expect(frameBlock).toMatch(/height\s*:\s*20px/);
    expect(frameBlock).toMatch(/margin\s*:\s*0/);
    expect(frameBlock).toMatch(/border\s*:\s*0/);
    expect(frameBlock).toMatch(/border-radius\s*:\s*0/);
    expect(frameBlock).toMatch(/background\s*:\s*transparent/);
    expect(richContentBlock).toMatch(/gap\s*:\s*0/);

    const document = trustedDisplayDocument("<main>状态栏</main>");
    expect(document).toContain("background: transparent");
    expect(document).not.toContain("background:#ffffff!important");
  });

  it("exposes copy, edit, delete, regenerate, continue, and Swipe controls", () => {
    const message: WorkspaceMessage = {
      id: "message-test",
      conversationId: "conversation-test",
      role: "assistant",
      content: "第一候选",
      createdLabel: "10:30",
      revision: 2,
      swipes: [
        { id: "swipe-1", content: "第一候选" },
        { id: "swipe-2", content: "第二候选" },
      ],
      activeSwipeIndex: 0,
    };
    const noop = vi.fn();
    const html = renderToStaticMarkup(
      <MessageCard
        message={message}
        isLast
        onCopy={noop}
        onUpdate={noop}
        onDelete={noop}
        onRegenerate={noop}
        onContinue={noop}
        onSelectSwipe={noop}
      />,
    );

    for (const label of [
      "模型",
      "模型回复",
      "复制消息",
      "编辑消息",
      "删除消息",
      "重新生成并创建 Swipe",
      "从这里继续",
      "下一个 Swipe",
    ]) {
      expect(html).toContain(label);
    }
    expect(html).not.toContain("记录员");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<iframe");
    expect(html).toContain("第一候选");
  });

  it("labels messages with the active persona, card, and generating Provider", () => {
    const noop = vi.fn();
    const assistant = renderToStaticMarkup(
      <MessageCard
        message={{
          id: "message-attributed-assistant",
          conversationId: "conversation-test",
          role: "assistant",
          content: "欢迎回来。",
          createdLabel: "10:30",
          revision: 1,
          providerName: "Claude 主连接",
        }}
        userName="旅行者"
        cardName="雾港档案"
        isLast
        onCopy={noop}
        onUpdate={noop}
        onDelete={noop}
        onRegenerate={noop}
        onContinue={noop}
        onSelectSwipe={noop}
      />,
    );
    const user = renderToStaticMarkup(
      <MessageCard
        message={{
          id: "message-attributed-user",
          conversationId: "conversation-test",
          role: "user",
          content: "继续。",
          createdLabel: "10:31",
          revision: 1,
        }}
        userName="旅行者"
        cardName="雾港档案"
        isLast={false}
        onCopy={noop}
        onUpdate={noop}
        onDelete={noop}
        onRegenerate={noop}
        onContinue={noop}
        onSelectSwipe={noop}
      />,
    );

    expect(assistant).toContain("雾港档案");
    expect(assistant).toContain("Claude 主连接");
    expect(assistant).not.toContain(">模型<");
    expect(user).toContain("旅行者");
    expect(user).not.toContain("Claude 主连接");
  });

  it("renders Markdown inside a semantic document wrapper", () => {
    const displayContent = `<dream>
## 降临方式

**【观察者，时间锚点已锁定。】**

1. 命运承载者
2. 降临者

| 选项 | 状态 |
| --- | --- |
| 身份 | 待选择 |
</dream>
<tableEdit>`;
    const message: WorkspaceMessage = {
      id: "message-markdown-document",
      conversationId: "conversation-test",
      role: "assistant",
      content: displayContent,
      displayContent,
      appliedRegexScriptIds: [],
      createdLabel: "10:31",
      revision: 1,
    };
    const noop = vi.fn();
    const html = renderToStaticMarkup(
      <MessageCard
        message={message}
        isLast
        onCopy={noop}
        onUpdate={noop}
        onDelete={noop}
        onRegenerate={noop}
        onContinue={noop}
        onSelectSwipe={noop}
      />,
    );

    expect(isHtmlDisplayContent(displayContent)).toBe(false);
    expect(markdownDisplayContent(displayContent)).toMatch(/^## 降临方式/u);
    expect(
      markdownDisplayContent("<dream>芝加哥的酒店房间</dream> <tableEdit>"),
    ).toBe("芝加哥的酒店房间");
    expect(html).toContain(">降临方式</h2>");
    expect(html).toContain("<strong>【观察者，时间锚点已锁定。】</strong>");
    expect(html).toContain('<ol start="1">');
    expect(html).toContain("<table>");
    expect(html).toContain("message-item__content--markdown");
    expect(html).not.toContain("&lt;dream&gt;");
    expect(html).not.toContain("&lt;tableEdit&gt;");
    expect(html).not.toContain("<iframe");
  });

  it("formats Prompt Template base and inline display content as HTML", () => {
    const block = messageDisplayHtml(
      '**状态**\n\n<section class="meter">80</section>',
    );

    expect(block).toContain("<strong>状态</strong>");
    expect(block).toContain('<section class="meter">80</section>');
    expect(messageDisplayInlineHtml("**80**")).toContain("<strong>80</strong>");
  });

  it("renders trusted Prompt Template output for both roles in the compatibility frame", () => {
    const noop = vi.fn();
    for (const role of ["user", "assistant"] as const) {
      const message: WorkspaceMessage = {
        id: `message-prompt-template-${role}`,
        conversationId: "conversation-test",
        role,
        content: "raw <%= variables.hp %>",
        createdLabel: "10:31",
        revision: 1,
      };
      const html = renderToStaticMarkup(
        <MessageCard
          message={message}
          messageIndex={7}
          promptTemplateDisplay={{
            content: "<p>Rendered <strong>80</strong></p>",
            trusted: true,
          }}
          isLast={false}
          onCopy={noop}
          onUpdate={noop}
          onDelete={noop}
          onRegenerate={noop}
          onContinue={noop}
          onSelectSwipe={noop}
        />,
      );

      expect(html).toContain("<iframe");
      expect(html).toContain('id="TH-message--7--prompt-template"');
      expect(html).toContain("提示词模板显示内容");
      expect(html).not.toContain("raw &lt;%=");
    }
  });

  it("keeps untrusted Prompt Template cleanup on the inert Markdown path", () => {
    const noop = vi.fn();
    const message: WorkspaceMessage = {
      id: "message-prompt-template-untrusted",
      conversationId: "conversation-test",
      role: "assistant",
      content: "raw <%= blocked() %>",
      createdLabel: "10:31",
      revision: 1,
    };
    const html = renderToStaticMarkup(
      <MessageCard
        message={message}
        promptTemplateDisplay={{
          content: "Safe **status** <script>blocked()</script>",
          trusted: false,
        }}
        isLast={false}
        onCopy={noop}
        onUpdate={noop}
        onDelete={noop}
        onRegenerate={noop}
        onContinue={noop}
        onSelectSwipe={noop}
      />,
    );

    expect(html).toContain("<strong>status</strong>");
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("<script>blocked()");
  });

  it("marks quoted dialogue without changing code blocks", () => {
    const message: WorkspaceMessage = {
      id: "message-dialogue-styling",
      conversationId: "conversation-test",
      role: "assistant",
      content:
        '普通叙述。\n\n“先别关灯。” 港务员压低声音。\n\n```json\n{"text":"不要染色"}\n```',
      createdLabel: "10:33",
      revision: 1,
    };
    const noop = vi.fn();
    const html = renderToStaticMarkup(
      <MessageCard
        message={message}
        isLast
        onCopy={noop}
        onUpdate={noop}
        onDelete={noop}
        onRegenerate={noop}
        onContinue={noop}
        onSelectSwipe={noop}
      />,
    );

    expect(highlightDialogueText("“对白”与普通正文")).toBeTruthy();
    expect(html).toContain(
      '<span class="message-item__dialogue">“先别关灯。”</span>',
    );
    expect(html).toContain("{&quot;text&quot;:&quot;不要染色&quot;}");
    expect(html).not.toContain(
      'class="message-item__dialogue">{&quot;text&quot;',
    );
  });

  it("always parses user Markdown instead of treating wrappers as rich HTML", () => {
    const displayContent = `<init_data>
\`\`\`yaml
# AI任务指令
创角档案:
  核心人格:
    姓名: "风间澪"
\`\`\`
</init_data>`;
    const message: WorkspaceMessage = {
      id: "message-user-yaml",
      conversationId: "conversation-test",
      role: "user",
      content: displayContent,
      displayContent,
      appliedRegexScriptIds: [],
      createdLabel: "15:42",
      revision: 1,
    };
    const noop = vi.fn();
    const renderMessage = (renderRichContent: boolean) =>
      renderToStaticMarkup(
        <MessageCard
          message={message}
          isLast={false}
          renderRichContent={renderRichContent}
          onCopy={noop}
          onUpdate={noop}
          onDelete={noop}
          onRegenerate={noop}
          onContinue={noop}
          onSelectSwipe={noop}
        />,
      );
    const richContentHtml = renderMessage(true);
    const depthLimitedHtml = renderMessage(false);

    for (const html of [richContentHtml, depthLimitedHtml]) {
      expect(html).toContain("message-item__content--markdown");
      expect(html).toContain('<code class="language-yaml lang-yaml">');
      expect(html).toContain("# AI任务指令");
      expect(html).not.toContain("```yaml");
      expect(html).not.toContain("&lt;init_data&gt;");
      expect(html).not.toContain("<iframe");
    }
  });

  it("runs trusted regex HTML in an unsandboxed same-origin frame", () => {
    const message: WorkspaceMessage = {
      id: "message-regex-html",
      conversationId: "conversation-test",
      role: "assistant",
      content: "raw content for edit and copy",
      displayContent:
        "<section>safe display<script>globalThis.compromised = true</script></section>",
      appliedRegexScriptIds: ["card-display"],
      createdLabel: "10:31",
      revision: 1,
    };
    const noop = vi.fn();
    const html = renderToStaticMarkup(
      <MessageCard
        message={message}
        isLast
        onCopy={noop}
        onUpdate={noop}
        onDelete={noop}
        onRegenerate={noop}
        onContinue={noop}
        onSelectSwipe={noop}
      />,
    );
    const sourceDocument = trustedDisplayDocument(
      message.displayContent ?? "",
      "TH-message--3--0",
    );
    const trustedSourceDocument = trustedDisplayDocument(
      `${message.displayContent ?? ""}
        <script>
          localStorage.setItem("profile", "saved");
          const profileName = prompt("方案名称", "默认方案");
          if (confirm("清除方案？")) alert(profileName);
          window.parent.document.querySelector("#send_textarea").value = "开始创建";
          const Mvu = window.parent?.Mvu || window.top?.Mvu;
          await Mvu.replaceMvuData({ stat_data: { favor: 4 } });
        </script>`,
      "TH-message--3--0",
    );
    const pendingSourceDocument = trustedDisplayDocument(
      message.displayContent ?? "",
      "TH-message--3--0",
      false,
    );

    expect(html).toContain("<iframe");
    expect(html).not.toContain("sandbox=");
    expect(html).toContain('id="TH-message--0--0"');
    expect(html).toContain('scrolling="no"');
    expect(html).toContain('data-execution-model="trusted-same-origin"');
    expect(html).toContain('data-auto-height="true"');
    expect(html).toContain('data-applied-regex="card-display"');
    expect(sourceDocument).not.toContain("Content-Security-Policy");
    expect(sourceDocument).toContain('content="TH-message--3--0"');
    expect(sourceDocument).toContain("const host=window.parent");
    expect(sourceDocument).toContain(
      'Object.defineProperty(window,"SillyTavern"',
    );
    expect(sourceDocument).toContain("helper._bind??{}");
    expect(sourceDocument).toContain("body>p");
    expect(sourceDocument).toContain("color:#202124!important");
    expect(sourceDocument).toContain("stn-message-dialogue");
    expect(sourceDocument).not.toContain("background:#fff1f0");
    expect(sourceDocument).toContain("new MutationObserver(decorate)");
    expect(sourceDocument).toContain(".observe(root,");
    expect(sourceDocument).not.toContain(".observe(document.body,");
    expect(trustedSourceDocument).toContain(
      'window.parent.document.querySelector("#send_textarea")',
    );
    expect(trustedSourceDocument).toContain("window.parent?.Mvu");
    expect(trustedSourceDocument).toContain(
      'localStorage.setItem("profile", "saved")',
    );
    expect(trustedSourceDocument).toContain('prompt("方案名称", "默认方案")');
    expect(trustedSourceDocument).toContain('confirm("清除方案？")');
    expect(trustedSourceDocument).toContain("alert(profileName)");
    expect(trustedSourceDocument).not.toContain("__stnParentDocument");
    expect(trustedSourceDocument).not.toContain("__stnLocalStorage");
    expect(pendingSourceDocument).toContain("正在加载可信脚本运行时");
    expect(pendingSourceDocument).not.toContain("globalThis.compromised");
    expect(message.content).toBe("raw content for edit and copy");
    expect(isHtmlDisplayContent(message.displayContent ?? "")).toBe(true);
  });

  it("keeps an injected fenced HTML status bar separate from message Markdown", () => {
    const displayContent = `<dream>
## 正文标题

这里是模型正文。
</dream>

\`\`\`
<!DOCTYPE html>
<html><body><div class="calendar-container">状态栏</div></body></html>
\`\`\``;
    const segments = displayContentSegments(displayContent);
    const message: WorkspaceMessage = {
      id: "message-mixed-regex-html",
      conversationId: "conversation-test",
      role: "assistant",
      content: "raw content",
      displayContent,
      appliedRegexScriptIds: ["card-status"],
      createdLabel: "10:31",
      revision: 1,
    };
    const noop = vi.fn();
    const html = renderToStaticMarkup(
      <MessageCard
        message={message}
        isLast
        onCopy={noop}
        onUpdate={noop}
        onDelete={noop}
        onRegenerate={noop}
        onContinue={noop}
        onSelectSwipe={noop}
      />,
    );

    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ kind: "markdown" });
    expect(segments[1]).toMatchObject({ kind: "html" });
    expect(segments[0]?.content).toContain("这里是模型正文。");
    expect(segments[1]?.content).toContain(
      '<div class="calendar-container">状态栏</div>',
    );
    expect(html).toContain("message-item__rich-content");
    expect(html.match(/<iframe/gu)).toHaveLength(1);
    expect(html).toContain("message-item__content--markdown");
    expect(html).toContain(">正文标题</h2>");
  });

  it("clips incidental cross-axis overflow in vertically scrolling trusted content", () => {
    const document = trustedDisplayDocument(`
      <style>.status-content { height: 200px; overflow-y: auto; }</style>
      <section class="status-content">状态栏</section>
    `);

    expect(document).toContain('[data-stn-clip-incidental-overflow-x="true"]');
    expect(document).toContain('style.overflowX==="auto"');
    expect(document).toContain("element.scrollWidth<=element.clientWidth+1");
    expect(document).toContain('style.overflowY==="scroll"');
  });

  it("keeps consecutive fenced HTML documents in separate trusted frames", () => {
    const displayContent = `\`\`\`html
<!DOCTYPE html>
<html><body><main class="opening-form">开场表单</main></body></html>
\`\`\`

\`\`\`html
<!DOCTYPE html>
<html><body><aside class="status-panel">状态栏</aside></body></html>
\`\`\``;
    const segments = displayContentSegments(displayContent);
    const message: WorkspaceMessage = {
      id: "message-consecutive-regex-html",
      conversationId: "conversation-test",
      role: "assistant",
      content: "[开始创建]\n\n<StatusPlaceHolderImpl/>",
      displayContent,
      appliedRegexScriptIds: ["card-opening", "card-status"],
      createdLabel: "10:31",
      revision: 1,
    };
    const noop = vi.fn();
    const html = renderToStaticMarkup(
      <MessageCard
        message={message}
        isLast
        onCopy={noop}
        onUpdate={noop}
        onDelete={noop}
        onRegenerate={noop}
        onContinue={noop}
        onSelectSwipe={noop}
      />,
    );

    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ kind: "html" });
    expect(segments[1]).toMatchObject({ kind: "html" });
    expect(segments[0]?.content).toContain(
      '<main class="opening-form">开场表单</main>',
    );
    expect(segments[1]?.content).toContain(
      '<aside class="status-panel">状态栏</aside>',
    );
    expect(html.match(/<iframe/gu)).toHaveLength(2);
  });

  it("keeps a Tavern Helper full document body style away from prose", () => {
    const displayContent = `正文段落。

<current_event>当前事件</current_event>

\`\`\`
<!DOCTYPE html>
<html>
<head><style>body { display: flex; }</style></head>
<body><div class="calendar-container">交互日历</div></body>
</html>
\`\`\``;
    const segments = displayContentSegments(displayContent);

    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ kind: "mixed" });
    expect(segments[1]).toMatchObject({ kind: "html" });

    const proseDocument = trustedDisplayDocument(
      mixedDisplayContent(segments[0]!.content),
    );
    const calendarDocument = trustedDisplayDocument(segments[1]!.content);
    expect(proseDocument).toContain("正文段落。");
    expect(proseDocument).not.toContain("body { display: flex; }");
    expect(proseDocument).not.toContain("calendar-container");
    expect(calendarDocument).toContain("body { display: flex; }");
    expect(calendarDocument).toContain(
      '<div class="calendar-container">交互日历</div>',
    );
  });

  it("keeps arbitrary regex-injected HTML intact in one mixed document", () => {
    const displayContent = `<style>
.thinking { color: rebeccapurple; }
</style>
<status-panel data-kind="thinking">
<details class="thinking">
<summary>
  <i class="fa-solid fa-server"></i>
  <span>变量更新LOG // 处理完成</span>
  <div style="flex: 1"></div>
  <i class="fa-solid fa-caret-down"></i>
</summary>
<div>重点

- 条目一
- 条目二</div>
</details>
</status-panel>

正文仍然支持 **Markdown**。

\`\`\`
<!DOCTYPE html>
<html><body><div class="calendar">状态栏</div></body></html>
\`\`\``;
    const segments = displayContentSegments(displayContent);
    const mixedHtml = mixedDisplayContent(segments[0]!.content);
    const message: WorkspaceMessage = {
      id: "message-mixed-raw-html",
      conversationId: "conversation-test",
      role: "assistant",
      content: "raw content",
      displayContent,
      appliedRegexScriptIds: ["preset-thinking", "card-status"],
      createdLabel: "10:32",
      revision: 1,
    };
    const noop = vi.fn();
    const html = renderToStaticMarkup(
      <MessageCard
        message={message}
        isLast
        onCopy={noop}
        onUpdate={noop}
        onDelete={noop}
        onRegenerate={noop}
        onContinue={noop}
        onSelectSwipe={noop}
      />,
    );

    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ kind: "mixed" });
    expect(segments[1]).toMatchObject({ kind: "html" });
    expect(mixedHtml).toContain("<style>");
    expect(mixedHtml).toContain('<status-panel data-kind="thinking">');
    expect(mixedHtml).toContain('<details class="thinking">');
    expect(mixedHtml).toContain("<span>变量更新LOG // 处理完成</span>");
    expect(mixedHtml).not.toMatch(
      /<summary[^>]*>[\s\S]*?<br\s*\/?>[\s\S]*?<\/summary>/u,
    );
    expect(mixedHtml).not.toMatch(
      /<summary[^>]*>[\s\S]*?<pre>[\s\S]*?<\/summary>/u,
    );
    expect(segments[1]?.content).toContain(
      '<div class="calendar">状态栏</div>',
    );
    expect(mixedHtml).toContain("<strong>Markdown</strong>");
    expect(html.match(/<iframe/gu)).toHaveLength(2);
    expect(html).not.toContain("message-item__content--markdown");
  });

  it("defers full frontend documents beyond render depth without flattening mixed HTML", () => {
    const displayContent = `正文仍然可见。

\`\`\`html
<!DOCTYPE html>
<html><body><main>行动选项</main></body></html>
\`\`\`

<details class="variable-log">
<summary>变量更新LOG // 处理完成</summary>
<div>变更记录</div>
</details>

\`\`\`html
<!DOCTYPE html>
<html><body><aside>状态总览</aside></body></html>
\`\`\``;
    const message: WorkspaceMessage = {
      id: "message-depth-limited-rich-content",
      conversationId: "conversation-test",
      role: "assistant",
      content: "raw content",
      displayContent,
      appliedRegexScriptIds: [
        "card-options",
        "preset-variables",
        "card-status",
      ],
      createdLabel: "10:32",
      revision: 1,
    };
    const noop = vi.fn();
    const html = renderToStaticMarkup(
      <MessageCard
        message={message}
        isLast
        renderRichContent={false}
        collapseCodeBlocks="frontend"
        onCopy={noop}
        onUpdate={noop}
        onDelete={noop}
        onRegenerate={noop}
        onContinue={noop}
        onSelectSwipe={noop}
      />,
    );

    expect(html.match(/显示前端代码块/gu)).toHaveLength(2);
    expect(html.match(/<iframe/gu)).toHaveLength(1);
    expect(html).toContain("变量更新LOG // 处理完成");
    expect(html).not.toContain("&lt;!DOCTYPE html&gt;");
    expect(html).not.toContain('<code class="language-html lang-html">');
  });

  it("unwraps a full fenced HTML greeting only in its display copy", () => {
    const raw =
      "```\r\n<!DOCTYPE html><html><body>Greeting</body></html>\r\n```";
    const display = htmlDisplayContent(raw);
    const document = trustedDisplayDocument(raw);

    expect(display).toBe("<!DOCTYPE html><html><body>Greeting</body></html>");
    expect(document).toContain(
      "<!DOCTYPE html><html><body>Greeting</body></html>",
    );
    expect(document).not.toContain("```");
    expect(raw.startsWith("```")).toBe(true);
  });

  it("renders persisted model reasoning in a collapsed disclosure", () => {
    const noop = vi.fn();
    const html = renderToStaticMarkup(
      <MessageCard
        message={{
          id: "message-reasoning",
          conversationId: "conversation-test",
          role: "assistant",
          content: "最终回复",
          reasoningText: "先检查上下文，再组织回复。",
          createdLabel: "10:33",
          revision: 1,
        }}
        isLast
        onCopy={noop}
        onUpdate={noop}
        onDelete={noop}
        onRegenerate={noop}
        onContinue={noop}
        onSelectSwipe={noop}
      />,
    );

    expect(html).toContain("思考过程");
    expect(html).toContain("先检查上下文，再组织回复。");
    expect(html).toContain('<details class="message-reasoning">');
    expect(html).not.toContain('<details class="message-reasoning" open="">');
  });
});
