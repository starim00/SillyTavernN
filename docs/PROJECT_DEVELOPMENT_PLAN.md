# SillyTavernN 项目开发规划

> 文档版本：V1.0
>
> 制定日期：2026-07-29
>
> 上游基线：SillyTavern `release` / `1.18.0` / `8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8`
>
> 目录归属：`/Users/hutiance/SillyTavernN`
>
> 状态说明：本文是新实现的早期规划存档。当前产品模型、安全边界和实现结构以
> 仓库根目录 `AGENTS.md`、现行架构文档及代码为准；与它们冲突的早期方案不再
> 作为实施依据。`/Users/hutiance/SillyTavernNG` 仅用于观察上游格式和兼容行为。

## 1. 项目目标

SillyTavernN 是一个面向 AI 角色扮演的轻量前端。项目不以完整复刻
SillyTavern 的所有功能为目标，而是保留高频 RP 主链路、现有数据兼容能力、
提示词预设生态和第三方 JavaScript 扩展能力，并把非核心功能移出默认运行时。

目标产品应做到：

1. 用户可以导入角色卡、选择 Persona、连接模型并立即开始 RP。
2. 角色、会话、提示词和 Lorebook 数据可以可靠保存、迁移和导出。
3. 原有常见提示词预设可以直接导入，并提供导入预览和兼容性报告。
4. 第三方 JavaScript 扩展仍可安装、启用和调用稳定的宿主 API。
5. 支持具备原生 Tool Calling 的模型作为 Agent，通过受控工具维护 RP 衍生资料。
6. Agent 只能修改用户明确标记为“允许 Agent 修改”的世界书。
7. 核心代码不再依赖单一巨型入口、全局可变状态或无条件加载的边角模块。
8. 可选功能通过独立扩展或懒加载模块提供，不进入核心启动链路。

## 2. 设计原则

### 2.1 核心优先

- 默认安装只包含完成一次完整 RP 所需的能力。
- 可选功能不得反向依赖核心 UI 的内部实现。
- 后端只挂载已启用模块对应的路由。
- 前端只加载当前页面和已启用扩展需要的代码。

### 2.2 兼容优先

- 数据迁移必须可预览、可回滚，不允许静默丢字段。
- 原预设无法完全映射时，保留原始数据并报告未应用字段。
- 扩展兼容通过版本化 API 和适配层实现，不直接暴露新的内部状态。
- 重构期间以现有生成结果为基准，通过 Golden Tests 比较提示词。

### 2.3 渐进替换

- 不直接在原 `public/script.js` 中大规模删除后再修补。
- 先建立契约和测试，再逐个抽取领域模块。
- 新旧实现允许短期并存，通过 Feature Flag 切换。
- 每个阶段都必须产出可运行、可回退的版本。

### 2.4 安全默认

- API Key 仅由服务端保存和使用。
- 第三方 JavaScript 扩展默认视为受信任但高风险代码。
- 扩展安装、更新和权限变化必须由用户确认。
- Agent 写工具由服务端执行和鉴权，模型输出不能直接写文件。
- 世界书默认禁止 Agent 修改，旧数据导入后也保持禁止。
- 服务端 Node.js 插件不进入首版默认能力。

## 3. 产品范围

### 3.1 P0：首版必须完成

#### 角色卡

- 角色列表、搜索和选择。
- 创建、编辑、复制、删除角色。
- 角色头像、名称、描述、性格、场景、首条消息、示例对话。
- System Prompt、Post-History Instructions、Depth Prompt。
- TavernCard PNG、JSON、CharX 导入导出。
- 导入时保留未知扩展字段，避免重新导出时数据丢失。

#### Persona

- Persona 创建、编辑、选择和删除。
- 名称、头像、描述。
- Persona 描述在提示词中的位置和深度。
- 默认 Persona 和按角色绑定 Persona。

#### 单角色聊天

- 创建、打开、重命名、删除、导入和导出会话。
- 用户消息与角色消息展示。
- 消息编辑、删除、复制。
- 重新生成、继续生成、停止生成、模拟用户回复。
- 流式输出。
- Swipe 候选回复及当前候选切换。
- 会话元数据和自动保存。
- 长会话分页或虚拟列表。

#### 提示词引擎

- 角色描述、性格、场景、示例对话。
- Persona 描述。
- System Prompt、Post-History Instructions。
- 聊天历史和当前用户输入。
- Author's Note、Depth Prompt。
- Lorebook / World Info 扫描和注入。
- 基础宏：`{{user}}`、`{{char}}`、日期时间和简单变量。
- Token 预算、上下文裁剪和最大回复长度。
- Text Completion 的 Instruct 与 Context 模板。
- Chat Completion 的消息角色和顺序编排。
- 生成前后扩展钩子。

#### 模型连接

- OpenAI-compatible Chat Completions 协议。
- 通用 Text Completions 协议。
- 模型列表、连接测试和错误展示。
- API Key、Base URL、模型名称和自定义请求头。
- Temperature、Top P、Top K、Min P、重复惩罚等通用参数。
- Streaming、Abort、超时和有限重试。
- 供应商特殊字段通过 Adapter 扩展，不写入核心流程。

#### 数据与设置

- 单用户本地数据目录。
- 原 SillyTavern 数据目录只读扫描和导入。
- 角色卡、聊天 JSONL、Persona、Lorebook、预设和设置迁移。
- 原子写入、冲突检测、基础自动备份。
- 全量数据导入导出。
- 数据格式版本和逐版本迁移器。

#### 提示词预设

- 详见第 5 节，属于 P0 正式兼容能力。

#### JavaScript 扩展

- 详见第 6 节，属于 P0 正式平台能力。

#### Agent 与工具

- 支持具备原生 Function/Tool Calling 的 Chat Completion 模型。
- Agent Run、步骤上限、中止、超时和工具结果回传。
- 世界书读取、检索以及受权限约束的条目创建、更新和删除。
- 创建和更新聊天摘要。
- 创建和更新角色档案。
- 工具调用记录、世界书变更历史、差异查看和撤销。
- 详见第 17 节，属于 P0 正式核心能力。

### 3.2 P1：核心稳定后加入

