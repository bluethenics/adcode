import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("keeps model connection flows usable across popup widths", () => {
  const require = createRequire(import.meta.url);
  const env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"];
  const run = spawnSync(require("electron") as string,
    [fileURLToPath(new URL("./fixtures/connectView.cjs", import.meta.url))],
    { env, encoding: "utf8", timeout: 30_000, windowsHide: true });
  expect(run.status, run.stderr || String(run.error)).toBe(0);
  const line = run.stdout.split(/\r?\n/).find(entry => entry.startsWith("CONNECT_RESULTS="));
  expect(line, run.stdout + run.stderr).toBeDefined();
  const results = JSON.parse(line!.slice("CONNECT_RESULTS=".length)) as Record<string, boolean>;
  expect(Object.keys(results).length).toBeGreaterThanOrEqual(12);
  for (const [name, passed] of Object.entries(results)) expect(passed, name).toBe(true);
}, 35_000);
