import { z } from "zod";

const safeLegacyAssetPathSchema = z
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
    "Legacy extension asset paths must be safe relative URL paths.",
  );

const legacyDependencyIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u);

export const legacyExtensionManifestSchema = z
  .object({
    display_name: z.string().trim().min(1).max(512),
    loading_order: z.number().int().min(-10_000).max(10_000).default(100),
    requires: z.array(legacyDependencyIdSchema).default([]),
    optional: z.array(legacyDependencyIdSchema).default([]),
    dependencies: z.array(legacyDependencyIdSchema).default([]),
    js: safeLegacyAssetPathSchema,
    css: z.union([z.literal(""), safeLegacyAssetPathSchema]).default(""),
    author: z.string().trim().max(512).default(""),
    version: z.string().trim().min(1).max(128),
    homePage: z.string().url().max(2_048).optional(),
    minimum_client_version: z.string().trim().min(1).max(128).optional(),
    i18n: z
      .record(z.string().trim().min(1), safeLegacyAssetPathSchema)
      .default({}),
    hooks: z
      .object({
        activate: z.string().trim().min(1).max(256).optional(),
      })
      .strict()
      .optional(),
    auto_update: z.boolean().optional(),
  })
  .passthrough();

export type LegacyExtensionManifest = z.infer<
  typeof legacyExtensionManifestSchema
>;

export interface NormalizedLegacyExtensionManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly loadingOrder: number;
  readonly scripts: readonly string[];
  readonly styles: readonly string[];
  readonly i18n: Readonly<Record<string, string>>;
  readonly requires: readonly string[];
  readonly optional: readonly string[];
  readonly activateExport?: string;
  readonly minimumHostVersion?: string;
}

function manifestIdFromDirectory(directoryName: string): string {
  const value = directoryName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  if (!/^[a-z0-9][a-z0-9._-]+$/u.test(value)) {
    throw new Error(
      `Cannot derive a stable legacy extension id from ${JSON.stringify(directoryName)}.`,
    );
  }
  return value;
}

export function parseLegacyExtensionManifest(
  input: unknown,
  options: { readonly directoryName: string },
): NormalizedLegacyExtensionManifest {
  const legacy = legacyExtensionManifestSchema.parse(input);
  return {
    id: manifestIdFromDirectory(options.directoryName),
    name: legacy.display_name,
    version: legacy.version,
    loadingOrder: legacy.loading_order,
    scripts: [legacy.js],
    styles: legacy.css ? [legacy.css] : [],
    i18n: legacy.i18n,
    requires: Array.from(new Set([...legacy.requires, ...legacy.dependencies])),
    optional: Array.from(new Set(legacy.optional)),
    ...(legacy.hooks?.activate === undefined
      ? {}
      : { activateExport: legacy.hooks.activate }),
    ...(legacy.minimum_client_version === undefined
      ? {}
      : { minimumHostVersion: legacy.minimum_client_version }),
  };
}
