import _ from "lodash";

import type {
  PreparedPromptMessage,
  PromptTemplateDirective,
} from "../api/workspaceApi";
import type { TavernHelperContext } from "./tavernHelperTypes";
import { browserRegexWorker } from "./browserRegexWorker";

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
};

const templatePattern = /<%[\s\S]*?%>/gu;
const decoratorPattern = /^@@([a-z_]+)(?:\s+(.+))?$/iu;

type PromptWorldbookEntry = {
  id: string;
  worldbookId: string;
  worldbookName: string;
  title: string;
  content: string;
  cleanContent: string;
  enabled: boolean;
  order: number;
  legacyUid: number | null;
  decorators: Array<{ name: string; argument: string }>;
};

type TemporaryRegex = {
  find: RegExp;
  replacement: string | ((...values: string[]) => string);
  generate: boolean;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

function stripExecutableTemplate(content: string): string {
  return content.replace(templatePattern, "");
}

function hasTemplate(content: string): boolean {
  templatePattern.lastIndex = 0;
  const result = templatePattern.test(content);
  templatePattern.lastIndex = 0;
  return result;
}

function parseDecorators(content: string): {
  cleanContent: string;
  decorators: PromptWorldbookEntry["decorators"];
} {
  const lines = content.split(/\r?\n/u);
  const decorators: PromptWorldbookEntry["decorators"] = [];
  let index = 0;
  while (index < lines.length) {
    const match = decoratorPattern.exec(lines[index]?.trim() ?? "");
    if (!match) break;
    decorators.push({
      name: match[1]!.toLowerCase(),
      argument: match[2]?.trim() ?? "",
    });
    index += 1;
  }
  return {
    cleanContent: lines.slice(index).join("\n"),
    decorators,
  };
}

function promptWorldbookEntries(
  context: TavernHelperContext | null,
): PromptWorldbookEntry[] {
  return (context?.worldbooks ?? []).flatMap((worldbook) =>
    worldbook.entries.map((entry) => {
      const parsed = parseDecorators(entry.content);
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
      };
    }),
  );
}

function hasDecorator(entry: PromptWorldbookEntry, name: string): boolean {
  return entry.decorators.some((decorator) => decorator.name === name);
}

function decoratorArgument(
  entry: PromptWorldbookEntry,
  name: string,
): string | undefined {
  return entry.decorators.find((decorator) => decorator.name === name)
    ?.argument;
}

function isInitialVariables(entry: PromptWorldbookEntry): boolean {
  return (
    /^\[InitialVariables\]$/iu.test(entry.title) ||
    hasDecorator(entry, "initial_variables")
  );
}

