export type LegacyTrustLevel = "disabled" | "trusted";

export interface LegacyPluginLock {
  readonly id: string;
  readonly displayName: string;
  readonly repository: string;
  readonly commit: string;
  readonly manifestVersion: string;
  readonly installDirectory: string;
  readonly manifestPath: string;
  readonly manifestSha256: string;
  readonly entryPath: string;
  readonly entrySha256: string;
  readonly stylesheetPaths: readonly string[];
  readonly requiredAssets: readonly LegacyPluginAssetContract[];
  readonly assetPatterns: readonly string[];
  readonly moduleSurfaces: readonly LegacyModuleSurface[];
  readonly license: {
    readonly identifier: string;
    readonly distribution: "user-installed";
    readonly notice: string;
  };
}

export interface LegacyPluginAssetContract {
  readonly path: string;
  readonly sha256: string;
  readonly kind:
    | "entry"
    | "manifest"
    | "style"
    | "worker"
    | "module"
    | "template"
    | "localization";
}

export interface LegacyImportBinding {
  readonly imported: string;
  readonly local: string;
  readonly kind: "default" | "named" | "namespace";
}

export interface LegacyStaticImport {
  readonly specifier: string;
  readonly bindings: readonly LegacyImportBinding[];
}

export interface LegacyModuleSurface {
  readonly path: string;
  readonly exports: readonly string[];
}

export const LEGACY_CAPABILITIES = [
  "chat.read",
  "chat.write",
  "character.read",
  "character.write",
  "preset.read",
  "preset.write",
  "worldbook.read",
  "worldbook.write",
  "generation.invoke",
  "prompt.inject",
  "settings.read",
  "settings.write",
  "extension.manage",
  "events.emit",
  "ui.slot",
  "clipboard.write",
  "legacy-dom.write",
  "audio.play",
] as const;

export type LegacyCapability =
  (typeof LEGACY_CAPABILITIES)[number] | `network.egress:${string}`;

export interface LegacyCapabilityGrant {
  readonly pluginId: string;
  readonly actor: LegacyActor;
  readonly capability: LegacyCapability;
  readonly granted: boolean;
  readonly grantedAt?: string;
}

export type LegacyActor = "legacy-plugin" | "embedded-script";
