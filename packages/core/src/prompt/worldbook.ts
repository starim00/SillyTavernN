import type { Worldbook, WorldbookEntry } from "@stn/contracts";

import type { MatchedWorldbookEntry, WorldbookMatchOptions } from "./types.js";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function regexFromKey(value: string): RegExp | undefined {
  const match = /^\/([\s\S]+)\/([gimsuy]*)$/u.exec(value);
  if (!match) return undefined;
  const pattern = match[1]!;
  if (/(^|[^\\])\//u.test(pattern)) return undefined;
  try {
    return new RegExp(pattern.replaceAll("\\/", "/"), match[2]);
  } catch {
    return undefined;
  }
}

function matchesKey(
  text: string,
  key: string,
  caseSensitive: boolean,
  wholeWords: boolean,
  useRegex: boolean,
): boolean {
  if (!key) {
    return false;
  }
  if (useRegex) {
    const expression = regexFromKey(key);
    if (expression) return expression.test(text);
  }
  if (wholeWords) {
    const flags = caseSensitive ? "u" : "iu";
    const expression = new RegExp(
      `(?<![\\p{L}\\p{N}_])${escapeRegExp(key)}(?![\\p{L}\\p{N}_])`,
      flags,
    );
    return expression.test(text);
  }
  return caseSensitive
    ? text.includes(key)
    : text.toLocaleLowerCase().includes(key.toLocaleLowerCase());
}

function matchingKeys(
  text: string,
  keys: readonly string[],
  entry: WorldbookEntry,
): string[] {
  return keys.filter((key) =>
    matchesKey(
      text,
      key,
      entry.caseSensitive,
      entry.matchWholeWords,
      entry.useRegex === true,
    ),
  );
}

function secondaryMatches(
  text: string,
  entry: WorldbookEntry,
): { matched: boolean; keys: string[] } {
  if (!entry.selective || entry.secondaryKeys.length === 0) {
    return { matched: true, keys: [] };
  }
  const keys = matchingKeys(text, entry.secondaryKeys, entry);
  const count = keys.length;
  const total = entry.secondaryKeys.length;
  switch (entry.secondaryLogic) {
    case "all":
      return { matched: count === total, keys };
    case "not-any":
      return { matched: count === 0, keys };
    case "not-all":
      return { matched: count !== total, keys };
    case "any":
      return { matched: count > 0, keys };
  }
}

function entrySort(
  left: { book: Worldbook; entry: WorldbookEntry },
  right: { book: Worldbook; entry: WorldbookEntry },
): number {
  return (
    right.entry.priority - left.entry.priority ||
    left.entry.order - right.entry.order ||
    left.book.id.localeCompare(right.book.id) ||
    left.entry.id.localeCompare(right.entry.id)
  );
}

function scanWindow(
  history: readonly string[],
  book: Worldbook,
  entry: WorldbookEntry,
): string {
  const depth = Math.max(1, entry.scanDepth ?? book.scanDepth);
  return history.slice(-depth).join("\n");
}

export function matchWorldbookEntries(
  worldbooks: readonly Worldbook[],
  history: string | readonly string[],
  options: WorldbookMatchOptions = {},
): readonly MatchedWorldbookEntry[] {
  const historyItems = typeof history === "string" ? [history] : [...history];
  const candidates = worldbooks
    .flatMap((book) => book.entries.map((entry) => ({ book, entry })))
    .filter(({ entry }) => !entry.disabled)
    .sort(entrySort);
  const selected = new Set<string>();
  const results: MatchedWorldbookEntry[] = [];
  const recursionText: string[] = [];
  const configuredMaximum = Math.max(
    0,
    ...worldbooks.map((book) => book.recursionLimit),
  );
  const recursionMaximum = Math.min(
    configuredMaximum,
    Math.max(0, options.maxRecursion ?? configuredMaximum),
  );

  for (let depth = 0; depth <= recursionMaximum; depth += 1) {
    const newlyRecursive: string[] = [];

    for (const candidate of candidates) {
      const key = `${candidate.book.id}\u0000${candidate.entry.id}`;
      if (
        selected.has(key) ||
        (depth > 0 && depth > candidate.book.recursionLimit) ||
        (depth === 0 && candidate.entry.delayUntilRecursion === true) ||
        (depth > 0 && candidate.entry.excludeRecursion === true)
      ) {
        continue;
      }
      const baseText = scanWindow(
        historyItems,
        candidate.book,
        candidate.entry,
      );
      const text =
        recursionText.length === 0
          ? baseText
          : `${baseText}\n${recursionText.join("\n")}`;
      const primary = matchingKeys(
        text,
        candidate.entry.primaryKeys,
        candidate.entry,
      );
      const reason = candidate.entry.constant ? "constant" : "keyword";
      if (!candidate.entry.constant && primary.length === 0) {
        continue;
      }
      const secondary = candidate.entry.constant
        ? { matched: true, keys: [] }
        : secondaryMatches(text, candidate.entry);
      if (!secondary.matched) {
        continue;
      }

      selected.add(key);
      results.push({
        worldbookId: candidate.book.id,
        worldbookName: candidate.book.name,
        entry: candidate.entry,
        depth,
        reason,
        matchedKeys: [...primary, ...secondary.keys],
      });
      if (
        depth < recursionMaximum &&
        candidate.entry.recursion &&
        !candidate.entry.preventRecursion &&
        candidate.entry.content
      ) {
        newlyRecursive.push(candidate.entry.content);
      }
    }

    if (newlyRecursive.length === 0) {
      break;
    }
    recursionText.push(...newlyRecursive);
  }

  return results;
}
