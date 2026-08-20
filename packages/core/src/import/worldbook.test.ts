import type { Worldbook } from "@stn/contracts";
import { describe, expect, it } from "vitest";

import { matchWorldbookEntries } from "../prompt/worldbook.js";
import { importWorldbookJson } from "./worldbook.js";

const now = "2026-07-29T00:00:00.000Z";

describe("SillyTavern worldbook compatibility", () => {
  it("imports a standalone object-keyed entry collection without book metadata", () => {
    const imported = importWorldbookJson(
      {
        entries: {
          0: {
            uid: 0,
            key: ["silver latch"],
            keysecondary: ["workbench"],
            comment: "Clean-room object entry",
            content: "A compact reference entry.",
            selective: true,
            selectiveLogic: 1,
            order: 42,
            position: 0,
            disable: false,
            probability: 75,
            useProbability: true,
            scanDepth: 3,
            caseSensitive: true,
            matchWholeWords: true,
          },
        },
      },
      {
        filename: "standalone-tools.json",
        idFactory: (kind) => `${kind}-standalone`,
        now: () => now,
      },
    );

    expect(imported.value.name).toBe("standalone-tools");
    expect(imported.value.entries).toEqual([
      expect.objectContaining({
        label: "Clean-room object entry",
        primaryKeys: ["silver latch"],
        secondaryKeys: ["workbench"],
        content: "A compact reference entry.",
        disabled: false,
        extensions: {
          probability: 75,
        },
        scanDepth: 3,
        caseSensitive: true,
        matchWholeWords: true,
        agentEditable: false,
      }),
    ]);
  });

  it("normalizes Character Card extension placement and recursion metadata", () => {
    const imported = importWorldbookJson(
      {
        character_book: {
          name: "Clean-room embedded book",
          agent_editable: true,
          entries: [
            {
              id: 7,
              keys: ["/red\\s+bell/i"],
              secondary_keys: ["harbor"],
              comment: "At-depth entry",
              content: "Lore",
              constant: false,
              selective: true,
              insertion_order: 1200,
              enabled: true,
              agentEditable: true,
              position: "after_char",
              use_regex: true,
              extensions: {
                position: 4,
                depth: 0,
                role: 1,
                selectiveLogic: 3,
                prevent_recursion: true,
                exclude_recursion: true,
                delay_until_recursion: false,
                scan_depth: 2,
                case_sensitive: true,
                match_whole_words: true,
                outlet_name: "supporting-lore",
              },
            },
          ],
        },
      },
      {
        idFactory: (kind) => `${kind}-test`,
        now: () => now,
      },
    );

    expect(imported.value.entries).toHaveLength(1);
    expect(imported.value.entries[0]).toMatchObject({
      id: "worldbook-entry-test",
      legacyUid: 7,
      primaryKeys: ["/red\\s+bell/i"],
      secondaryKeys: ["harbor"],
      secondaryLogic: "all",
      scanDepth: 2,
      caseSensitive: true,
      matchWholeWords: true,
      preventRecursion: true,
      excludeRecursion: true,
      delayUntilRecursion: false,
      useRegex: true,
      agentEditable: false,
      legacyInsertionOrder: 1200,
      insertionPosition: "at-depth",
      outletName: "supporting-lore",
      insertionDepth: 0,
      insertionRole: "user",
      position: "after-card",
      order: 1200,
      priority: 1200,
      compatibility: {
        unknownFields: {
          sourceEntryId: 7,
        },
      },
    });
    expect(imported.value.agentEditable).toBe(false);
    expect(imported.diagnostics).toEqual([
      expect.objectContaining({
        code: "IMPORTED_AGENT_PERMISSION_IGNORED",
      }),
    ]);
  });

  it("matches slash-delimited keys and honors recursion inclusion guards", () => {
    let sequence = 0;
    const imported = importWorldbookJson(
      {
        name: "Clean-room matching book",
        recursion_limit: 2,
        entries: [
          {
            id: "regex",
            keys: ["/red\\s+bell/i"],
            content: "regex match",
            enabled: true,
            use_regex: true,
            insertion_order: 400,
          },
          {
            id: "literal",
            keys: ["/blue\\s+bell/i"],
            content: "must remain literal",
            enabled: true,
            use_regex: false,
            insertion_order: 300,
          },
          {
            id: "seed",
            keys: [],
            content: "recursive signal",
            constant: true,
            enabled: true,
            insertion_order: 200,
          },
          {
            id: "excluded",
            keys: ["recursive signal"],
            content: "excluded from recursion",
            enabled: true,
            insertion_order: 100,
            extensions: { exclude_recursion: true },
          },
          {
            id: "delayed",
            keys: ["recursive signal"],
            content: "delayed until recursion",
            enabled: true,
            insertion_order: 50,
            extensions: { delay_until_recursion: true },
          },
        ],
      },
      {
        idFactory: (kind) => `${kind}-${String(++sequence)}`,
        now: () => now,
      },
    );
    const book: Worldbook = imported.value;

    const matches = matchWorldbookEntries(
      [book],
      ["The RED   BELL rings beside /blue\\s+bell/i."],
    );
    expect(
      matches.map((match) => [match.entry.legacyUid, match.depth]),
    ).toEqual([
      ["regex", 0],
      ["literal", 0],
      ["seed", 0],
      ["delayed", 1],
    ]);
    expect(matches.some((match) => match.entry.legacyUid === "excluded")).toBe(
      false,
    );
  });

  it("keeps constant entries active without applying secondary keyword filters", () => {
    const imported = importWorldbookJson(
      {
        name: "Clean-room constant book",
        entries: [
          {
            id: "always",
            keys: [],
            secondary_keys: ["must-not-be-required"],
            selective: true,
            constant: true,
            enabled: true,
            content: "Always included.",
          },
        ],
      },
      {
        idFactory: (kind) => `${kind}-constant`,
        now: () => now,
      },
    );

    const matches = matchWorldbookEntries([imported.value], ["ordinary chat"]);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ reason: "constant" });
    expect(matches[0]?.entry).toMatchObject({
      id: "worldbook-entry-constant",
      legacyUid: "always",
      compatibility: {
        unknownFields: {
          sourceEntryId: "always",
        },
      },
    });
  });
});
