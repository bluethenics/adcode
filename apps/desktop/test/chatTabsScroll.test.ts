import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("makes overflowed chat tabs reachable with a mouse wheel without trapping edge, trackpad, or zoom gestures", () => {
  const require = createRequire(import.meta.url);
  const env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"];
  const run = spawnSync(require("electron") as string,
    [fileURLToPath(new URL("./fixtures/chatTabsScroll.cjs", import.meta.url))],
    { env, encoding: "utf8", timeout: 25_000, windowsHide: true });
  expect(run.status, run.stderr || String(run.error)).toBe(0);
  const line = run.stdout.split(/\r?\n/).find(entry => entry.startsWith("CHAT_TABS_SCROLL_RESULTS="));
  expect(line, run.stdout + run.stderr).toBeDefined();
  expect(JSON.parse(line!.slice("CHAT_TABS_SCROLL_RESULTS=".length))).toEqual({
    overflowed: true, wheelMoves: true, lastTabReachable: true, edgePasses: true,
    reverseMoves: true, startPasses: true, linesMove: true, pagesMove: true,
    horizontalNative: true, zoomNative: true, noOverflowPasses: true,
  });
}, 30_000);