function generationPosition(
  entry: PromptWorldbookEntry,
): { index?: number; position: "BEFORE" | "AFTER" } | undefined {
  const title = /^\[GENERATE(?::(\d+))?:(BEFORE|AFTER)\]$/iu.exec(entry.title);
  if (title) {
    return {
      ...(title[1] === undefined ? {} : { index: Number(title[1]) }),
      position: title[2]!.toUpperCase() as "BEFORE" | "AFTER",
    };
  }
  const before = decoratorArgument(entry, "generate_before");
  if (before !== undefined) {
    return {
      ...(before === "" || Number.isNaN(Number(before))
        ? {}
        : { index: Number(before) }),
      position: "BEFORE",
    };
  }
  const after = decoratorArgument(entry, "generate_after");
  if (after !== undefined) {
    return {
      ...(after === "" || Number.isNaN(Number(after))
        ? {}
        : { index: Number(after) }),
      position: "AFTER",
    };
  }
  return undefined;
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
    entryReference?: string | number | RegExp,
  ) => {
    const entry = findWorldbookEntry(worldbookOrEntry, entryReference);
    if (entry) forceActivatedEntryIds.add(entry.id);
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
  ) => {
    const { default: ejs } = await import("ejs");
    const browserGlobals =
      typeof window === "undefined"
        ? {}
        : ((window as unknown as { TavernHelper?: Record<string, unknown> })
            .TavernHelper ?? {});
    return ejs.render(
      await applyTemporaryRegexes(content),
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
      },
    );
  };
  const working = messages.map((message) => ({ ...message }));

  const directiveEntries = [...(input.directives ?? [])].map((directive) => {
    const parsed = parseDecorators(directive.content);
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
    } satisfies PromptWorldbookEntry;
  });
  const entriesById = new Map(
    [...worldbookEntries, ...directiveEntries].map((entry) => [
      entry.id,
      entry,
    ]),
  );
  const directiveIds = new Set(directiveEntries.map((entry) => entry.id));
  const allEntries = [...entriesById.values()].sort(
    (left, right) =>
      left.order - right.order ||
      left.worldbookName.localeCompare(right.worldbookName) ||
      left.id.localeCompare(right.id),
  );
  const sourceTemplateCount = allEntries.filter((entry) =>
    hasTemplate(entry.cleanContent),
  ).length;

  if (input.enabled) {
    for (const entry of allEntries) {
      if (isInitialVariables(entry)) {
        replaceEntryContent(working, entry, "");
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
    }

    for (const entry of allEntries) {
      if (
        !entry.enabled &&
        !directiveIds.has(entry.id) &&
        !hasDecorator(entry, "always_enabled")
      )
        continue;
      const condition = decoratorArgument(entry, "if");
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
            continue;
          }
        } catch (error) {
          replaceEntryContent(working, entry, "");
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
      if (hasDecorator(entry, "dont_activate")) {
        replaceEntryContent(working, entry, "");
        continue;
      }
      if (hasDecorator(entry, "preprocessing")) {
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

    for (const entry of allEntries) {
      const position = generationPosition(entry);
      const regex = /^\[GENERATE:REGEX:(.+)\]$/iu.exec(entry.title);
      const inject = /^@INJECT\b/iu.test(entry.title);
      if (!position && !regex && !inject) continue;
      replaceEntryContent(working, entry, "");
      if (
        !entry.enabled &&
        !directiveIds.has(entry.id) &&
        !hasDecorator(entry, "always_enabled")
      )
        continue;
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
        const parameters = Object.fromEntries(
          [...entry.title.matchAll(/(\w+)=("[^"]*"|'[^']*'|[^,\]]+)/gu)].map(
            (match) => [
              match[1]!.toLowerCase(),
              match[2]!.trim().replace(/^(['"])([\s\S]*)\1$/u, "$2"),
            ],
          ),
        );
        const role =
          parameters.role === "user" || parameters.role === "assistant"
            ? parameters.role
            : "system";
        let index = 0;
        if (parameters.pos !== undefined) {
          const requested = Number(parameters.pos);
          index =
            requested < 0
              ? Math.max(0, working.length + requested + 1)
              : Math.max(0, Math.min(working.length, requested - 1));
        } else if (parameters.regex !== undefined) {
          try {
            const found = await browserRegexWorker.findIndex(
              working.map((message) => message.content),
              parameters.regex,
            );
            index =
              found < 0
                ? working.length
                : found + (parameters.at === "after" ? 1 : 0);
          } catch {
            index = working.length;
          }
        } else if (parameters.target !== undefined) {
          const candidates = working
            .map((message, candidateIndex) => ({ message, candidateIndex }))
            .filter(({ message }) => message.role === parameters.target);
          const requested = Number(parameters.index ?? "1");
          const selected =
            requested < 0
              ? candidates.at(requested)
              : candidates[Math.max(0, requested - 1)];
          index =
            selected === undefined
              ? working.length
              : selected.candidateIndex + (parameters.at === "after" ? 1 : 0);
        }
        try {
          const content = await renderContent(
            entry.cleanContent,
            { role, content: entry.cleanContent },
            index,
            { world_info: entry },
          );
          working.splice(index, 0, { role, content });
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

    for (const entry of allEntries) {
      if (
        !entry.enabled ||
        isInitialVariables(entry) ||
        generationPosition(entry) ||
        /^\[GENERATE:REGEX:/iu.test(entry.title) ||
        /^@INJECT\b/iu.test(entry.title) ||
        hasDecorator(entry, "preprocessing")
      ) {
        continue;
      }
      const present = working.some(
        (message) =>
          message.content.includes(entry.content) ||
          message.content.includes(entry.cleanContent),
      );
      if (!present && !forceActivatedEntryIds.has(entry.id)) continue;
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
      rendered.push({ ...message });
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
