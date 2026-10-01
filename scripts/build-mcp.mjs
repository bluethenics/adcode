/**
 * Bundle the project-memory MCP server into the one file an installed ADCode hands out.
 *
 * Settings > "Connect an external agent" shows a command: `claude mcp add adcode -- node
 * "<script>" "<workspace>"`. In a source checkout that script is the TypeScript in
 * `packages/memory/bin`, which Node 24 runs directly; an installed build names this
 * bundle, as copied from `resources/mcp/` to `~/.adcode/mcp/` by `main/mcpInstall.ts` so
 * the path outlives the portable, AppImage and Store resources folder. An installer has no
 * `packages/` and no `node_modules`, so the packaged path has to be a file that stands
 * entirely on its own - and until this script existed nothing produced it. The command
 * was offered, copied, accepted by `claude mcp add`, and then failed the first time the
 * agent tried to start a server from a path that was never shipped.
 *
 * Who runs the result matters. It is the *user's* `node`, spawned by their agent, not
 * ADCode: `electronFuses.runAsNode` is off in electron-builder.yml, so the packaged
 * executable cannot be asked to act as a Node runtime. That is why this is a plain Node
 * program under `extraResources` rather than something inside the asar, which only
 * Electron can read.
 *
 * Vite rather than a second bundler: it is already the desktop build's dependency, and
 * its Node target ("ssr") with every dependency inlined is exactly a single-file CLI.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { isBuiltin } from "node:module";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Where the bundle comes from and where it lands, relative to the repository root.
 *
 * `outDir` is under `apps/desktop/out` so it inherits every ignore rule build output
 * already has. `resourceDir` and `file` are the other half of a pair: `extraResources` in
 * electron-builder.yml copies `outDir` to `resourceDir`, and `main/memory.ts` joins the
 * same two names onto `process.resourcesPath`. `apps/desktop/test/mcpBundle.test.ts`
 * holds all three together.
 */
export const MCP_BUNDLE = Object.freeze({
  entry: "packages/memory/bin/adcode-mcp.ts",
  outDir: "apps/desktop/out/mcp",
  resourceDir: "mcp",
  file: "adcode-mcp.js",
});

/**
 * Build the bundle into `outDir` and return the path of the script.
 *
 * Throws if anything other than a Node built-in is left as an import. Such a bundle runs
 * perfectly from a checkout, where `node_modules` is a few directories up, and fails with
 * "Cannot find package" on every installed copy - the same bug this script exists to fix,
 * one step later and much harder to see.
 */
export async function buildMcpBundle(outDir = join(REPO, MCP_BUNDLE.outDir)) {
  const { build } = await import("vite");

  const result = await build({
    configFile: false,
    root: REPO,
    logLevel: "warn",
    publicDir: false,
    ssr: { noExternal: true },
    build: {
      ssr: join(REPO, MCP_BUNDLE.entry),
      outDir,
      emptyOutDir: true,
      // `node:sqlite` is what sets the floor: it needs no flag from Node 22.13.
      target: "node22",
      minify: false,
      rollupOptions: {
        output: { format: "es", entryFileNames: MCP_BUNDLE.file, inlineDynamicImports: true },
      },
    },
  });

  const chunks = (Array.isArray(result) ? result : [result]).flatMap((built) => built.output);
  const unbundled = chunks
    .flatMap((chunk) => (chunk.type === "chunk" ? [...chunk.imports, ...chunk.dynamicImports] : []))
    .filter((specifier) => !isBuiltin(specifier));

  if (chunks.length !== 1 || unbundled.length > 0) {
    throw new Error(
      `The MCP bundle is not self-contained: ${chunks.length} output file(s), ` +
        `unbundled imports [${unbundled.join(", ")}]. Nothing sits beside it in an ` +
        `installed app, so every import has to be inlined or a Node built-in.`,
    );
  }

  // The bundle is an ES module in a `.js` file. Saying so beside it means Node never has
  // to guess from the syntax, and a `package.json` further up the install path cannot
  // change the answer.
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "package.json"), `${JSON.stringify({ type: "module" })}\n`, "utf8");

  return join(outDir, MCP_BUNDLE.file);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const built = await buildMcpBundle();
    process.stdout.write(`MCP server bundled to ${built}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
