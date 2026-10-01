import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildMcpBundle, MCP_BUNDLE } from "../../../scripts/build-mcp.mjs";
import { mcpScriptPath, SHIPPED_MCP, stableMcpDirectory } from "../src/main/mcpInstall.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const require = createRequire(import.meta.url);

const read = (...parts: string[]): string => readFileSync(join(ROOT, ...parts), "utf8");

interface FileSet {
  readonly from?: string;
  readonly to?: string;
  readonly filter?: readonly string[];
}

const builder = require("js-yaml").load(read("electron-builder.yml")) as {
  files: ReadonlyArray<string | FileSet>;
  extraResources?: ReadonlyArray<string | FileSet>;
  electronFuses?: { runAsNode?: boolean };
};

/*
 * The path an installed ADCode tells an agent to run.
 *
 * `main/memory.ts` builds a command around `<resources>/mcp/adcode-mcp.js` and shows it in
 * Settings with a Copy button. For a long time nothing put a file there: no bundle step,
 * no `extraResources`, and no test that would have noticed, because the command is only
 * ever executed later, by somebody else's process. `claude mcp add` records whatever it is
 * given, so the first sign of trouble was an agent failing to start a server.
 *
 * Four places have to agree for that path to exist, and these tests hold them together:
 * the path the app asks for, the file the bundle script writes, the `extraResources`
 * entry that carries one to the other, and the two packaging scripts that must run the
 * bundle step before electron-builder looks for its output.
 */
describe("the MCP server an installed build points agents at", () => {
  it("asks for the path packaging fills", () => {
    expect([SHIPPED_MCP.resourceDir, SHIPPED_MCP.file]).toEqual([MCP_BUNDLE.resourceDir, MCP_BUNDLE.file]);
    // Agreeing names are no use unless memory.ts looks for them under resources.
    expect(read("apps", "desktop", "src", "main", "memory.ts")).toMatch(
      /join\(process\.resourcesPath,\s*SHIPPED_MCP\.resourceDir\)/,
    );
  });

  it("ships the bundle script's output to that path as an extra resource", () => {
    // `from` is relative to the project directory - the repository root, where
    // electron-builder.yml lives - not to `directories.app` as `files` entries are.
    const shipped = (builder.extraResources ?? []).filter(
      (entry): entry is FileSet => typeof entry !== "string" && entry.from === MCP_BUNDLE.outDir,
    );

    expect(shipped).toHaveLength(1);
    expect(shipped[0]?.to).toBe(MCP_BUNDLE.resourceDir);
    // The `package.json` beside it is what makes Node load a `.js` file as an ES module.
    expect([...(shipped[0]?.filter ?? [])].sort()).toEqual([MCP_BUNDLE.file, "package.json"].sort());
    expect(existsSync(join(ROOT, MCP_BUNDLE.entry))).toBe(true);
  });

  /*
   * The bundle is written under `apps/desktop/out`, and `files` takes `out/**`. Without
   * an exclusion the installer would carry it twice - once where an agent's `node` can
   * read it, and once inside the asar, where only Electron can.
   */
  it("keeps the bundle out of the asar, where no outside process could read it", () => {
    const { FileMatcher } = require("app-builder-lib/out/fileMatcher.js");
    const app = join(ROOT, "apps", "desktop");
    const packed = new FileMatcher(
      app,
      join(ROOT, "release", "win-unpacked", "resources", "app"),
      (value: string) => value,
      builder.files.filter((entry) => typeof entry === "string"),
    ).createFilter();
    const file = { isDirectory: () => false };
    const bundleDir = posix.relative("apps/desktop", MCP_BUNDLE.outDir);

    expect(packed(join(app, bundleDir, MCP_BUNDLE.file), file)).toBe(false);
    expect(packed(join(app, bundleDir, "package.json"), file)).toBe(false);
    expect(packed(join(app, "out", "main", "index.js"), file)).toBe(true);
  });

  it("is bundled by both packaging scripts before electron-builder runs", () => {
    for (const script of ["package.mjs", "package-store.mjs"]) {
      const source = read("scripts", script);
      const bundled = source.indexOf('join(REPO, "scripts", "build-mcp.mjs")');
      const packaged = source.indexOf('binOf("electron-builder", "cli.js")');

      expect(bundled, `${script} never builds the MCP bundle`).toBeGreaterThan(-1);
      expect(packaged, `${script} no longer invokes electron-builder the way this test reads it`).toBeGreaterThan(-1);
      expect(bundled, `${script} packages before the bundle exists`).toBeLessThan(packaged);
    }
  });

  /*
   * Why the bundle has to run under plain `node`.
   *
   * With `runAsNode` fused off the packaged executable cannot be used as a Node runtime,
   * so the command cannot fall back to `ADCode.exe adcode-mcp.js`. If that fuse is ever
   * turned back on this test should be revisited rather than deleted: the command in
   * `memory.ts` could then stop depending on the user having Node installed.
   */
  it("is run by the user's node, because the packaged app cannot act as one", () => {
    expect(builder.electronFuses?.runAsNode).toBe(false);
    expect(read("apps", "desktop", "src", "main", "memory.ts")).toContain('-- node "${script}"');
  });
});

