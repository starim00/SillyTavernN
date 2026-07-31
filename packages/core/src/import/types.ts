import type {
  Card,
  Conversation,
  Diagnostic,
  Message,
  Participant,
  PromptPreset,
  Worldbook,
} from "@stn/contracts";

import type { SafeJsonLimits } from "./safe-json.js";

export interface ImportOptions {
  filename?: string;
  now?: () => string;
  idFactory?: (kind: string) => string;
  jsonLimits?: Partial<SafeJsonLimits>;
}

export interface BinaryImportLimits {
  maxInputBytes: number;
  maxMetadataBytes: number;
  maxArchiveEntries: number;
  maxArchiveEntryBytes: number;
  maxArchiveUncompressedBytes: number;
}

export const defaultBinaryImportLimits: BinaryImportLimits = {
  maxInputBytes: 32 * 1024 * 1024,
  maxMetadataBytes: 16 * 1024 * 1024,
  maxArchiveEntries: 256,
  maxArchiveEntryBytes: 16 * 1024 * 1024,
  maxArchiveUncompressedBytes: 64 * 1024 * 1024,
};

export interface ImportResult<T> {
  value: T;
  diagnostics: Diagnostic[];
  sourceFormat: string;
}

export interface CardImportResult extends ImportResult<Card> {
  embeddedWorldbooks: Worldbook[];
}

export interface ConversationImportValue {
  conversation: Conversation;
  messages: Message[];
  participants: Participant[];
}

export type ConversationImportResult = ImportResult<ConversationImportValue>;
export type WorldbookImportResult = ImportResult<Worldbook>;
export type PromptPresetImportResult = ImportResult<PromptPreset>;

export interface ImportContext {
  now: () => string;
  id: (kind: string) => string;
  filename?: string;
  jsonLimits?: Partial<SafeJsonLimits>;
}

export function createImportContext(
  options: ImportOptions = {},
): ImportContext {
  let sequence = 0;
  const defaultId = (kind: string): string => {
    sequence += 1;
    const random =
      typeof globalThis.crypto?.randomUUID === "function"
        ? globalThis.crypto.randomUUID()
        : `${Date.now().toString(36)}-${sequence.toString(36)}`;
    return `${kind}-${random}`;
  };
  return {
    now: options.now ?? (() => new Date().toISOString()),
    id: options.idFactory ?? defaultId,
    ...(options.filename === undefined ? {} : { filename: options.filename }),
    ...(options.jsonLimits === undefined
      ? {}
      : { jsonLimits: options.jsonLimits }),
  };
}
