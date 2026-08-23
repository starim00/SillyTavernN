export type PromptTemplateDecorator = {
  name: string;
  argument: string;
};

export type PromptTemplateSourceEntry = {
  title: string;
  enabled: boolean;
  decorators: PromptTemplateDecorator[];
};

export type PromptTemplateMessage = {
  role: "system" | "assistant" | "user" | "tool";
  content: string;
};

type PromptInjectionRole = Exclude<PromptTemplateMessage["role"], "tool">;

export type PromptInjectionInstruction = {
  type: "pos" | "target" | "regex";
  role: PromptInjectionRole;
  content: string;
  order: number;
  sequence: number;
  position?: number;
  target?: string;
  targetIndex?: number;
  placement: "before" | "after";
  regex?: string;
};

const KNOWN_DECORATORS = new Set([
  "activate",
  "dont_activate",
  "message_formatting",
  "generate_before",
  "generate_after",
  "render_before",
  "render_after",
  "dont_preload",
  "initial_variables",
  "always_enabled",
  "only_preload",
  "preload",
  "iframe",
  "preprocessing",
  "if",
  "private",
]);

export function parsePromptTemplateDecorators(content: string): {
  cleanContent: string;
  decorators: PromptTemplateDecorator[];
} {
  if (!content.startsWith("@@")) {
    return { cleanContent: content, decorators: [] };
  }

  const decorators: PromptTemplateDecorator[] = [];
  let cursor = 0;
  let fallback = false;
  while (cursor < content.length && content.startsWith("@@", cursor)) {
    let lineEnd = content.indexOf("\n", cursor);
    if (lineEnd < 0) lineEnd = content.length;
    let line = content.slice(cursor, lineEnd);
    if (line.endsWith("\r")) line = line.slice(0, -1);

    const escaped = line.startsWith("@@@");
    if (escaped && !fallback) break;
    const candidate = escaped ? line.slice(1) : line;
    const space = candidate.indexOf(" ");
    const rawName = space < 0 ? candidate.slice(2) : candidate.slice(2, space);
    if (KNOWN_DECORATORS.has(rawName)) {
      decorators.push({
        name: rawName,
        argument: space < 0 ? "" : candidate.slice(space + 1).trim(),
      });
      fallback = false;
    } else {
      fallback = true;
    }

    cursor = lineEnd === content.length ? content.length : lineEnd + 1;
  }
  return { cleanContent: content.slice(cursor), decorators };
}

export function hasPromptTemplateDecorator(
  entry: Pick<PromptTemplateSourceEntry, "decorators">,
  name: string,
): boolean {
  return entry.decorators.some((decorator) => decorator.name === name);
}

export function promptTemplateDecoratorArgument(
  entry: Pick<PromptTemplateSourceEntry, "decorators">,
  name: string,
): string | undefined {
  return entry.decorators.find((decorator) => decorator.name === name)
    ?.argument;
}

export function isInitialVariablesEntry(
  entry: PromptTemplateSourceEntry,
): boolean {
  return (
    /^\[InitialVariables\]$/iu.test(entry.title) ||
    hasPromptTemplateDecorator(entry, "initial_variables")
  );
}