- 角色标签、收藏和文件夹。
- 会话全文搜索。
- 聊天分支与书签。
- 多角色群聊。
- 高级 Prompt 调试器和 Token 分段查看。
- 扩展权限声明与更细粒度授权。
- 可选的桌面封装。
- 多语言 UI。

### 3.3 默认不实现

以下功能不进入核心开发范围，可由后续扩展承担：

- Stable Diffusion 和其他图像生成。
- Gallery、图片元数据管理、图片描述。
- TTS、STT 和音频播放器。
- 角色表情、Sprite 自动分类。
- 翻译。
- 向量数据库、通用 RAG 和原自动摘要扩展；Agent 结构化聊天摘要属于 P0。
- 网页搜索、网页抓取和视频字幕抓取。
- Data Bank 和通用文件知识库。
- Quick Reply 内置内容。
- Regex 内置编辑器。
- Data Maid、统计面板、批量角色编辑。
- 背景图库、主题市场、可拖动 UI 布局。
- Horde、NovelAI 等独立供应商专用界面。
- 多用户、管理员和账号恢复。
- Replit、Colab 等托管环境脚本。
- 服务端任意 Node.js 插件。

说明：

- Slash Command 的注册和最小执行内核为扩展兼容而保留，但不默认注册原项目的全部命令。
- Regex、Quick Reply 等原内置模块可以作为独立扩展示例迁移，不进入核心包。
- 基础备份属于数据可靠性，不等同于原来的备份浏览器功能。

## 4. 目标架构

### 4.1 仓库结构

```text
SillyTavernN/
├── apps/
│   ├── web/                    # 浏览器端应用
│   └── server/                 # 本地 Node.js 服务
├── packages/
│   ├── domain/                 # 角色、Persona、消息、会话等领域模型
│   ├── prompt-engine/          # 提示词编排和 Token 预算
│   ├── provider-contracts/     # 模型 Adapter 接口
│   ├── provider-openai/        # OpenAI-compatible Chat Completion
│   ├── provider-text/          # 通用 Text Completion
│   ├── agent-runtime/          # Agent 循环、工具调度和运行状态
│   ├── agent-tools/            # 世界书、摘要、角色档案工具
│   ├── preset-compat/          # 原预设解析、校验和转换
│   ├── data-compat/            # 原角色卡、JSONL 和设置迁移
│   ├── extension-sdk/          # 新扩展 API、类型和测试工具
│   ├── legacy-extension-host/  # SillyTavern JS 扩展兼容桥
│   └── shared/                 # 公共 DTO、错误码和工具
├── extensions/
│   └── examples/               # 官方示例扩展和兼容性测试扩展
├── tests/
│   ├── contract/
│   ├── fixtures/
│   ├── integration/
│   └── e2e/
└── docs/
```

### 4.2 技术路线

- Node.js 20+。
- npm workspaces。
- TypeScript 严格模式。
- 服务端首阶段继续使用 Express，稳定后再评估替换。
- 前端使用 Vite + TypeScript。
- 核心 UI 使用模块化组件和显式状态 Store。
- 保留一个隔离的 Legacy DOM Host，向旧扩展提供必要的 DOM 挂载点。
- Jest 或 Vitest 用于单元测试，Playwright 用于端到端测试。
- ESLint、TypeScript、构建和测试统一进入 CI。

不建议在第一阶段直接切换到大型前端框架并重写所有页面。现有第三方扩展常依赖
DOM、jQuery 和全局对象，先建立宿主边界和兼容桥能显著降低迁移风险。

### 4.3 核心模块边界

#### Domain

只包含数据结构和业务规则，不依赖 DOM、Express 或具体模型 SDK：

- `Character`
- `Persona`
- `ChatSession`
- `ChatMessage`
- `Swipe`
- `Lorebook`
- `PromptPreset`
- `ConnectionProfile`
- `AgentRun`
- `AgentToolCall`
- `ChatSummary`
- `CharacterProfile`
- `WorldbookAccessPolicy`

#### Application

以 Use Case 组织：

- `CreateCharacter`
- `ImportCharacter`
- `OpenChat`
- `SaveChat`
- `BuildPrompt`
- `GenerateReply`
- `RunAgent`
- `ExecuteAgentTool`
- `UndoAgentChange`
- `ImportPreset`
- `ActivateExtension`

#### Infrastructure

- 文件系统 Repository。
- API Router。
- 模型 Adapter。
- 原数据迁移器。
- 扩展安装器。

UI 只能调用 Application Service，不直接读写数据目录或拼装模型请求。

## 5. 提示词预设兼容规划

### 5.1 必须支持的原格式

首版导入器必须识别：

1. Chat Completion / OpenAI 设置预设。
2. Text Completion 设置预设。
3. Kobold 设置预设。
4. NovelAI 设置预设。
5. Instruct Template。
6. Context Template。
7. System Prompt。
8. Reasoning Formatting。
9. Start Reply With。
10. Prompt Manager 的 Full 和 Character 导出。
11. Master Settings 多段组合导出。

其中 Kobold 和 NovelAI 预设不要求保留独立供应商 UI，但必须：

- 解析原 JSON。
- 将通用采样参数映射到统一模型。
- 保留无法应用的原始字段。
- 在导入报告中列出未映射字段。

### 5.2 统一预设模型

```ts
interface PromptPreset {
  schemaVersion: number;
  id: string;
  name: string;
  sourceFormat: string;
  generation: GenerationSettings;
  promptLayout?: PromptLayout;
  instructTemplate?: InstructTemplate;
  contextTemplate?: ContextTemplate;
  systemPrompt?: SystemPrompt;
  reasoningTemplate?: ReasoningTemplate;
  startReplyWith?: StartReplyWith;
  legacyPayload?: Record<string, unknown>;
}
```

### 5.3 导入流程

1. 读取 JSON，不立即写入。
2. 检测格式和版本。
3. 使用对应 Parser 转成统一模型。
4. 校验字段类型、必填项和数值范围。
5. 展示导入预览：
   - 检测到的格式；
   - 将创建或覆盖的预设；
   - 已映射字段；
   - 未映射字段；
   - 警告和错误。
6. 用户选择重命名、覆盖或跳过。
7. 原子写入。
8. 保存原始文件摘要和迁移报告。
9. 重新读取并做 Round-trip 校验。

