import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

/*
 * Team in Vibe, in real Chromium: while a team chat opens, a skeleton in the chat's shape shows;
 * then the real chat, with the strip (title, AI replies, Invite) above it and teammates on the
 * left. The panel's own chat must never appear - it used to flash for a moment on every visit.
 */
it("opens a team chat in the real chat without flashing the panel's own chat", () => {
  const env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"];
  const run = spawnSync(createRequire(import.meta.url)("electron") as string, [fileURLToPath(new URL("./fixtures/teamInChat.cjs", import.meta.url))], { env, encoding: "utf8", timeout: 40_000, windowsHide: true });
  expect(run.status, run.stdout + run.stderr || String(run.error)).toBe(0);
  const line = run.stdout.split(/\r?\n/).find((entry) => entry.startsWith("TEAM_IN_CHAT="));
  expect(line, run.stdout + run.stderr).toBeDefined();
  const result = JSON.parse(line!.slice("TEAM_IN_CHAT=".length)) as Record<string, unknown> & { frames: { panelChat: number; skeleton: number; cardBeforeDrawn: number } };
  expect(result).toMatchObject({
    skeletonWhileOpening: true,
    chatOpen: true,
    cardShown: true,
    hostHidden: true,
    stripAbove: true,
    stripTitle: "Launch planning",
    stripHasControls: true,
    teammateLeft: true,
  });
  expect(result["stripHeight"]).toBeGreaterThan(40);
  expect(result.frames.panelChat).toBe(0);
  expect(result.frames.cardBeforeDrawn).toBe(0);
  expect(result.frames.skeleton).toBeGreaterThan(0);
}, 45_000);
