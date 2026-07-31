import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import {
  importPortableCard,
  readCardJsonFromCharX,
  readCardMetadataFromPng,
} from "./portable-card.js";

const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

function uint32(value: number): Uint8Array {
  return Uint8Array.from([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = strToU8(type);
  return Uint8Array.from([
    ...uint32(data.length),
    ...typeBytes,
    ...data,
    0,
    0,
    0,
    0,
  ]);
}

function cardJson(name = "Portable world"): string {
  return JSON.stringify({
    spec: "chara_card_v3",
    spec_version: "3.0",
    data: {
      name,
      kind: "world",
      world: "A world without a required featured character.",
      participants: [],
      unknown_extension_field: { kept: true },
    },
  });
}

describe("portable character cards", () => {
  it("reads base64 TavernCard metadata from a PNG text chunk", () => {
    const encoded = btoa(cardJson("PNG world"));
    const png = Uint8Array.from([
      ...signature,
      ...chunk("tEXt", strToU8(`chara\u0000${encoded}`)),
      ...chunk("IEND", new Uint8Array()),
    ]);
    expect(new TextDecoder().decode(readCardMetadataFromPng(png))).toContain(
      "PNG world",
    );
    const imported = importPortableCard(png, {
      filename: "world.png",
      idFactory: (kind) => `${kind}-test`,
      now: () => "2026-07-29T00:00:00.000Z",
    });
    expect(imported.sourceFormat).toBe("character-png");
    expect(imported.value.kind).toBe("world");
    expect(imported.value.participants).toEqual([]);
    expect(imported.value.compatibility?.unknownFields.data).toMatchObject({
      unknown_extension_field: { kept: true },
    });
  });

  it("prefers ccv3 metadata over chara regardless of PNG chunk order", () => {
    const legacy = btoa(cardJson("Legacy chara card"));
    const current = btoa(cardJson("Preferred ccv3 card"));
    const chara = chunk("tEXt", strToU8(`chara\u0000${legacy}`));
    const ccv3 = chunk("tEXt", strToU8(`ccv3\u0000${current}`));

    for (const metadataChunks of [
      [chara, ccv3],
      [ccv3, chara],
    ]) {
      const png = Uint8Array.from([
        ...signature,
        ...metadataChunks.flatMap((metadata) => [...metadata]),
        ...chunk("IEND", new Uint8Array()),
      ]);
      const metadata = new TextDecoder().decode(readCardMetadataFromPng(png));
      expect(JSON.parse(metadata)).toMatchObject({
        spec: "chara_card_v3",
        data: { name: "Preferred ccv3 card" },
      });
      expect(
        importPortableCard(png, {
          idFactory: (kind) => `${kind}-test`,
          now: () => "2026-07-29T00:00:00.000Z",
        }).value.name,
      ).toBe("Preferred ccv3 card");
    }
  });

  it("imports a minimal clean-room CharX archive", () => {
    const archive = zipSync({
      "card.json": strToU8(cardJson("CharX world")),
      "assets/readme.txt": strToU8("self-authored fixture"),
    });
    const inspected = readCardJsonFromCharX(archive);
    expect(inspected.archiveEntries).toContain("card.json");
    const imported = importPortableCard(archive, {
      filename: "world.charx",
      idFactory: (kind) => `${kind}-test`,
      now: () => "2026-07-29T00:00:00.000Z",
    });
    expect(imported.sourceFormat).toBe("charx");
    expect(imported.value.name).toBe("CharX world");
  });

  it("rejects traversal paths before extracting a CharX archive", () => {
    const archive = zipSync({
      "../card.json": strToU8(cardJson("Unsafe")),
    });
    expect(() => readCardJsonFromCharX(archive)).toThrowError(
      expect.objectContaining({ code: "ARCHIVE_PATH_TRAVERSAL" }),
    );
  });
});
