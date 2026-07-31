import type { JsonObject, PromptPreset } from "@stn/contracts";
import { describe, expect, it } from "vitest";

import { ImportSecurityError } from "../import/safe-json.js";
import { assemblePrompt } from "../prompt/assemble.js";
import { resolvePresetConflict } from "./conflict.js";
import { detectPresetFormat } from "./detect.js";
import { importPromptPreset, previewPromptPreset } from "./parse.js";
import { exportPromptPreset } from "./serialize.js";
import type { PresetFormat } from "./types.js";

const timestamp = "2026-07-29T00:00:00.000Z";

function object(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

function parseOptions(prefix = "") {
  let sequence = 0;
  return {
    now: () => timestamp,
    idFactory: (kind: string) => {
      sequence += 1;
      return `${kind}-${prefix}${String(sequence)}`;
    },
  };
}

const formatFixtures: ReadonlyArray<readonly [PresetFormat, JsonObject]> = [
  [
    "openai",
    object({
      prompts: [],
      prompt_order: [],
      chat_completion_source: "openai",
      openai_max_tokens: 512,
    }),
  ],
  [
    "text-generation",
    object({ temp: 0.8, top_k: 40, top_p: 0.9, rep_pen: 1.1 }),
  ],
  [
    "kobold",
    object({
      use_default_badwordsids: true,
      mirostat: 0,
      rep_pen: 1.1,
      rep_pen_range: 1024,
    }),
  ],
  [
    "novelai",
    object({
      phrase_rep_pen: "aggressive",
      tail_free_sampling: 0.9,
      prefix: "vanilla",
      order: [1, 2, 3],
    }),
  ],
  [
    "instruct",
    object({
      name: "ChatML",
      input_sequence: "<user>",
      output_sequence: "<assistant>",
    }),
  ],
  ["context", object({ name: "Context", story_string: "{{description}}" })],
  ["system", object({ name: "System", content: "Remain in character." })],
  [
    "reasoning",
    object({
      name: "Think",
      prefix: "<think>",
      suffix: "</think>",
      separator: "\n",
    }),
  ],
  ["start-reply", object({ value: "Certainly,", show: true })],
  [
    "prompt-manager-full",
    object({
      version: 1,
      type: "full",
      data: { prompts: [], prompt_order: [] },
    }),
  ],
  [
    "prompt-manager-character",
    object({
      version: 1,
      type: "character",
      data: { prompts: [], prompt_order: [] },
    }),
  ],
  [
    "master",
    object({
      instruct: {
        name: "ChatML",
        input_sequence: "<user>",
        output_sequence: "<assistant>",
      },
      context: { name: "Context", story_string: "{{description}}" },
      sysprompt: { name: "System", content: "Stay in character." },
      preset: { temp: 0.7, top_k: 40, top_p: 0.9, rep_pen: 1.05 },
      reasoning: {
        name: "Think",
        prefix: "<think>",
        suffix: "</think>",
        separator: "\n",
      },
      srw: { value: "I", show: true },
    }),
  ],
  [
    "sillytavern-n",
    object({
      spec: "sillytavern_n_prompt_preset",
      data: {},
    }),
  ],
];

describe("preset format detection and preview", () => {
  it.each(formatFixtures)("detects %s by field signature", (format, value) => {
    expect(detectPresetFormat(value).format).toBe(format);
  });

  it.each(formatFixtures.filter(([format]) => format !== "sillytavern-n"))(
    "previews %s without applying it",
    (format, value) => {
      const preview = previewPromptPreset(value, parseOptions(format));
      expect(preview.detection.format).toBe(format);
      expect(preview.preset.compatibility?.sourceFormat).toBe(format);
      expect(preview.sections.length).toBeGreaterThan(0);
    },
  );

  it("parses all master sections into one portable preview", () => {
    const master = formatFixtures.find(([format]) => format === "master")?.[1];
    expect(master).toBeDefined();
    const preview = previewPromptPreset(master as JsonObject, parseOptions());

    expect(preview.sections.map((section) => section.kind)).toEqual([
      "instruct",
      "context",
      "sysprompt",
      "preset",
      "reasoning",
      "srw",
    ]);
    expect(preview.preset.generation.temperature).toBe(0.7);
    expect(
      preview.preset.prompts.some(
        (prompt) => prompt.metadata.presetKind === "system",
      ),
    ).toBe(true);
  });
});

describe("preset normalization and export", () => {
  it("retains enabled EJS prompts for the native trusted template pipeline", () => {
    const preview = previewPromptPreset(
      object({
        prompts: [
          {
            identifier: "ejs-rule",
            name: "EJS rule",
            role: "system",
            content: "Favor: <%= variables.favor %>",
            enabled: true,
          },
        ],
        prompt_order: [{ identifier: "ejs-rule", enabled: true }],
      }),
      parseOptions(),
    );

    expect(preview.preset.prompts[0]).toMatchObject({
      id: "ejs-rule",
      enabled: true,
      content: "Favor: <%= variables.favor %>",
    });
    expect(preview.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "EXECUTABLE_TEMPLATE_RETAINED",
        severity: "info",
      }),
    );
  });

  it("preserves wrapper, data, and prompt unknown fields across ST export", () => {
    const source = object({
      version: 7,
      type: "full",
      future_root: { enabled: true },
      data: {
        future_data: 42,
        prompts: [
          {
            identifier: "custom-rule",
            name: "Custom rule",
            role: "system",
            content: "Protect {{user}}.",
            enabled: true,
            system_prompt: false,
            vendor_prompt: "kept",
          },
        ],
        prompt_order: [{ identifier: "custom-rule", enabled: true }],
      },
    });
    const preview = previewPromptPreset(source, parseOptions());

    expect(preview.unknownFields.future_root).toEqual({ enabled: true });
    expect(preview.unknownFields.dataUnknown).toEqual({ future_data: 42 });
    expect(preview.preset.prompts[0]?.metadata.legacy).toEqual({
      vendor_prompt: "kept",
    });

    const exported = exportPromptPreset(preview.preset, {
      target: "sillytavern",
    });
    expect(exported.future_root).toEqual({ enabled: true });
    expect((exported.data as JsonObject).future_data).toBe(42);
    expect(
      ((exported.data as JsonObject).prompts as JsonObject[])[0]?.vendor_prompt,
    ).toBe("kept");

    const roundTrip = importPromptPreset(exported, parseOptions());
    expect(roundTrip.prompts).toEqual(preview.preset.prompts);
    expect(roundTrip.mode).toBe(preview.preset.mode);
  });

  it("keeps nested prompt order authoritative and round-trips legacy anchors", () => {
    const source = object({
      name: "Ordered compatibility preset",
      openai_max_context: 2_000_000,
      prompts: [
        {
          identifier: "main",
          name: "Variable setup",
          role: "system",
          content: "{{setvar::mode::focused}}",
          enabled: false,
          marker: false,
          system_prompt: true,
          injection_position: 0,
          injection_depth: 4,
          injection_order: 100,
          injection_trigger: [],
        },
        {
          identifier: "chatHistory",
          name: "Chat history",
          role: "system",
          enabled: true,
          marker: true,
          system_prompt: true,
          injection_position: 0,
          injection_depth: 4,
          injection_order: 100,
          injection_trigger: [],
        },
        {
          identifier: "after-history",
          name: "After history",
          role: "assistant",
          content: "{{getvar::mode}} / {{lastUserMessage}}",
          enabled: false,
          marker: false,
          system_prompt: false,
          injection_position: 0,
          injection_depth: 4,
          injection_order: 100,
          injection_trigger: [],
        },
        {
          identifier: "orphan",
          name: "Stored but not ordered",
          role: "system",
          content: "Must not run.",
          enabled: true,
          marker: false,
          system_prompt: false,
          injection_position: 0,
          injection_depth: 4,
          injection_order: 100,
          injection_trigger: [],
        },
      ],
      prompt_order: [
        {
          character_id: 100001,
          order: [
            { identifier: "main", enabled: true },
            { identifier: "chatHistory", enabled: true },
            { identifier: "after-history", enabled: true },
          ],
        },
      ],
    });

    const preview = previewPromptPreset(source, parseOptions());
    const main = preview.preset.prompts.find((prompt) => prompt.id === "main");
    const history = preview.preset.prompts.find(
      (prompt) => prompt.id === "chatHistory",
    );
    const orphan = preview.preset.prompts.find(
      (prompt) => prompt.id === "orphan",
    );
    expect(main?.enabled).toBe(true);
    expect(main?.marker).toBeUndefined();
    expect(history?.marker).toBe("history");
    expect(history?.metadata.dynamicMarker).toBe(true);
    expect(orphan?.enabled).toBe(false);
    expect(orphan?.metadata.promptOrderMember).toBe(false);
    expect(preview.preset.generation.additional.maxContextTokens).toBe(
      2_000_000,
    );

    const assembled = assemblePrompt({
      preset: preview.preset,
      currentInput: "Latest user turn.",
    });
    expect(
      assembled.trace.assembled
        .filter((segment) => segment.source.kind === "preset")
        .map((segment) => ({
          content: segment.content,
          position: segment.position,
        })),
    ).toEqual([
      {
        content: "focused / Latest user turn.",
        position: "after-history",
      },
    ]);

    const exported = exportPromptPreset(preview.preset, {
      target: "sillytavern",
      format: "openai",
    });
    expect(exported.prompt_order).toEqual(source.prompt_order);
    const exportedPrompts = exported.prompts as JsonObject[];
    expect(exportedPrompts).toHaveLength(4);
    expect(exportedPrompts[0]).toMatchObject({
      enabled: false,
      marker: false,
      injection_position: 0,
      injection_depth: 4,
      injection_order: 100,
      injection_trigger: [],
    });
    expect(exportedPrompts[1]).toMatchObject({
      marker: true,
      injection_position: 0,
      injection_depth: 4,
      injection_order: 100,
      injection_trigger: [],
    });
    expect(exportedPrompts[3]?.enabled).toBe(true);
  });

  it("retains unordered optional prompts and exports them after a user enables one", () => {
    const source = object({
      name: "Clean-room optional prompt preset",
      prompts: [
        {
          identifier: "active-rule",
          name: "Active rule",
          role: "system",
          content: "ACTIVE_RULE",
          enabled: true,
        },
        {
          identifier: "optional-rule",
          name: "Optional rule",
          role: "system",
          content: "OPTIONAL_RULE",
          enabled: true,
        },
      ],
      prompt_order: [
        {
          character_id: 100001,
          order: [{ identifier: "active-rule", enabled: true }],
        },
      ],
    });
    const preview = previewPromptPreset(source, parseOptions());
    const optional = preview.preset.prompts.find(
      (prompt) => prompt.id === "optional-rule",
    );

    expect(preview.preset.prompts).toHaveLength(2);
    expect(optional).toMatchObject({
      content: "OPTIONAL_RULE",
      enabled: false,
      metadata: { promptOrderMember: false },
    });
    expect(
      assemblePrompt({ preset: preview.preset })
        .segments.map((segment) => segment.content)
        .join("\n"),
    ).not.toContain("OPTIONAL_RULE");

    const enabledPreset: PromptPreset = {
      ...preview.preset,
      prompts: preview.preset.prompts.map((prompt) =>
        prompt.id === "optional-rule"
          ? {
              ...prompt,
              enabled: true,
              order: 1,
              metadata: {
                ...prompt.metadata,
                promptOrderMember: true,
                promptOrderIndex: 1,
              },
            }
          : prompt,
      ),
    };
    const exported = exportPromptPreset(enabledPreset, {
      target: "sillytavern",
      format: "openai",
    });
    const nestedOrder = (
      (exported.prompt_order as JsonObject[])[0]?.order as JsonObject[]
    ).map((item) => ({
      identifier: item.identifier,
      enabled: item.enabled,
    }));

    expect(nestedOrder).toEqual([
      { identifier: "active-rule", enabled: true },
      { identifier: "optional-rule", enabled: true },
    ]);
    const roundTrip = importPromptPreset(exported, parseOptions());
    expect(
      roundTrip.prompts.find((prompt) => prompt.id === "optional-rule"),
    ).toMatchObject({
      content: "OPTIONAL_RULE",
      enabled: true,
      order: 1,
      metadata: { promptOrderIndex: 1, promptOrderMember: true },
    });
  });

  it("round-trips the normalized NG representation", () => {
    const preset = importPromptPreset(
      object({
        name: "OpenAI",
        prompts: [
          {
            identifier: "main",
            name: "Main",
            role: "system",
            content: "Preset rule.",
            enabled: true,
            system_prompt: true,
          },
        ],
        prompt_order: [{ identifier: "main", enabled: true }],
        temperature: 0.4,
        top_p: 0.8,
        openai_max_tokens: 256,
        vendor_sampler: 9,
      }),
      parseOptions(),
    );
    const exported = exportPromptPreset(preset, {
      target: "sillytavern-n",
    });
    const imported = importPromptPreset(exported);

    expect(imported).toEqual(preset);
  });

  it("exports canonical generation edits using ST field names", () => {
    const preset = importPromptPreset(
      object({ temp: 0.8, top_k: 40, top_p: 0.9, rep_pen: 1.1, future: true }),
      parseOptions(),
    );
    const edited: PromptPreset = {
      ...preset,
      generation: { ...preset.generation, temperature: 0.25 },
    };
    const exported = exportPromptPreset(edited, {
      target: "sillytavern",
      format: "text-generation",
    });

    expect(exported.temp).toBe(0.25);
    expect(exported.future).toBe(true);
  });

  it("changes the prompt trace when an imported preset is applied", () => {
    const preset = importPromptPreset(
      object({
        prompts: [
          {
            identifier: "main",
            name: "Main",
            role: "system",
            content: "Preset rule.",
            enabled: true,
            system_prompt: true,
          },
        ],
        prompt_order: [{ identifier: "main", enabled: true }],
        chat_completion_source: "openai",
      }),
      parseOptions(),
    );
    const withoutPreset = assemblePrompt({ currentInput: "Hello" });
    const withPreset = assemblePrompt({ preset, currentInput: "Hello" });

    expect(
      withoutPreset.trace.assembled.some(
        (segment) => segment.source.kind === "preset",
      ),
    ).toBe(false);
    expect(
      withPreset.trace.assembled
        .filter((segment) => segment.source.kind === "preset")
        .map((segment) => segment.content),
    ).toEqual(["Preset rule."]);
  });

  it("rejects prototype-polluting keys at any nesting depth", () => {
    expect(() =>
      previewPromptPreset(
        '{"name":"Unsafe","content":"x","nested":{"__proto__":{"polluted":true}}}',
      ),
    ).toThrowError(ImportSecurityError);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
});

describe("preset conflict strategies", () => {
  const existing = importPromptPreset(
    object({ name: "Shared", content: "Old" }),
    {
      ...parseOptions(),
      idFactory: (kind) => `${kind}-same`,
    },
  );
  const incoming = importPromptPreset(
    object({ name: "Shared", content: "New", future: "kept" }),
    {
      ...parseOptions(),
      idFactory: (kind) => `${kind}-same`,
    },
  );

  it("keeps, replaces, duplicates, and merges deterministically", () => {
    expect(
      resolvePresetConflict(existing, incoming, "keep-existing").preset,
    ).toBe(existing);

    const replaced = resolvePresetConflict(existing, incoming, "replace", {
      now: () => "2026-07-30",
    });
    expect(replaced.preset.id).toBe(existing.id);
    expect(replaced.preset.prompts[0]?.content).toBe("New");

    const duplicated = resolvePresetConflict(existing, incoming, "duplicate", {
      now: () => "2026-07-30",
      idFactory: () => "duplicate-id",
    });
    expect(duplicated.preset.id).toBe("duplicate-id");
    expect(duplicated.preset.name).toBe("Shared (imported)");

    const merged = resolvePresetConflict(existing, incoming, "merge", {
      now: () => "2026-07-30",
    });
    expect(merged.preset.prompts[0]?.content).toBe("New");
    expect(merged.conflicts.map((conflict) => conflict.kind)).toEqual([
      "preset-id",
      "preset-name",
      "prompt-id",
    ]);
    expect(merged.preset.compatibility?.unknownFields.future).toBe("kept");
  });
});
