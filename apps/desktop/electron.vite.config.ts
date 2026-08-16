import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

/** Deviation D6: no npm workspaces on FAT32, so local packages resolve by alias. */
const alias = {
  "@adcode/ads": resolve(import.meta.dirname, "../../packages/ads/src/index.ts"),
  "@adcode/memory": resolve(import.meta.dirname, "../../packages/memory/src/index.ts"),
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: {
      rollupOptions: {
        input: { index: resolve(import.meta.dirname, "src/main/index.ts") },
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
