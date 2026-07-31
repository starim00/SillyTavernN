import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  importConversation,
  importPortableCard,
  importWorldbookJson,
  inspectTavernHelperScripts,
  type ImportOptions,
} from "@stn/core";
import { CardSchema, type JsonObject, type JsonValue } from "@stn/contracts";
import type { AppStore } from "@stn/storage";

function jsonObject(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

export class ImportService {
  constructor(
    private readonly store: AppStore,
    private readonly assetDirectory?: string,
  ) {}

  private importedPngAsset(
    source: string | Uint8Array,
    filename: string | undefined,
  ) {
    if (
      typeof source === "string" ||
      this.assetDirectory === undefined ||
      source.length < 8 ||
      source[0] !== 137 ||
      source[1] !== 80 ||
      source[2] !== 78 ||
      source[3] !== 71
    ) {
      return undefined;
    }
    const hash = createHash("sha256").update(source).digest("hex");
    const directory = path.join(this.assetDirectory, "cards");
    const storedName = `${hash}.png`;
    mkdirSync(directory, { recursive: true });
    try {
      writeFileSync(path.join(directory, storedName), source, { flag: "wx" });
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "EEXIST"
      ) {
        throw error;
      }
    }
    return {
      id: `asset-${hash.slice(0, 24)}`,
      path: `/api/assets/cards/${storedName}`,
      mediaType: "image/png",
      size: source.byteLength,
      kind: "avatar" as const,
      title: filename?.slice(0, 512) || "Imported character card",
      hash: `sha256:${hash}`,
    };
  }

  importCard(
    source: string | Uint8Array,
    options: ImportOptions = {},
  ): {
    card: ReturnType<AppStore["getCard"]>;
    participantIds: string[];
    worldbookIds: string[];
    regexScriptCount: number;
    tavernHelperScriptCount: number;
    enabledTavernHelperScriptCount: number;
    diagnostics: JsonValue[];
    sourceFormat: string;
  } {
    const imported = importPortableCard(source, options);
    const sourceAsset = this.importedPngAsset(source, options.filename);
    const participants = imported.value.participants.map(
      (participant, index) =>
        sourceAsset !== undefined &&
        index === 0 &&
        participant.avatarAssetId === undefined
          ? { ...participant, avatarAssetId: sourceAsset.id }
          : participant,
    );
    const normalizedCard = CardSchema.parse({
      ...imported.value,
      participants,
      assets:
        sourceAsset === undefined
          ? imported.value.assets
          : [
              ...imported.value.assets.filter(
                (asset) => asset.id !== sourceAsset.id,
              ),
              sourceAsset,
            ],
    });
    const regexScriptCount = Array.isArray(
      normalizedCard.extensions.regex_scripts,
    )
      ? normalizedCard.extensions.regex_scripts.length
      : 0;
    const tavernHelper = inspectTavernHelperScripts(normalizedCard);
    return this.store.database.transaction(() => {
      const created = this.store.createCard({
        id: normalizedCard.id,
        kind: normalizedCard.kind,
        name: normalizedCard.name,
        description: normalizedCard.description,
        legacyPayload: jsonObject({
          normalized: normalizedCard,
          compatibility: normalizedCard.compatibility ?? {},
        }),
        participants: [
          ...normalizedCard.participants,
          ...(normalizedCard.narrator ? [normalizedCard.narrator] : []),
        ].map((participant) => ({
          id: participant.id,
          name: participant.name,
          role: participant.kind,
          profile: jsonObject(participant),
          legacyPayload: jsonObject(
            participant.compatibility?.unknownFields ?? {},
          ),
        })),
      });
      const worldbookIds = imported.embeddedWorldbooks.map((worldbook) => {
        const persisted = this.persistWorldbook(worldbook);
        this.store.bindWorldbook({
          worldbookId: persisted.id,
          scopeType: "card",
          scopeId: created.card.id,
        });
        return persisted.id;
      });
      if (regexScriptCount > 0) {
        this.store.setExtensionSetting(
          "stn.regex",
          `card:${created.card.id}`,
          false,
        );
      }
      if (tavernHelper.scriptCount > 0) {
        this.store.setExtensionSetting(
          "stn.tavern-helper",
          `card:${created.card.id}`,
          false,
        );
      }
      return {
        card: created.card,
        participantIds: created.participants.map(
          (participant) => participant.id,
        ),
        worldbookIds,
        regexScriptCount,
        tavernHelperScriptCount: tavernHelper.scriptCount,
        enabledTavernHelperScriptCount: tavernHelper.enabledScriptCount,
        diagnostics: imported.diagnostics.map((diagnostic) =>
          jsonObject(diagnostic),
        ),
        sourceFormat: imported.sourceFormat,
      };
    });
  }

  importWorldbook(source: string | Uint8Array, options: ImportOptions = {}) {
    const imported = importWorldbookJson(source, options);
    return {
      worldbook: this.persistWorldbook(imported.value),
      diagnostics: imported.diagnostics,
      sourceFormat: imported.sourceFormat,
    };
  }

  importChat(
    source: string | Uint8Array,
    cardId: string,
    options: ImportOptions = {},
  ) {
    const imported = importConversation(source, options);
    return this.store.database.transaction(() => {
      const cardParticipantIds = new Set(
        this.store
          .listCardParticipants(cardId)
          .map((participant) => participant.id),
      );
      const conversation = this.store.createConversation({
        id: imported.value.conversation.id,
        title: imported.value.conversation.title,
        cardId,
      });
      const messageIdMap = new Map<string, string>();
      for (const message of imported.value.messages) {
        const active =
          message.swipes.find((swipe) => swipe.id === message.activeSwipeId) ??
          message.swipes[0];
        if (!active) continue;
        const parentMessageId = message.parentMessageId
          ? (messageIdMap.get(message.parentMessageId) ??
            message.parentMessageId)
          : undefined;
        const common = {
          id: message.id,
          conversationId: conversation.id,
          ...(parentMessageId === undefined ? {} : { parentMessageId }),
          content: active.content,
        };
        const persisted =
          message.role === "user"
            ? this.store.addUserMessage(common)
            : message.role === "assistant"
              ? this.store.addAssistantMessage({
                  ...common,
                  participantId:
                    message.author.participantId !== undefined &&
                    cardParticipantIds.has(message.author.participantId)
                      ? message.author.participantId
                      : null,
                })
              : this.store.addInternalMessage({
                  ...common,
                  role: message.role,
                });
        messageIdMap.set(message.id, persisted.id);
        for (const swipe of message.swipes) {
          this.store.addSwipe({
            id: swipe.id,
            messageId: persisted.id,
            content: swipe.content,
            selected: swipe.id === message.activeSwipeId,
          });
        }
      }
      return {
        conversation,
        diagnostics: imported.diagnostics,
        sourceFormat: imported.sourceFormat,
      };
    });
  }

  private persistWorldbook(
    worldbook: ReturnType<typeof importWorldbookJson>["value"],
  ) {
    return this.store.createWorldbook({
      id: worldbook.id,
      name: worldbook.name,
      source: "import",
      // Imported permission metadata is deliberately never propagated.
      agentEditable: false,
      legacyPayload: jsonObject({
        normalized: worldbook,
        compatibility: worldbook.compatibility ?? {},
      }),
      entries: worldbook.entries.map((entry) => ({
        id: entry.id,
        legacyUid: typeof entry.legacyUid === "number" ? entry.legacyUid : null,
        keys: [...entry.primaryKeys, ...entry.secondaryKeys],
        content: entry.content,
        enabled: !entry.disabled,
        position: Math.floor(entry.order),
        metadata: jsonObject({
          label: entry.label,
          primaryKeys: entry.primaryKeys,
          secondaryKeys: entry.secondaryKeys,
          secondaryLogic: entry.secondaryLogic,
          selective: entry.selective,
          constant: entry.constant,
          caseSensitive: entry.caseSensitive,
          matchWholeWords: entry.matchWholeWords,
          ...(entry.scanDepth === undefined
            ? {}
            : { scanDepth: entry.scanDepth }),
          recursion: entry.recursion,
          preventRecursion: entry.preventRecursion,
          ...(entry.excludeRecursion === undefined
            ? {}
            : { excludeRecursion: entry.excludeRecursion }),
          ...(entry.delayUntilRecursion === undefined
            ? {}
            : { delayUntilRecursion: entry.delayUntilRecursion }),
          ...(entry.useRegex === undefined ? {} : { useRegex: entry.useRegex }),
          ...(entry.legacyInsertionOrder === undefined
            ? {}
            : { legacyInsertionOrder: entry.legacyInsertionOrder }),
          ...(entry.insertionPosition === undefined
            ? {}
            : { insertionPosition: entry.insertionPosition }),
          ...(entry.outletName === undefined
            ? {}
            : { outletName: entry.outletName }),
          ...(entry.insertionDepth === undefined
            ? {}
            : { insertionDepth: entry.insertionDepth }),
          ...(entry.insertionRole === undefined
            ? {}
            : { insertionRole: entry.insertionRole }),
          promptPosition: entry.position,
          priority: entry.priority,
          extensions: entry.extensions,
          compatibility: entry.compatibility ?? {},
        }),
      })),
    });
  }
}
