import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { expect, it } from "vitest";
it("reviews actual edit diffs, expands files, respects Undo conflicts and fits narrow themes", () => {
  const env = { ...process.env }; delete env["ELECTRON_RUN_AS_NODE"];
  const run = spawnSync(createRequire(import.meta.url)("electron") as string, [resolve(import.meta.dirname, "fixtures/editSummary.cjs")], { env, encoding: "utf8", timeout: 40_000, windowsHide: true });
  expect(run.status, run.stderr || String(run.error)).toBe(0);
  const result = /^EDIT_SUMMARY_RESULTS=(.+)$/m.exec(run.stdout);
  expect(result, run.stdout).not.toBeNull();
  expect(JSON.parse(result![1]!)).toEqual({ summary: true, startsCollapsed: true, showsMore: true, opensFile: true, reviewsRecordedDiff: true, collapsesReview: true, deletedDisabled: true, preservesLaterEdits: true, explicitForceUndo: true, lineEndingsOnly: true, narrow: true });
}, 45_000);
