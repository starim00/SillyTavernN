import { fileURLToPath } from "node:url";

import { configDefaults, defineConfig } from "vitest/config";

const workspaceSource = (path: string) =>
  fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@stn/contracts": workspaceSource("./packages/contracts/src/index.ts"),
      "@stn/core": workspaceSource("./packages/core/src/index.ts"),
      "@stn/extension-sdk": workspaceSource(
        "./packages/extension-sdk/src/index.ts",
      ),
      "@stn/legacy-compat": workspaceSource(
        "./packages/legacy-compat/src/index.ts",
      ),
      "@stn/providers": workspaceSource("./packages/providers/src/index.ts"),
      "@stn/storage": workspaceSource("./packages/storage/src/index.ts"),
    },
  },
  test: {
    include: [
      "apps/*/src/**/*.test.{ts,tsx}",
      "packages/*/src/**/*.test.{ts,tsx}",
    ],
    exclude: [...configDefaults.exclude, "**/dist/**", "apps/web/tests/**"],
  },
});
