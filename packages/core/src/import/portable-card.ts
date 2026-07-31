import { strFromU8, unzipSync, unzlibSync } from "fflate";

import type { CardImportResult, ImportOptions } from "./types.js";
import { defaultBinaryImportLimits } from "./types.js";
import { importCardJson } from "./card.js";
import { ImportSecurityError } from "./safe-json.js";

const pngSignature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const decoder = new TextDecoder("utf-8", { fatal: true });

function startsWith(bytes: Uint8Array, prefix: Uint8Array): boolean {
  return prefix.every((value, index) => bytes[index] === value);
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! * 0x1_00_00_00 +
    bytes[offset + 1]! * 0x1_00_00 +
    bytes[offset + 2]! * 0x1_00 +
    bytes[offset + 3]!
  );
}

function decodeLatin1(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => String.fromCharCode(value)).join("");
}

function decodeBase64(value: string): Uint8Array {
  const compact = value.replace(/\s+/gu, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(compact)) {
    throw new Error("Card metadata is not valid base64.");
  }
  const binary = globalThis.atob(compact);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function splitNull(bytes: Uint8Array, start = 0): [Uint8Array, number] {
  const end = bytes.indexOf(0, start);
  if (end < 0) {
    throw new Error("Malformed PNG text metadata.");
  }
  return [bytes.subarray(start, end), end + 1];
}

function textChunk(
  type: string,
  data: Uint8Array,
):
  | {
      keyword: string;
      text: Uint8Array;
    }
  | undefined {
  if (type === "tEXt") {
    const [keyword, offset] = splitNull(data);
    return { keyword: decodeLatin1(keyword), text: data.subarray(offset) };
  }
  if (type === "zTXt") {
    const [keyword, offset] = splitNull(data);
    if (data[offset] !== 0) {
      throw new Error("Unsupported PNG text compression method.");
    }
    return {
      keyword: decodeLatin1(keyword),
      text: unzlibSync(data.subarray(offset + 1)),
    };
  }
  if (type === "iTXt") {
    const [keyword, afterKeyword] = splitNull(data);
    const compressed = data[afterKeyword] === 1;
    const method = data[afterKeyword + 1];
    if (compressed && method !== 0) {
      throw new Error("Unsupported PNG international text compression method.");
    }
    const [, afterLanguage] = splitNull(data, afterKeyword + 2);
    const [, afterTranslated] = splitNull(data, afterLanguage);
    const content = data.subarray(afterTranslated);
    return {
      keyword: decodeLatin1(keyword),
      text: compressed ? unzlibSync(content) : content,
    };
  }
  return undefined;
}

export function readCardMetadataFromPng(
  source: Uint8Array,
  options: ImportOptions = {},
): Uint8Array {
  const limits = {
    ...defaultBinaryImportLimits,
    ...(options.jsonLimits?.maxInputBytes === undefined
      ? {}
      : { maxMetadataBytes: options.jsonLimits.maxInputBytes }),
  };
  if (source.byteLength > limits.maxInputBytes) {
    throw new ImportSecurityError(
      "BINARY_INPUT_TOO_LARGE",
      `PNG input exceeds ${String(limits.maxInputBytes)} bytes.`,
    );
  }
  if (!startsWith(source, pngSignature)) {
    throw new Error("Character PNG signature is invalid.");
  }

  let offset = pngSignature.length;
  let charaMetadata: Uint8Array | undefined;
  let ccv3Metadata: Uint8Array | undefined;
  while (offset + 12 <= source.length) {
    const length = readUint32(source, offset);
    const typeStart = offset + 4;
    const dataStart = typeStart + 4;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (dataEnd < dataStart || chunkEnd > source.length) {
      throw new Error("Character PNG contains a truncated chunk.");
    }
    const type = decodeLatin1(source.subarray(typeStart, dataStart));
    const parsed = textChunk(type, source.subarray(dataStart, dataEnd));
    const keyword = parsed?.keyword.toLowerCase();
    if (parsed && keyword === "chara" && charaMetadata === undefined) {
      charaMetadata = parsed.text;
    }
    if (parsed && keyword === "ccv3" && ccv3Metadata === undefined) {
      ccv3Metadata = parsed.text;
    }
    offset = chunkEnd;
    if (type === "IEND") break;
  }

  const selected = ccv3Metadata ?? charaMetadata;
  if (selected) {
    if (selected.byteLength > limits.maxMetadataBytes) {
      throw new ImportSecurityError(
        "CARD_METADATA_TOO_LARGE",
        `PNG card metadata exceeds ${String(limits.maxMetadataBytes)} bytes.`,
      );
    }
    const textual = decoder.decode(selected).trim();
    if (textual.startsWith("{")) return new TextEncoder().encode(textual);
    const decoded = decodeBase64(textual);
    if (decoded.byteLength > limits.maxMetadataBytes) {
      throw new ImportSecurityError(
        "CARD_METADATA_TOO_LARGE",
        `Decoded PNG card metadata exceeds ${String(limits.maxMetadataBytes)} bytes.`,
      );
    }
    return decoded;
  }
  throw new Error("Character PNG has no supported chara or ccv3 metadata.");
}

interface ZipEntryHeader {
  readonly name: string;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly flags: number;
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  const minimum = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (
      bytes[offset] === 0x50 &&
      bytes[offset + 1] === 0x4b &&
      bytes[offset + 2] === 0x05 &&
      bytes[offset + 3] === 0x06
    ) {
      return offset;
    }
  }
  throw new Error("CharX archive has no valid central directory.");
}

