import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ADCODE_MASCOT_MOODS,
  ADCODE_MASCOT_NAME,
  GAZE_LIMIT,
  gazeOffset,
  gazeReach,
  isAdcodeMascotMood,
  isCompactSize,
  isDoubleBlink,
  moodBlinks,
  moodForAssistant,
  nextBlinkDelay,
  transientDuration,
  type AssistantMascotState,
} from "../src/renderer/mascot/adcodeMascot.ts";

const CSS = readFileSync(join(import.meta.dirname, "../src/renderer/styles/adcodeMascot.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const SOURCE = readFileSync(join(import.meta.dirname, "../src/renderer/mascot/adcodeMascot.ts"), "utf8");
const GATE = ':root:not([data-reduced-motion="true"]) ';

/** The body of every `@media` block whose query starts with `query`, found by matching braces. */
function mediaBlocks(css: string, query: string): string[] {
  const found: string[] = [];
  let from = 0;
  for (;;) {
    const at = css.indexOf(query, from);
    if (at < 0) return found;
    const open = css.indexOf("{", at);
    let depth = 0;
    let end = open;
    for (; end < css.length; end += 1) {
      if (css[end] === "{") depth += 1;
      else if (css[end] === "}" && --depth === 0) break;
    }
    found.push(css.slice(open + 1, end));
    from = end;
  }
}

/** Everything outside the given blocks. */
function without(css: string, blocks: readonly string[]): string {
  return blocks.reduce((rest, block) => rest.replace(block, ""), css);
}

/** Plain `selector { declarations }` rules, nested blocks flattened away. */
function rules(css: string): { selector: string; body: string }[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({ selector: match[1]!.trim(), body: match[2]!.trim() }));
}

const MOTION = mediaBlocks(CSS, "@media (prefers-reduced-motion: no-preference)");
const HOVER = mediaBlocks(CSS, "@media (hover: hover) and (pointer: fine)");
const KEYFRAMES = CSS.match(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})+\s*\}/g) ?? [];
const STILL = without(without(without(CSS, MOTION), HOVER), KEYFRAMES);

describe("Buck's pure helpers", () => {
  it("has a name and at least sixteen distinct moods", () => {
    expect(ADCODE_MASCOT_NAME).toBe("Buck");
    expect(ADCODE_MASCOT_MOODS.length).toBeGreaterThanOrEqual(16);
    expect(new Set(ADCODE_MASCOT_MOODS).size).toBe(ADCODE_MASCOT_MOODS.length);
    expect(ADCODE_MASCOT_MOODS).toContain("idle");
  });

  it("recognises its own moods and nothing else", () => {
    for (const mood of ADCODE_MASCOT_MOODS) expect(isAdcodeMascotMood(mood)).toBe(true);
    for (const other of ["", "Idle", "happy", 3, null, undefined, {}]) expect(isAdcodeMascotMood(other)).toBe(false);
  });

  it("maps every assistant state to a mood", () => {
    const states: AssistantMascotState[] = ["idle", "thinking", "working", "streaming", "done", "error"];
    for (const state of states) expect(isAdcodeMascotMood(moodForAssistant(state))).toBe(true);
    expect(moodForAssistant("idle")).toBe("idle");
    expect(moodForAssistant("thinking")).toBe("thinking");
    expect(moodForAssistant("working")).toBe("searching");
    expect(moodForAssistant("streaming")).toBe("working");
    expect(moodForAssistant("done")).toBe("success");
    expect(moodForAssistant("error")).toBe("error");
  });

  it("looks only at a pointer within reach, and never past its limit", () => {
    expect(gazeOffset(0, 0, 200)).toEqual({ x: 0, y: 0 });
    expect(gazeOffset(300, 0, 200)).toEqual({ x: 0, y: 0 });
    expect(gazeOffset(10, 10, 0)).toEqual({ x: 0, y: 0 });
    expect(gazeOffset(Number.NaN, 4, 200)).toEqual({ x: 0, y: 0 });
    const right = gazeOffset(80, 0, 200);
    expect(right.x).toBe(GAZE_LIMIT.x);
    expect(right.y).toBe(0);
    const upLeft = gazeOffset(-40, -40, 200);
    expect(upLeft.x).toBeLessThan(0);
    expect(upLeft.y).toBeLessThan(0);
    for (const [dx, dy] of [[5, 5], [60, -90], [-120, 30], [190, 10]] as const) {
      const offset = gazeOffset(dx, dy, 200);
      expect(Math.abs(offset.x)).toBeLessThanOrEqual(GAZE_LIMIT.x);
      expect(Math.abs(offset.y)).toBeLessThanOrEqual(GAZE_LIMIT.y);
    }
    // Eases back towards the edge of its reach instead of snapping off.
    expect(Math.abs(gazeOffset(195, 0, 200).x)).toBeLessThan(Math.abs(gazeOffset(120, 0, 200).x));
  });

  it("reaches further for a bigger mascot, never under 180px", () => {
    expect(gazeReach(40)).toBe(180);
    expect(gazeReach(160)).toBe(416);
    expect(gazeReach(Number.NaN)).toBe(180);
  });

  it("blinks every 1.8 to 6 seconds, doubled about one time in six", () => {
    expect(nextBlinkDelay(0)).toBe(1800);
    expect(nextBlinkDelay(1)).toBe(6000);
    expect(nextBlinkDelay(-3)).toBe(1800);
    expect(nextBlinkDelay(9)).toBe(6000);
    expect(nextBlinkDelay(Number.NaN)).toBe(3900);
    expect(isDoubleBlink(0.1)).toBe(true);
    expect(isDoubleBlink(0.5)).toBe(false);
  });

  it("does not blink with its eyes already shut", () => {
    expect(moodBlinks("idle")).toBe(true);
    expect(moodBlinks("thinking")).toBe(true);
    for (const mood of ["sleeping", "celebrating", "success", "proud", "dancing", "poked"] as const) expect(moodBlinks(mood)).toBe(false);
  });

  it("plays a passing mood long enough to read", () => {
    expect(transientDuration("poked")).toBe(720);
    expect(transientDuration("celebrating")).toBe(3300);
    expect(transientDuration("thinking")).toBe(2400);
    for (const mood of ADCODE_MASCOT_MOODS) expect(transientDuration(mood)).toBeGreaterThan(0);
  });

  it("drops the fine detail below 44px", () => {
    expect(isCompactSize(32)).toBe(true);
    expect(isCompactSize(40)).toBe(true);
    expect(isCompactSize(44)).toBe(false);
    expect(isCompactSize(160)).toBe(false);
    expect(isCompactSize(0)).toBe(false);
    expect(isCompactSize(Number.NaN)).toBe(false);
  });
});

