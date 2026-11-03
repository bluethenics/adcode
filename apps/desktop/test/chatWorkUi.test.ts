import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("shows main-chat edits as they stream, follows growth, keeps the turn's cards beside the latest work, renders tables and restores edit cards", () => {
  const env = { ...process.env }; delete env["ELECTRON_RUN_AS_NODE"];
  const run = spawnSync(createRequire(import.meta.url)("electron") as string, [resolve(import.meta.dirname, "fixtures/chatWork.cjs")], { env, encoding: "utf8", timeout: 45_000, windowsHide: true });
  expect(run.status, run.stderr || String(run.error)).toBe(0);
  const line = /^CHAT_WORK_RESULTS=(.+)$/m.exec(run.stdout);
  expect(line, run.stdout).not.toBeNull();
  expect(JSON.parse(line![1]!)).toEqual({ chatPreview: true, previewDismissed: true, typingInline: true, followsGrowingCode: true, respectsScrollUp: true, settlesCode: true, oneWindowPerTurn: true, cardsFollowTheWork: true, cardsSettleAboveTheTurn: true, realTable: true, narrowTable: true, restoredCard: true, restoredUndoState: true, errors: [] });
}, 50_000);
