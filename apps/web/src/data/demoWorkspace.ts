import type {
  ConversationSpace,
  LegacyPlugin,
  Participant,
  Persona,
  PromptPreset,
  RoleCard,
  WorkspaceMessage,
  WorkspaceState,
  Worldbook,
  WorldbookEntry,
} from "../domain/workspace";

export const demoParticipants: Participant[] = [
  {
    id: "participant-narrator",
    name: "旁白",
    kind: "narrator",
    accent: "slate",
  },
  {
    id: "participant-harbor",
    name: "港务员",
    kind: "character",
    accent: "coral",
  },
  {
    id: "participant-archivist",
    name: "记录员",
    kind: "character",
    accent: "mint",
  },
  {
    id: "participant-observer",
    name: "观察者",
    kind: "person",
    accent: "violet",
  },
];

export const demoCards: RoleCard[] = [
  {
    id: "world-fog-harbor",
    name: "雾港设定集",
    description: "潮汐城市、航路与居民群像",
    revision: 1,
    conversationCount: 2,
    worldbookIds: ["worldbook-harbor", "worldbook-shared"],
  },
  {
    id: "world-glasshouse",
    name: "玻璃温室",
    description: "群像协作的封闭场景",
    revision: 1,
    conversationCount: 1,
    worldbookIds: ["worldbook-shared"],
  },
  {
    id: "world-drifting-archive",
    name: "漂流档案",
    description: "无固定角色的世界探索",
    revision: 1,
    conversationCount: 1,
    worldbookIds: ["worldbook-archive"],
  },
];

export const demoConversations: ConversationSpace[] = [
  {
    id: "conversation-harbor",
    title: "雾港 · 雨后调查",
    subtitle: "与港务员继续调查潮汐钟楼附近的新线索。",
    cardId: "world-fog-harbor",
    personaId: "persona-traveler",
    revision: 1,
    worldbookIds: ["worldbook-harbor", "worldbook-shared"],
    updatedLabel: "刚刚",
    unreadCount: 0,
    pinned: true,
  },
  {
    id: "conversation-glasshouse",
    title: "玻璃温室 · 第三次会议",
    subtitle: "群像设定 · 所有旁白与人物对白都由模型在正文中统一生成。",
    cardId: "world-glasshouse",
    personaId: "persona-traveler",
    revision: 1,
    worldbookIds: ["worldbook-shared"],
    updatedLabel: "18 分钟前",
    unreadCount: 2,
    pinned: false,
  },
  {
    id: "conversation-archive",
    title: "漂流档案 · 序章",
    subtitle: "世界模式 · 模型依据世界设定回应用户输入。",
    cardId: "world-drifting-archive",
    personaId: "persona-traveler",
    revision: 1,
    worldbookIds: ["worldbook-archive"],
    updatedLabel: "昨天",
    unreadCount: 0,
    pinned: false,
  },
];

export const demoPersonas: Persona[] = [
  {
    id: "persona-traveler",
    name: "旅人",
    description: "一名习惯先观察细节、再做决定的旅人。",
    title: "默认用户人设",
    isDefault: true,
    revision: 1,
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z",
  },
];

const messages = (
  conversationId: string,
  rows: Array<Omit<WorkspaceMessage, "conversationId" | "revision">>,
): WorkspaceMessage[] =>
  rows.map((row, index) => ({
    ...row,
    conversationId,
    revision: index + 1,
  }));

export const demoMessages: Record<string, WorkspaceMessage[]> = {
  "conversation-harbor": messages("conversation-harbor", [
    {
      id: "message-harbor-1",
      role: "assistant",
      content:
        "雨停后，雾港重新显出层层屋脊。渡桥刚刚放下，潮水把一只没有署名的信匣推到了石阶边。\n\n“钟楼昨晚停过一次。”港务员把登记簿转向桌面中央，“不是故障，更像有人把那一刻从记录里拿走了。”",
      createdLabel: "10:12",
    },
    {
      id: "message-harbor-3",
      role: "user",
      content:
        "我先核对信匣上的潮痕，再去钟楼。其他人可以从值班表里找出昨晚换岗的人。",
      createdLabel: "10:16",
    },
    {
      id: "message-harbor-4",
      role: "assistant",
      content:
        "信匣底部沾着银白色的盐晶，和旧港北侧的浅滩一致。远处的钟声迟了一拍，像在等待某个回答。",
      createdLabel: "10:18",
    },
  ]),
  "conversation-glasshouse": messages("conversation-glasshouse", [
    {
      id: "message-glasshouse-1",
      role: "assistant",
      content:
        "温室的百叶窗依次合拢，长桌上的四份记录同时翻到同一页。\n\n记录员抬起头：“我们不需要先选出主角。让每个人各自确认一段记录，矛盾会自己浮出来。”",
      createdLabel: "09:40",
    },
  ]),
  "conversation-archive": messages("conversation-archive", [
    {
      id: "message-archive-1",
      role: "assistant",
      content:
        "这份档案没有人物目录。第一页只记录了一条规律：每当岛屿改变航向，天空就会多出一枚陌生的月亮。",
      createdLabel: "昨天",
    },
  ]),
};