describe("Buck's stylesheet", () => {
  it("starts every animation behind both stillness switches", () => {
    expect(MOTION.length).toBeGreaterThan(0);
    expect(STILL).not.toMatch(/\banimation(?:-name)?\s*:/);
    for (const block of MOTION) {
      for (const rule of rules(block).filter((item) => /\banimation\s*:/.test(item.body))) {
        for (const selector of rule.selector.split(/,(?![^(]*\))/)) expect(selector.trim().startsWith(GATE)).toBe(true);
      }
    }
  });

  it("animates only transform, opacity and a drawn stroke", () => {
    expect(KEYFRAMES.length).toBeGreaterThan(10);
    const allowed = new Set(["transform", "opacity", "translate", "scale", "rotate", "stroke-dashoffset", "animation-timing-function"]);
    for (const frames of KEYFRAMES) {
      const inner = frames.slice(frames.indexOf("{") + 1);
      for (const [, property] of inner.matchAll(/([a-z-]+)\s*:/g)) expect(allowed.has(property!), `${property!} in ${frames.slice(0, 40)}`).toBe(true);
      expect(frames).not.toMatch(/\b(?:width|height|top|left|margin|padding)\s*:/);
    }
  });

  it("never transitions everything, eases in, or scales to nothing", () => {
    expect(CSS).not.toMatch(/transition\s*:\s*all\b/);
    expect(CSS).not.toMatch(/ease-in\b(?!-out)/);
    expect(CSS).not.toMatch(/scale\(\s*0\s*[,)]/);
    expect(CSS).not.toMatch(/scale\(\s*0\s*,\s*0\s*\)/);
  });

  it("keeps hover behind a pointer that can hover", () => {
    expect(without(CSS, HOVER)).not.toMatch(/:hover/);
    expect(HOVER.join("")).toMatch(/:hover/);
  });

  it("gives every animated part its own transform box and origin", () => {
    const boxed = new Set<string>();
    for (const rule of rules(CSS).filter((item) => /transform-box:\s*fill-box/.test(item.body) && /transform-origin:/.test(item.body))) {
      for (const [name] of rule.selector.matchAll(/\.adcode-mascot-[a-z-]+/g)) boxed.add(name);
    }
    const animated = new Set<string>();
    for (const block of MOTION) {
      for (const rule of rules(block).filter((item) => /\banimation\s*:\s*(?!none)/.test(item.body))) {
        for (const selector of rule.selector.split(/,(?![^(]*\))/)) {
          // The part a rule moves is the last thing its selector names.
          const parts = [...selector.matchAll(/\.adcode-mascot-[a-z-]+/g)].map((match) => match[0]);
          const last = parts[parts.length - 1];
          if (last !== undefined) animated.add(last);
        }
      }
    }
    expect(animated.size).toBeGreaterThan(10);
    for (const part of animated) expect(boxed.has(part), part).toBe(true);
  });

  it("holds a distinct pose for every mood with motion off", () => {
    const still = rules(STILL);
    const poses = new Map<string, string>();
    for (const mood of ADCODE_MASCOT_MOODS) {
      const pose = still.map((rule, index) => (rule.selector.includes(`[data-mood="${mood}"]`) ? index : -1)).filter((index) => index >= 0).join(",");
      if (mood !== "idle") expect(pose, `${mood} has no pose of its own`).not.toBe("");
      const twin = poses.get(pose);
      expect(twin, `${mood} looks the same as ${twin ?? ""}`).toBeUndefined();
      poses.set(pose, mood);
    }
  });

  it("uses no emoji or star glyphs", () => {
    const glyphs = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}★☆✨]/u;
    expect(CSS).not.toMatch(glyphs);
    expect(SOURCE).not.toMatch(glyphs);
  });
});

describe("Buck's element", () => {
  it("is named by aria-label only, leaving tooltips to the app's own layer", () => {
    expect(SOURCE).toContain("aria-label");
    expect(SOURCE).not.toMatch(/\.title\s*=|setAttribute\(\s*["']title["']/);
  });
});
