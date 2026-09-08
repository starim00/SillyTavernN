import { expect, it } from "vitest";
import { cardCoverPng } from "./card-cover.js";

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function chunk(type: string, value: string) {
  const data = Buffer.from(value);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  return Buffer.concat([length, Buffer.from(type), data, Buffer.alloc(4)]);
}
it("preserves pixel, color and animation chunks verbatim while removing text metadata", () => {
  const visual = [
    chunk("IHDR", "header"),
    chunk("iCCP", "profile"),
    chunk("acTL", "animation"),
    chunk("IDAT", "pixels"),
    chunk("IEND", ""),
  ];
  const source = Buffer.concat([
    signature,
    visual[0]!,
    chunk("tEXt", "card".repeat(10000)),
    chunk("zTXt", "compressed"),
    chunk("iTXt", "international"),
    ...visual.slice(1),
  ]);
  const copy = Buffer.from(source);
  expect(cardCoverPng(source)).toEqual(Buffer.concat([signature, ...visual]));
  expect(source).toEqual(copy);
});
it("leaves malformed or incomplete sources untouched", () => {
  for (const source of [
    Buffer.from("not png"),
    Buffer.concat([signature, chunk("IDAT", "pixels").subarray(0, 10)]),
  ]) {
    expect(cardCoverPng(source)).toBe(source);
  }
});