const demoWorldbookEntry = (
  entry: Pick<
    WorldbookEntry,
    "id" | "title" | "keys" | "content" | "agentEditable" | "revision"
  > &
    Partial<WorldbookEntry>,
): WorldbookEntry => ({
  primaryKeys: entry.keys,
  secondaryKeys: [],
  secondaryLogic: "any",
  selective: false,
  enabled: true,
  constant: false,
  caseSensitive: false,
  matchWholeWords: false,
  useRegex: true,
  scanDepth: null,
  recursion: true,
  preventRecursion: false,
  excludeRecursion: false,
  delayUntilRecursion: false,
  insertionPosition: null,
  outletName: null,
  insertionDepth: null,
  insertionRole: "system",
  order: 0,
  priority: 0,
  probability: 100,
  ...entry,
});

export const demoWorldbooks: Worldbook[] = [
  {
    id: "worldbook-harbor",
    name: "雾港设定集",
    description: "从角色卡导入 · 条目默认禁止 AI 编辑",
    agentEditable: false,
    revision: 12,
    imported: true,
    hitCount: 2,
    entries: [
      demoWorldbookEntry({
        id: "entry-clocktower",
        title: "旧港钟楼",
        keys: ["钟楼", "报时", "旧港"],
        content: "钟楼的机械记录与港区潮位表保持同步。",
        agentEditable: false,
        revision: 3,
      }),
      demoWorldbookEntry({
        id: "entry-salt",
        title: "北侧浅滩",
        keys: ["盐晶", "浅滩"],
        content: "银白盐晶只在退潮后的一小时内形成。",
        constant: true,
        agentEditable: true,
        revision: 2,
      }),
    ],
    hits: [
      {
        id: "hit-clocktower",
        title: "旧港钟楼",
        keys: ["钟楼", "报时", "旧港"],
        excerpt: "钟楼的机械记录与港区潮位表保持同步。",
        score: 0.94,
      },
      {
        id: "hit-salt",
        title: "北侧浅滩",
        keys: ["盐晶", "浅滩"],
        excerpt: "银白盐晶只在退潮后的一小时内形成。",
        score: 0.81,
      },
    ],
  },
  {
    id: "worldbook-shared",
    name: "通用叙事约定",
    description: "手动创建 · 逐条管理 AI 编辑权限",
    agentEditable: true,
    revision: 4,
    imported: false,
    hitCount: 1,
    entries: [
      demoWorldbookEntry({
        id: "entry-pacing",
        title: "调查场景节奏",
        keys: ["线索", "行动"],
        content: "模型回复应在环境推进与可行动线索之间保持清晰节奏。",
        enabled: false,
        agentEditable: true,
        revision: 2,
      }),
    ],
    hits: [
      {
        id: "hit-pacing",
        title: "多人场景节奏",
        keys: ["成员", "行动"],
        excerpt: "多人回合优先保留每位参与者的独立动机。",
        score: 0.73,
      },
    ],
  },
  {
    id: "worldbook-archive",
    name: "漂流规则",
    description: "从角色卡导入 · 条目默认禁止 AI 编辑",
    agentEditable: false,
    revision: 7,
    imported: true,
    hitCount: 1,
    entries: [
      demoWorldbookEntry({
        id: "entry-moons",
        title: "天空规则",
        keys: ["月亮", "航向"],
        content: "世界规则不要求绑定任何固定角色。",
        agentEditable: false,
        revision: 4,
      }),
    ],
    hits: [
      {
        id: "hit-moons",
        title: "天空规则",
        keys: ["月亮", "航向"],
        excerpt: "世界规则不要求绑定任何固定角色。",
        score: 0.9,
      },
    ],
  },
];