### 5.4 兼容策略

- 不根据文件名猜测格式，使用字段特征和可选的版本字段识别。
- 不认识的字段写入 `legacyPayload`。
- 不支持的采样器参数不得被转换成错误的近似字段。
- 导入失败不得影响已有预设。
- 重复导入必须得到可预测结果。
- 导出默认使用 SillyTavernN 格式，同时提供“兼容 SillyTavern JSON”选项。

### 5.5 预设验收标准

- 上游默认 OpenAI、TextGen、Instruct、Context、System Prompt 预设均可批量导入。
- Prompt Manager Full/Character 文件可恢复提示词内容和顺序。
- Master Settings 可选择性导入各区段。
- 导入、导出、再导入后，所有已支持字段保持一致。
- 未支持字段在报告和 `legacyPayload` 中可见。
- 恶意文件名、超大 JSON、错误类型和原型污染输入有测试覆盖。

## 6. JavaScript 扩展平台规划

### 6.1 保留范围

首版保留浏览器端 JavaScript 扩展能力：

- 从本地目录发现扩展。
- 从 Git URL 安装扩展。
- 更新、启用、禁用和卸载。
- 加载 `manifest.json`。
- 按 `loading_order` 排序。
- 加载扩展 JavaScript、CSS 和本地化资源。
- 校验版本、依赖和最低客户端版本。
- 扩展激活与停用生命周期。
- 扩展设置持久化。
- 事件订阅。
- 提示词注入和生成拦截。
- 注册 Slash Command。
- 注册设置页面、工具栏按钮和聊天区域组件。

### 6.2 Manifest 兼容字段

兼容读取以下 SillyTavern 字段：

- `display_name`
- `loading_order`
- `js`
- `css`
- `author`
- `version`
- `homePage`
- `minimum_client_version`
- `requires`
- `optional`
- `dependencies`
- `i18n`
- `hooks.activate`

SillyTavernN 新增：

- `id`
- `manifest_version`
- `minimum_host_api`
- `permissions`
- `entrypoints`
- `integrity`

旧 Manifest 没有权限声明时，以 `legacy.trusted` 模式加载并显示明显警告。

### 6.3 稳定宿主 API

提供版本化全局入口：

```js
globalThis.SillyTavernN = {
  apiVersion: "1",
  getContext,
  events,
  commands,
  prompts,
  settings,
  ui,
  generation,
  characters,
  chats,
};
```

同时提供：

```js
globalThis.SillyTavern = legacyCompatibilityFacade;
```

兼容 Facade 首版至少覆盖：

- `getContext()`。
- 当前角色、Persona、聊天和消息只读快照。
- `eventSource` 与稳定事件名称。
- `extensionSettings` 命名空间。
- `saveSettingsDebounced()`。
- `setExtensionPrompt()` / `getExtensionPrompt()`。
- `generate()` / `generateQuietPrompt()`。
- `sendSystemMessage()`。
- `renderExtensionTemplateAsync()`。
- `SlashCommandParser.addCommandObject()` 兼容注册。
- 请求头和 CSRF Token 获取。
- Toast、Popup 和基础 UI Slot。

内部 Store 不直接暴露可变引用。扩展需要修改数据时必须调用命令式 API。

### 6.4 事件合同

首版稳定事件：

- `APP_READY`
- `SETTINGS_LOADED`
- `CHARACTER_SELECTED`
- `CHARACTER_UPDATED`
- `CHAT_OPENED`
- `CHAT_CHANGED`
- `MESSAGE_SENT`
- `MESSAGE_RECEIVED`
- `MESSAGE_UPDATED`
- `GENERATION_STARTED`
- `BEFORE_PROMPT_BUILD`
- `AFTER_PROMPT_BUILD`
- `BEFORE_MODEL_REQUEST`
- `MODEL_STREAM_CHUNK`
- `GENERATION_ENDED`
- `GENERATION_STOPPED`
- `PRESET_CHANGED`
- `EXTENSION_ACTIVATED`
- `EXTENSION_DEACTIVATED`

事件 Payload 使用只读 DTO，并按 API 版本维护。

### 6.5 UI 扩展点

不鼓励扩展依赖任意 DOM Selector，正式提供：

- 顶部工具栏。
- 消息输入区。
- 消息操作菜单。
- 角色详情页 Tab。
- 设置页 Section。
- 聊天消息前后插槽。
- 独立对话框。

Legacy Host 保留一组常见原 DOM ID，但只作为兼容层，不作为新扩展 SDK。

### 6.6 Slash Command

为扩展兼容保留：

- 命令注册表。
- 命名参数和位置参数。
- 自动补全基础接口。
- 命令执行结果和错误。
- 中止信号。

不在核心包中默认注册原项目全部业务命令。内置命令仅保留：

- `/help`
- `/stop`
- `/send`
- `/continue`
- `/regenerate`
- `/swipe`
- `/setvar`
- `/getvar`

其他命令作为官方扩展迁移。

### 6.7 安全边界

浏览器端 Legacy 扩展可以访问页面上下文，本质上拥有用户会话权限，因此：

- 仅允许用户主动安装。
- 安装前展示来源、Commit、权限和风险。
- 默认关闭自动更新。
- 更新前展示版本和权限差异。
- 支持固定 Git Commit。
- 记录安装来源和文件哈希。
- API Key 不通过 Context 暴露。
- 网络请求通过带权限检查的宿主 API 代理。
- 提供“安全模式启动”，跳过所有第三方扩展。

服务端 Node.js 插件具有文件系统和进程权限，P0 不支持。未来如需加入，必须单独设计
进程隔离和权限模型，不能直接沿用原 `import()` 加载方式。

### 6.8 扩展兼容等级

- A 级：只使用正式 API，无 DOM 私有依赖，必须完全兼容。
- B 级：使用原 `SillyTavern.getContext()`、事件和 Slash Command，兼容层支持。
- C 级：直接修改原页面 DOM 或导入内部源码，只提供尽力兼容。
- D 级：依赖已删除的内置功能或服务端插件，不保证兼容。

每个候选扩展都生成兼容性报告，不能笼统宣称“兼容所有 SillyTavern 扩展”。

