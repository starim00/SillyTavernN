import type { LegacyPluginLock } from "./types.js";
import {
  JS_SLASH_RUNNER_MODULE_SURFACES,
  ST_PROMPT_TEMPLATE_MODULE_SURFACES,
} from "./baseline.js";
import { ST_PROMPT_TEMPLATE_RUNTIME_ASSETS } from "./prompt-template-assets.js";

export const LEGACY_PLUGIN_LOCKS = {
  "js-slash-runner": {
    id: "js-slash-runner",
    displayName: "酒馆助手 / JS-Slash-Runner",
    repository: "https://gitlab.com/novi028/JS-Slash-Runner",
    commit: "49efcca50809be8d48bfb1776bacf952ef16991b",
    manifestVersion: "4.8.19",
    installDirectory: "JS-Slash-Runner",
    manifestPath: "manifest.json",
    manifestSha256:
      "6fd670e3e695aba3e84fac4d85295f1f0694058311a31fc1c0a50acdde82ab33",
    entryPath: "dist/index.js",
    entrySha256:
      "14a920868d1081dd9cd5bb0a17c3cc54e7fbf4c3eed8d74a4e4712645c8fafab",
    stylesheetPaths: ["dist/index.css"],
    requiredAssets: [
      {
        path: "manifest.json",
        sha256:
          "6fd670e3e695aba3e84fac4d85295f1f0694058311a31fc1c0a50acdde82ab33",
        kind: "manifest",
      },
      {
        path: "dist/index.js",
        sha256:
          "14a920868d1081dd9cd5bb0a17c3cc54e7fbf4c3eed8d74a4e4712645c8fafab",
        kind: "entry",
      },
      {
        path: "dist/index.css",
        sha256:
          "05764d23141867a1db59afd33905d45f37650c30f7eed3f2c16dc2e36c5a32f4",
        kind: "style",
      },
      {
        path: "lib/jsoneditor.js",
        sha256:
          "983629948b23a48a87150d4c0338d619da5158beda31805c5dc68e24c6f64b8f",
        kind: "module",
      },
      {
        path: "lib/tailwindcss.min.js",
        sha256:
          "3573a896869009f2ab0ea9870ba0279cb8bda0dd45d710a83950367d19ee7ea9",
        kind: "module",
      },
      {
        path: "i18n/en.json",
        sha256:
          "a5538e59bbd460c3337554eb7a063179e8f32ed5788a3baba00163bc5c5a8e22",
        kind: "localization",
      },
    ],
    assetPatterns: ["manifest.json", "dist/**", "i18n/**", "lib/**"],
    moduleSurfaces: JS_SLASH_RUNNER_MODULE_SURFACES,
    license: {
      identifier: "AFPL",
      distribution: "user-installed",
      notice:
        "Do not redistribute the plugin bundle from the SillyTavern N repository.",
    },
  },
  "st-prompt-template": {
    id: "st-prompt-template",
    displayName: "Prompt Template / 提示词模板",
    repository: "https://github.com/zonde306/ST-Prompt-Template",
    commit: "c80a572839f99a2aaf3d91cf9b7ebfc202c4ef0b",
    manifestVersion: "1.17.6.8",
    installDirectory: "ST-Prompt-Template",
    manifestPath: "manifest.json",
    manifestSha256:
      "f4336412f239021a2b975e8ee4a97c263a089fb3b95049ea7f95d0b79a8b00de",
    entryPath: "dist/index.js",
    entrySha256:
      "115b7aa1f300e08846eee4b670fb1132314974b4e50725c80ae550c0ca412d93",
    stylesheetPaths: [],
    requiredAssets: [
      {
        path: "manifest.json",
        sha256:
          "f4336412f239021a2b975e8ee4a97c263a089fb3b95049ea7f95d0b79a8b00de",
        kind: "manifest",
      },
      {
        path: "dist/index.js",
        sha256:
          "115b7aa1f300e08846eee4b670fb1132314974b4e50725c80ae550c0ca412d93",
        kind: "entry",
      },
      {
        path: "dist/editor.worker.js",
        sha256:
          "bca225a42a1aa169caf68e990a317e32c6ffe1fd8085f8601d962d5754cd21c5",
        kind: "worker",
      },
      {
        path: "dist/ejs.workers.js",
        sha256:
          "faab85d2f929ab9b0976a86fd29e4abfb82ab25fd7a778cde0e9e0928e1d64aa",
        kind: "worker",
      },
      {
        path: "libs/faker.mjs",
        sha256:
          "e89e9d69ec8e237f5527eb1a8e860894df1b5b217836c2c34fd48a5d7e145000",
        kind: "module",
      },
      {
        path: "settings.html",
        sha256:
          "d659bf1fd60c2a0a937f1438e9e898dd40c6a27ded074ae563e9e415ac8d8c36",
        kind: "template",
      },
      {
        path: "locales/zh-cn.json",
        sha256:
          "25ee75b85e9cd51df5ee5e0a0ec66de1d825bc09bb59b8c08511898024c64ab2",
        kind: "localization",
      },
      {
        path: "locales/zh-tw.json",
        sha256:
          "fabfc5ca6f9324679c4653b5d67f5eaa0613aa110ea9485613c2705dbe4c6eca",
        kind: "localization",
      },
      ...ST_PROMPT_TEMPLATE_RUNTIME_ASSETS,
    ],
    assetPatterns: [
      "manifest.json",
      "settings.html",
      "dist/**",
      "include/**",
      "libs/**",
      "locales/**",
    ],
    moduleSurfaces: ST_PROMPT_TEMPLATE_MODULE_SURFACES,
    license: {
      identifier: "AGPL-3.0",
      distribution: "user-installed",
      notice:
        "The core stores only a compatibility lock; users install the plugin separately.",
    },
  },
} as const satisfies Record<string, LegacyPluginLock>;

export type LegacyPluginId = keyof typeof LEGACY_PLUGIN_LOCKS;

export function getLegacyPluginLock(id: string): LegacyPluginLock | undefined {
  return LEGACY_PLUGIN_LOCKS[id as LegacyPluginId];
}

export function isLegacyPluginAssetAllowed(
  lock: LegacyPluginLock,
  assetPath: string,
): boolean {
  if (
    !assetPath ||
    assetPath.startsWith("/") ||
    assetPath.includes("\\") ||
    assetPath.includes("\0") ||
    assetPath
      .split("/")
      .some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    return false;
  }
  return lock.requiredAssets.some((asset) => asset.path === assetPath);
}
