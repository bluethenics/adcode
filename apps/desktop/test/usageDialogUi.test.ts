import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("shows real activity and allowance in Chromium, keeps keyboard focus live, and fits narrow windows", () => {
  const require = createRequire(import.meta.url);
  const env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"];
  const run = spawnSync(require("electron") as string, [fileURLToPath(new URL("./fixtures/usageDialog.cjs", import.meta.url))], { env, encoding: "utf8", timeout: 30000, windowsHide: true });
  expect(run.status, run.stdout + run.stderr || String(run.error)).toBe(0);
  const line = run.stdout.split(/\r?\n/).find((entry) => entry.startsWith("USAGE_DIALOG_RESULTS="));
  expect(line, run.stdout).toBeDefined();
  const results = JSON.parse(line!.slice("USAGE_DIALOG_RESULTS=".length)) as Record<string, boolean>;
  expect(Object.keys(results)).toHaveLength(28);
  expect(Object.values(results).every(Boolean)).toBe(true);
}, 35000);