## 7. 数据模型与迁移

### 7.1 数据目录

```text
data/
├── app.json
├── characters/
├── personas/
├── chats/
├── lorebooks/
├── presets/
├── artifacts/
│   ├── chat-summaries/
│   └── character-profiles/
├── agent-audit/
├── extensions/
├── extension-data/
├── backups/
└── migration/
```

### 7.2 数据可靠性

- 所有 JSON 使用 Schema Version。
- 聊天保存使用临时文件 + 原子替换。
- 保存前验证当前文件版本，避免多标签页覆盖。
- 迁移前创建快照。
- 迁移日志记录源文件、目标文件、结果和错误。
- 不自动删除原 SillyTavern 数据。
- 支持 Dry Run。

### 7.3 迁移顺序

1. 设置和连接配置，不迁移明文密钥到浏览器。
2. Persona。
3. 角色卡。
4. Lorebook。
5. 提示词预设。
6. 单角色聊天。
7. 旧聊天摘要转为 ChatSummary Artifact。
8. 扩展清单和扩展设置。
9. 所有导入世界书显式写入 `agentEditable=false`。
10. P1 再迁移群聊、标签和分支。

## 8. 模型 Adapter 设计

```ts
interface ModelProvider {
  id: string;
  capabilities(): ProviderCapabilities;
  testConnection(config: ConnectionConfig): Promise<ConnectionStatus>;
  listModels(config: ConnectionConfig): Promise<ModelInfo[]>;
  countTokens(input: PromptInput): Promise<number>;
  generate(
    request: GenerationRequest,
    signal: AbortSignal,
  ): AsyncIterable<GenerationEvent>;
}
```

`GenerationEvent` 统一表示：

- 文本增量。
- Reasoning 增量。
- 结构化 Tool Call。
- 使用量。
- 完成原因。
- 可恢复错误。
- 最终错误。

核心提示词引擎不得判断 OpenRouter、DeepSeek、Moonshot 等供应商名称。供应商差异由
Adapter 和 Capability 描述。

`ProviderCapabilities` 必须明确声明 `nativeToolCalling`。P0 的 Agent 只在模型明确支持
原生结构化 Tool Calling 时启用，不通过解析普通文本或 Markdown 猜测工具调用。

## 9. 开发阶段

以下为两名全职开发者的粗略规模估算，不是交付日期承诺。加入 Agent 后，单人实施通常
需要 30 至 40 周。

### Phase 0：基线与契约，1 至 2 周

任务：

- 固定上游基线 Commit。
- 收集代表性角色卡、聊天、Lorebook、预设和 Tool Call Fixture。
- 记录现有关键流程生成的最终 Prompt 和请求体。
- 选择 5 至 10 个常用第三方扩展作为兼容样本。
- 建立 CI、TypeScript、测试和 Workspace 骨架。
- 编写 ADR：数据格式、扩展信任模型、模型协议范围、Agent 权限和审计。

验收：

- Fixture 不包含真实 API Key 和私人聊天。
- 参考项目和 SillyTavernN 可以对同一输入生成可比较结果。
- CI 能执行 lint、typecheck、unit 和空壳 e2e。

### Phase 1：领域模型与数据层，2 周

任务：

- 建立 Character、Persona、Chat、Message、Lorebook、AgentArtifact 模型。
- 文件系统 Repository。
- 原子保存、Revision 条件写入、版本冲突和备份。
- 原角色卡与聊天读取器。
- 迁移 Dry Run 和报告。

验收：

- 代表性角色卡和聊天可以读入再写出。
- 未知角色卡字段不丢失。
- 保存中断不会破坏原文件。
- 旧世界书和新世界书默认 `agentEditable=false`。

### Phase 2：核心 UI 壳与单角色聊天，2 至 3 周

任务：

- 应用布局、导航和设置入口。
- 角色列表和编辑器。
- Persona 管理。
- 会话列表和消息区域。
- 世界书 Agent 可修改标记和权限说明。
- Agent 运行面板、工具记录入口和停止按钮。
- 编辑、删除、复制、重新生成、继续和 Swipe UI。
- 显式 Store，禁止新增全局可变业务状态。

验收：

- 不连接模型也能完成角色与会话 CRUD。
- 1000 条消息会话可正常打开和滚动。
- 刷新后状态一致。

### Phase 3：提示词引擎与 RP 注入，2 至 3 周

任务：

- Prompt Segment 中间表示。
- Chat Completion 和 Text Completion Renderer。
- Persona、角色、历史、Author's Note、Lorebook 注入。
- Instruct 和 Context 模板。
- Token 预算和裁剪。
- 基础宏。
- Golden Prompt 对比测试。

验收：

- 关键 Fixture 的 Segment 内容和顺序与基线一致。
- 裁剪不会删除当前输入和必要 System Prompt。
- 每个 Segment 可以追踪来源和 Token 数。

### Phase 4：模型连接与生成，2 周

任务：

- OpenAI-compatible Adapter。
- Text Completion Adapter。
- 连接配置和密钥存储。
- Streaming、停止、超时和错误。
- 原生 Tool Calling Capability 探测和统一 Tool Call 事件。
- 通用采样设置。

验收：

- 云端兼容接口和至少一个本地接口通过合同测试。
- 停止生成后不会继续写入消息。
- 网络中断不会产生损坏的会话记录。
- 不支持 Tool Calling 的模型仍可普通聊天，但 Agent 模式不可启用。

### Phase 5：提示词预设兼容，2 周

任务：

- 格式探测器和 Parser Registry。
- 第 5.1 节全部格式的解析器。
- 导入预览、冲突策略和迁移报告。
- SillyTavernN 导出和 SillyTavern 兼容导出。
- Prompt Manager 顺序迁移。

验收：

- 达成第 5.5 节全部标准。

### Phase 6：JavaScript 扩展宿主，3 至 4 周

任务：

- Manifest 解析和依赖排序。
- 动态 JS/CSS 加载。
- 生命周期和扩展设置。
- 事件总线、UI Slot、Prompt Hook。
- 只读和写入工具的扩展注册合同。
- Slash Command 最小内核。
- `SillyTavernN` SDK。
- `SillyTavern` Legacy Facade。
- Git 安装、更新、禁用、卸载和安全模式。
- 示例扩展和扩展开发模板。