function readUint16Le(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function readUint32Le(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset]! |
      (bytes[offset + 1]! << 8) |
      (bytes[offset + 2]! << 16) |
      (bytes[offset + 3]! << 24)) >>>
    0
  );
}

function safeArchiveName(name: string): boolean {
  const normalized = name.replaceAll("\\", "/");
  return (
    !normalized.startsWith("/") &&
    !/^[A-Za-z]:\//u.test(normalized) &&
    !normalized.split("/").includes("..") &&
    !normalized.includes("\0")
  );
}

function inspectZip(source: Uint8Array): ZipEntryHeader[] {
  const limits = defaultBinaryImportLimits;
  if (source.byteLength > limits.maxInputBytes) {
    throw new ImportSecurityError(
      "BINARY_INPUT_TOO_LARGE",
      `CharX input exceeds ${String(limits.maxInputBytes)} bytes.`,
    );
  }
  const end = findEndOfCentralDirectory(source);
  const count = readUint16Le(source, end + 10);
  const directorySize = readUint32Le(source, end + 12);
  const directoryOffset = readUint32Le(source, end + 16);
  if (count > limits.maxArchiveEntries) {
    throw new ImportSecurityError(
      "ARCHIVE_ENTRY_LIMIT",
      `CharX contains more than ${String(limits.maxArchiveEntries)} entries.`,
    );
  }
  if (directoryOffset + directorySize > source.length || directoryOffset < 0) {
    throw new Error("CharX central directory is outside the archive.");
  }

  const entries: ZipEntryHeader[] = [];
  let offset = directoryOffset;
  let total = 0;
  for (let index = 0; index < count; index += 1) {
    if (readUint32Le(source, offset) !== 0x02014b50) {
      throw new Error("CharX central directory entry is malformed.");
    }
    const flags = readUint16Le(source, offset + 8);
    const compressedSize = readUint32Le(source, offset + 20);
    const uncompressedSize = readUint32Le(source, offset + 24);
    const nameLength = readUint16Le(source, offset + 28);
    const extraLength = readUint16Le(source, offset + 30);
    const commentLength = readUint16Le(source, offset + 32);
    const nameStart = offset + 46;
    const next = nameStart + nameLength + extraLength + commentLength;
    if (next > source.length) {
      throw new Error("CharX central directory entry is truncated.");
    }
    const name = decoder.decode(
      source.subarray(nameStart, nameStart + nameLength),
    );
    if (!safeArchiveName(name)) {
      throw new ImportSecurityError(
        "ARCHIVE_PATH_TRAVERSAL",
        `Unsafe CharX entry path: ${name}`,
      );
    }
    if ((flags & 0x01) !== 0) {
      throw new ImportSecurityError(
        "ARCHIVE_ENCRYPTED_ENTRY",
        `Encrypted CharX entry is not supported: ${name}`,
      );
    }
    if (uncompressedSize > limits.maxArchiveEntryBytes) {
      throw new ImportSecurityError(
        "ARCHIVE_ENTRY_TOO_LARGE",
        `CharX entry exceeds ${String(limits.maxArchiveEntryBytes)} bytes: ${name}`,
      );
    }
    total += uncompressedSize;
    if (total > limits.maxArchiveUncompressedBytes) {
      throw new ImportSecurityError(
        "ARCHIVE_UNCOMPRESSED_LIMIT",
        `CharX exceeds ${String(limits.maxArchiveUncompressedBytes)} uncompressed bytes.`,
      );
    }
    entries.push({ name, compressedSize, uncompressedSize, flags });
    offset = next;
  }
  return entries;
}

