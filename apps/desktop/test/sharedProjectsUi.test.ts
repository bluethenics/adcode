import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
it("opens and joins projects, copies invites, explains the Free limit and resolves conflicts in Chromium", () => {
  const require = createRequire(import.meta.url), env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"];
  const run = spawnSync(require("electron") as string, [fileURLToPath(new URL("./fixtures/sharedProjects.cjs", import.meta.url))], { env, encoding: "utf8", timeout: 30_000, windowsHide: true });
  expect(run.status, run.stderr || String(run.error)).toBe(0);
  const line = run.stdout.split(/\r?\n/).find(item => item.startsWith("PROJECTS_UI_RESULTS="));
  expect(line, run.stdout).toBeDefined();
  expect(JSON.parse(line!.slice("PROJECTS_UI_RESULTS=".length))).toEqual({ quotaText: true, noOverflow: true, copies: true, opens: true, joins: true, cancelSafe: true, upgradeMessage: true, conflictChoice: true });
}, 35_000);
