import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

/** Deviation D6: no npm workspaces on FAT32, so local packages resolve by alias. */
const alias = {
  "@adcode/ads": resolve(import.meta.dirname, "../../packages/ads/src/index.ts"),
  "@adcode/memory": resolve(import.meta.dirname, "../../packages/memory/src/index.ts"),
  "@adcode/settings": resolve(import.meta.dirname, "../../packages/settings/src/index.ts"),
  "@adcode/ai": resolve(import.meta.dirname, "../../packages/ai/src/index.ts"),
  "@adcode/diagnostics": resolve(import.meta.dirname, "../../packages/diagnostics/src/index.ts"),
  "@adcode/lsp": resolve(import.meta.dirname, "../../packages/lsp/src/index.ts"),
  // The renderer wants the conflict parser without dragging in the exec adapter, which
  // reaches for node:child_process and has no business in a sandboxed window. This entry
  // sits above the bare `@adcode/git` alias because the resolver takes the first key that
  // matches, and a prefix match on the shorter key would rewrite the path to nonsense.
  "@adcode/git/conflicts": resolve(import.meta.dirname, "../../packages/git/src/conflicts.ts"),
  "@adcode/git": resolve(import.meta.dirname, "../../packages/git/src/index.ts"),
  // Same reasoning as the git alias above: the renderer wants the fuzzy matcher without
  // the workspace walker, which imports node:fs and cannot run in a sandboxed window.
  "@adcode/search/fuzzy": resolve(import.meta.dirname, "../../packages/search/src/fuzzy.ts"),
  "@adcode/search": resolve(import.meta.dirname, "../../packages/search/src/index.ts"),
  "@adcode/collab": resolve(import.meta.dirname, "../../packages/collab/src/index.ts"),
  "@adcode/structure": resolve(import.meta.dirname, "../../packages/structure/src/index.ts"),
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: {
      rollupOptions: {
        input: { index: resolve(import.meta.dirname, "src/main/index.ts") },
        // node-pty loads a `.node` binary by building a path at runtime. Bundled, that
        // path resolves relative to `out/main` and the native module is not found - the
        // build succeeds and the terminal fails on first use, which is exactly the class
        // of bug `npm run smoke` exists to catch. It stays external and is resolved from
        // node_modules like any other dependency.
        external: ["node-pty"],
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(import.meta.dirname, "src/preload/index.ts") },
        // A sandboxed preload is not an ES module - Electron loads it in a restricted
        // CommonJS scope, and an `import` statement there fails with "Cannot use import
        // statement outside a module", leaving the contextBridge unexposed. The `.cjs`
        // extension is required because this package is `"type": "module"`.
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
    root: resolve(import.meta.dirname, "src/renderer"),
    resolve: { alias },
    build: {
      rollupOptions: {
        input: { index: resolve(import.meta.dirname, "src/renderer/index.html") },
        output: {
          // Monaco is large and splits into language chunks. Keeping them as separate
          // files rather than one bundle is what keeps cold-start-to-editable inside
          // the §7 budget: only the languages actually opened get parsed.
          manualChunks: {
            monaco: ["monaco-editor"],
          },
        },
      },
      chunkSizeWarningLimit: 4000,
    },
    worker: {
      format: "es",
    },
  },
});
