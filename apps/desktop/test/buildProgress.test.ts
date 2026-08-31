import { describe, expect, it } from "vitest";
import {
  createBuildProgress,
  formatDuration,
  formatSize,
  QUIPS,
  QUIP_MS,
  quipAt,
  renderFrame,
  renderSummary,
} from "../../../scripts/buildProgress.mjs";

/*
 * Verbatim from a piped `npm start` build - escape codes and all.
 *
 * The colours are the point. An earlier version of this fixture held the same lines with
 * the escapes already stripped, which is why every test passed while the real bar showed
 * no sizes and learned no renderer duration: Vite colours its output even into a pipe, so
 * nothing anchored to the start of a line ever matched. A fixture that is easier to read
 * than the thing it stands for is not a fixture.
 */
const OUTPUT = [
  "\u001b[36mvite v7.3.6 \u001b[32mbuilding ssr environment for production...\u001b[36m\u001b[39m",
  "transforming...",
  "\u001b[32m✓\u001b[39m 857 modules transformed.",
  "\u001b[2mout/main/\u001b[22m\u001b[36mchunks/node-DDzCJxqj.js  \u001b[39m\u001b[1m\u001b[2m   33.19 kB\u001b[22m\u001b[1m\u001b[22m",
  "\u001b[2mout/main/\u001b[22m\u001b[36mchunks/main-D8FnthHW.js  \u001b[39m\u001b[1m\u001b[33m  566.25 kB\u001b[39m\u001b[22m",
  "\u001b[2mout/main/\u001b[22m\u001b[36mindex.js                 \u001b[39m\u001b[1m\u001b[33m1,890.65 kB\u001b[39m\u001b[22m",
  "\u001b[32m✓ built in 11.58s\u001b[39m",
  "\u001b[36mvite v7.3.6 \u001b[32mbuilding ssr environment for production...\u001b[36m\u001b[39m",
  "\u001b[32m✓\u001b[39m 2 modules transformed.",
  "\u001b[2mout/preload/\u001b[22m\u001b[36mindex.cjs  \u001b[39m\u001b[1m\u001b[2m27.43 kB\u001b[22m\u001b[1m\u001b[22m",
  "\u001b[32m✓ built in 258ms\u001b[39m",
  "\u001b[36mvite v7.3.6 \u001b[32mbuilding client environment for production...\u001b[36m\u001b[39m",
  '\u001b[33m[plugin vite:resolve] Module "fs" has been externalized for browser compatibility, imported by "E:/adcode-sourcecode/node_modules/web-tree-sitter/tree-sitter.js".',
  '\u001b[33m[plugin vite:resolve] Module "path" has been externalized for browser compatibility, imported by "E:/adcode-sourcecode/node_modules/web-tree-sitter/tree-sitter.js".',
  "\u001b[32m✓\u001b[39m 1472 modules transformed.",
  "\u001b[2m../../out/renderer/\u001b[22m\u001b[32mindex.html                              \u001b[39m\u001b[1m\u001b[2m    18.97 kB\u001b[22m\u001b[1m\u001b[22m",
];

/** The line that ends the renderer, which is the only phase long enough to be told in minutes. */
const RENDERER_DONE = "\u001b[32m✓ built in 1m 24s\u001b[39m";

const SSR_STARTS = OUTPUT[0]!;
const PRELOAD_STARTS = OUTPUT.filter((line) => line.includes("ssr environment"))[1]!;
const CLIENT_STARTS = OUTPUT.find((line) => line.includes("client environment"))!;

/** A clock the test moves by hand, so a ninety-second build takes no time to assert. */
function fakeClock(start = 1_000) {
  let at = start;
  return { now: () => at, advance: (ms: number) => (at += ms) };
}

