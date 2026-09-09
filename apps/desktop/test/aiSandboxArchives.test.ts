import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("copies and measures archive files as bytes in Electron, excluding release output", () => {
  const env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"];
  const run = spawnSync(createRequire(import.meta.url)("electron") as string,
    [fileURLToPath(new URL("./fixtures/aiSandboxArchives.cjs", import.meta.url))],
    { env, encoding: "utf8", windowsHide: true, timeout: 25_000 });
  expect(run.status, run.stderr || String(run.error)).toBe(0);
  expect(run.stdout).toContain("ASAR_SANDBOX_OK");
}, 30_000);