export function promptTemplateGenerationPosition(
  entry: PromptTemplateSourceEntry,
): { index?: number; position: "BEFORE" | "AFTER" } | undefined {
  const title = /^\[GENERATE(?::(\d+))?:(BEFORE|AFTER)\]$/iu.exec(entry.title);
  if (title) {
    return {
      ...(title[1] === undefined ? {} : { index: Number(title[1]) }),
      position: title[2]!.toUpperCase() as "BEFORE" | "AFTER",
    };
  }
  const before = promptTemplateDecoratorArgument(entry, "generate_before");
  if (before !== undefined) {
    return {
      ...(before === "" || Number.isNaN(Number(before))
        ? {}
        : { index: Number(before) }),
      position: "BEFORE",
    };
  }
  const after = promptTemplateDecoratorArgument(entry, "generate_after");
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

export function promptTemplateRenderPosition(
  entry: PromptTemplateSourceEntry,
): "BEFORE" | "AFTER" | undefined {
  const title = /^\[RENDER:(BEFORE|AFTER)\]$/iu.exec(entry.title);
  if (title) return title[1]!.toUpperCase() as "BEFORE" | "AFTER";
  if (hasPromptTemplateDecorator(entry, "render_before")) return "BEFORE";
  if (hasPromptTemplateDecorator(entry, "render_after")) return "AFTER";
  return undefined;
}

export function isStandalonePromptTemplateEntry(
  entry: PromptTemplateSourceEntry,
): boolean {
  return (
    isInitialVariablesEntry(entry) ||
    promptTemplateGenerationPosition(entry) !== undefined ||
    /^\[GENERATE:REGEX:/iu.test(entry.title) ||
    promptTemplateRenderPosition(entry) !== undefined ||
    /^@INJECT\b/iu.test(entry.title) ||
    hasPromptTemplateDecorator(entry, "render_before") ||
    hasPromptTemplateDecorator(entry, "render_after") ||
    hasPromptTemplateDecorator(entry, "only_preload")
  );
}

export function isPromptTemplateEntryEnabled(
  entry: PromptTemplateSourceEntry,
): boolean {
  if (hasPromptTemplateDecorator(entry, "always_enabled")) return true;
  if (
    hasPromptTemplateDecorator(entry, "activate") &&
    !hasPromptTemplateDecorator(entry, "dont_activate")
  ) {
    return true;
  }
  return isStandalonePromptTemplateEntry(entry)
    ? !entry.enabled
    : entry.enabled;
}

export function promptTemplateEntryTriggered(
  probability: number | undefined,
  random: () => number,
): boolean {
  if (probability === undefined || probability >= 100) return true;
  if (probability <= 0) return false;
  return random() * 100 < probability;
}

function injectionParameters(title: string): Record<string, string> {
  return Object.fromEntries(
    [...title.matchAll(/(\w+)=("[^"]*"|'[^']*'|[^,\]]+)/gu)].map((match) => [
      match[1]!.toLowerCase(),
      match[2]!.trim().replace(/^(['"])([\s\S]*)\1$/u, "$2"),
    ]),
  );
}

export function parsePromptInjection(
  title: string,
  content: string,
  order: number,
  sequence: number,
): PromptInjectionInstruction | null {
  if (!/^@INJECT\b/iu.test(title)) return null;
  const parameters = injectionParameters(title);
  const role =
    parameters.role === "user" || parameters.role === "assistant"
      ? parameters.role
      : "system";
  const placement = parameters.at === "after" ? "after" : "before";

  if (parameters.pos !== undefined) {
    const position = Number(parameters.pos);
    return Number.isInteger(position)
      ? { type: "pos", role, content, order, sequence, position, placement }
      : null;
  }
  if (parameters.target !== undefined) {
    const targetIndex = Number(parameters.index ?? "1");
    return Number.isInteger(targetIndex) && targetIndex !== 0
      ? {
          type: "target",
          role,
          content,
          order,
          sequence,
          target: parameters.target,
          targetIndex,
          placement,
        }
      : null;
  }
  if (parameters.regex !== undefined && parameters.regex.length > 0) {
    return {
      type: "regex",
      role,
      content,
      order,
      sequence,
      regex: parameters.regex,
      placement,
    };
  }
  return null;
}

type ResolvedInjection = {
  instruction: PromptInjectionInstruction;
  index: number;
};

function resolvePositionalInjections(
  messages: readonly PromptTemplateMessage[],
  instructions: readonly PromptInjectionInstruction[],
): ResolvedInjection[] {
  return instructions.flatMap((instruction) => {
    if (instruction.type === "pos") {
      const requested = instruction.position ?? 0;
      const index =
        requested < 0
          ? Math.max(0, messages.length + requested)
          : requested === 0
            ? 0
            : Math.min(messages.length, requested - 1);
      return [{ instruction, index }];
    }
    if (instruction.type !== "target") return [];
    const candidates = messages.flatMap((message, index) =>
      message.role === instruction.target ? [{ index }] : [],
    );
    const targetIndex = instruction.targetIndex ?? 1;
    const selected =
      targetIndex < 0
        ? candidates.at(targetIndex)
        : candidates[targetIndex - 1];
    if (!selected) return [];
    return [
      {
        instruction,
        index: selected.index + (instruction.placement === "after" ? 1 : 0),
      },
    ];
  });
}

function sortForReverseInsertion(
  left: ResolvedInjection,
  right: ResolvedInjection,
): number {
  if (left.index !== right.index) return right.index - left.index;
  if (left.instruction.order !== right.instruction.order) {
    return right.instruction.order - left.instruction.order;
  }
  const priority = { pos: 0, target: 1, regex: 2 } as const;
  const priorityDifference =
    priority[right.instruction.type] - priority[left.instruction.type];
  return (
    priorityDifference || right.instruction.sequence - left.instruction.sequence
  );
}

function insertResolved(
  messages: PromptTemplateMessage[],
  resolved: readonly ResolvedInjection[],
): void {
  for (const { instruction, index } of [...resolved].sort(
    sortForReverseInsertion,
  )) {
    messages.splice(index, 0, {
      role: instruction.role,
      content: instruction.content,
    });
  }
}

export async function applyPromptInjections(
  messages: readonly PromptTemplateMessage[],
  instructions: readonly PromptInjectionInstruction[],
  findIndex: (messages: readonly string[], pattern: string) => Promise<number>,
): Promise<PromptTemplateMessage[]> {
  const result = messages.map((message) => ({ ...message }));
  insertResolved(result, resolvePositionalInjections(result, instructions));

  const regexResolved: ResolvedInjection[] = [];
  for (const instruction of instructions) {
    if (instruction.type !== "regex" || instruction.regex === undefined) {
      continue;
    }
    const match = await findIndex(
      result.map((message) => message.content),
      instruction.regex,
    );
    if (match < 0) continue;
    regexResolved.push({
      instruction,
      index: match + (instruction.placement === "after" ? 1 : 0),
    });
  }
  insertResolved(result, regexResolved);
  return result;
}