/*
 * The config above can all agree and the feature still be dead: a bundle that left
 * `@modelcontextprotocol/sdk` as an import loads from a checkout, where `node_modules` is
 * a few directories up, and fails on every installed copy. So this builds the real bundle
 * into the system temp directory - outside the repository, with nothing resolvable beside
 * it, exactly as it sits under `resources/` - and performs the handshake an agent does.
 */
describe("the bundle itself, with nothing beside it", () => {
  let scratch: string | null = null;
  let built: Promise<string> | null = null;

  /* Built once, into a resources folder of its own, for every test below. */
  const builtBundle = (): Promise<string> =>
    (built ??= (async () => {
      scratch = await mkdtemp(join(tmpdir(), "adcode-mcp-bundle-"));
      return buildMcpBundle(join(scratch, "resources", MCP_BUNDLE.resourceDir));
    })());

  afterAll(async () => {
    if (scratch !== null) await rm(scratch, { recursive: true, force: true });
  }, 30_000);

  it("answers an MCP handshake and lists the memory tools", async () => {
    const script = await builtBundle();
    const resources = dirname(script);
    expect(script).toBe(join(resources, MCP_BUNDLE.file));
    expect(JSON.parse(await readFile(join(resources, "package.json"), "utf8"))).toEqual({ type: "module" });

    expect(await listTools(script, join(dirname(dirname(resources)), "workspace"))).toEqual(MEMORY_TOOLS);
  }, 90_000);

  /*
   * What the command names on a packaged build is not that file but a copy of it, made by
   * `main/mcpInstall.ts`, because on portable, AppImage and the Store the resources folder
   * is gone once the app closes or updates. So: copy the server out the way the app does,
   * delete the resources it came from, and the agent's next start still has to work.
   */
  it("still answers from the copy once the resources it came from are gone", async () => {
    const shipped = dirname(await builtBundle());
    const root = await mkdtemp(join(scratch!, "installed-"));
    const resources = join(root, "resources", MCP_BUNDLE.resourceDir);
    await cp(shipped, resources, { recursive: true });

    const script = await mcpScriptPath(resources, stableMcpDirectory(join(root, "home")));
    await rm(join(root, "resources"), { recursive: true, force: true });

    expect(script.startsWith(join(root, "home"))).toBe(true);
    expect(await listTools(script, join(root, "workspace"))).toEqual(MEMORY_TOOLS);
  }, 90_000);
});

const MEMORY_TOOLS = [
  "memory_list",
  "memory_read",
  "memory_search",
  "memory_write",
  "project_context",
  "session_append",
];

/** Start `script` the way an agent does, perform the MCP handshake, and list its tools. */
async function listTools(script: string, workspace: string): Promise<string[]> {
  const child = spawn(process.execPath, [script, workspace], { stdio: ["pipe", "pipe", "pipe"] });
  let errors = "";
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => (errors += chunk));

  try {
    return await new Promise<string[]>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no tools/list reply. stderr: ${errors}`)), 30_000);
      let out = "";

      child.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`the bundle exited with ${code} before answering. stderr: ${errors}`));
      });

      child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
        out += chunk;
        for (const line of out.split("\n")) {
          if (!line.trim().startsWith("{")) continue;
          try {
            const message = JSON.parse(line) as { id?: number; result?: { tools?: Array<{ name: string }> } };
            if (message.id === 2) {
              clearTimeout(timer);
              resolve((message.result?.tools ?? []).map((tool) => tool.name).sort());
            }
          } catch {
            // Partial frame; wait for more.
          }
        }
      });

      const send = (message: Record<string, unknown>): void => {
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
      };
      send({
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "bundle-test", version: "0" } },
      });
      send({ method: "notifications/initialized" });
      send({ id: 2, method: "tools/list", params: {} });
    });
  } finally {
    // Wait for the exit: on Windows the open SQLite handle makes the cleanup fail otherwise.
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      child.removeAllListeners("exit");
      child.once("exit", () => resolve());
      child.kill();
    });
  }
}
