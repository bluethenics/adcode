import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("runs the Agents board in real Chromium: starters, a solo run, live columns, stop, edit", () => {
  const require = createRequire(import.meta.url);
  const env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"];
  const run = spawnSync(require("electron") as string, [fileURLToPath(new URL("./fixtures/agentsPage.cjs", import.meta.url))], { env, encoding: "utf8", timeout: 40_000, windowsHide: true });
  expect(run.status, run.stderr || String(run.error)).toBe(0);
  const line = run.stdout.split(/\r?\n/).find((entry) => entry.startsWith("AGENTS_PAGE_RESULTS="));
  expect(line, run.stdout + run.stderr).toBeDefined();
  expect(JSON.parse(line!.slice("AGENTS_PAGE_RESULTS=".length))).toEqual({
    startersSeeded: true,
    emptyBoard: true,
    dialogOpens: true,
    startsSoloRun: true,
    boxWorking: true,
    summary: true,
    movesToReady: true,
    stopAsks: true,
    stopCancels: true,
    chatBox: true,
    editorSaves: true,
    finishedStays: true,
    proofChips: true,
    raceCompare: true,
    escapedText: true,
    narrow: true,
  });
}, 45_000);
