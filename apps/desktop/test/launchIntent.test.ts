import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { launchSessionFromArguments } from "../src/main/launchIntent.ts";

describe("adcode open launch intent", () => {
  it("opens an explicit folder through the normal workspace session", async () => {
    const root = await mkdtemp(join(tmpdir(), "adcode-open-folder-"));
    await expect(
      launchSessionFromArguments(["electron", "app", "--adcode-open", root], dirname(root)),
    ).resolves.toEqual({ root, openFiles: [], activeFile: null });
  });

  it("opens an explicit file with its containing folder as the workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "adcode-open-file-"));
    const nested = join(root, "src");
    const file = join(nested, "main.ts");
    await mkdir(nested);
    await writeFile(file, "export {};\n", "utf8");

    await expect(
      launchSessionFromArguments(
        ["electron", "app", "--adcode-open", join("src", "main.ts")],
        root,
      ),
    ).resolves.toEqual({ root: nested, openFiles: [file], activeFile: file });
  });

  it("leaves ordinary launches and missing targets to normal session restore", async () => {
    await expect(
      launchSessionFromArguments(["electron", "app"], process.cwd()),
    ).resolves.toBeNull();
    await expect(
      launchSessionFromArguments(
        ["electron", "app", "--adcode-open", "definitely-missing"],
        process.cwd(),
      ),
    ).resolves.toBeNull();
  });

  it("forwards a second-instance open intent to the live renderer", async () => {
    const main = await readFile(join(import.meta.dirname, "../src/main/index.ts"), "utf8");
    const renderer = await readFile(join(import.meta.dirname, "../src/renderer/main.ts"), "utf8");

    expect(main).toContain('app.on("second-instance"');
    expect(main).toContain("launchSessionFromArguments");
    expect(main).toContain("CHANNELS.sessionOpenIntent");
    expect(renderer).toContain("window.adcode.session.onOpenIntent");
    expect(renderer).toContain("sameWorkspacePath(workspaceRoot, state.root)");
  });

  it("rebuilds after dependency and TypeScript configuration changes", async () => {
    const start = await readFile(join(import.meta.dirname, "../../../scripts/start.mjs"), "utf8");

    expect(start).toContain('join(REPO, "package-lock.json")');
    expect(start).toContain('join(REPO, "tsconfig.json")');
    expect(start).toContain('join(REPO, "apps", "desktop", "tsconfig.json")');
  });
});
