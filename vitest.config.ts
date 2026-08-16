import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Deviation D6: the repo is on a FAT32 volume, which has no symlinks, so npm workspaces
 * cannot link local packages. These aliases replace that mechanism, and must stay in step
 * with `tsconfig.json`'s `paths` and `apps/desktop/electron.vite.config.ts`.
 */
const alias = {
  "@adcode/ads": resolve(import.meta.dirname, "packages/ads/src/index.ts"),
  "@adcode/memory": resolve(import.meta.dirname, "packages/memory/src/index.ts"),
  "@adcode/settings": resolve(import.meta.dirname, "packages/settings/src/index.ts"),
  "@adcode/ai": resolve(import.meta.dirname, "packages/ai/src/index.ts"),
  // Ahead of the bare alias: the resolver takes the first matching key, and a prefix
  // match on `@adcode/git` would rewrite this specifier to a path that does not exist.
  "@adcode/git/conflicts": resolve(import.meta.dirname, "packages/git/src/conflicts.ts"),
  "@adcode/git": resolve(import.meta.dirname, "packages/git/src/index.ts"),
  "@adcode/search": resolve(import.meta.dirname, "packages/search/src/index.ts"),
};

export default defineConfig({
  resolve: { alias },
  test: {
    include: ["packages/**/test/**/*.test.ts", "mock-server/test/**/*.test.ts", "apps/**/test/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/__fixtures__/**"],
    environment: "node",
    // The pure modules exist to be testable in milliseconds (§2). If the suite ever
    // needs longer than this per test, something has acquired I/O it should not have.
    testTimeout: 10_000,
    reporters: ["default"],
  },
});