验收：

- 官方示例扩展可以注册设置、按钮、事件、Prompt Hook 和命令。
- 选定的 A/B 级样本扩展通过兼容测试。
- 一个扩展加载失败不会阻止核心应用启动。
- 安全模式可以无扩展启动。

### Phase 7：Agent Runtime 与受控工具，3 至 4 周

任务：

- Agent Run 状态机、步骤上限、取消、超时和幂等键。
- 服务端 Tool Registry、JSON Schema 校验和 Effect 分类。
- 世界书只读工具。
- 世界书条目创建、更新、删除工具。
- 世界书 `agentEditable` UI、数据迁移和服务端 Policy。
- Chat Summary 和 Character Profile Artifact。
- Agent Audit Log、变更 Diff 和撤销。
- 工具确认策略和批量写入限制。
- Prompt Injection 防护和恶意 Tool Call 测试。

验收：

- 达成第 17.12 节全部标准。
- Agent 无法通过参数、旧接口或扩展绕过世界书写权限。
- Agent 不能修改角色卡正文和原聊天消息。
- Agent Run 中止后不能继续执行未完成工具。
- 世界书写入冲突不会覆盖用户的较新修改。

### Phase 8：迁移整合与 P1 取舍，2 周

任务：

- 一键扫描原数据目录。
- 统一迁移角色、聊天、摘要、预设、世界书权限默认值和扩展设置。
- 扩展兼容报告。
- 性能分析和懒加载。
- 决定是否进入群聊、标签和聊天分支。

验收：

- 迁移可重复执行。
- 失败项可单独重试。
- 旧目录不被修改。

### Phase 9：稳定化与发布，2 周

任务：

- 安全审查。
- 跨平台测试。
- 数据恢复演练。
- 文档、迁移指南和扩展开发指南。
- Alpha、Beta、Stable 发布流程。

验收：

- P0 e2e 全部通过。
- 无已知数据丢失问题。
- Prompt、预设和扩展兼容差异有公开说明。

## 10. 测试规划

### 10.1 单元测试

- 领域规则。
- Prompt Segment 排序。
- Token 裁剪。
- 宏替换。
- 预设格式识别和转换。
- Manifest 校验。
- 数据迁移器。
- Agent 状态机、步骤限制和幂等。
- Tool 参数 JSON Schema。
- WorldbookAccessPolicy。
- Revision 条件写入和撤销。

### 10.2 合同测试

- Provider Adapter。
- Repository。
- Extension Host API。
- Preset Parser。
- Character Card Parser。
- Agent Tool Executor。
- Agent Artifact Repository。

### 10.3 Golden Tests

至少覆盖：

- 基础单角色聊天。
- Persona 注入。
- System Prompt 和 PHI。
- Author's Note。
- 多条 Lorebook 命中和 Depth 注入。
- Instruct + Context 模板。
- 长上下文裁剪。
- Swipe 和 Continue。
- 扩展修改 Prompt。
- Agent 读取世界书并产生结构化工具调用。
- Agent 工具结果回传后的继续生成。

Golden 差异必须人工确认，不能直接批量更新快照。

### 10.4 端到端测试

- 导入角色卡并开始聊天。
- 创建 Persona 并确认进入请求。
- 导入预设并生成。
- 中止流式生成。
- 重启后恢复会话。
- 安装示例扩展、启用、禁用和卸载。
- 扩展注册命令和 Prompt Hook。
- 将世界书标记为可修改后由 Agent 新建和更新条目。
- 未标记世界书的写入工具返回明确拒绝且文件保持不变。
- 创建聊天摘要并确认来源消息范围。
- 创建角色档案且不改变角色卡。
- 撤销 Agent 对世界书的最近一次修改。
- 中止包含多个工具步骤的 Agent Run。
- 从原数据目录执行 Dry Run 和正式迁移。

### 10.5 非功能目标

- 核心页面不加载可选多媒体模块。
- 生产核心 JS Bundle 目标小于 1 MB gzip，扩展单独加载。
- 普通本地机器冷启动目标小于 3 秒。
- 1000 条消息会话交互无明显阻塞。
- 所有文件写入具备中断恢复测试。
- Agent 单次运行的最大步骤数、工具调用数和写入条数可配置并有硬上限。
- Agent Audit Log 不记录 API Key、Cookie、完整隐藏推理或其他密钥。

性能指标应在固定基准机器和 Fixture 上测量。

## 11. CI 与质量门槛

每个合并请求必须通过：

1. 格式检查。
2. ESLint。
3. TypeScript strict typecheck。
4. 单元测试。
5. 合同测试。
6. 构建。
7. P0 Playwright Smoke Test。

发布分支额外执行：

- 完整 e2e。
- 数据迁移 Fixture。
- Golden Prompt 对比。
- 扩展兼容矩阵。
- Agent 权限矩阵和恶意 Tool Call Fixture。
- 世界书并发修改与回滚测试。
- 依赖和安全扫描。
- 安装包 Smoke Test。

## 12. 发布与迁移策略

### Alpha

- 面向开发者和测试用户。
- 只保证新建数据。
- 提供只读迁移扫描和报告。
- 扩展仅支持官方示例。
- Agent 只开放只读工具和测试用可写世界书。

### Beta

- 开放正式数据导入。
- 支持选定 A/B 级扩展。
- 提供备份和回滚工具。
- 收集 Prompt 差异和未知预设字段。
- 开放世界书写工具、摘要和角色档案，默认采用“写入前确认”。

### Stable

- P0 全部完成。
- 数据迁移和恢复经过演练。
- 扩展兼容范围公开。
- Agent 工具、权限、审计和撤销经过安全审查。
- 不再修改核心数据 Schema，后续仅通过版本迁移演进。

项目基于 AGPL-3.0 上游代码开展时，应保留相应许可证、版权信息和源码提供方式。

## 13. 风险与应对

