import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("keeps a pending commit detail visible across a history refresh", () => {
  const env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"];
  const run = spawnSync(createRequire(import.meta.url)("electron") as string,
    [fileURLToPath(new URL("./fixtures/commitBrowser.cjs", import.meta.url))],
    { env, encoding: "utf8", windowsHide: true, timeout: 25_000 });
  expect(run.status, run.stderr || String(run.error)).toBe(0);
  expect(run.stdout).toContain("COMMIT_REFRESH_OK");
}, 30_000);
