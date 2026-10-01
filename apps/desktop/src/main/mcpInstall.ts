/**
 * Keep the MCP server an agent was told to run at a path that outlives the app.
 *
 * Settings hands out `claude mcp add adcode -- node "<script>" "<workspace>"`, the agent
 * records it, and runs it later - with the user's own `node`, after ADCode has closed or
 * updated. Packaging ships the script under `process.resourcesPath`, which is a stable
 * address on only some of the targets this repo builds:
 *
 * - NSIS (`%LOCALAPPDATA%\Programs\ADCode`) and .deb (`/opt/ADCode`): stable.
 * - portable: electron-builder's launcher unpacks into `%TEMP%\<unpackDirName>` on every
 *   launch and removes it on exit (`templates/nsis/portable.nsi`). Unset, `unpackDirName`
 *   is an id generated per build, so the folder also moves with every release.
 * - AppImage: the runtime mounts the image at a fresh `mkdtemp("/tmp/.mount_XXXXXX")` on
 *   every launch, and unmounts it when the app exits.
 * - Microsoft Store: `WindowsApps\<package full name>`, and the full name includes the
 *   version, so every Store update moves it.
 *
 * So a packaged build copies the two files to `~/.adcode/mcp/` and hands out that copy.
 * Not `userData`: it sits under AppData, and inside the Store's MSIX container Windows
 * writes newly created AppData files to a private per-package folder, where the user's
 * `node` would never find them at the path the command names. The home folder is not
 * virtualised, and `~/.adcode` is already ADCode's per-user folder (`assistantSkills.ts`).
 *
 * No Electron import, so the copying is tested against real directories.
 */
import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Where packaging puts the server, under `process.resourcesPath`.
 *
 * `apps/desktop/test/mcpBundle.test.ts` pins both names to what `scripts/build-mcp.mjs`
 * writes and `extraResources` ships.
 */
export const SHIPPED_MCP = Object.freeze({ resourceDir: "mcp", file: "adcode-mcp.js" });

/**
 * The marker first. The script must never sit in the folder without `"type": "module"`
 * beside it, or a `package.json` further up the user's home could change how Node loads it.
 */
const FILES = ["package.json", SHIPPED_MCP.file] as const;

export function stableMcpDirectory(home: string): string {
  return join(home, ".adcode", "mcp");
}

export interface McpInstall {
  /** The script to name in the command. */
  readonly script: string;
  /** The files written this time, in order. Empty when the copy already matched. */
  readonly copied: readonly string[];
}

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  );

/**
 * Copy the shipped server into `stable`, rewriting only the files whose bytes differ.
 *
 * Each file is written beside its target and renamed over it, so an agent that starts its
 * server mid-copy reads the old file or the new one, never part of each. Throws, having
 * created nothing, when the shipped files cannot be read.
 */
export async function installMcpBundle(shipped: string, stable: string): Promise<McpInstall> {
  const sources = await Promise.all(FILES.map((name) => readFile(join(shipped, name))));
  await mkdir(stable, { recursive: true });

  const copied: string[] = [];
  for (const [index, name] of FILES.entries()) {
    const source = sources[index]!;
    const target = join(stable, name);
    const current = await readFile(target).catch(() => null);
    if (current?.equals(source) === true) continue;

    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, source);
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
    copied.push(name);
  }

  return { script: join(stable, SHIPPED_MCP.file), copied };
}

/**
 * The script a packaged build names in the command: the stable copy, refreshed first.
 *
 * If no copy can be made, an earlier one still runs - an older server beats a path that
 * disappears when this build closes. With neither, the shipped file is right for as long
 * as this build stays where it is, which on NSIS and .deb is for good.
 */
export async function mcpScriptPath(
  shipped: string,
  stable: string,
  onError: (error: unknown) => void = () => undefined,
): Promise<string> {
  try {
    return (await installMcpBundle(shipped, stable)).script;
  } catch (error) {
    onError(error);
    const earlier = join(stable, SHIPPED_MCP.file);
    return (await exists(earlier)) ? earlier : join(shipped, SHIPPED_MCP.file);
  }
}

/**
 * Bring an existing copy up to date with this build, without creating one.
 *
 * Run at startup, so an update reaches the agents connected under the last version before
 * anyone opens Settings. Somebody who never asked for the command gets no folder at all.
 */
export async function refreshMcpBundle(shipped: string, stable: string): Promise<McpInstall | null> {
  if (!(await exists(join(stable, SHIPPED_MCP.file)))) return null;
  return installMcpBundle(shipped, stable);
}
