import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("runs the Tools page in real Chromium: servers, catalogue, skills, memory, sharing", () => {
  const require = createRequire(import.meta.url);
  const env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"];
  const run = spawnSync(require("electron") as string, [fileURLToPath(new URL("./fixtures/toolsPage.cjs", import.meta.url))], { env, encoding: "utf8", timeout: 40_000, windowsHide: true });
  expect(run.status, run.stderr || String(run.error)).toBe(0);
  const line = run.stdout.split(/\r?\n/).find((entry) => entry.startsWith("TOOLS_PAGE_RESULTS="));
  expect(line, run.stdout + run.stderr).toBeDefined();
  expect(JSON.parse(line!.slice("TOOLS_PAGE_RESULTS=".length))).toEqual({
    counts: true,
    usedBy: true,
    liveState: true,
    toggleReachesBackend: true,
    escapedMetadata: true,
    filter: true,
    catalogueAdd: true,
    saveServer: true,
    systemFilter: true,
    skillToggle: true,
    skillPreview: true,
    createSkill: true,
    memoryListed: true,
    shareCopies: true,
    memoryAdded: true,
    memoryDeleted: true,
    liveRefresh: true,
    keyboardTabs: true,
    narrow: true,
  });
}, 45_000);
