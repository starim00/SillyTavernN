import type { PromptSegment } from "@stn/contracts";

import type {
  PromptBudgetResult,
  PromptTokenBudget,
  TokenEstimator,
} from "./types.js";

const utf8 = new TextEncoder();

export function estimatePromptTokens(content: string): number {
  if (!content) {
    return 0;
  }
  return Math.max(1, Math.ceil(utf8.encode(content).byteLength / 4));
}

function withEstimate(
  segment: PromptSegment,
  estimate: TokenEstimator,
): PromptSegment {
  return { ...segment, tokenEstimate: estimate(segment.content) };
}

function isCurrentInput(segment: PromptSegment): boolean {
  return segment.metadata.currentInput === true;
}

function isProtected(segment: PromptSegment): boolean {
  return (
    segment.required || segment.position === "system" || isCurrentInput(segment)
  );
}

function truncateContent(
  content: string,
  targetTokens: number,
  mode: "head" | "tail",
  estimate: TokenEstimator,
): string {
  if (targetTokens <= 0 || content.length === 0) {
    return "";
  }
  if (estimate(content) <= targetTokens) {
    return content;
  }
  const codePoints = [...content];
  let low = 1;
  let high = codePoints.length;
  let best = "";
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate =
      mode === "head"
        ? codePoints.slice(0, middle).join("")
        : codePoints.slice(-middle).join("");
    if (estimate(candidate) <= targetTokens) {
      best = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return best;
}

export function applyPromptTokenBudget(
  source: readonly PromptSegment[],
  budget: PromptTokenBudget,
  estimate: TokenEstimator = estimatePromptTokens,
): PromptBudgetResult {
  const availableTokens = Math.max(
    0,
    Math.floor(budget.maxContextTokens) -
      Math.max(0, Math.floor(budget.reservedOutputTokens ?? 0)),
  );
  const working = source.map((segment) => withEstimate(segment, estimate));
  const dropped: PromptSegment[] = [];
  const total = (): number =>
    working.reduce((sum, segment) => sum + segment.tokenEstimate, 0);

  const optional = [...working]
    .filter((segment) => !isProtected(segment))
    .sort(
      (left, right) =>
        left.priority - right.priority ||
        right.order - left.order ||
        left.id.localeCompare(right.id),
    );

  for (const candidate of optional) {
    if (total() <= availableTokens) {
      break;
    }
    const index = working.findIndex((segment) => segment.id === candidate.id);
    if (index < 0) {
      continue;
    }
    const current = working[index] as PromptSegment;
    const excess = total() - availableTokens;
    const target = Math.max(0, current.tokenEstimate - excess);
    if (
      target > 0 &&
      (current.truncation === "head" || current.truncation === "tail")
    ) {
      const content = truncateContent(
        current.content,
        target,
        current.truncation,
        estimate,
      );
      if (content) {
        working[index] = withEstimate({ ...current, content }, estimate);
        continue;
      }
    }
    dropped.push(current);
    working.splice(index, 1);
  }

  if (total() > availableTokens) {
    const protectedSegments = [...working]
      .filter(isProtected)
      .sort(
        (left, right) =>
          left.priority - right.priority || left.id.localeCompare(right.id),
      );
    for (const candidate of protectedSegments) {
      if (total() <= availableTokens) {
        break;
      }
      const index = working.findIndex((segment) => segment.id === candidate.id);
      const current = working[index];
      if (!current || current.tokenEstimate <= 1) {
        continue;
      }
      const excess = total() - availableTokens;
      const target = Math.max(1, current.tokenEstimate - excess);
      const preferredMode =
        current.truncation === "head" || current.truncation === "tail"
          ? current.truncation
          : isCurrentInput(current)
            ? "tail"
            : "head";
      const content = truncateContent(
        current.content,
        target,
        preferredMode,
        estimate,
      );
      working[index] = withEstimate(
        { ...current, content: content || [...current.content][0] || "" },
        estimate,
      );
    }
  }

  const totalTokenEstimate = total();
  return {
    segments: working,
    dropped,
    totalTokenEstimate,
    availableTokens,
    overBudget: totalTokenEstimate > availableTokens,
  };
}
