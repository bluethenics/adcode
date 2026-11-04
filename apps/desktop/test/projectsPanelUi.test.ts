import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("shows projects, live people and real contribution fields in Chromium, including errors and narrow layouts", () => {
  const require = createRequire(import.meta.url);
  const env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"];
  const run = spawnSync(require("electron") as string, [fileURLToPath(new URL("./fixtures/projectsPanel.cjs", import.meta.url))], { env, encoding: "utf8", timeout: 30_000, windowsHide: true });
  expect(run.status, run.stdout + run.stderr || String(run.error)).toBe(0);
  const line = run.stdout.split(/\r?\n/).find(l => l.startsWith("PROJECTS_RESULTS="));
  expect(line, run.stdout).toBeDefined();
  expect(Object.values(JSON.parse(line!.slice("PROJECTS_RESULTS=".length))).every(Boolean)).toBe(true);
}, 35_000);
