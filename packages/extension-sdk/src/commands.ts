export interface SlashCommandHost {
  stop(signal: AbortSignal): void | Promise<void>;
  send(text: string, signal: AbortSignal): unknown;
  continue(signal: AbortSignal): unknown;
  regenerate(signal: AbortSignal): unknown;
  swipe(index: number | undefined, signal: AbortSignal): unknown;
  setVariable(name: string, value: string, signal: AbortSignal): unknown;
  getVariable(name: string, signal: AbortSignal): unknown;
}

export interface SlashCommandInvocation {
  readonly command: string;
  readonly raw: string;
  readonly positional: readonly string[];
  readonly named: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
  readonly host: SlashCommandHost;
}

export interface SlashCommandDefinition {
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly description: string;
  readonly owner: string;
  readonly execute: (invocation: SlashCommandInvocation) => unknown;
}

export interface SlashCommandExecution {
  readonly handled: boolean;
  readonly command?: string;
  readonly value?: unknown;
}

function commandName(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9._-]*$/.test(normalized)) {
    throw new Error(`Invalid slash command name: ${JSON.stringify(value)}.`);
  }
  return normalized;
}

function tokenize(source: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | undefined;
  let escaped = false;

  const flush = () => {
    if (current) {
      tokens.push(current);
      current = "";
    }
  };

  for (const character of source) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) {
        quote = undefined;
      } else {
        current += character;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (/\s/u.test(character)) {
      flush();
      continue;
    }
    current += character;
  }
  if (escaped) {
    current += "\\";
  }
  if (quote) {
    throw new Error("Unterminated quoted slash command argument.");
  }
  flush();
  return tokens;
}

function parseArguments(tokens: readonly string[]): {
  readonly positional: readonly string[];
  readonly named: Readonly<Record<string, string>>;
} {
  const positional: string[] = [];
  const named: Record<string, string> = Object.create(null) as Record<
    string,
    string
  >;
  for (const token of tokens) {
    const candidate = token.startsWith("--") ? token.slice(2) : token;
    const equals = candidate.indexOf("=");
    if (equals > 0) {
      const name = candidate.slice(0, equals);
      if (/^[a-zA-Z][\w.-]*$/.test(name)) {
        named[name] = candidate.slice(equals + 1);
        continue;
      }
    }
    positional.push(token);
  }
  return { positional, named };
}

function requiredArgument(
  invocation: SlashCommandInvocation,
  index: number,
  named: string,
): string {
  const value = invocation.named[named] ?? invocation.positional[index];
  if (!value) {
    throw new Error(`/${invocation.command} requires ${named}.`);
  }
  return value;
}

export class SlashCommandRegistry {
  readonly #definitions = new Map<string, SlashCommandDefinition>();
  readonly #aliases = new Map<string, string>();

  constructor(
    readonly host: SlashCommandHost,
    includeBuiltIns = true,
  ) {
    if (includeBuiltIns) {
      registerBuiltInSlashCommands(this);
    }
  }

  register(definition: SlashCommandDefinition): () => void {
    const name = commandName(definition.name);
    const aliases = (definition.aliases ?? []).map(commandName);
    for (const candidate of [name, ...aliases]) {
      if (this.#definitions.has(candidate) || this.#aliases.has(candidate)) {
        throw new Error(
          `Slash command name ${candidate} is already registered.`,
        );
      }
    }
    const normalized = Object.freeze({ ...definition, name, aliases });
    this.#definitions.set(name, normalized);
    for (const alias of aliases) {
      this.#aliases.set(alias, name);
    }
    return () => {
      if (this.#definitions.get(name) !== normalized) {
        return;
      }
      this.#definitions.delete(name);
      for (const alias of aliases) {
        this.#aliases.delete(alias);
      }
    };
  }

  unregisterOwner(owner: string): void {
    for (const definition of [...this.#definitions.values()]) {
      if (definition.owner !== owner) {
        continue;
      }
      this.#definitions.delete(definition.name);
      for (const alias of definition.aliases ?? []) {
        this.#aliases.delete(alias);
      }
    }
  }

  list(): readonly SlashCommandDefinition[] {
    return [...this.#definitions.values()].sort((left, right) =>
      left.name.localeCompare(right.name),
    );
  }

  complete(prefix: string): readonly string[] {
    const normalized = prefix.replace(/^\//u, "").toLowerCase();
    return this.list()
      .map((definition) => `/${definition.name}`)
      .filter((name) => name.slice(1).startsWith(normalized));
  }

  async execute(
    source: string,
    signal = new AbortController().signal,
  ): Promise<SlashCommandExecution> {
    const trimmed = source.trim();
    if (!trimmed.startsWith("/")) {
      return { handled: false };
    }
    if (signal.aborted) {
      throw signal.reason;
    }
    const tokens = tokenize(trimmed.slice(1));
    const requested = tokens.shift();
    if (!requested) {
      return { handled: false };
    }
    const requestedName = commandName(requested);
    const name = this.#aliases.get(requestedName) ?? requestedName;
    const definition = this.#definitions.get(name);
    if (!definition) {
      throw new Error(`Unknown slash command: /${requestedName}.`);
    }
    const parsed = parseArguments(tokens);
    const value = await definition.execute({
      command: name,
      raw: source,
      positional: parsed.positional,
      named: parsed.named,
      signal,
      host: this.host,
    });
    if (signal.aborted) {
      throw signal.reason;
    }
    return { handled: true, command: name, value };
  }
}

export function registerBuiltInSlashCommands(
  registry: SlashCommandRegistry,
): void {
  const register = (
    definition: Omit<SlashCommandDefinition, "owner">,
  ): void => {
    registry.register({ ...definition, owner: "core" });
  };

  register({
    name: "help",
    description: "List the available slash commands.",
    execute: () =>
      registry
        .list()
        .map((definition) => `/${definition.name} — ${definition.description}`)
        .join("\n"),
  });
  register({
    name: "stop",
    description: "Stop the active generation.",
    execute: ({ host, signal }) => host.stop(signal),
  });
  register({
    name: "send",
    description: "Send a user message.",
    execute: ({ host, signal, positional, named }) => {
      const text = named.text ?? positional.join(" ");
      if (!text) {
        throw new Error("/send requires message text.");
      }
      return host.send(text, signal);
    },
  });
  register({
    name: "continue",
    description: "Continue the latest assistant response.",
    execute: ({ host, signal }) => host.continue(signal),
  });
  register({
    name: "regenerate",
    aliases: ["regen"],
    description: "Regenerate the latest assistant response.",
    execute: ({ host, signal }) => host.regenerate(signal),
  });
  register({
    name: "swipe",
    description: "Select or advance an assistant swipe.",
    execute: ({ host, signal, positional, named }) => {
      const raw = named.index ?? positional[0];
      const index = raw === undefined ? undefined : Number(raw);
      if (index !== undefined && (!Number.isInteger(index) || index < 0)) {
        throw new Error("/swipe index must be a non-negative integer.");
      }
      return host.swipe(index, signal);
    },
  });
  register({
    name: "setvar",
    description: "Set a conversation variable.",
    execute: (invocation) => {
      const name = requiredArgument(invocation, 0, "name");
      const value =
        invocation.named.value ?? invocation.positional.slice(1).join(" ");
      if (!value) {
        throw new Error("/setvar requires value.");
      }
      return invocation.host.setVariable(name, value, invocation.signal);
    },
  });
  register({
    name: "getvar",
    description: "Read a conversation variable.",
    execute: (invocation) =>
      invocation.host.getVariable(
        requiredArgument(invocation, 0, "name"),
        invocation.signal,
      ),
  });
}
