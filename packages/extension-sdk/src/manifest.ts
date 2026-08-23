import { z } from "zod";

export const nativeCapabilitySchema = z.enum([
  "chat.read",
  "chat.write",
  "card.read",
  "worldbook.read",
  "prompt.hook",
  "artifact.read",
  "artifact.write",
  "ui.panel",
  "slash.register",
  "settings.read",
  "settings.write",
]);

export type NativeCapability = z.infer<typeof nativeCapabilitySchema>;

const safeRelativePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(2_048)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.includes("\\") &&
      !value.includes("\0") &&
      !value.split("/").some((segment) => segment === ".."),
    "Extension asset paths must be safe relative URL paths.",
  );

const dependencyIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/);

const contributionSchema = z
  .object({
    promptHooks: z.array(z.string().trim().min(1).max(256)).default([]),
    slashCommands: z.array(z.string().trim().min(1).max(256)).default([]),
    panels: z.array(z.string().trim().min(1).max(256)).default([]),
  })
  .strict()
  .default({ promptHooks: [], slashCommands: [], panels: [] });

export const extensionManifestSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(256)
      .regex(/^[a-z0-9][a-z0-9._-]+$/),
    name: z.string().trim().min(1).max(512),
    version: z.string().trim().min(1).max(128),
    apiVersion: z.literal("1"),
    entry: safeRelativePathSchema,
    capabilities: z.array(nativeCapabilitySchema).default([]),
    contributes: contributionSchema,
    loadingOrder: z.number().int().min(-10_000).max(10_000).default(100),
    requires: z.array(dependencyIdSchema).default([]),
    optional: z.array(dependencyIdSchema).default([]),
    minimumHostApi: z.string().trim().min(1).max(128).optional(),
    styles: z.array(safeRelativePathSchema).default([]),
    i18n: z
      .record(z.string().trim().min(1), safeRelativePathSchema)
      .default({}),
    activateExport: z.string().trim().min(1).max(256).optional(),
    integrity: z
      .record(safeRelativePathSchema, z.string().trim().min(1).max(256))
      .default({}),
  })
  .strict();

export type ExtensionManifest = z.infer<typeof extensionManifestSchema>;

export interface NormalizedExtensionManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly loadingOrder: number;
  readonly scripts: readonly string[];
  readonly styles: readonly string[];
  readonly i18n: Readonly<Record<string, string>>;
  readonly requires: readonly string[];
  readonly optional: readonly string[];
  readonly capabilities: readonly NativeCapability[];
  readonly activateExport?: string;
  readonly minimumHostVersion?: string;
}

export function parseExtensionManifest(
  input: unknown,
): NormalizedExtensionManifest {
  const native = extensionManifestSchema.parse(input);
  return {
    id: native.id,
    name: native.name,
    version: native.version,
    loadingOrder: native.loadingOrder,
    scripts: [native.entry],
    styles: native.styles,
    i18n: native.i18n,
    requires: native.requires,
    optional: native.optional,
    capabilities: native.capabilities,
    ...(native.activateExport === undefined
      ? {}
      : { activateExport: native.activateExport }),
    ...(native.minimumHostApi === undefined
      ? {}
      : { minimumHostVersion: native.minimumHostApi }),
  };
}

export class ExtensionDependencyError extends Error {
  readonly code: "EXTENSION_DEPENDENCY_CYCLE" | "EXTENSION_DEPENDENCY_MISSING";
  readonly extensionIds: readonly string[];

  constructor(
    code: ExtensionDependencyError["code"],
    message: string,
    extensionIds: readonly string[],
  ) {
    super(message);
    this.name = "ExtensionDependencyError";
    this.code = code;
    this.extensionIds = extensionIds;
  }
}

function compareManifests(
  left: NormalizedExtensionManifest,
  right: NormalizedExtensionManifest,
): number {
  return (
    left.loadingOrder - right.loadingOrder || left.id.localeCompare(right.id)
  );
}

export function resolveExtensionLoadOrder(
  manifests: readonly NormalizedExtensionManifest[],
): readonly NormalizedExtensionManifest[] {
  const byId = new Map<string, NormalizedExtensionManifest>();
  for (const manifest of manifests) {
    if (byId.has(manifest.id)) {
      throw new Error(`Duplicate extension id: ${manifest.id}`);
    }
    byId.set(manifest.id, manifest);
  }

  const dependents = new Map<string, Set<string>>();
  const dependencyCounts = new Map<string, number>();
  for (const manifest of manifests) {
    const dependencies = new Set(manifest.requires);
    for (const optional of manifest.optional) {
      if (byId.has(optional)) {
        dependencies.add(optional);
      }
    }
    const missing = [...dependencies].filter((id) => !byId.has(id));
    if (missing.length > 0) {
      throw new ExtensionDependencyError(
        "EXTENSION_DEPENDENCY_MISSING",
        `Extension ${manifest.id} requires missing dependencies: ${missing.join(", ")}.`,
        [manifest.id, ...missing],
      );
    }
    dependencyCounts.set(manifest.id, dependencies.size);
    for (const dependency of dependencies) {
      const current = dependents.get(dependency) ?? new Set<string>();
      current.add(manifest.id);
      dependents.set(dependency, current);
    }
  }

  const ready = manifests
    .filter((manifest) => dependencyCounts.get(manifest.id) === 0)
    .sort(compareManifests);
  const ordered: NormalizedExtensionManifest[] = [];

  while (ready.length > 0) {
    const current = ready.shift();
    if (!current) {
      break;
    }
    ordered.push(current);
    for (const dependentId of dependents.get(current.id) ?? []) {
      const remaining = (dependencyCounts.get(dependentId) ?? 0) - 1;
      dependencyCounts.set(dependentId, remaining);
      if (remaining === 0) {
        const dependent = byId.get(dependentId);
        if (dependent) {
          ready.push(dependent);
          ready.sort(compareManifests);
        }
      }
    }
  }

  if (ordered.length !== manifests.length) {
    const cycle = manifests
      .filter((manifest) => !ordered.some((item) => item.id === manifest.id))
      .map((manifest) => manifest.id)
      .sort();
    throw new ExtensionDependencyError(
      "EXTENSION_DEPENDENCY_CYCLE",
      `Extension dependency cycle: ${cycle.join(", ")}.`,
      cycle,
    );
  }
  return ordered;
}