| 风险                           | 影响           | 应对                                                         |
| ------------------------------ | -------------- | ------------------------------------------------------------ |
| 重写后 Prompt 顺序发生细微变化 | RP 效果变化    | Segment IR、Golden Tests、双实现对比                         |
| 旧扩展依赖私有 DOM             | 无法直接运行   | Legacy DOM Host、兼容分级、样本矩阵                          |
| 扩展可以读取页面数据           | 隐私和安全风险 | 明示信任、权限、固定 Commit、安全模式                        |
| 原预设字段众多且语义重叠       | 错误映射       | Parser Registry、原始字段保留、导入报告                      |
| 数据迁移中断                   | 数据损坏       | 只读源目录、快照、原子写、可重复迁移                         |
| 供应商协议持续变化             | 核心再次膨胀   | Provider Adapter、Capability、独立发布                       |
| 为兼容而保留过多旧全局状态     | 新架构继续腐化 | Facade 隔离、版本化 API、内部 Store 不外露                   |
| 边角功能重新进入核心           | 范围失控       | P0/P1 清单、ADR、模块准入规则                                |
| 世界书内容诱导 Agent 越权      | 非授权写入     | 服务端 Policy、工具白名单、参数 Schema、提示词内容不决定权限 |
| Agent 覆盖用户刚完成的修改     | 数据丢失       | Revision/If-Match、按世界书串行化、冲突返回                  |
| Agent 大量创建错误条目         | 世界书污染     | 单次写入上限、Diff 预览、审计、撤销                          |
| 摘要或档案被当成绝对事实       | RP 设定漂移    | 来源消息引用、更新时间、用户锁定与人工修订                   |

## 14. 核心完成定义

项目满足以下条件时，视为精简版 P0 完成：

- 新用户可以在十分钟内完成角色导入、模型连接和首次对话。
- 角色、Persona、聊天、Lorebook 和预设可以可靠持久化。
- 两类模型协议均可流式生成和中止。
- 现有主要提示词预设格式可导入且有清晰兼容报告。
- 第三方 JavaScript 扩展可以通过稳定 API 注册 UI、事件、命令和 Prompt Hook。
- 支持模型可以运行受步骤限制、可中止的 Agent。
- Agent 能创建聊天摘要和角色档案，但不能直接修改原消息或角色卡。
- Agent 对未标记世界书的任何写入都在服务端被拒绝。
- Agent 写入具备 Revision 冲突检查、Audit Log、Diff 和撤销。
- 一个损坏扩展不会导致应用无法启动。
- 原 SillyTavern 数据可以只读扫描、迁移和回滚。
- 核心启动链路不包含第 3.3 节功能。
- 没有新的万行入口文件或跨领域全局状态。
- P0 测试、迁移测试和扩展合同测试全部通过。

## 15. 首批开发任务

正式编码前，按以下顺序建立任务：

1. 创建 Workspace 和 CI 骨架。
2. 建立 Fixture 脱敏规范。
3. 提取角色卡和聊天数据合同。
4. 建立 Prompt Segment IR。
5. 记录原版 Golden Prompt。
6. 建立统一预设模型和格式探测器。
7. 建立 Extension Manifest Schema。
8. 定义 `SillyTavernN` API V1。
9. 定义 Legacy `SillyTavern.getContext()` 兼容清单。
10. 定义 Agent Tool Contract 和 WorldbookAccessPolicy。
11. 设计 ChatSummary、CharacterProfile 和 AgentAudit 模型。
12. 选择第三方扩展兼容样本并固定 Commit。
13. 完成数据层和核心单角色聊天。
14. 接入两类 Provider 和 Tool Calling Capability。
15. 完成预设导入。
16. 完成扩展宿主。
17. 完成 Agent Runtime 与受控工具。
18. 执行迁移、性能和发布阶段。

## 16. 上游能力映射

本规划所述兼容能力对应当前上游实现：

| 能力                                            | 上游入口                                                     | SillyTavernN 目标模块                               |
| ----------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------- |
| 通用预设保存、删除和恢复                        | `src/endpoints/presets.js`                                   | `packages/preset-compat` + Server Preset Repository |
| Instruct、Context、System Prompt 和 Master 导入 | `public/scripts/preset-manager.js`                           | Preset Parser Registry                              |
| Prompt Manager Full/Character 导入              | `public/scripts/PromptManager.js`                            | Prompt Layout Migrator                              |
| 扩展发现和 Manifest 加载                        | `public/scripts/extensions.js`                               | `packages/legacy-extension-host`                    |
| 扩展安装、更新和卸载                            | `src/endpoints/extensions.js`                                | Server Extension Manager                            |
| 全局扩展上下文                                  | `public/scripts/st-context.js`、`public/script.js`           | `packages/extension-sdk` + Legacy Facade            |
| 扩展事件                                        | `public/scripts/events.js`                                   | Versioned Event Bus                                 |
| 扩展命令注册                                    | `public/scripts/slash-commands*`                             | Minimal Command Registry                            |
| Function Tool 注册和调用                        | `public/scripts/tool-calling.js`                             | `packages/agent-runtime`                            |
| 世界书读写                                      | `public/scripts/world-info.js`、`src/endpoints/worldinfo.js` | Worldbook Service + Agent Policy                    |
| 聊天摘要                                        | `public/scripts/extensions/memory`                           | ChatSummary Artifact Tool                           |
| 服务端 Node.js 插件                             | `src/plugin-loader.js`                                       | P0 不实现，未来单独安全设计                         |

该映射用于迁移追踪。实现过程中每移除一个上游模块，都必须先证明对应的核心能力已经
迁移、被明确排除，或由兼容层承接。

## 17. Agent 与受控工具规划

### 17.1 能力目标

Agent 是普通聊天生成之上的可选运行模式。启用后，模型可以通过项目提供的结构化工具：

- 查询当前聊天关联的世界书。
- 检索世界书条目。
- 在允许 Agent 修改的世界书中创建、更新或删除条目。
- 为当前聊天创建和更新结构化摘要。
- 为当前角色创建和更新衍生角色档案。
- 读取自己已经创建的摘要、档案和工具执行结果。

Agent 不具备以下能力：

- 执行任意 JavaScript、Shell 或操作系统命令。
- 直接调用任意 HTTP 接口。
- 读取 API Key、Cookie 和服务端密钥。
- 修改世界书的 Agent 权限标记。
- 修改未明确标记为可修改的世界书。
- 直接重写角色卡原始定义。
- 直接编辑或删除原聊天消息。
- 绕过用户、聊天和数据目录隔离。

