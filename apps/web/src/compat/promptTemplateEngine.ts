import _ from "lodash";

import type {
  PreparedPromptMessage,
  PromptTemplateDirective,
} from "../api/workspaceApi";
import type { TavernHelperContext } from "./tavernHelperTypes";
import { browserRegexWorker } from "./browserRegexWorker";
import {
  applyPromptInjections,
  hasPromptTemplateDecorator,
  isInitialVariablesEntry,
  isPromptTemplateEntryEnabled,
  isStandalonePromptTemplateEntry,
  parsePromptInjection,
  parsePromptTemplateDecorators,
  promptTemplateDecoratorArgument,
  promptTemplateEntryTriggered,
  promptTemplateGenerationPosition,
  promptTemplateRenderPosition,
  type PromptInjectionInstruction,
  type PromptTemplateSourceEntry,
} from "./promptTemplateDirectives";

export type PromptTemplateDiagnostic = {
  messageIndex: number;
  message: string;
  phase?: "directive" | "preprocess" | "render";
  sourceId?: string;
  sourceLabel?: string;
};

export type PromptTemplateResult = {
  messages: PreparedPromptMessage[];
  diagnostics: PromptTemplateDiagnostic[];
  renderedCount: number;
  sourceTemplateCount: number;
  displayRenderedIndexes?: number[];
};

const templatePattern = /<%[\s\S]*?%>/gu;
const escapeTemplateScopePattern = /<#escape-ejs>([\s\S]*?)<#\/escape-ejs>/giu;

type PromptWorldbookEntry = PromptTemplateSourceEntry & {
  id: string;
  worldbookId: string;
  worldbookName: string;
  title: string;
  content: string;
  cleanContent: string;
  enabled: boolean;
  order: number;
  legacyUid: number | null;
  probability?: number;
};

