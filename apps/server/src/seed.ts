import type { AppStore } from "@stn/storage";

export function seedDevelopmentWorkspace(store: AppStore): void {
  if (store.listConversations().length > 0 || store.listCards().length > 0) {
    return;
  }
  const created = store.createCard({
    id: "card-fog-harbor",
    kind: "character",
    name: "雾港港务员",
    description: "熟悉雾港潮汐、航道与旧钟楼记录的港务员。",
    participants: [
      { id: "participant-harbor", name: "港务员", role: "character" },
    ],
  });
  const conversation = store.createConversation({
    id: "conversation-harbor",
    title: "雾港 · 雨后调查",
    cardId: created.card.id,
  });
  const first = store.addUserMessage({
    id: "message-harbor-1",
    conversationId: conversation.id,
    content: "雨停后，我在石阶边发现了一个没有署名的信匣。港里有什么异常吗？",
  });
  store.addAssistantMessage({
    id: "message-harbor-2",
    conversationId: conversation.id,
    parentMessageId: first.id,
    content:
      "雾港重新显出层层屋脊，渡桥刚刚放下，潮水仍拍着石阶。\n\n港务员压低声音：“钟楼昨晚停过一次，更像有人把那一刻从记录里拿走了。”",
  });
  const worldbook = store.createWorldbook({
    id: "worldbook-harbor",
    name: "雾港世界书",
    source: "import",
    entries: [
      {
        id: "entry-clocktower",
        keys: ["钟楼", "报时", "旧港"],
        content: "钟楼的机械记录与港区潮位表保持同步。",
        metadata: { title: "旧港钟楼" },
      },
    ],
  });
  store.bindWorldbook({
    worldbookId: worldbook.id,
    scopeType: "conversation",
    scopeId: conversation.id,
  });
  store.createPreset({
    id: "preset-longform",
    name: "长篇叙事",
    kind: "native",
    payload: {
      temperature: 0.8,
      maxOutputTokens: 800,
    },
  });
}
