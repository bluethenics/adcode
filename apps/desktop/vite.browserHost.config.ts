/**
 * Builds the web version's browser host: the desktop's main process as one Web Worker script.
 *
 * Like the retired cloud sandbox's build (vite.host.config.ts) with two differences: Node's built-in
 * modules resolve to browser stand-ins in src/browserHost/shims, and the output runs in a
 * worker in the person's tab rather than on a server. It is a build of its own, not part of
 * the page's, because the page's build replaces `process.env` with `{}` at compile time and
 * the main process reads its environment at run time.
 *
 *   npx vite build -c apps/desktop/vite.browserHost.config.ts   ->   apps/desktop/out/browser-host/browser-host.js
 */
import { readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { resolve } from "node:path";
import { defineConfig, normalizePath, type Plugin } from "vite";
import { alias } from "./electron.vite.config.ts";

const DESKTOP = import.meta.dirname;
const SHIMS = normalizePath(resolve(DESKTOP, "src/browserHost/shims"));
/** Forward slashes, as Rollup ids every other module: a backslash id would load a second copy of the same file. */
const at = (...parts: string[]): string => normalizePath(resolve(...parts));
const version = (JSON.parse(readFileSync(resolve(DESKTOP, "package.json"), "utf8")) as { version: string }).version;

/** Node's built-ins, by the shim that stands in for each. Anything else Node-only is "unavailable". */
const BUILTINS: Record<string, string> = {
  fs: "fs.ts",
  "fs/promises": "fsPromises.ts",
  path: "path.ts",
  "path/posix": "path.ts",
  os: "os.ts",
  crypto: "crypto.ts",
  events: "events.ts",
  buffer: "buffer.ts",
  child_process: "childProcess.ts",
  http: "http.ts",
  https: "http.ts",
  util: "util.ts",
  stream: "stream.ts",
  async_hooks: "asyncHooks.ts",
  zlib: "zlib.ts",
  url: "url.ts",
  "timers/promises": "timersPromises.ts",
  readline: "readline.ts",
  module: "module.ts",
};
/** Node-only packages the main process imports; like a built-in with no shim, they load but do nothing. */
const UNAVAILABLE = new Set(["ws", "node-pty", "chokidar", ...builtinModules]);
const UNAVAILABLE_ID = "\0adcode-unavailable:";

/*
 * A module with no browser meaning answers every export name with one function: calling it, or
 * constructing it, says the web version has no computer. A class may still extend it, so a
 * dependency that subclasses (say) an HTTP/2 request loads fine and only fails if it is used.
 */
const UNAVAILABLE_SOURCE = `
const message = "This needs the ADCode desktop app: the web version has no computer of its own.";
function Unavailable() { throw new Error(message); }
export default new Proxy(Unavailable, { get: (target, key) => key === "__esModule" ? false : key === "prototype" ? Unavailable.prototype : Unavailable });
`;

function browserHostResolve(): Plugin {
  return {
    name: "adcode-browser-host-resolve",
    enforce: "pre",
    resolveId(source, importer) {
      const bare = source.startsWith("node:") ? source.slice(5) : source;
      if (Object.hasOwn(BUILTINS, bare)) return at(SHIMS, BUILTINS[bare]!);
      if (UNAVAILABLE.has(bare) || source.startsWith("node:")) return { id: UNAVAILABLE_ID + bare, syntheticNamedExports: true };
      if (source === "electron") return at(DESKTOP, "src/host/electronShim.ts");
      // Source control answers from GitHub: there is no git program in a browser (browserHost/git.ts).
      // The alias step has already turned `@adcode/git` into its file by now, so match that; the
      // stand-in itself imports the real file, which must stay the real file.
      const gitPackage = source === "@adcode/git" || normalizePath(source).endsWith("packages/git/src/index.ts");
      if (gitPackage && !normalizePath(importer ?? "").endsWith("/src/browserHost/git.ts")) return at(DESKTOP, "src/browserHost/git.ts");
      return null;
    },
    load(id) {
      return id.startsWith(UNAVAILABLE_ID) ? UNAVAILABLE_SOURCE : null;
    },
  };
}

export default defineConfig({
  plugins: [browserHostResolve()],
  resolve: {
    alias: Object.entries(alias).map(([find, replacement]) => ({ find, replacement })),
    // Packages' browser builds, not their Node ones.
    conditions: ["browser", "import", "module", "default"],
    mainFields: ["browser", "module", "main"],
  },
  define: {
    __ADCODE_GOOGLE_CLIENT_SECRET__: JSON.stringify(""),
    __ADCODE_VERSION__: JSON.stringify(version),
  },
  build: {
    outDir: resolve(DESKTOP, "out/browser-host"),
    emptyOutDir: true,
    target: "es2022",
    minify: true,
    sourcemap: true,
    // One file: a module worker loads it by URL.
    lib: { entry: resolve(DESKTOP, "src/browserHost/worker.ts"), formats: ["es"], fileName: () => "browser-host.js" },
    rollupOptions: { output: { inlineDynamicImports: true } },
    chunkSizeWarningLimit: 20_000,
  },
});
