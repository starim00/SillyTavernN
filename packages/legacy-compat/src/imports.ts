import path from "node:path";

import type {
  LegacyImportBinding,
  LegacyModuleSurface,
  LegacyStaticImport,
} from "./types.js";

const IMPORT_PATTERN =
  /(?:^|[;\n])\s*import\s*(?:(?<clause>[\s\S]*?)\s*from\s*)?["'](?<specifier>[^"']+)["']\s*;?/g;

function parseNamedBindings(source: string): LegacyImportBinding[] {
  const trimmed = source.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith("*")) {
    const match = /^\*\s+as\s+([A-Za-z_$][\w$]*)$/.exec(trimmed);
    return match
      ? [{ imported: "*", local: match[1] as string, kind: "namespace" }]
      : [];
  }

  const bindings: LegacyImportBinding[] = [];
  let remainder = trimmed;

  if (!remainder.startsWith("{")) {
    const comma = remainder.indexOf(",");
    const defaultName = (
      comma >= 0 ? remainder.slice(0, comma) : remainder
    ).trim();
    if (/^[A-Za-z_$][\w$]*$/.test(defaultName)) {
      bindings.push({
        imported: "default",
        local: defaultName,
        kind: "default",
      });
    }
    remainder = comma >= 0 ? remainder.slice(comma + 1).trim() : "";
  }

  const named = /\{([\s\S]*)\}/.exec(remainder);
  if (!named) {
    return bindings;
  }

  for (const rawPart of (named[1] ?? "").split(",")) {
    const part = rawPart.trim();
    if (!part) {
      continue;
    }
    const [imported, local = imported] = part.split(/\s+as\s+/);
    if (
      imported &&
      local &&
      /^[A-Za-z_$][\w$]*$/.test(imported) &&
      /^[A-Za-z_$][\w$]*$/.test(local)
    ) {
      bindings.push({ imported, local, kind: "named" });
    }
  }

  return bindings;
}

export function scanLegacyStaticImports(source: string): LegacyStaticImport[] {
  const imports: LegacyStaticImport[] = [];
  for (const match of source.matchAll(IMPORT_PATTERN)) {
    const specifier = match.groups?.specifier;
    if (!specifier) {
      continue;
    }
    imports.push({
      specifier,
      bindings: parseNamedBindings(match.groups?.clause ?? ""),
    });
  }
  return imports;
}

export function resolveLegacyImportPath(
  entryUrlPath: string,
  specifier: string,
): string {
  if (specifier.startsWith("/")) {
    return path.posix.normalize(specifier);
  }
  if (!specifier.startsWith(".")) {
    return specifier;
  }
  return path.posix.normalize(
    path.posix.join(path.posix.dirname(entryUrlPath), specifier),
  );
}

export function buildLegacyModuleSurfaces(
  entryUrlPath: string,
  imports: readonly LegacyStaticImport[],
): LegacyModuleSurface[] {
  const grouped = new Map<string, Set<string>>();
  for (const item of imports) {
    const modulePath = resolveLegacyImportPath(entryUrlPath, item.specifier);
    const exports = grouped.get(modulePath) ?? new Set<string>();
    for (const binding of item.bindings) {
      // A namespace import does not name an ESM export. Pinned plugins receive
      // their explicitly reviewed namespace surface from baseline contracts.
      if (binding.imported !== "*") {
        exports.add(binding.imported);
      }
    }
    grouped.set(modulePath, exports);
  }

  return [...grouped.entries()]
    .map(([modulePath, exports]) => ({
      path: modulePath,
      exports: [...exports].sort(),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}
