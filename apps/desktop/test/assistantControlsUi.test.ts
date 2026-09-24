import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("manages MCP servers and skills through the actual Chromium controls", () => {
  const require = createRequire(import.meta.url);
  const env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"];
  const run = spawnSync(require("electron") as string, [fileURLToPath(new URL("./fixtures/assistantControls.cjs", import.meta.url))], { env, encoding: "utf8", timeout: 25_000, windowsHide: true });
  expect(run.status, run.stderr || String(run.error)).toBe(0);
  const line = run.stdout.split(/\r?\n/).find(entry => entry.startsWith("ASSISTANT_CONTROLS_RESULTS="));
  expect(line, run.stdout + run.stderr).toBeDefined();
  expect(JSON.parse(line!.slice("ASSISTANT_CONTROLS_RESULTS=".length))).toEqual({ liveState: true, toggleReachesBackend: true, escapedMetadata: true, filter: true, systemFilter: true, skillToggle: true, skillPreview: true, createSkill: true, saveServer: true, narrow: true, liveRefresh: true });
}, 30_000);
