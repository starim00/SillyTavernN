const STRUCTURED_TAGS = ["UpdateVariable", "Analysis", "JSONPatch"] as const;

type StructuredTag = (typeof STRUCTURED_TAGS)[number];

const tagPattern = (tag: StructuredTag, closing = false): RegExp =>
  new RegExp(`<${closing ? "/" : ""}${tag}\\s*>`, "i");

function normalizeKnownTags(content: string): string {
  let normalized = content;
  for (const tag of STRUCTURED_TAGS) {
    normalized = normalized
      .replace(new RegExp(`\\\\?<${tag}\\s*>`, "gi"), `<${tag}>`)
      .replace(new RegExp(`\\\\?<\\/${tag}\\s*>`, "gi"), `</${tag}>`);
  }
  return normalized;
}

function indexOfTag(
  content: string,
  tag: StructuredTag,
  closing = false,
): number {
  return content.search(tagPattern(tag, closing));
}

function insertAt(content: string, index: number, insertion: string): string {
  return `${content.slice(0, index)}${insertion}${content.slice(index)}`;
}

function lineStart(content: string, index: number): number {
  const previousNewline = content.lastIndexOf("\n", Math.max(0, index - 1));
  return previousNewline < 0 ? 0 : previousNewline + 1;
}

function decodeJsonEntities(content: string): string {
  return content
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (entity, code: string) => {
      const radix = code[0]?.toLowerCase() === "x" ? 16 : 10;
      const digits = radix === 16 ? code.slice(1) : code;
      const value = Number.parseInt(digits, radix);
      return Number.isFinite(value) ? String.fromCodePoint(value) : entity;
    })
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function withoutCodeFence(content: string): string {
  const trimmed = content.trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return match?.[1]?.trim() ?? trimmed;
}

function balanceJsonContainers(content: string): string | null {
  const stack: Array<"]" | "}"> = [];
  let inString = false;
  let escaped = false;

  for (const character of content) {
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "[") stack.push("]");
    else if (character === "{") stack.push("}");
    else if (character === "]" || character === "}") {
      if (stack.at(-1) !== character) return null;
      stack.pop();
    }
  }

  if (inString) return null;
  return `${content}${stack.reverse().join("")}`;
}

function parsedPatchArray(content: string): string | null {
  const decoded = withoutCodeFence(decodeJsonEntities(content));
  if (!decoded) return null;

  const candidates = [decoded];
  if (!decoded.startsWith("[")) candidates.push(`[${decoded}]`);

  for (const candidate of candidates) {
    const variants = [candidate, candidate.replace(/}\s*{/g, "},{")];
    for (const variant of new Set(variants)) {
      const balanced = balanceJsonContainers(variant);
      if (balanced === null) continue;
      const parseCandidates = [
        balanced,
        balanced.replace(/,\s*([}\]])/g, "$1"),
      ];
      for (const parseCandidate of new Set(parseCandidates)) {
        try {
          const parsed: unknown = JSON.parse(parseCandidate);
          if (Array.isArray(parsed)) return parseCandidate;
          if (typeof parsed === "object" && parsed !== null) {
            return `[${parseCandidate}]`;
          }
        } catch {
          // Try the next conservative repair candidate.
        }
      }
    }
  }
  return null;
}

function repairJsonPatchBody(content: string): string {
  const opening = tagPattern("JSONPatch").exec(content);
  if (opening?.index === undefined) return content;
  const bodyStart = opening.index + opening[0].length;
  const remaining = content.slice(bodyStart);
  const closing = tagPattern("JSONPatch", true).exec(remaining);
  if (closing?.index === undefined) return content;
  const bodyEnd = bodyStart + closing.index;
  const repaired = parsedPatchArray(content.slice(bodyStart, bodyEnd));
  if (repaired === null) return content;
  return `${content.slice(0, bodyStart)}\n${repaired}\n${content.slice(bodyEnd)}`;
}

function wrapBareJsonPatch(content: string): string {
  if (indexOfTag(content, "JSONPatch") >= 0) return content;
  const analysisClose = indexOfTag(content, "Analysis", true);
  if (analysisClose < 0) return content;
  const afterAnalysis = analysisClose + "</Analysis>".length;
  const updateClose = indexOfTag(content, "UpdateVariable", true);
  const end = updateClose < 0 ? content.length : updateClose;
  const region = content.slice(afterAnalysis, end);
  const leadingWhitespace = region.match(/^\s*/)?.[0].length ?? 0;
  const trailingWhitespace = region.match(/\s*$/)?.[0].length ?? 0;
  const candidateStart = afterAnalysis + leadingWhitespace;
  const candidateEnd = end - trailingWhitespace;
  if (candidateEnd <= candidateStart) return content;
  const repaired = parsedPatchArray(
    content.slice(candidateStart, candidateEnd),
  );
  if (repaired === null) return content;
  return `${content.slice(0, candidateStart)}<JSONPatch>\n${repaired}\n</JSONPatch>${content.slice(candidateEnd)}`;
}

