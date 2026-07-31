import _ from "lodash";

import type {
  PreparedPromptMessage,
  PromptTemplateDirective,
} from "../api/workspaceApi";
import type { TavernHelperContext } from "./tavernHelperTypes";

export type PromptTemplateDiagnostic = {
  messageIndex: number;
  message: string;
};

export type PromptTemplateResult = {
  messages: PreparedPromptMessage[];
  diagnostics: PromptTemplateDiagnostic[];
  renderedCount: number;
};

const templatePattern = /<%[\s\S]*?%>/gu;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function latestMessageVariables(
  context: TavernHelperContext | null,
): Record<string, unknown> {
  if (!context) return {};
  const values = Object.values(context.variables.messages);
  return structuredClone(values.at(-1) ?? context.variables.chat);
}

function stripExecutableTemplate(content: string): string {
  return content.replace(templatePattern, "");
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
  const setvar = (path: string, value: unknown) => {
    _.set(variables, path, value);
    const replaceVariables = (
      window as unknown as {
        replaceVariables?: (
          variables: Record<string, unknown>,
          option: { type: "message" },
        ) => void;
      }
    ).replaceVariables;
    replaceVariables?.(variables, { type: "message" });
    return "";
  };
  const getvar = (path: string, fallback = "") =>
    _.get(variables, path, fallback);
  const renderContent = async (
    content: string,
    message: PreparedPromptMessage,
    messageIndex: number,
    additional: Record<string, unknown> = {},
  ) => {
    const { default: ejs } = await import("ejs");
    return ejs.render(
      content,
      {
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
        _,
        ...additional,
      },
      {
        async: true,
      },
    );
  };
  const working = messages.map((message) => ({ ...message }));
  const directives = [...(input.directives ?? [])].sort(
    (left, right) => left.order - right.order,
  );
  for (const directive of directives) {
    for (const message of working) {
      if (message.content.includes(directive.content)) {
        message.content = message.content.replace(directive.content, "");
      }
    }
  }
  if (input.enabled) {
    for (const directive of directives) {
      if (/^\[InitialVariables\]$/iu.test(directive.title)) {
        try {
          const initial = JSON.parse(directive.content) as unknown;
          if (
            typeof initial === "object" &&
            initial !== null &&
            !Array.isArray(initial)
          ) {
            _.merge(variables, initial);
            const replaceVariables = (
              window as unknown as {
                replaceVariables?: (
                  variables: Record<string, unknown>,
                  option: { type: "message"; message_id: number },
                ) => void;
              }
            ).replaceVariables;
            replaceVariables?.(variables, { type: "message", message_id: 0 });
          }
        } catch (error) {
          diagnostics.push({
            messageIndex: -1,
            message: `[InitialVariables] ${errorMessage(error)}`,
          });
        }
        continue;
      }
      const position = /^\[GENERATE(?::(\d+))?:(BEFORE|AFTER)\]$/iu.exec(
        directive.title,
      );
      if (position) {
        const index =
          position[1] === undefined
            ? position[2]?.toUpperCase() === "BEFORE"
              ? 0
              : working.length - 1
            : Math.min(working.length - 1, Math.max(0, Number(position[1])));
        const target = working[index];
        if (target) {
          target.content =
            position[2]?.toUpperCase() === "BEFORE"
              ? `${directive.content}\n${target.content}`
              : `${target.content}\n${directive.content}`;
        }
        continue;
      }
      const regex = /^\[GENERATE:REGEX:(.+)\]$/iu.exec(directive.title);
      if (regex) {
        try {
          const pattern = new RegExp(regex[1]!, "iu");
          const index = working.findIndex((message) =>
            pattern.test(message.content),
          );
          const target = working[index];
          if (target) {
            const content = await renderContent(
              directive.content,
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
            message: `${directive.title} ${errorMessage(error)}`,
          });
        }
        continue;
      }
      if (/^@INJECT\b/iu.test(directive.title)) {
        const parameters = Object.fromEntries(
          [
            ...directive.title.matchAll(/(\w+)=("[^"]*"|'[^']*'|[^,\]]+)/gu),
          ].map((match) => [
            match[1]!.toLowerCase(),
            match[2]!.trim().replace(/^(['"])([\s\S]*)\1$/u, "$2"),
          ]),
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
            const pattern = new RegExp(parameters.regex, "iu");
            const found = working.findIndex((message) =>
              pattern.test(message.content),
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
        working.splice(index, 0, { role, content: directive.content });
      }
    }
  }
  const rendered: PreparedPromptMessage[] = [];
  for (const [messageIndex, message] of working.entries()) {
    if (!templatePattern.test(message.content)) {
      templatePattern.lastIndex = 0;
      rendered.push({ ...message });
      continue;
    }
    templatePattern.lastIndex = 0;
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
      });
      rendered.push({
        ...message,
        content: stripExecutableTemplate(message.content),
      });
    }
  }
  return { messages: rendered, diagnostics, renderedCount };
}
