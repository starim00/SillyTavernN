import type { ProviderRequest } from "./types.js";

const providerFunctionNamePattern = /^[a-zA-Z0-9_-]+$/u;

export interface ToolNameAliases {
  toInternal(name: string): string;
  toProvider(name: string): string;
}

/**
 * Responses and Chat Completions have the same provider-safe function-name
 * restriction in practice. Keep the mapping in one place so a continuation
 * can always resolve a provider name back to the internal dotted name.
 */
export function createToolNameAliases(
  tools: ProviderRequest["tools"],
): ToolNameAliases {
  const internalToProvider = new Map<string, string>();
  const providerToInternal = new Map<string, string>();

  for (const tool of tools ?? []) {
    const encodedName = providerFunctionNamePattern.test(tool.name)
      ? tool.name
      : `stn_${Array.from(new TextEncoder().encode(tool.name), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join("")}`;
    let providerName = encodedName;
    let suffix = 2;
    while (
      providerToInternal.has(providerName) &&
      providerToInternal.get(providerName) !== tool.name
    ) {
      providerName = `${encodedName}_${String(suffix)}`;
      suffix += 1;
    }
    internalToProvider.set(tool.name, providerName);
    providerToInternal.set(providerName, tool.name);
  }

  return {
    toInternal: (name) => providerToInternal.get(name) ?? name,
    toProvider: (name) => internalToProvider.get(name) ?? name,
  };
}