/**
 * Repairs only the structural envelope used by Tavern Helper variable updates.
 * It never invents JSON Patch operations or missing op/path/value fields.
 */
export function repairAssistantStructuredContent(content: string): string {
  let repaired = normalizeKnownTags(content);
  const hasUpdateMarker =
    indexOfTag(repaired, "UpdateVariable") >= 0 ||
    indexOfTag(repaired, "UpdateVariable", true) >= 0;
  const hasJsonPatchMarker =
    indexOfTag(repaired, "JSONPatch") >= 0 ||
    indexOfTag(repaired, "JSONPatch", true) >= 0;
  if (!hasUpdateMarker && !hasJsonPatchMarker) return content;

  const analysisOpen = indexOfTag(repaired, "Analysis");
  const analysisClose = indexOfTag(repaired, "Analysis", true);
  if (analysisOpen < 0 && analysisClose >= 0) {
    const updateOpen = indexOfTag(repaired, "UpdateVariable");
    const start = updateOpen < 0 ? 0 : updateOpen + "<UpdateVariable>".length;
    repaired = insertAt(repaired, start, "\n<Analysis>");
  } else if (analysisOpen >= 0 && analysisClose < 0) {
    const jsonOpen = indexOfTag(repaired, "JSONPatch");
    const updateClose = indexOfTag(repaired, "UpdateVariable", true);
    const end =
      jsonOpen >= 0
        ? jsonOpen
        : updateClose >= 0
          ? updateClose
          : repaired.length;
    repaired = insertAt(repaired, lineStart(repaired, end), "</Analysis>\n");
  } else if (analysisOpen < 0 && analysisClose < 0 && hasJsonPatchMarker) {
    const json = indexOfTag(repaired, "JSONPatch");
    const jsonClose = indexOfTag(repaired, "JSONPatch", true);
    const updateOpen = indexOfTag(repaired, "UpdateVariable");
    const searchStart =
      updateOpen < 0 ? 0 : updateOpen + "<UpdateVariable>".length;
    const bareJsonStart =
      jsonClose < 0
        ? -1
        : repaired.slice(searchStart, jsonClose).search(/[[{]/);
    const insertion =
      json >= 0
        ? lineStart(repaired, json)
        : bareJsonStart >= 0
          ? lineStart(repaired, searchStart + bareJsonStart)
          : lineStart(repaired, Math.max(0, jsonClose));
    repaired = insertAt(repaired, insertion, "<Analysis>\n</Analysis>\n");
  }

  const jsonOpen = indexOfTag(repaired, "JSONPatch");
  const jsonClose = indexOfTag(repaired, "JSONPatch", true);
  if (jsonOpen < 0 && jsonClose >= 0) {
    const boundary = indexOfTag(repaired, "Analysis", true);
    const searchStart = boundary < 0 ? 0 : boundary + "</Analysis>".length;
    const jsonStart = repaired.slice(searchStart, jsonClose).search(/[[{]/);
    if (jsonStart >= 0) {
      repaired = insertAt(repaired, searchStart + jsonStart, "<JSONPatch>\n");
    }
  } else if (jsonOpen >= 0 && jsonClose < 0) {
    const updateClose = indexOfTag(repaired, "UpdateVariable", true);
    const end =
      updateClose >= 0 ? lineStart(repaired, updateClose) : repaired.length;
    repaired = insertAt(repaired, end, "\n</JSONPatch>\n");
  }

  repaired = wrapBareJsonPatch(repaired);

  const updateOpen = indexOfTag(repaired, "UpdateVariable");
  const updateClose = indexOfTag(repaired, "UpdateVariable", true);
  if (updateOpen < 0 && updateClose >= 0) {
    const analysis = indexOfTag(repaired, "Analysis");
    const json = indexOfTag(repaired, "JSONPatch");
    const start =
      [analysis, json].filter((index) => index >= 0).sort((a, b) => a - b)[0] ??
      0;
    repaired = insertAt(
      repaired,
      lineStart(repaired, start),
      "<UpdateVariable>\n",
    );
  } else if (updateOpen >= 0 && updateClose < 0) {
    repaired = `${repaired.trimEnd()}\n</UpdateVariable>${repaired.slice(repaired.trimEnd().length)}`;
  } else if (updateOpen < 0 && updateClose < 0) {
    const analysis = indexOfTag(repaired, "Analysis");
    const json = indexOfTag(repaired, "JSONPatch");
    const starts = [analysis, json]
      .filter((index) => index >= 0)
      .sort((a, b) => a - b);
    if (starts.length > 0) {
      const start = lineStart(repaired, starts[0]!);
      repaired = `${repaired.slice(0, start)}<UpdateVariable>\n${repaired.slice(start).trimEnd()}\n</UpdateVariable>${repaired.slice(repaired.trimEnd().length)}`;
    }
  }

  return repairJsonPatchBody(repaired);
}