type TemporaryRegex = {
  find: RegExp;
  replacement: string | ((...values: string[]) => string);
  generate: boolean;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function coerceEjsOutput(value: unknown): string {
  // Compatibility requires ordinary JavaScript string coercion, including
  // custom toString implementations exposed to trusted prompt templates.
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  return String(value ?? "");
}

function latestMessageVariables(
  context: TavernHelperContext | null,
): Record<string, unknown> {
  if (!context) return {};
  const values = Object.values(context.variables.messages);
  const latest = values.at(-1) ?? context.variables.chat;
  if (_.isPlainObject(latest.stat_data) && !_.isEmpty(latest.stat_data)) {
    return structuredClone(latest);
  }
  for (let index = values.length - 2; index >= 0; index -= 1) {
    const candidate = values[index];
    if (
      candidate &&
      _.isPlainObject(candidate.stat_data) &&
      !_.isEmpty(candidate.stat_data)
    ) {
      return structuredClone({
        ...candidate,
        ...latest,
        stat_data: candidate.stat_data,
      });
    }
  }
  return structuredClone(latest);
}

function protectEscapedTemplates(content: string): {
  content: string;
  restore: (rendered: string) => string;
} {
  let marker = "STN_ESCAPED_EJS_BLOCK";
  while (content.includes(marker)) marker += "_";
  const blocks: string[] = [];
  const protectedContent = content.replace(
    escapeTemplateScopePattern,
    (_match, escaped: string) => {
      const index = blocks.length;
      blocks.push(escaped);
      return `\u0000${marker}${String(index)}\u0000`;
    },
  );
  return {
    content: protectedContent,
    restore: (rendered) =>
      rendered.replace(
        new RegExp(`\\u0000${marker}(\\d+)\\u0000`, "gu"),
        (_match, index: string) => blocks[Number(index)] ?? "",
      ),
  };
}

function stripExecutableTemplate(content: string): string {
  const protectedTemplate = protectEscapedTemplates(content);
  return protectedTemplate.restore(
    protectedTemplate.content.replace(templatePattern, ""),
  );
}

function unwrapEscapedTemplates(content: string): string {
  const protectedTemplate = protectEscapedTemplates(content);
  return protectedTemplate.restore(protectedTemplate.content);
}

function hasTemplate(content: string): boolean {
  const protectedTemplate = protectEscapedTemplates(content);
  templatePattern.lastIndex = 0;
  const result = templatePattern.test(protectedTemplate.content);
  templatePattern.lastIndex = 0;
  return result;
}

function escapeDisplayText(content: string): string {
  return content
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function formatDisplayTemplate(
  content: string,
  formatter: (content: string) => string,
): string {
  let marker = "STN_DISPLAY_EJS_BLOCK";
  while (content.includes(marker)) marker += "_";
  const blocks: Array<{ content: string; escaped: boolean }> = [];
  const protect = (value: string, escaped: boolean) => {
    const index = blocks.length;
    blocks.push({ content: value, escaped });
    return `${marker}${String(index)}END`;
  };
  const escapedScopes = content.replace(
    escapeTemplateScopePattern,
    (_match, escaped: string) => protect(escaped, true),
  );
  const protectedTemplate = escapedScopes.replace(templatePattern, (template) =>
    protect(template, false),
  );
  return formatter(protectedTemplate).replace(
    new RegExp(`${marker}(\\d+)END`, "gu"),
    (_match, index: string) => {
      const block = blocks[Number(index)];
      if (!block) return "";
      return block.escaped ? escapeDisplayText(block.content) : block.content;
    },
  );
}

function promptWorldbookEntries(
  context: TavernHelperContext | null,
): PromptWorldbookEntry[] {
  return (context?.worldbooks ?? []).flatMap((worldbook) =>
    worldbook.entries.map((entry) => {
      const parsed = parsePromptTemplateDecorators(entry.content);
      const extensions =
        typeof entry.metadata.extensions === "object" &&
        entry.metadata.extensions !== null &&
        !Array.isArray(entry.metadata.extensions)
          ? (entry.metadata.extensions as Record<string, unknown>)
          : undefined;
      const rawProbability = extensions?.probability;
      return {
        id: entry.id,
        worldbookId: worldbook.id,
        worldbookName: worldbook.name,
        title:
          typeof entry.metadata.label === "string"
            ? entry.metadata.label.trim()
            : `条目 ${String((entry.legacyUid ?? entry.position) + 1)}`,
        content: entry.content,
        cleanContent: parsed.cleanContent,
        enabled: entry.enabled,
        order: entry.position,
        legacyUid: entry.legacyUid,
        decorators: parsed.decorators,
        ...(typeof rawProbability === "number" &&
        Number.isFinite(rawProbability)
          ? { probability: Math.max(0, Math.min(100, rawProbability)) }
          : {}),
      };
    }),
  );
}

function replaceEntryContent(
  messages: PreparedPromptMessage[],
  entry: PromptWorldbookEntry,
  replacement: string,
): boolean {
  let replaced = false;
  for (const message of messages) {
    if (message.content.includes(entry.content)) {
      message.content = message.content.replaceAll(entry.content, replacement);
      replaced = true;
      continue;
    }
    if (
      entry.cleanContent !== entry.content &&
      message.content.includes(entry.cleanContent)
    ) {
      message.content = message.content.replaceAll(
        entry.cleanContent,
        replacement,
      );
      replaced = true;
    }
  }
  return replaced;
}

export async function renderPromptTemplateMessages(
  messages: readonly PreparedPromptMessage[],
  input: {
    enabled: boolean;
    context: TavernHelperContext | null;
    directives?: readonly PromptTemplateDirective[];
    random?: () => number;
    phase?: "display" | "generate";
    formatDisplayContent?: (content: string) => string;
    formatDisplayInline?: (content: string) => string;
  },
): Promise<PromptTemplateResult> {
  const diagnostics: PromptTemplateDiagnostic[] = [];
  let renderedCount = 0;
  const variables = _.merge(
    {},
    input.context?.variables.global ?? {},
    input.context?.variables.character ?? {},
    input.context?.variables.preset ?? {},
    input.context?.variables.chat ?? {},
    latestMessageVariables(input.context),
  ) as Record<string, unknown>;
  const persistMessageVariables = () => {
    if (typeof window === "undefined") return;
    const replaceVariables = (
      window as unknown as {
        replaceVariables?: (
          variables: Record<string, unknown>,
          option: { type: "message"; message_id?: number | "latest" },
        ) => void;
      }
    ).replaceVariables;
    replaceVariables?.(variables, { type: "message", message_id: "latest" });
  };
  const setvar = (
    path: string,
    value: unknown,
    option: { scope?: string; results?: "old" | "new" } = {},
  ) => {
    const old = _.get(variables, path);
    _.set(variables, path, value);
    if (option.scope !== "cache") persistMessageVariables();
    return option.results === "old"
      ? old
      : option.results === "new"
        ? value
        : "";
  };
  const getvar = (path: string, fallback = "") =>
    _.get(variables, path, fallback);
  const worldbookEntries = promptWorldbookEntries(input.context);
  const injectedPrompts = new Map<string, string[]>();
  const forceActivatedEntryIds = new Set<string>();
  const hardForceActivatedEntryIds = new Set<string>();
  const temporaryRegexes: TemporaryRegex[] = [];
  const findWorldbookEntry = (
    worldbookOrEntry: string | number | RegExp,
    entryReference?: string | number | RegExp,
  ): PromptWorldbookEntry | undefined => {
    const reference = entryReference ?? worldbookOrEntry;
    const worldbook =
      entryReference === undefined ? undefined : worldbookOrEntry;
    return worldbookEntries.find((entry) => {
      const worldbookMatches =
        worldbook === undefined ||
        (typeof worldbook === "string" &&
          (entry.worldbookId === worldbook ||
            entry.worldbookName === worldbook)) ||
        (worldbook instanceof RegExp &&
          (worldbook.test(entry.worldbookId) ||
            worldbook.test(entry.worldbookName)));
      if (!worldbookMatches) return false;
      if (typeof reference === "number") return entry.legacyUid === reference;
      if (reference instanceof RegExp)
        return reference.test(entry.title) || reference.test(entry.id);
      return (
        entry.title === reference ||
        entry.id === reference ||
        String(entry.legacyUid) === reference
      );
    });
  };
  const getwi = (
    worldbookOrEntry: string | number | RegExp,
    entryReference?: string | number | RegExp,
  ) => findWorldbookEntry(worldbookOrEntry, entryReference)?.cleanContent ?? "";
  const activewi = async (
    worldbookOrEntry: string | number | RegExp,
    entryReferenceOrForce?: string | number | RegExp | boolean,
    force = false,
  ) => {
    const entryReference =
      typeof entryReferenceOrForce === "boolean"
        ? undefined
        : entryReferenceOrForce;
    const hardForce =
      typeof entryReferenceOrForce === "boolean"
        ? entryReferenceOrForce
        : force;
    const entry = findWorldbookEntry(worldbookOrEntry, entryReference);
    if (entry) {
      forceActivatedEntryIds.add(entry.id);
      if (hardForce) hardForceActivatedEntryIds.add(entry.id);
    }
    return entry ?? null;
  };
  const injectPrompt = (name: string, content: string) => {
    const current = injectedPrompts.get(name) ?? [];
    current.push(String(content));
    injectedPrompts.set(name, current);
    return "";
  };
  const getPromptsInjected = (name: string) =>
    (injectedPrompts.get(name) ?? []).join("\n");
  const activateRegex = (
    find: RegExp,
    replacement: TemporaryRegex["replacement"],
    option: { generate?: boolean } = {},
  ) => {
    temporaryRegexes.push({
      find,
      replacement,
      generate: option.generate !== false,
    });
    return "";
  };
  const applyTemporaryRegexes = async (content: string): Promise<string> => {
    const enabled = temporaryRegexes.filter((regex) => regex.generate);
    const workerReplacements = enabled.flatMap((regex) =>
      typeof regex.replacement === "string"
        ? [{ find: regex.find, replacement: regex.replacement }]
        : [],
    );
    let output = await browserRegexWorker.replace(content, workerReplacements);
    for (const regex of enabled) {
      const replacement = regex.replacement;
      if (typeof replacement === "string") continue;
      output = output.replace(regex.find, (...values) =>
        replacement(...values.map(String)),
      );
    }
    return output;
  };
  const renderContent = async (
    content: string,
    message: PreparedPromptMessage,
    messageIndex: number,
    additional: Record<string, unknown> = {},
    options: { escapeFunction?: (value: unknown) => string } = {},
  ) => {
    const { default: ejs } = await import("ejs");
    const browserGlobals =
      typeof window === "undefined"
        ? {}
        : ((window as unknown as { TavernHelper?: Record<string, unknown> })
            .TavernHelper ?? {});
    const protectedTemplate = protectEscapedTemplates(
      await applyTemporaryRegexes(content),
    );
    const rendered = await ejs.render(
      protectedTemplate.content,
      {
        ...browserGlobals,
        variables,
        messages,
        message,
        message_index: messageIndex,
        getvar,
        setvar,
        getGlobalVar: (path: string, fallback = "") =>
          _.get(input.context?.variables.global ?? {}, path, fallback),
        getChatVar: (path: string, fallback = "") =>
          _.get(input.context?.variables.chat ?? {}, path, fallback),
        getCharacterVar: (path: string, fallback = "") =>
          _.get(input.context?.variables.character ?? {}, path, fallback),
        getPresetVar: (path: string, fallback = "") =>
          _.get(input.context?.variables.preset ?? {}, path, fallback),
        getwi,
        getWorldInfo: getwi,
        activewi,
        injectPrompt,
        getPromptsInjected,
        activateRegex,
        substitudeMacros: (text: string) => {
          if (typeof window === "undefined") return text;
          const substitute = (
            window as unknown as {
              substitudeMacros?: (value: string) => string;
            }
          ).substitudeMacros;
          return substitute?.(text) ?? text;
        },
        SillyTavern:
          typeof window === "undefined"
            ? undefined
            : (window as unknown as { SillyTavern?: unknown }).SillyTavern,
        Mvu:
          typeof window === "undefined"
            ? undefined
            : (window as unknown as { Mvu?: unknown }).Mvu,
        _,
        ...additional,
      },
      {
        async: true,
        escapeFunction: options.escapeFunction ?? coerceEjsOutput,
      } as Parameters<typeof ejs.render>[2],
    );
    return protectedTemplate.restore(rendered);
  };
  const working = messages.map((message) => ({ ...message }));

  const directiveEntries = [...(input.directives ?? [])].map((directive) => {
    const parsed = parsePromptTemplateDecorators(directive.content);
    return {
      id: directive.id,
      worldbookId: directive.worldbookId,
      worldbookName:
        worldbookEntries.find(
          (entry) => entry.worldbookId === directive.worldbookId,
        )?.worldbookName ?? directive.worldbookId,
      title: directive.title,
      content: directive.content,
      cleanContent: parsed.cleanContent,
      enabled: directive.enabled,
      order: directive.order,
      legacyUid: null,
      decorators: parsed.decorators,
      ...(directive.probability === undefined
        ? {}
        : { probability: directive.probability }),
    } satisfies PromptWorldbookEntry;
  });
  const entriesById = new Map(
    [...worldbookEntries, ...directiveEntries].map((entry) => [
      entry.id,
      entry,
    ]),
  );
  const allEntries = [...entriesById.values()].sort(
    (left, right) =>
      left.order - right.order ||
      left.worldbookName.localeCompare(right.worldbookName) ||
      left.id.localeCompare(right.id),
  );
  const sourceTemplateCount = allEntries.filter((entry) =>
    hasTemplate(entry.cleanContent),
  ).length;
  const random = input.random ?? Math.random;
  const eligibleEntryIds = new Set(
    allEntries
      .filter(
        (entry) =>
          isPromptTemplateEntryEnabled(entry) &&
          (!isStandalonePromptTemplateEntry(entry) ||
            promptTemplateEntryTriggered(entry.probability, random)),
      )
      .map((entry) => entry.id),
  );
  const suppressedEntryIds = new Set<string>();

  if (input.phase === "display") {
    const formatDisplayContent =
      input.formatDisplayContent ?? ((value) => value);
    const formatDisplayInline = input.formatDisplayInline ?? ((value) => value);
    const displayEscape = (value: unknown) =>
      formatDisplayInline(coerceEjsOutput(value));
    const renderEntries = allEntries.filter(
      (entry) =>
        promptTemplateRenderPosition(entry) !== undefined &&
        eligibleEntryIds.has(entry.id) &&
        !hasPromptTemplateDecorator(entry, "dont_activate") &&
        !hasPromptTemplateDecorator(entry, "only_preload"),
    );
    const displayRenderedIndexes: number[] = [];

    for (const [messageIndex, message] of working.entries()) {
      const sourceHasTemplate = hasTemplate(message.content);
      if (
        !sourceHasTemplate &&
        (!input.enabled || renderEntries.length === 0)
      ) {
        continue;
      }
      displayRenderedIndexes.push(messageIndex);
      if (!input.enabled) {
        message.content = formatDisplayContent(
          stripExecutableTemplate(message.content),
        );
        continue;
      }

      const metadata = {
        runType: "render",
        message_id: messageIndex,
        swipe_id: 0,
        is_last: messageIndex === working.length - 1,
        is_user: message.role === "user",
        is_system: message.role === "system",
        name:
          message.role === "user"
            ? "user"
            : message.role === "assistant"
              ? "assistant"
              : message.role,
        isDryRun: false,
        generateType: "",
      };
      const renderEntry = async (
        entry: PromptWorldbookEntry,
      ): Promise<string> => {
        const condition = promptTemplateDecoratorArgument(entry, "if");
        if (condition !== undefined) {
          const conditionResult = await renderContent(
            `<%= Boolean(${condition}) %>`,
            message,
            messageIndex,
            { ...metadata, world_info: entry },
          );
          if (conditionResult.trim() !== "true") return "";
        }
        let rendered = await renderContent(
          entry.cleanContent,
          message,
          messageIndex,
          { ...metadata, world_info: entry },
          { escapeFunction: displayEscape },
        );
        if (hasPromptTemplateDecorator(entry, "message_formatting")) {
          rendered = formatDisplayContent(rendered);
        }
        renderedCount += 1;
        return rendered;
      };

      let mainContent: string;
      try {
        mainContent = await renderContent(
          formatDisplayTemplate(message.content, formatDisplayContent),
          message,
          messageIndex,
          metadata,
          { escapeFunction: displayEscape },
        );
        if (sourceHasTemplate) renderedCount += 1;
      } catch (error) {
        mainContent = formatDisplayContent(
          stripExecutableTemplate(message.content),
        );
        diagnostics.push({
          messageIndex,
          message: errorMessage(error),
          phase: "render",
        });
      }

      const before: string[] = [];
      const after: string[] = [];
      for (const entry of renderEntries) {
        try {
          const rendered = await renderEntry(entry);
          if (!rendered) continue;
          if (promptTemplateRenderPosition(entry) === "BEFORE") {
            before.push(rendered);
          } else {
            after.push(rendered);
          }
        } catch (error) {
          diagnostics.push({
            messageIndex,
            message: errorMessage(error),
            phase: "directive",
            sourceId: entry.id,
            sourceLabel: `${entry.worldbookName}: ${entry.title}`,
          });
        }
      }
      message.content = `${before.join("")}${mainContent}${after.join("")}`;
    }

    return {
      messages: working,
      diagnostics,
      renderedCount,
      sourceTemplateCount,
      displayRenderedIndexes,
    };
  }

  if (input.enabled) {
    for (const entry of allEntries) {
      if (isStandalonePromptTemplateEntry(entry)) {
        replaceEntryContent(working, entry, "");
      }
    }
    for (const entry of allEntries) {
      if (!isInitialVariablesEntry(entry)) continue;
      replaceEntryContent(working, entry, "");
      if (!eligibleEntryIds.has(entry.id)) continue;
      try {
        const initial = JSON.parse(entry.cleanContent) as unknown;
        if (
          typeof initial === "object" &&
          initial !== null &&
          !Array.isArray(initial)
        ) {
          _.merge(variables, initial);
          persistMessageVariables();
        }
      } catch (error) {
        diagnostics.push({
          messageIndex: -1,
          message: errorMessage(error),
          phase: "preprocess",
          sourceId: entry.id,
          sourceLabel: `${entry.worldbookName}: ${entry.title}`,
        });
      }
    }

    for (const entry of allEntries) {
      if (!eligibleEntryIds.has(entry.id)) continue;
      const condition = promptTemplateDecoratorArgument(entry, "if");
      if (condition !== undefined) {
        try {
          const result = await renderContent(
            `<%= Boolean(${condition}) %>`,
            { role: "system", content: entry.cleanContent },
            -1,
            { world_info: entry },
          );
          if (result.trim() !== "true") {
            replaceEntryContent(working, entry, "");
            suppressedEntryIds.add(entry.id);
            continue;
          }
        } catch (error) {
          replaceEntryContent(working, entry, "");
          suppressedEntryIds.add(entry.id);
          diagnostics.push({
            messageIndex: -1,
            message: errorMessage(error),
            phase: "preprocess",
            sourceId: entry.id,
            sourceLabel: `${entry.worldbookName}: ${entry.title}`,
          });
          continue;
        }
      }
      if (hasPromptTemplateDecorator(entry, "only_preload")) {
        replaceEntryContent(working, entry, "");
        suppressedEntryIds.add(entry.id);
        continue;
      }
      if (hasPromptTemplateDecorator(entry, "dont_activate")) {
        replaceEntryContent(working, entry, "");
        continue;
      }
      if (hasPromptTemplateDecorator(entry, "activate")) {
        forceActivatedEntryIds.add(entry.id);
        hardForceActivatedEntryIds.add(entry.id);
      }
      if (hasPromptTemplateDecorator(entry, "preprocessing")) {
        try {
          const content = await renderContent(
            entry.cleanContent,
            { role: "system", content: entry.cleanContent },
            -1,
            { world_info: entry },
          );
          replaceEntryContent(working, entry, content);
          renderedCount += 1;
        } catch (error) {
          replaceEntryContent(working, entry, "");
          diagnostics.push({
            messageIndex: -1,
            message: errorMessage(error),
            phase: "preprocess",
            sourceId: entry.id,
            sourceLabel: `${entry.worldbookName}: ${entry.title}`,
          });
        }
      }
    }

    const promptInjections: PromptInjectionInstruction[] = [];
    for (const [sequence, entry] of allEntries.entries()) {
      const position = promptTemplateGenerationPosition(entry);
      const regex = /^\[GENERATE:REGEX:(.+)\]$/iu.exec(entry.title);
      const inject = /^@INJECT\b/iu.test(entry.title);
      if (!position && !regex && !inject) continue;
      replaceEntryContent(working, entry, "");
      if (suppressedEntryIds.has(entry.id) || !eligibleEntryIds.has(entry.id)) {
        continue;
      }
      if (position) {
        let renderedDirective: string;
        try {
          renderedDirective = await renderContent(
            entry.cleanContent,
            { role: "system", content: entry.cleanContent },
            -1,
            { world_info: entry },
          );
        } catch (error) {
          diagnostics.push({
            messageIndex: -1,
            message: errorMessage(error),
            phase: "directive",
            sourceId: entry.id,
            sourceLabel: `${entry.worldbookName}: ${entry.title}`,
          });
          continue;
        }
        const index =
          position.index === undefined
            ? position.position === "BEFORE"
              ? 0
              : working.length - 1
            : Math.min(working.length - 1, Math.max(0, Number(position.index)));
        const target = working[index];
        if (target) {
          target.content =
            position.position === "BEFORE"
              ? `${renderedDirective}\n${target.content}`
              : `${target.content}\n${renderedDirective}`;
        }
        continue;
      }
      if (regex) {
        try {
          const index = await browserRegexWorker.findIndex(
            working.map((message) => message.content),
            regex[1]!,
          );
          const target = working[index];
          if (target) {
            const content = await renderContent(
              entry.cleanContent,
              target,
              index,
              {
                matched_message: target.content,
                matched_message_index: index,
                matched_message_role: target.role,
              },
            );
            working.splice(index, 0, { role: "system", content });
          }
        } catch (error) {
          diagnostics.push({
            messageIndex: -1,
            message: errorMessage(error),
            phase: "directive",
            sourceId: entry.id,
            sourceLabel: `${entry.worldbookName}: ${entry.title}`,
          });
        }
        continue;
      }
      if (inject) {
        const instruction = parsePromptInjection(
          entry.title,
          "",
          entry.order,
          sequence,
        );
        if (!instruction) continue;
        try {
          const content = await renderContent(
            entry.cleanContent,
            { role: instruction.role, content: entry.cleanContent },
            -1,
            { world_info: entry },
          );
          if (content.trim()) {
            promptInjections.push({ ...instruction, content });
          }
        } catch (error) {
          diagnostics.push({
            messageIndex: -1,
            message: errorMessage(error),
            phase: "directive",
            sourceId: entry.id,
            sourceLabel: `${entry.worldbookName}: ${entry.title}`,
          });
        }
      }
    }

    if (promptInjections.length > 0) {
      const injected = await applyPromptInjections(
        working,
        promptInjections,
        (contents, pattern) =>
          browserRegexWorker.findIndex([...contents], pattern),
      );
      working.splice(0, working.length, ...injected);
    }

    for (const entry of allEntries) {
      const forced = forceActivatedEntryIds.has(entry.id);
      const hardForced = hardForceActivatedEntryIds.has(entry.id);
      if (
        suppressedEntryIds.has(entry.id) ||
        (!entry.enabled && !forced) ||
        (hasPromptTemplateDecorator(entry, "dont_activate") && !hardForced) ||
        isStandalonePromptTemplateEntry(entry) ||
        hasPromptTemplateDecorator(entry, "preprocessing")
      ) {
        continue;
      }
      const present = working.some(
        (message) =>
          message.content.includes(entry.content) ||
          message.content.includes(entry.cleanContent),
      );
      if (!present && !forced) continue;
      try {
        const content = hasTemplate(entry.cleanContent)
          ? await renderContent(
              entry.cleanContent,
              { role: "system", content: entry.cleanContent },
              -1,
              { world_info: entry },
            )
          : entry.cleanContent;
        if (present) {
          replaceEntryContent(working, entry, content);
        } else if (content) {
          const target = working[0];
          if (target) target.content = `${target.content}\n${content}`;
          else working.push({ role: "system", content });
        }
        if (hasTemplate(entry.cleanContent)) renderedCount += 1;
      } catch (error) {
        replaceEntryContent(working, entry, "");
        diagnostics.push({
          messageIndex: -1,
          message: errorMessage(error),
          phase: "render",
          sourceId: entry.id,
          sourceLabel: `${entry.worldbookName}: ${entry.title}`,
        });
      }
    }
  } else {
    for (const entry of allEntries) {
      if (hasTemplate(entry.content)) replaceEntryContent(working, entry, "");
    }
  }

  const rendered: PreparedPromptMessage[] = [];
  for (const [messageIndex, message] of working.entries()) {
    if (!hasTemplate(message.content)) {
      rendered.push({
        ...message,
        content: unwrapEscapedTemplates(message.content),
      });
      continue;
    }
    if (!input.enabled) {
      rendered.push({
        ...message,
        content: stripExecutableTemplate(message.content),
      });
      continue;
    }
    try {
      const content = await renderContent(
        message.content,
        message,
        messageIndex,
      );
      rendered.push({ ...message, content });
      renderedCount += 1;
    } catch (error) {
      diagnostics.push({
        messageIndex,
        message: errorMessage(error),
        phase: "render",
      });
      rendered.push({
        ...message,
        content: "",
      });
    }
  }
  return {
    messages: rendered.filter((message) => message.content.trim().length > 0),
    diagnostics,
    renderedCount,
    sourceTemplateCount,
  };
}

export function renderPromptTemplateDisplayMessages(
  messages: readonly PreparedPromptMessage[],
  input: {
    enabled: boolean;
    context: TavernHelperContext | null;
    directives?: readonly PromptTemplateDirective[];
    random?: () => number;
    formatDisplayContent: (content: string) => string;
    formatDisplayInline: (content: string) => string;
  },
): Promise<PromptTemplateResult> {
  return renderPromptTemplateMessages(messages, { ...input, phase: "display" });
}
