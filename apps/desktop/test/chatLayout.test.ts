import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("resizes assistant panels in Chromium and preserves room at narrow popup widths", () => {
  const require = createRequire(import.meta.url);
  const env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"];
  const run = spawnSync(require("electron") as string,
    [fileURLToPath(new URL("./fixtures/chatLayout.cjs", import.meta.url))],
    { env, encoding: "utf8", timeout: 25_000, windowsHide: true });
  expect(run.status, run.stderr || String(run.error)).toBe(0);
  const line = run.stdout.split(/\r?\n/).find(entry => entry.startsWith("CHAT_LAYOUT_RESULTS="));
  expect(line, run.stdout).toBeDefined();
  expect(JSON.parse(line!.slice("CHAT_LAYOUT_RESULTS=".length))).toEqual({
    keyboard: true, conversationRoom: true, medium: true, compact: true, hidden: true, reset: true,
  });
}, 30_000);