export function readCardJsonFromCharX(source: Uint8Array): {
  readonly json: Uint8Array;
  readonly archiveEntries: readonly string[];
} {
  const headers = inspectZip(source);
  const archive = unzipSync(source);
  const candidates = headers
    .map((entry) => entry.name)
    .filter((name) => name.toLowerCase().endsWith(".json"))
    .sort((left, right) => {
      const leftCard = /(^|\/)card\.json$/iu.test(left) ? 0 : 1;
      const rightCard = /(^|\/)card\.json$/iu.test(right) ? 0 : 1;
      return leftCard - rightCard || left.localeCompare(right);
    });
  for (const name of candidates) {
    const bytes = archive[name];
    if (!bytes) continue;
    try {
      const parsed = JSON.parse(strFromU8(bytes)) as {
        spec?: unknown;
        data?: unknown;
        name?: unknown;
      };
      if (
        (typeof parsed.spec === "string" &&
          parsed.spec.startsWith("chara_card_")) ||
        (parsed.data &&
          typeof parsed.data === "object" &&
          !Array.isArray(parsed.data)) ||
        typeof parsed.name === "string"
      ) {
        return {
          json: bytes,
          archiveEntries: headers.map((entry) => entry.name),
        };
      }
    } catch {
      // Continue to another JSON member; importCardJson provides final validation.
    }
  }
  throw new Error("CharX archive does not contain a recognizable card JSON.");
}

export function importPortableCard(
  source: string | Uint8Array,
  options: ImportOptions = {},
): CardImportResult {
  if (typeof source === "string") {
    return importCardJson(source, options);
  }
  if (startsWith(source, pngSignature)) {
    const result = importCardJson(
      readCardMetadataFromPng(source, options),
      options,
    );
    return {
      ...result,
      sourceFormat: "character-png",
      diagnostics: [
        ...result.diagnostics,
        {
          severity: "info",
          code: "CARD_METADATA_FROM_PNG",
          message: "Card metadata was read from a PNG text chunk.",
        },
      ],
    };
  }
  if (
    source[0] === 0x50 &&
    source[1] === 0x4b &&
    (source[2] === 0x03 || source[2] === 0x05 || source[2] === 0x07)
  ) {
    const charx = readCardJsonFromCharX(source);
    const result = importCardJson(charx.json, options);
    return {
      ...result,
      sourceFormat: "charx",
      diagnostics: [
        ...result.diagnostics,
        {
          severity: "info",
          code: "CHARX_ASSETS_DISCOVERED",
          message: `CharX archive contained ${String(charx.archiveEntries.length)} entries; assets remain external until persisted.`,
        },
      ],
    };
  }
  return importCardJson(source, options);
}