### 17.2 Agent Runtime

一次 Agent Run 包含：

```ts
interface AgentRun {
  id: string;
  chatId: string;
  characterId: string;
  modelConnectionId: string;
  status:
    | "queued"
    | "running"
    | "waiting_confirmation"
    | "completed"
    | "failed"
    | "cancelled";
  startedAt: string;
  finishedAt?: string;
  maxSteps: number;
  currentStep: number;
  toolCallCount: number;
  idempotencyKey: string;
}
```

标准执行流：

1. 用户发送普通消息或显式启动 Agent。
2. 服务端创建 Agent Run 和不可重复使用的运行上下文。
3. Agent Runtime 根据当前权限生成可用工具清单。
4. Provider 返回原生结构化 Tool Call。
5. Runtime 校验工具名、参数 Schema、运行状态和调用上限。
6. Policy Engine 判断是否允许、是否需要确认。
7. 服务端 Tool Executor 执行工具。
8. 写操作记录 Audit、Revision 和 Diff。
9. 工具结果返回模型。
10. 模型继续调用工具或生成最终回复。
11. 达到完成、取消、错误或步骤上限后结束。

默认限制：

- 最大 Agent Step：8。
- 最大 Tool Call：16。
- 最大连续写工具：5。
- 单次世界书工具最多变更 10 个条目。
- 单次工具结果大小必须截断并分页。
- Run 被取消后，所有尚未开始的工具拒绝执行。

限制由服务端配置设定，模型和浏览器请求不能提高硬上限。

### 17.3 世界书 Agent 可修改标记

领域模型使用：

```ts
interface WorldbookAccessPolicy {
  agentEditable: boolean;
}
```

为兼容原 SillyTavern 世界书，持久化在：

```json
{
  "entries": {},
  "extensions": {
    "sillytavernng": {
      "agentEditable": false
    }
  }
}
```

规则：

1. `agentEditable` 默认值永远是 `false`。
2. 从 SillyTavern 导入的世界书没有该字段时按 `false` 处理。
3. 新建世界书默认也是 `false`。
4. 只有用户通过世界书设置 UI 或普通人工编辑接口可以改变该标记。
5. Agent Tool、模型参数和第三方 Prompt 都不能改变该标记。
6. Agent 可读取当前聊天有权访问的世界书，不代表拥有写权限。
7. `agentEditable=true` 时只开放条目级创建、更新和删除。
8. Agent 不得重命名世界书、替换整本文件、导入文件或改变关联关系。
9. 用户将标记改回 `false` 后，新的 Agent 写操作立即失效。
10. 已排队但未执行的写工具必须在真正写入前重新检查标记。

世界书列表和编辑器必须显示清晰状态：

- “仅用户可编辑”。
- “允许 Agent 修改”。

开启时展示风险说明，并记录由哪位用户在何时开启。这个 UI 标记是授权入口，但后端持久
数据才是权限判断依据。

### 17.4 世界书写入执行规则

Agent 不调用兼容旧版的整本 `/api/worldinfo/edit` 接口。所有 Agent 写入进入
`WorldbookService`：

```ts
updateEntry({
  actor: agentActor,
  worldbookId,
  entryId,
  expectedRevision,
  patch,
});
```

服务端执行顺序固定为：

1. 从 Agent Run 获取服务端创建的 Actor，拒绝客户端传入 Actor 类型。
2. 根据当前用户解析世界书真实路径。
3. 重新读取磁盘上的最新世界书。
4. 检查 `agentEditable === true`。
5. 检查 `expectedRevision` 与当前 Revision。
6. 校验 Entry Patch，只允许工具声明的字段。
7. 获取世界书级写锁。
8. 再次检查 Revision 和 `agentEditable`。
9. 创建变更前快照和 Audit。
10. 原子写入新 Revision。
11. 释放锁并返回变更 Diff。

任意检查失败都不得写文件。禁止采用“前端先判断，再调用普通保存接口”的方式实现权限。

### 17.5 内置工具清单

| 工具                       | Effect      | 默认执行策略   | 说明                                 |
| -------------------------- | ----------- | -------------- | ------------------------------------ |
| `worldbook.list`           | read        | 自动           | 列出当前聊天可访问的世界书及可写状态 |
| `worldbook.get`            | read        | 自动           | 读取指定世界书元数据和分页条目       |
| `worldbook.search`         | read        | 自动           | 按关键词、UID 或标签查询条目         |
| `worldbook.entry.create`   | write       | 可写世界书自动 | 创建一个条目                         |
| `worldbook.entry.update`   | write       | 可写世界书自动 | 按 UID 和 Revision 更新允许字段      |
| `worldbook.entry.delete`   | destructive | 默认确认       | 删除条目并生成可撤销记录             |
| `chat.summary.get`         | read        | 自动           | 读取当前聊天摘要                     |
| `chat.summary.create`      | write       | 自动           | 基于明确消息范围创建摘要             |
| `chat.summary.update`      | write       | 自动           | 基于新增消息更新摘要                 |
| `character.profile.get`    | read        | 自动           | 读取当前角色的衍生档案               |
| `character.profile.create` | write       | 自动           | 创建独立角色档案                     |
| `character.profile.update` | write       | 自动           | 更新档案并记录来源                   |
| `agent.change.undo`        | destructive | 用户主动       | 撤销一次 Agent 写入                  |

世界书写工具的参数不能直接接受完整文件内容。每次调用只操作一个明确 Worldbook ID 和
一个或有限数量的 Entry。

### 17.6 工具 Effect 与确认

每个工具注册时必须声明：

```ts
type ToolEffect = "read" | "write" | "destructive";
```

- `read`：在当前 Agent Run 授权范围内自动执行。
- `write`：满足资源 Policy 时执行，并显示结果和 Diff。
- `destructive`：默认等待用户确认。

用户可以把已标记可写的世界书设置为：

- 每次写入确认。
- 自动允许创建和更新。

删除条目默认始终确认。未来若允许用户关闭确认，也必须保留 Audit 和撤销。

