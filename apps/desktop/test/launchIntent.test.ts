import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
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
});
