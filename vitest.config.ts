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
  "@adcode/ai/agents": resolve(import.meta.dirname, "packages/ai/src/agents.ts"),
  "@adcode/ai": resolve(import.meta.dirname, "packages/ai/src/index.ts"),
  "@adcode/diagnostics": resolve(import.meta.dirname, "packages/diagnostics/src/index.ts"),
  "@adcode/lsp": resolve(import.meta.dirname, "packages/lsp/src/index.ts"),
  // Ahead of the bare alias: the resolver takes the first matching key, and a prefix
  // match on `@adcode/git` would rewrite this specifier to a path that does not exist.
  "@adcode/git/conflicts": resolve(import.meta.dirname, "packages/git/src/conflicts.ts"),
  "@adcode/git": resolve(import.meta.dirname, "packages/git/src/index.ts"),
  "@adcode/search/fuzzy": resolve(import.meta.dirname, "packages/search/src/fuzzy.ts"),
  "@adcode/search": resolve(import.meta.dirname, "packages/search/src/index.ts"),
  "@adcode/collab": resolve(import.meta.dirname, "packages/collab/src/index.ts"),
  "@adcode/release/downloadAssets": resolve(import.meta.dirname, "packages/release/src/downloadAssets.ts"),
  "@adcode/release": resolve(import.meta.dirname, "packages/release/src/index.ts"),
  "@adcode/structure": resolve(import.meta.dirname, "packages/structure/src/index.ts"),
  "@adcode/spell": resolve(import.meta.dirname, "packages/spell/src/index.ts"),
  "@adcode/help": resolve(import.meta.dirname, "packages/help/src/index.ts"),
  "@adcode/format": resolve(import.meta.dirname, "packages/format/src/index.ts"),
  "@adcode/highlight": resolve(import.meta.dirname, "packages/highlight/src/index.ts"),
  "@adcode/debug": resolve(import.meta.dirname, "packages/debug/src/index.ts"),
  // The website's own alias, last and with its slash: `@/lib/api` is apps/web/src/lib/api.
  // The trailing slash is what keeps it from also matching `@adcode/...` above.
  "@/": `${resolve(import.meta.dirname, "apps/web/src")}/`,
};

export default defineConfig({
  resolve: { alias },
  test: {
    include: [
      "packages/**/test/**/*.test.ts",
      "mock-server/test/**/*.test.ts",
      "services/**/test/**/*.test.ts",
      "apps/**/test/**/*.test.ts",
      // The website's component tests. JSX rather than `createElement`, because a chart
      // test that asserts on rendered markup is unreadable when the fixture it renders is
      // three levels of nested function calls.
      "apps/**/test/**/*.test.tsx",
    ],
    // The emulator suite is the only one needing external tooling; `npm run test:emulator`
    // runs it. Keeping it out of the default run is what lets CI stay credential-free.
    exclude: ["**/node_modules/**", "**/__fixtures__/**", "**/test/emulator/**"],
    environment: "node",
    // The pure modules exist to be testable in milliseconds (§2). If the suite ever
    // needs longer than this per test, something has acquired I/O it should not have.
    testTimeout: 10_000,
    reporters: ["default"],
  },
});