世界书的 `agentEditable` 是所有写模式的必要条件。用户选择“每次确认”或点击某一次确认，
都不能让未标记的世界书临时越权写入。

### 17.7 聊天摘要

聊天摘要不再只保存在某条消息的 `extra.memory` 中，而是独立 Artifact：

```ts
interface ChatSummary {
  id: string;
  chatId: string;
  revision: number;
  sourceFromMessageId: string;
  sourceToMessageId: string;
  summary: string;
  keyEvents: string[];
  unresolvedThreads: string[];
  characterStates: Record<string, string>;
  createdBy: "agent" | "user";
  createdAt: string;
  updatedAt: string;
}
```

规则：

- 工具只能总结当前聊天中真实存在的消息范围。
- 更新摘要必须声明旧 Revision 和新增消息范围。
- 删除或编辑来源消息后，摘要标记为可能过期。
- 摘要是否注入 Prompt 由用户设置控制。
- 摘要可以人工编辑和锁定。
- Agent 不得以创建摘要为名修改原聊天消息。
- 从旧 `extra.memory` 迁移时保留来源消息位置和原始文本。

### 17.8 角色档案

角色档案是从聊天中提取的衍生资料，不是 Character Card：

```ts
interface CharacterProfile {
  id: string;
  characterId: string;
  chatId?: string;
  revision: number;
  overview: string;
  traits: string[];
  goals: string[];
  relationships: Array<{
    target: string;
    description: string;
  }>;
  facts: Array<{
    text: string;
    sourceMessageIds: string[];
    confidence: "low" | "medium" | "high";
  }>;
  createdBy: "agent" | "user";
  updatedAt: string;
}
```

规则：

- 默认按当前聊天创建档案，避免不同世界线互相污染。
- 用户可以把确认过的字段提升为角色级档案。
- 每条事实尽量记录来源消息。
- Agent 可以修改自己维护的档案，但不能修改角色卡描述、首条消息和 System Prompt。
- 档案是否注入 Prompt、以什么位置注入由用户控制。
- 用户可以锁定字段，Agent 更新时必须保留锁定内容。

### 17.9 审计、Diff 与撤销

所有 Agent 写操作记录：

```ts
interface AgentAuditRecord {
  id: string;
  runId: string;
  toolCallId: string;
  toolName: string;
  userId: string;
  chatId: string;
  resourceType: string;
  resourceId: string;
  revisionBefore: number;
  revisionAfter: number;
  patch: JsonPatch;
  inversePatch: JsonPatch;
  createdAt: string;
}
```

Audit 不保存：

- API Key。
- Cookie。
- Authorization Header。
- 完整隐藏推理。
- 与工具执行无关的私人配置。

撤销同样执行 Revision 检查。如果资源在 Agent 修改后又被用户更新，不直接强行回滚，
而是展示冲突并让用户选择如何合并。

### 17.10 Tool Registry 与扩展

内置写工具在服务端注册。JavaScript 扩展可以通过 SDK 注册 Agent Tool，但必须声明：

- 唯一名称。
- JSON Schema。
- Effect。
- 所需权限。
- 超时。
- 结果大小上限。

P0 规则：

- 浏览器端 Legacy 扩展默认只能注册 `read` 工具。
- 扩展 `write` 或 `destructive` 工具必须有服务端受控 Handler，并由用户单独授权。
- 扩展不能把普通前端回调伪装成世界书写工具。
- 扩展工具不能复用世界书普通编辑接口绕过 WorldbookAccessPolicy。
- 同名工具不允许静默覆盖。

### 17.11 Prompt Injection 与错误合同

世界书、聊天消息、角色档案和网页内容都视为不受信任文本。文本中的“忽略权限”“修改
某文件”等指令不能改变 Tool Policy。

Runtime 必须：

- 只执行已注册工具。
- 严格校验 JSON Schema。
- 拒绝未知字段或超限数组。
- 不把文件路径作为模型参数。
- 不允许模型选择 User ID、Actor 类型和数据根目录。
- 不允许工具返回密钥。
- 对工具结果做大小限制。

稳定错误码：

- `AGENT_NOT_SUPPORTED_BY_PROVIDER`
- `AGENT_RUN_CANCELLED`
- `AGENT_STEP_LIMIT_REACHED`
- `TOOL_NOT_FOUND`
- `TOOL_ARGUMENT_INVALID`
- `TOOL_PERMISSION_DENIED`
- `WORLD_BOOK_NOT_AGENT_EDITABLE`
- `WORLD_BOOK_REVISION_CONFLICT`
- `CONFIRMATION_REQUIRED`
- `ARTIFACT_REVISION_CONFLICT`

权限拒绝应作为结构化工具结果返回模型，但不能透露服务器路径或其他世界书内容。

### 17.12 Agent 验收标准

1. 新建和导入的世界书默认均为不可修改。
2. 世界书 UI 可以显示并切换 Agent 可修改标记。
3. Agent 可以读取当前聊天允许读取的世界书。
4. 未标记世界书的创建、更新、删除条目请求全部由服务端拒绝。
5. 即使模型伪造 `agentEditable=true`、Actor 或文件路径，服务端仍拒绝写入。
6. Agent 不能通过普通世界书保存接口执行工具写入。
7. 标记为可修改后，Agent 可以按条目创建和更新，并返回 Diff。
8. Agent 删除条目默认需要确认。
9. 用户在 Tool Call 执行前关闭标记时，排队写入被拒绝。
10. 并发修改产生 Revision Conflict，不覆盖较新数据。
11. 每个成功写入都有 Audit 和可用的 Inverse Patch。
12. 无后续冲突时可以撤销 Agent 修改。
13. Agent 可以创建和更新当前聊天摘要。
14. 摘要记录来源消息范围，来源变化后能标记过期。
15. Agent 可以创建和更新独立角色档案。
16. 角色档案工具不会改变 Character Card。
17. Agent Run 可以停止，停止后不会继续执行工具。
18. 达到步骤、调用或写入上限时安全终止。
19. 不支持原生 Tool Calling 的模型无法启用 Agent，但普通 RP 不受影响。
20. Audit、错误信息和工具结果中不出现密钥或服务端真实路径。
