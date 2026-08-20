/// <reference types="node" />

import { readFileSync } from "node:fs";

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
  mixedDisplayContent,
  MessageCard,
  MessageStream,
  trustedDisplayDocument,
} from "./MessageStream";
import { LegacyManagementModal } from "./LegacyManagementModal";
import { ParticipantChips } from "./WorkspacePrimitives";
import { WorkspaceModals } from "./WorkspaceModals";

const workspaceStyles = readFileSync(
  new URL("../styles.css", import.meta.url),
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

  it("offers trust and enablement for a verified installed legacy plugin", () => {
    const plugin = createDemoWorkspace().plugins.find(
      (candidate) => candidate.id === "plugin-js-slash-runner",
    )!;
    const html = renderToStaticMarkup(
      <LegacyManagementModal
        kind="plugins"
        online
        plugins={[plugin]}
        legacyHostPlugins={{
          "js-slash-runner": {
            id: "js-slash-runner",
            name: "酒馆助手 / JS-Slash-Runner",
            version: plugin.version,
            repository: plugin.repository,
            commit: plugin.commit,
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

    expect(html).toContain("已校验固定提交");
    expect(html).toContain("信任并启用");
    expect(html).not.toContain("安装服务不可用");
    const actionIndex = html.indexOf("信任并启用");
    const openingTagStart = html.lastIndexOf("<button", actionIndex);
    const openingTagEnd = html.indexOf(">", openingTagStart);
    expect(actionIndex).toBeGreaterThan(-1);
    expect(openingTagStart).toBeGreaterThan(-1);
    expect(openingTagEnd).toBeGreaterThan(openingTagStart);
    expect(html.slice(openingTagStart, openingTagEnd + 1)).not.toContain(
      "disabled",
    );
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

  it("does not create an inner scrollbar for ordinary message content", () => {
    for (const selector of [".message-item", ".message-item__content"]) {
      const block = cssBlocks(selector)[0] ?? "";
      expect(block).not.toMatch(
        /(?:^|;)\s*(?:overflow|overflow-y)\s*:\s*(?:auto|scroll)\b/,
      );
      expect(block).not.toMatch(/(?:^|;)\s*max-height\s*:/);
    }
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
