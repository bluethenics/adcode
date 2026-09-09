import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

type Presentation = { opacity: string; scale: string; translate: string };
let results: {
  prompts: { replacementSurvives: boolean; dragSurvives: boolean; backdropCloses: boolean }[];
  dismissal: { openingClickSurvives: boolean; dragSurvives: boolean; backdropCloses: boolean };
  labels: { id: string; ownsLabel: boolean }[];
  motion: { reduce: boolean; beforeClose: Presentation; afterClose: Presentation;
    beforeReopen: Presentation; afterReopen: Presentation; open: boolean }[];
  backdrop: { helpClosed: boolean; settingsOpen: boolean; focusReturned: boolean };
  nextPressCloses: boolean;
  inside: { helpClosed: boolean; settingsOpen: boolean; clicks: number };
  nextControlClick: number;
  afterCancelClick: number;
  afterNoClickDrag: number;
  layeredClose: { firstOpen: boolean; secondOpen: boolean };
  repeatedOpen: { open: boolean; opacity: string }[];
};

beforeAll(() => {
  const require = createRequire(import.meta.url);
  const env = { ...process.env };
  delete env["ELECTRON_RUN_AS_NODE"];
  const run = spawnSync(require("electron") as string,
    [fileURLToPath(new URL("./fixtures/popupInteractions.cjs", import.meta.url))],
    { env, encoding: "utf8", timeout: 25_000, windowsHide: true });
  expect(run.status, run.stderr || String(run.error)).toBe(0);
  const line = run.stdout.split(/\r?\n/).find((entry) => entry.startsWith("POPUP_RESULTS="));
  expect(line, run.stdout).toBeDefined();
  results = JSON.parse(line!.slice("POPUP_RESULTS=".length)) as typeof results;
}, 30_000);

describe("popup interactions in Chromium", () => {
  it("stays visible after repeated completed close and reopen animations", () => {
    expect(results.repeatedOpen).toEqual(Array.from({ length: 4 }, () => ({ open: true, opacity: "1" })));
  });
  it("keeps replacement prompts open and preserves them when selecting text outside the card", () => {
    expect(results.prompts).toEqual([
      { replacementSurvives: true, dragSurvives: true, backdropCloses: true },
      { replacementSurvives: true, dragSurvives: true, backdropCloses: true },
    ]);
  });
  it("requires a fresh backdrop press rather than an opening click or a drag out", () => {
    expect(results.dismissal).toEqual({ openingClickSurvives: true, dragSurvives: true, backdropCloses: true });
  });
  it("labels simultaneous Connect instances from their own unique title", () => {
    expect(new Set(results.labels.map((label) => label.id)).size).toBe(2);
    expect(results.labels.every((label) => label.ownsLabel)).toBe(true);
  });
  for (const reduce of [false, true]) {
    it(`closes midway through opening without jumping (reduced motion: ${String(reduce)})`, () => {
      const sample = results.motion.find((entry) => entry.reduce === reduce)!;
      expect(Number(sample.beforeClose.opacity)).toBeGreaterThan(0);
      expect(Number(sample.beforeClose.opacity)).toBeLessThan(1);
      expect(sample.afterClose).toEqual(sample.beforeClose);
      if (reduce) expect(sample.afterClose).toMatchObject({ scale: "none", translate: "none" });
    });
    it(`reopens midway through closing without jumping (reduced motion: ${String(reduce)})`, () => {
      const sample = results.motion.find((entry) => entry.reduce === reduce)!;
      expect(Number(sample.beforeReopen.opacity)).toBeGreaterThan(0);
      expect(Number(sample.beforeReopen.opacity)).toBeLessThan(1);
      expect(sample.afterReopen).toEqual(sample.beforeReopen);
      expect(sample.open).toBe(true);
    });
  }
  it("consumes the full backdrop gesture for row help before the earlier document listener and shell click", () => {
    expect(results.backdrop).toEqual({ helpClosed: true, settingsOpen: true, focusReturned: true });
    expect(results.nextPressCloses).toBe(true);
  });
  it("dismisses help without activating the control underneath, then permits fresh gestures", () => {
    expect(results.inside).toEqual({ helpClosed: true, settingsOpen: true, clicks: 0 });
    expect(results.nextControlClick).toBe(1);
    expect(results.afterCancelClick).toBe(2);
    expect(results.afterNoClickDrag).toBe(3);
  });
  it("does not leave a closing primary dialog in the native top layer when another primary opens", () => {
    expect(results.layeredClose).toEqual({ firstOpen: false, secondOpen: true });
  });
});
