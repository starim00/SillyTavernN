const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** Keep encoded pixels and rendering metadata; omit portable-card text payloads. */
export function cardCoverPng(source: Buffer): Buffer {
  if (!source.subarray(0, 8).equals(signature)) return source;
  const chunks = [source.subarray(0, 8)];
  let offset = 8;
  while (offset + 12 <= source.length) {
    const length = source.readUInt32BE(offset);
    const end = offset + length + 12;
    if (end > source.length) return source;
    const type = source.toString("ascii", offset + 4, offset + 8);
    if (!["tEXt", "zTXt", "iTXt"].includes(type)) {
      chunks.push(source.subarray(offset, end));
    }
    offset = end;
    if (type === "IEND") return Buffer.concat(chunks);
  }
  return source;
}