export const demoPresets: PromptPreset[] = [
  {
    id: "preset-longform",
    name: "长篇叙事",
    description: "稳定节奏与环境细节",
    revision: 3,
    mode: "chat-completion",
    generation: {
      temperature: 0.8,
      topP: 0.9,
      frequencyPenalty: 0,
      presencePenalty: 0,
      maxOutputTokens: 800,
      n: 1,
      stream: true,
      stop: [],
      samplerOrder: [],
      additional: {
        maxContextTokens: 32_768,
        maxContextUnlocked: false,
      },
    },
    prompts: [
      {
        id: "preset-longform-main",
        name: "主要指令",
        role: "system",
        content: "保持叙事连贯，兼顾场景细节与人物行动。",
        enabled: true,
        order: 0,
        systemPrompt: true,
        dynamicMarker: false,
        marker: "main",
      },
      {
        id: "preset-longform-optional-summary",
        name: "回合摘要（可选）",
        role: "system",
        content: "在回复末尾用一句话总结本回合发生的关键变化。",
        enabled: false,
        order: 1,
        systemPrompt: true,
        dynamicMarker: false,
        marker: "custom",
      },
    ],
  },
  {
    id: "preset-ensemble",
    name: "群像叙事",
    description: "在一条模型回复正文中组织旁白与多位人物对白",
    revision: 1,
    mode: "chat-completion",
    generation: {
      temperature: 1,
      topP: 1,
      frequencyPenalty: 0,
      presencePenalty: 0,
      maxOutputTokens: 300,
      n: 1,
      stream: true,
      stop: [],
      samplerOrder: [],
      additional: {
        maxContextTokens: 32_768,
        maxContextUnlocked: false,
      },
    },
    prompts: [],
  },
  {
    id: "preset-compact",
    name: "紧凑推进",
    description: "更短的回复与明确行动",
    revision: 1,
    mode: "chat-completion",
    generation: {
      temperature: 0.7,
      topP: 0.95,
      frequencyPenalty: 0,
      presencePenalty: 0,
      maxOutputTokens: 512,
      n: 1,
      stream: true,
      stop: [],
      samplerOrder: [],
      additional: {
        maxContextTokens: 32_768,
        maxContextUnlocked: false,
      },
    },
    prompts: [],
  },
];

export const demoPlugins: LegacyPlugin[] = [
  {
    id: "plugin-js-slash-runner",
    name: "JS-Slash-Runner",
    version: "4.8.19",
    repository: "https://gitlab.com/novi028/JS-Slash-Runner",
    commit: "49efcca50809be8d48bfb1776bacf952ef16991b",
    status: "disabled",
    trust: "untrusted",
    host: "legacy",
    description: "可信脚本运行器；启用前需要单独确认脚本能力。",
  },
  {
    id: "plugin-st-prompt-template",
    name: "ST-Prompt-Template",
    version: "1.17.6.8",
    repository: "https://github.com/zonde306/ST-Prompt-Template",
    commit: "c80a572839f99a2aaf3d91cf9b7ebfc202c4ef0b",
    status: "disabled",
    trust: "untrusted",
    host: "legacy",
    description: "提示词模板兼容层；确认信任后在隔离的旧版扩展域运行。",
  },
];

const clone = <T>(value: T): T => structuredClone(value);

export function createDemoWorkspace(): WorkspaceState {
  return {
    availability: "demo",
    bootstrapError: null,
    conversations: clone(demoConversations),
    cards: clone(demoCards),
    personas: clone(demoPersonas),
    participants: clone(demoParticipants),
    messagesByConversation: clone(demoMessages),
    conversationNextCursor: null,
    messageNextCursorByConversation: {},
    messageHistoryLoading: {},
    worldbooks: clone(demoWorldbooks),
    presets: clone(demoPresets),
    regexScopes: [],
    providerConnections: [],
    selectedProviderId: "fake",
    plugins: clone(demoPlugins),
    agentProposal: null,
    agentRun: null,
    generation: {
      status: "idle",
      mode: null,
      conversationId: null,
      generationId: null,
      targetMessageId: null,
      preview: "",
      reasoningPreview: "",
    },
    selectedCardId: "world-fog-harbor",
    selectedConversationId: "conversation-harbor",
    selectedPresetId: "preset-longform",
    expandedPanels: {
      preset: false,
      regex: true,
      worldbooks: true,
    },
    draftByConversation: {},
    navOpen: false,
    modal: { kind: "closed" },
    toast: null,
  };
}
