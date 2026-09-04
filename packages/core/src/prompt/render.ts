import type { JsonObject, PromptSegment } from "@stn/contracts";

import type {
  ChatPromptMessage,
  ChatRenderOptions,
  TextRenderOptions,
} from "./types.js";

function speakerName(segment: PromptSegment): string | undefined {
  const speaker = segment.metadata.speaker;
  return typeof speaker === "string" && speaker.trim() ? speaker : undefined;
}

export function renderChatPrompt(
  segments: readonly PromptSegment[],
  options: ChatRenderOptions = {},
): readonly ChatPromptMessage[] {
  const mergeAdjacent = options.mergeAdjacent ?? true;
  const messages: ChatPromptMessage[] = [];
  let previousSegment: PromptSegment | undefined;

  for (const segment of segments) {
    const name = speakerName(segment);
    const previous = messages.at(-1);
    const mergeWorldbookAtDepth =
      options.mergeWorldbookAtDepth === true &&
      previousSegment?.source.kind === "worldbook" &&
      segment.source.kind === "worldbook" &&
      previousSegment.position === "history" &&
      segment.position === "history" &&
      previousSegment.source.detail.insertionPosition === "at-depth" &&
      segment.source.detail.insertionPosition === "at-depth" &&
      previousSegment.source.detail.insertionDepth ===
        segment.source.detail.insertionDepth;
    if (
      (mergeAdjacent ||
        (options.mergeSystemMessages === true && segment.role === "system") ||
        mergeWorldbookAtDepth) &&
      previous &&
      previous.role === segment.role &&
      previous.name === name
    ) {
      messages[messages.length - 1] = {
        ...previous,
        content: `${previous.content}\n\n${segment.content}`,
        sourceSegmentIds: [...previous.sourceSegmentIds, segment.id],
      };
      previousSegment = segment;
      continue;
    }
    messages.push({
      role: segment.role,
      content: segment.content,
      ...(name === undefined ? {} : { name }),
      sourceSegmentIds: [segment.id],
      metadata: { source: segment.source.kind } satisfies JsonObject,
    });
    previousSegment = segment;
  }

  return messages;
}

export function renderTextPrompt(
  segments: readonly PromptSegment[],
  options: TextRenderOptions = {},
): string {
  const separator = options.separator ?? "\n\n";
  const prefixes: Record<PromptSegment["role"], string> = {
    system: options.systemPrefix ?? "System:",
    user: options.userPrefix ?? "User:",
    assistant: options.assistantPrefix ?? "Assistant:",
    tool: options.toolPrefix ?? "Tool:",
  };
  const includePrefixes = options.includeRolePrefixes ?? true;
  const blocks = segments.map((segment) => {
    if (!includePrefixes) {
      return segment.content;
    }
    const speaker = speakerName(segment);
    const prefix = speaker ? `${speaker}:` : prefixes[segment.role];
    return `${prefix}\n${segment.content}`;
  });
  if (options.assistantCue !== undefined) {
    blocks.push(options.assistantCue);
  }
  return blocks.join(separator);
}
