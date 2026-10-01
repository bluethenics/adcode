import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  installMcpBundle,
  mcpScriptPath,
  refreshMcpBundle,
  SHIPPED_MCP,
  stableMcpDirectory,
} from "../src/main/mcpInstall.ts";

/*
 * The path an agent is told to run has to outlive the app that told it.
 *
 * `claude mcp add` stores the command Settings hands out, and the agent runs it later with
 * the user's own `node`. On three of the targets this repo builds, `process.resourcesPath`
 * is gone by then: the portable build deletes its `%TEMP%` folder on exit, an AppImage is
 * unmounted from its `/tmp/.mount_*` directory, and a Store update moves the package to a
 * folder named for the new version. So a packaged build copies the server out to a folder
 * of its own and hands out that copy. These tests work on real directories, standing in for
 * `resources/mcp` and the user's home.
 */

const SCRIPT = "export const build = 'first';\n";
const MARKER = `${JSON.stringify({ type: "module" })}\n`;

let scratch: string;
let shipped: string;
let home: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "adcode-mcp-install-"));
  shipped = join(scratch, "resources", SHIPPED_MCP.resourceDir);
  home = join(scratch, "home");
  await mkdir(shipped, { recursive: true });
  await mkdir(home, { recursive: true });
  await writeFile(join(shipped, SHIPPED_MCP.file), SCRIPT);
  await writeFile(join(shipped, "package.json"), MARKER);
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

const stable = (): string => stableMcpDirectory(home);
const read = (...parts: string[]): Promise<string> => readFile(join(...parts), "utf8");

describe("where the copy lives", () => {
  /*
   * Not `userData`. That is under AppData, and inside the Store's MSIX container Windows
   * sends newly created AppData files to a private per-package folder, so the user's `node`
   * would look for the script at the path in the command and not find it. The home folder
   * is not virtualised, and `~/.adcode` is already where ADCode keeps per-user files.
   */
  it("is ADCode's folder in the user's home", () => {
    expect(stableMcpDirectory(home)).toBe(join(home, ".adcode", "mcp"));
  });
});

describe("installMcpBundle", () => {
  it("copies the server and the package.json that makes it an ES module", async () => {
    const installed = await installMcpBundle(shipped, stable());

    expect(installed.script).toBe(join(stable(), SHIPPED_MCP.file));
    expect(await read(installed.script)).toBe(SCRIPT);
    expect(await read(stable(), "package.json")).toBe(MARKER);
    // The marker first: the script must never sit there without `"type": "module"` beside
    // it, or a `package.json` further up the user's home could change how Node loads it.
    expect(installed.copied).toEqual(["package.json", SHIPPED_MCP.file]);
  });

  /* The whole point: portable exits, an AppImage unmounts, a Store update moves the folder. */
  it("leaves a script that is still there after the resources it came from are gone", async () => {
    const installed = await installMcpBundle(shipped, stable());
    await rm(join(scratch, "resources"), { recursive: true, force: true });

    expect(await read(installed.script)).toBe(SCRIPT);
  });

  /*
   * Startup and every visit to Settings run this. A copy that already matches is not
   * rewritten, so an agent reading it at that moment is never racing a write it did not need.
   */
  it("leaves a copy that already matches alone", async () => {
    await installMcpBundle(shipped, stable());
    const old = new Date("2020-01-01T00:00:00Z");
    for (const name of [SHIPPED_MCP.file, "package.json"]) await utimes(join(stable(), name), old, old);

    const again = await installMcpBundle(shipped, stable());

    expect(again.copied).toEqual([]);
    expect((await stat(join(stable(), SHIPPED_MCP.file))).mtime.getTime()).toBe(old.getTime());
    expect((await stat(join(stable(), "package.json"))).mtime.getTime()).toBe(old.getTime());
  });

  it("replaces a copy left by an earlier build, and only the file that changed", async () => {
    await installMcpBundle(shipped, stable());
    await writeFile(join(shipped, SHIPPED_MCP.file), "export const build = 'second';\n");

    const updated = await installMcpBundle(shipped, stable());

    expect(updated.copied).toEqual([SHIPPED_MCP.file]);
    expect(await read(updated.script)).toBe("export const build = 'second';\n");
    // Written beside the target and renamed over it, so nothing half-written is left behind.
    expect((await readdir(stable())).sort()).toEqual([SHIPPED_MCP.file, "package.json"].sort());
  });

  it("creates nothing when the shipped files cannot be read", async () => {
    await rm(join(shipped, "package.json"));

    await expect(installMcpBundle(shipped, stable())).rejects.toThrow();
    expect(existsSync(stable())).toBe(false);
  });
});

describe("mcpScriptPath, the path the command names", () => {
  it("is the stable copy", async () => {
    expect(await mcpScriptPath(shipped, stable())).toBe(join(stable(), SHIPPED_MCP.file));
    expect(await read(stable(), SHIPPED_MCP.file)).toBe(SCRIPT);
  });

  /*
   * If the home folder cannot be written, the shipped file is still right for as long as
   * this build stays put - which on NSIS and .deb is for good. A path to nothing is not.
   */
  it("falls back to the shipped file when no copy can be made, and says why", async () => {
    await writeFile(join(home, ".adcode"), "a file where the folder should be");
    const errors: unknown[] = [];

    const path = await mcpScriptPath(shipped, stable(), (error) => errors.push(error));

    expect(path).toBe(join(shipped, SHIPPED_MCP.file));
    expect(errors).toHaveLength(1);
  });

  /* An older server that runs beats a path that will not exist once this build closes. */
  it("keeps naming an earlier copy when refreshing it fails", async () => {
    await installMcpBundle(shipped, stable());
    await rm(join(shipped, "package.json"));
    const errors: unknown[] = [];

    const path = await mcpScriptPath(shipped, stable(), (error) => errors.push(error));

    expect(path).toBe(join(stable(), SHIPPED_MCP.file));
    expect(errors).toHaveLength(1);
  });
});

describe("refreshMcpBundle, at startup", () => {
  /* Somebody who never asked for the command gets no `~/.adcode/mcp`. */
  it("does not create a copy nobody asked for", async () => {
    expect(await refreshMcpBundle(shipped, stable())).toBeNull();
    expect(existsSync(stable())).toBe(false);
  });

  /* An update reaches the agents connected under the last version before Settings is opened. */
  it("brings an existing copy up to date with this build", async () => {
    await installMcpBundle(shipped, stable());
    await writeFile(join(shipped, SHIPPED_MCP.file), "export const build = 'second';\n");

    const refreshed = await refreshMcpBundle(shipped, stable());

    expect(refreshed?.copied).toEqual([SHIPPED_MCP.file]);
    expect(await read(stable(), SHIPPED_MCP.file)).toBe("export const build = 'second';\n");
  });
});
