import { createHash, randomUUID } from "node:crypto";
import * as fileSystem from "node:fs";
import { readFile } from "node:fs/promises";
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

import { parseImportFile } from "./import-worker.js";

function jsonObject(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

type ImportFileSystem = Pick<
  typeof fileSystem,
  "existsSync" | "mkdirSync" | "renameSync" | "unlinkSync" | "writeFileSync"
>;

type ImportedPngAsset = {
  id: string;
  path: string;
  mediaType: "image/png";
  size: number;
  kind: "avatar";
  title: string;
  hash: string;
};

type StagedPngAsset = {
  asset: ImportedPngAsset;
  finalPath: string;
  temporaryPath: string | null;
  finalExisted: boolean;
  publishedByImport: boolean;
};

export class ImportService {
  constructor(
    private readonly store: AppStore,
    private readonly assetDirectory?: string,
    private readonly files: ImportFileSystem = fileSystem,
  ) {}

  private stageImportedPngAsset(
    source: string | Uint8Array,
    filename: string | undefined,
  ): StagedPngAsset | undefined {
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
    const finalPath = path.join(directory, storedName);
    this.files.mkdirSync(directory, { recursive: true });
    const finalExisted = this.files.existsSync(finalPath);
    let temporaryPath: string | null = null;
    if (!finalExisted) {
      temporaryPath = `${finalPath}.${process.pid.toString()}.${randomUUID()}.tmp`;
      try {
        this.files.writeFileSync(temporaryPath, source, {
          flag: "wx",
          mode: 0o600,
        });
      } catch (error) {
        try {
          this.files.unlinkSync(temporaryPath);
        } catch {
          // Preserve the staging error if the partial file cannot be removed.
        }
        throw error;
      }
    }
    return {
      asset: {
        id: `asset-${hash.slice(0, 24)}`,
        path: `/api/assets/cards/${storedName}`,
        mediaType: "image/png",
        size: source.byteLength,
        kind: "avatar" as const,
        title: filename?.slice(0, 512) || "Imported character card",
        hash: `sha256:${hash}`,
      },
      finalPath,
      temporaryPath,
      finalExisted,
      publishedByImport: false,
    };
  }

  private cleanupStagedPngAsset(staged: StagedPngAsset | undefined): void {
    if (!staged) return;
    if (staged.temporaryPath) {
      try {
        this.files.unlinkSync(staged.temporaryPath);
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !("code" in error) ||
          error.code !== "ENOENT"
        ) {
          // Preserve the original import/rename error when best-effort cleanup
          // cannot remove a temporary file.
        }
      }
      staged.temporaryPath = null;
    }
    if (staged.publishedByImport && !staged.finalExisted) {
      try {
        this.files.unlinkSync(staged.finalPath);
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !("code" in error) ||
          error.code !== "ENOENT"
        ) {
          // The database compensation below remains the source of truth.
        }
      }
      staged.publishedByImport = false;
    }
  }

  private publishStagedPngAsset(staged: StagedPngAsset | undefined): void {
    if (!staged?.temporaryPath) return;
    if (this.files.existsSync(staged.finalPath)) {
      this.cleanupStagedPngAsset(staged);
      return;
    }
    const temporaryPath = staged.temporaryPath;
    try {
      this.files.renameSync(temporaryPath, staged.finalPath);
      staged.temporaryPath = null;
      staged.publishedByImport = true;
    } catch (error) {
      this.cleanupStagedPngAsset(staged);
      throw error;
    }
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
    return this.persistCardImport(imported, source, options);
  }

  async importCardFile(
    filePath: string,
    options: ImportOptions = {},
  ): Promise<ReturnType<ImportService["importCard"]>> {
    const [source, imported] = await Promise.all([
      readFile(filePath),
      parseImportFile(filePath, "card", options),
    ]);
    return this.persistCardImport(
      imported as ReturnType<typeof importPortableCard>,
      source,
      options,
    );
  }

  private persistCardImport(
    imported: ReturnType<typeof importPortableCard>,
    source: string | Uint8Array,
    options: ImportOptions,
  ): ReturnType<ImportService["importCard"]> {
    const parsedCard = CardSchema.parse(imported.value);
    const stagedPngAsset = this.stageImportedPngAsset(source, options.filename);
    const sourceAsset = stagedPngAsset?.asset;
    const participants = imported.value.participants.map(
      (participant, index) =>
        sourceAsset !== undefined &&
        index === 0 &&
        participant.avatarAssetId === undefined
          ? { ...participant, avatarAssetId: sourceAsset.id }
          : participant,
    );
    let normalizedCard: ReturnType<typeof CardSchema.parse>;
    try {
      normalizedCard = CardSchema.parse({
        ...parsedCard,
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
    } catch (error) {
      this.cleanupStagedPngAsset(stagedPngAsset);
      throw error;
    }
    let regexScriptCount = 0;
    let tavernHelper: ReturnType<typeof inspectTavernHelperScripts>;
    try {
      regexScriptCount = Array.isArray(normalizedCard.extensions.regex_scripts)
        ? normalizedCard.extensions.regex_scripts.length
        : 0;
      tavernHelper = inspectTavernHelperScripts(normalizedCard);
    } catch (error) {
      this.cleanupStagedPngAsset(stagedPngAsset);
      throw error;
    }
    let result: ReturnType<ImportService["importCard"]>;
    try {
      result = this.store.database.transaction(() => {
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
    } catch (error) {
      this.cleanupStagedPngAsset(stagedPngAsset);
      throw error;
    }

    try {
      this.publishStagedPngAsset(stagedPngAsset);
    } catch (error) {
      this.cleanupStagedPngAsset(stagedPngAsset);
      try {
        this.store.deleteCardCascade(result.card.id, result.card.revision);
      } catch {
        // Keep the rename error visible to the route; the compensation is
        // retried by the next import/reconciliation pass if storage is busy.
      }
      throw error;
    }
    return result;
  }

  importWorldbook(source: string | Uint8Array, options: ImportOptions = {}) {
    const imported = importWorldbookJson(source, options);
    return this.persistWorldbookImport(imported);
  }

  async importWorldbookFile(filePath: string, options: ImportOptions = {}) {
    const imported = await parseImportFile(filePath, "worldbook", options);
    return this.persistWorldbookImport(
      imported as ReturnType<typeof importWorldbookJson>,
    );
  }

  private persistWorldbookImport(
    imported: ReturnType<typeof importWorldbookJson>,
  ) {
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
    return this.persistChatImport(imported, cardId);
  }

  async importChatFile(
    filePath: string,
    cardId: string,
    options: ImportOptions = {},
  ) {
    const imported = await parseImportFile(filePath, "conversation", options);
    return this.persistChatImport(
      imported as ReturnType<typeof importConversation>,
      cardId,
    );
  }

  private persistChatImport(
    imported: ReturnType<typeof importConversation>,
    cardId: string,
  ) {
    return this.store.database.transaction(() => {
      const portableState = imported.value.portableState;
      let personaId: string | undefined;
      if (portableState?.personaId) {
        try {
          personaId = this.store.getPersona(portableState.personaId).id;
        } catch {
          personaId = undefined;
        }
      }
      const cardParticipantIds = new Set(
        this.store
          .listCardParticipants(cardId)
          .map((participant) => participant.id),
      );
      const conversation = this.store.createConversation({
        id: imported.value.conversation.id,
        title: imported.value.conversation.title,
        cardId,
        ...(personaId === undefined ? {} : { personaId }),
      });
      const messageIdMap = new Map<string, string>();
      const swipeIds = new Set<string>();
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
          swipeIds.add(swipe.id);
          const swipeState = portableState?.swipes[swipe.id];
          this.store.addSwipe({
            id: swipe.id,
            messageId: persisted.id,
            content: swipe.content,
            selected: swipe.id === message.activeSwipeId,
            ...(swipeState?.reasoningText === undefined
              ? {}
              : { reasoningText: swipeState.reasoningText }),
            ...(swipeState?.providerContext === undefined
              ? {}
              : { providerContext: swipeState.providerContext }),
          });
        }
      }
      const restoredVariables = {
        chat: false,
        messages: 0,
        swipes: 0,
      };
      if (portableState?.variables.chat !== undefined) {
        this.store.setExtensionSetting(
          "stn.tavern-helper",
          `variables:conversation:${conversation.id}`,
          portableState.variables.chat,
        );
        restoredVariables.chat = true;
      }
      for (const [messageId, variables] of Object.entries(
        portableState?.variables.messages ?? {},
      )) {
        if (!messageIdMap.has(messageId)) continue;
        this.store.setExtensionSetting(
          "stn.tavern-helper",
          `variables:message:${messageId}`,
          variables,
        );
        restoredVariables.messages += 1;
      }
      for (const [swipeId, variables] of Object.entries(
        portableState?.variables.swipes ?? {},
      )) {
        if (!swipeIds.has(swipeId)) continue;
        this.store.setExtensionSetting(
          "stn.tavern-helper",
          `variables:swipe:${swipeId}`,
          variables,
        );
        restoredVariables.swipes += 1;
      }
      return {
        conversation,
        diagnostics: imported.diagnostics,
        sourceFormat: imported.sourceFormat,
        restoredVariables,
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
