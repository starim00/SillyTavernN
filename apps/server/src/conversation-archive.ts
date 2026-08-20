import { isJsonObject, sanitizeJsonValue } from "@stn/core";
import type { JsonObject } from "@stn/contracts";
import type { AppStore } from "@stn/storage";

const tavernHelperExtensionId = "stn.tavern-helper";

function optionalObjectSetting(
  store: AppStore,
  key: string,
): JsonObject | undefined {
  try {
    const value = store.getExtensionSetting(tavernHelperExtensionId, key).value;
    return isJsonObject(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function exportConversationArchive(
  store: AppStore,
  conversationId: string,
): JsonObject {
  const conversation = store.getConversation(conversationId);
  const card = store.getCard(conversation.cardId);
  const participants = new Map(
    store
      .listConversationParticipants(conversation.id)
      .map((participant) => [participant.id, participant]),
  );
  const messages = store.listMessages(conversation.id);
  const providerContexts = new Map(
    store
      .listProviderSwipeContexts(conversation.id)
      .map((context) => [context.swipeId, context]),
  );
  const messageVariables = Object.fromEntries(
    messages.flatMap((message) => {
      const variables = optionalObjectSetting(
        store,
        `variables:message:${message.id}`,
      );
      return variables === undefined ? [] : [[message.id, variables]];
    }),
  );
  const swipeVariables = Object.fromEntries(
    messages.flatMap((message) =>
      message.swipes.flatMap((swipe) => {
        const variables = optionalObjectSetting(
          store,
          `variables:swipe:${swipe.id}`,
        );
        return variables === undefined ? [] : [[swipe.id, variables]];
      }),
    ),
  );
  const chatVariables = optionalObjectSetting(
    store,
    `variables:conversation:${conversation.id}`,
  );

  const archive = {
    spec: "sillytavern_n_conversation",
    version: 1,
    exportedAt: new Date().toISOString(),
    title: conversation.title,
    personaId: conversation.personaId,
    card: { id: card.id, name: card.name },
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messages: messages.map((message) => {
      const participant = message.participantId
        ? participants.get(message.participantId)
        : undefined;
      const swipes =
        message.swipes.length > 0
          ? message.swipes
          : [
              {
                id: `content:${message.id}`,
                messageId: message.id,
                position: 0,
                content: message.content,
                reasoningText: null,
                selected: true,
                revision: 1,
                createdAt: message.createdAt,
                updatedAt: message.updatedAt,
              },
            ];
      const selectedSwipe =
        swipes.find((swipe) => swipe.selected) ?? swipes[0]!;
      return {
        id: message.id,
        parentMessageId: message.parentMessageId,
        role: message.role,
        participantId: message.participantId,
        author: {
          kind: message.role,
          ...(message.participantId === null
            ? {}
            : { participantId: message.participantId }),
          ...(participant === undefined
            ? {}
            : { displayName: participant.name }),
        },
        content: message.content,
        activeSwipeId: selectedSwipe.id,
        createdAt: message.createdAt,
        updatedAt: message.updatedAt,
        swipes: swipes.map((swipe) => {
          const providerContext = providerContexts.get(swipe.id);
          return {
            id: swipe.id,
            content: swipe.content,
            createdAt: swipe.createdAt,
            updatedAt: swipe.updatedAt,
            ...(swipe.reasoningText === null
              ? {}
              : { reasoningText: swipe.reasoningText }),
            ...(providerContext === undefined
              ? {}
              : {
                  providerContext: {
                    connectionId: providerContext.connectionId,
                    items: providerContext.items,
                  },
                }),
          };
        }),
      };
    }),
    variables: {
      ...(chatVariables === undefined ? {} : { chat: chatVariables }),
      messages: messageVariables,
      swipes: swipeVariables,
    },
  };
  const sanitized = sanitizeJsonValue(archive);
  if (!isJsonObject(sanitized)) {
    throw new Error("Conversation export did not produce a JSON object.");
  }
  return sanitized;
}