describe("build progress", () => {
  it("walks the three phases in the order electron-vite builds them", () => {
    const clock = fakeClock();
    const progress = createBuildProgress({ now: clock.now });

    progress.push(SSR_STARTS);
    expect(progress.snapshot().phaseId).toBe("main");

    progress.push(PRELOAD_STARTS);
    expect(progress.snapshot().phaseId).toBe("preload");

    progress.push(CLIENT_STARTS);
    expect(progress.snapshot().phaseId).toBe("renderer");
  });

  it("never travels backwards when a phase ends sooner than its estimate", () => {
    const clock = fakeClock();
    const progress = createBuildProgress({ now: clock.now });

    const seen: number[] = [];
    for (const line of OUTPUT) {
      progress.push(line);
      clock.advance(400);
      seen.push(progress.snapshot().fraction);
    }

    for (let index = 1; index < seen.length; index += 1) {
      expect(seen[index]!).toBeGreaterThanOrEqual(seen[index - 1]!);
    }
  });

  it("stops short of finished until the last phase says it is built", () => {
    const clock = fakeClock();
    const progress = createBuildProgress({ now: clock.now });

    for (const line of OUTPUT) progress.push(line);
    // Far longer than any estimate: the clock must not be able to declare victory.
    clock.advance(10 * 60 * 1000);

    const before = progress.snapshot();
    expect(before.done).toBe(false);
    expect(before.fraction).toBeLessThan(1);

    progress.push(RENDERER_DONE);
    const after = progress.snapshot();
    expect(after.done).toBe(true);
    expect(after.fraction).toBe(1);
  });

  it("collects the bundle table and counts the warnings without showing them", () => {
    const progress = createBuildProgress({ now: fakeClock().now });
    for (const line of OUTPUT) progress.push(line);

    const state = progress.snapshot();
    expect(state.outputs).toContainEqual({ path: "out/main/index.js", kB: 1890.65 });
    expect(state.outputs).toContainEqual({ path: "out/preload/index.cjs", kB: 27.43 });
    // The renderer's table is written relative to its own Vite root, so its rows carry a
    // `../../` the other two do not. Missing this is half of why the summary said nothing.
    expect(state.outputs).toContainEqual({ path: "../../out/renderer/index.html", kB: 18.97 });
    expect(state.warnings).toBe(2);
  });

  it("records the renderer's duration, which Vite reports in minutes", () => {
    const clock = fakeClock();
    const progress = createBuildProgress({ now: clock.now });

    progress.push(CLIENT_STARTS);
    clock.advance(84_000);
    progress.push(RENDERER_DONE);

    // "✓ built in 1m 24s" - the format that matched nothing, on the one phase long enough
    // to always use it, which is why the cache learned two durations out of three.
    expect(progress.learned().durations["renderer"]).toBe(84_000);
  });

  it("learns what to expect next time", () => {
    const clock = fakeClock();
    const progress = createBuildProgress({ now: clock.now });

    progress.push(SSR_STARTS);
    clock.advance(10_740);
    progress.push("✓ 857 modules transformed.");
    progress.push("✓ built in 10.74s");

    const learned = progress.learned();
    expect(learned.durations["main"]).toBe(10_740);
    expect(learned.modules["main"]).toBe(857);
  });

  it("uses last build's module count as the denominator while transforming", () => {
    const clock = fakeClock();
    // No time passes at all, so anything the bar reports came from the module counter.
    const progress = createBuildProgress({
      now: clock.now,
      modules: { renderer: 2942 },
    });

    progress.push(CLIENT_STARTS);
    const idle = progress.snapshot().fraction;

    progress.push("transforming (1471) some/module.ts");
    expect(progress.snapshot().fraction).toBeGreaterThan(idle);
  });

  it("keeps moving when Vite prints no transforming lines into a pipe", () => {
    const clock = fakeClock();
    const progress = createBuildProgress({ now: clock.now, modules: { renderer: 2942 } });

    progress.push(CLIENT_STARTS);
    const before = progress.snapshot().fraction;
    clock.advance(20_000);

    // A denominator with no counter must fall back to the clock rather than freeze.
    expect(progress.snapshot().fraction).toBeGreaterThan(before);
  });
});

describe("what it says while it waits", () => {
  it("changes what it says as the build wears on", () => {
    expect(quipAt(0)).toBe(QUIPS[0]);
    expect(quipAt(QUIP_MS)).toBe(QUIPS[1]);
    expect(quipAt(QUIP_MS * 2)).toBe(QUIPS[2]);
  });

  it("settles on the reassuring one rather than looping back to the jokes", () => {
    expect(quipAt(QUIP_MS * QUIPS.length)).toBe(QUIPS[QUIPS.length - 1]);
    expect(quipAt(QUIP_MS * 1000)).toBe(QUIPS[QUIPS.length - 1]);
  });
});

describe("drawing", () => {
  const frame = (columns: number, fraction = 0.5) =>
    renderFrame({
      fraction,
      label: "the workbench",
      quip: "Asking tree-sitter to parse the parsers.",
      elapsedMs: 42_000,
      columns,
      colour: false,
    });

  it("draws three lines with the percentage and the clock", () => {
    const lines = frame(100);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("50%");
    expect(lines[0]).toContain("0:42");
    expect(lines[1]).toContain("the workbench");
  });

  it("fits inside a narrow terminal", () => {
    for (const columns of [40, 60, 100, 200]) {
      for (const line of frame(columns)) {
        // eslint-disable-next-line no-control-regex
        expect(line.length).toBeLessThanOrEqual(Math.max(columns, 64));
      }
    }
  });

  it("fills the bar in proportion", () => {
    const empty = (frame(100, 0)[0]!.match(/█/g) ?? []).length;
    const half = (frame(100, 0.5)[0]!.match(/█/g) ?? []).length;
    const full = (frame(100, 1)[0]!.match(/█/g) ?? []).length;

    expect(empty).toBe(0);
    expect(half).toBeGreaterThan(0);
    expect(full).toBeGreaterThan(half);
  });

  it("emits no escape codes when colour is off", () => {
    for (const line of frame(100)) {
      expect(line).not.toContain("\u001b");
    }
  });

  it("leaves one line behind naming the time and everything written", () => {
    const progress = createBuildProgress({ now: fakeClock().now });
    for (const line of OUTPUT) progress.push(line);

    const summary = renderSummary(progress.snapshot(), false);
    expect(summary).toContain("Built ADCode in");
    // 33.19 + 566.25 + 1888.98 + 27.43 kB, over the four files in the sample output.
    expect(summary).toContain("2.5 MB");
    expect(summary).toContain("across 5 files");
  });

  it("says nothing about size when nothing was written", () => {
    const progress = createBuildProgress({ now: fakeClock().now });
    expect(renderSummary(progress.snapshot(), false)).toBe("  Built ADCode in 0:00");
  });
});

describe("formatting", () => {
  it("counts minutes and seconds", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(42_000)).toBe("0:42");
    expect(formatDuration(91_000)).toBe("1:31");
  });

  it("switches to megabytes where kilobytes stop being readable", () => {
    expect(formatSize(27.43)).toBe("27 kB");
    expect(formatSize(1888.98)).toBe("1.9 MB");
  });
});
