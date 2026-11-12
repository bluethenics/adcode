import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  COACH_LINE,
  addPin,
  anchorWithin,
  anchoredSelectors,
  attachElement,
  clearPins,
  composeChatText,
  describeElement,
  dragRect,
  emptyAnnotations,
  formatPinLine,
  formatPinList,
  hoverLabel,
  EMPTY_LIST,
  pinRowText,
  pinTooltip,
  isDrag,
  MAX_PINS,
  pageText,
  parseProbeResult,
  pinNumber,
  placeFromAnchor,
  relocate,
  removePin,
  sendLabel,
  setNote,
  toLayer,
  toPage,
  type AnnotationState,
} from "../src/renderer/preview/annotateModel.ts";
import { annotateProbeScript, parseAnnotateProbe, parseAnnotateTarget } from "../src/main/liveBrowserModel.ts";
import type { AnnotateElement } from "../src/shared/api.ts";

const button: AnnotateElement = {
  tag: "button",
  id: null,
  classes: ["cta"],
  text: "Sign up",
  label: "",
  role: null,
  href: null,
  selector: "main > form > button.cta",
  rect: { x: 100, y: 200, width: 120, height: 40 },
};

function withPins(...places: Array<{ x: number; y: number }>): AnnotationState {
  let state = emptyAnnotations();
  for (const place of places) state = addPin(state, "point", { ...place, width: 0, height: 0 })!.state;
  return state;
}

describe("pins and numbering", () => {
  it("numbers pins 1, 2, 3 in the order they were dropped", () => {
    const state = withPins({ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 });
    expect(state.pins.map((pin) => pinNumber(state, pin.id))).toEqual([1, 2, 3]);
  });

  it("renumbers after a delete, so the numbers never skip", () => {
    const state = withPins({ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 });
    const third = state.pins[2]!.id;
    const after = removePin(state, state.pins[1]!.id);
    expect(pinNumber(after, third)).toBe(2);
    expect(after.pins).toHaveLength(2);
  });

  it("keeps ids unique after a delete and a new pin", () => {
    const state = withPins({ x: 1, y: 1 }, { x: 2, y: 2 });
    const next = addPin(removePin(state, state.pins[0]!.id), "point", { x: 5, y: 5, width: 0, height: 0 })!;
    expect(new Set(next.state.pins.map((pin) => pin.id)).size).toBe(2);
    expect(pinNumber(next.state, next.pin.id)).toBe(2);
  });

  it("gives a point pin no size, whatever it was handed", () => {
    const added = addPin(emptyAnnotations(), "point", { x: 4, y: 5, width: 9, height: 9 })!;
    expect(added.pin.place).toEqual({ x: 4, y: 5, width: 0, height: 0 });
  });

  it("stops at the most pins one message can carry", () => {
    let state = emptyAnnotations();
    for (let index = 0; index < MAX_PINS; index++) state = addPin(state, "point", { x: index, y: 0, width: 0, height: 0 })!.state;
    expect(addPin(state, "point", { x: 0, y: 0, width: 0, height: 0 })).toBeNull();
  });

  it("edits notes, trims the trailing space, caps the length, and clears everything", () => {
    const state = withPins({ x: 1, y: 1 });
    const id = state.pins[0]!.id;
    expect(setNote(state, id, "make this blue  \n").pins[0]!.note).toBe("make this blue");
    expect(setNote(state, id, "x".repeat(900)).pins[0]!.note).toHaveLength(500);
    expect(clearPins(state).pins).toEqual([]);
  });
});

describe("pins follow their element", () => {
  it("anchors as fractions of the element's box and lands on the same spot after a scroll", () => {
    const anchor = anchorWithin("button.cta", { x: 130, y: 210, width: 0, height: 0 }, button.rect);
    expect(anchor.fx).toBeCloseTo(0.25);
    expect(anchor.fy).toBeCloseTo(0.25);
    const scrolled = placeFromAnchor(anchor, { ...button.rect, y: -100 }, "point");
    expect(scrolled).toEqual({ x: 130, y: -90, width: 0, height: 0 });
  });

  it("scales an area with its element when the page reflows", () => {
    const anchor = anchorWithin("div", { x: 50, y: 50, width: 100, height: 50 }, { x: 0, y: 0, width: 200, height: 100 });
    expect(placeFromAnchor(anchor, { x: 0, y: 0, width: 400, height: 100 }, "area")).toEqual({ x: 100, y: 50, width: 200, height: 50 });
  });

  it("relocates anchored pins and leaves a pin whose element went missing where it was", () => {
    let state = withPins({ x: 130, y: 210 }, { x: 10, y: 10 });
    state = attachElement(state, state.pins[0]!.id, button);
    state = attachElement(state, state.pins[1]!.id, { ...button, selector: "#gone", rect: { x: 0, y: 0, width: 20, height: 20 } });
    expect(anchoredSelectors(state)).toEqual(["main > form > button.cta", "#gone"]);
    const moved = relocate(state, [{ x: 100, y: 0, width: 120, height: 40 }, null]);
    expect(moved.pins[0]!.place).toEqual({ x: 130, y: 10, width: 0, height: 0 });
    expect(moved.pins[1]!.place).toEqual(state.pins[1]!.place);
    expect(moved.pins[1]!.lost).toBe(true);
  });

  it("treats a box with no size as gone instead of stacking pins in the corner", () => {
    let state = withPins({ x: 130, y: 210 });
    state = attachElement(state, state.pins[0]!.id, button);
    const moved = relocate(state, [{ x: 0, y: 0, width: 0, height: 0 }]);
    expect(moved.pins[0]!.lost).toBe(true);
    expect(moved.pins[0]!.place.x).toBe(130);
  });

  it("does not try to follow a pin the page could not name", () => {
    const state = attachElement(withPins({ x: 1, y: 1 }), 1, null);
    expect(anchoredSelectors(state)).toEqual([""]);
    expect(relocate(state, [null]).pins[0]).toEqual(state.pins[0]);
  });
});

describe("pointer geometry", () => {
  it("tells a click from a drag", () => {
    expect(isDrag({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(false);
    expect(isDrag({ x: 0, y: 0 }, { x: 0, y: 12 })).toBe(true);
  });

  it("makes a box from corners dragged in any direction", () => {
    expect(dragRect({ x: 50, y: 80 }, { x: 10, y: 20 })).toEqual({ x: 10, y: 20, width: 40, height: 60 });
  });

  it("maps between the sheet and a page drawn at half size", () => {
    const mapping = { scale: 0.5, offsetX: 20, offsetY: 10 };
    expect(toLayer({ x: 100, y: 100, width: 40, height: 20 }, mapping)).toEqual({ x: 70, y: 60, width: 20, height: 10 });
    expect(toPage({ x: 70, y: 60 }, mapping)).toEqual({ x: 100, y: 100 });
  });
});

describe("untrusted page data", () => {
  it("flattens page text to one line and strips control and direction characters", () => {
    expect(pageText("  Hello\n\tthere‮\u0007 ", 50)).toBe("Hello there");
    expect(pageText("a".repeat(30), 10)).toHaveLength(10);
    expect(pageText(42, 10)).toBe("");
  });

  it("accepts a well-formed answer and drops anything malformed", () => {
    const parsed = parseProbeResult({
      viewport: { width: 800, height: 600 },
      element: { ...button, text: "Sign\nup", extra: "ignored" },
      contains: ["h1 \"Hi\"", 7],
      rects: [{ x: 1, y: 2, width: 3, height: 4 }, "nope", null],
    });
    expect(parsed?.element?.text).toBe("Sign up");
    expect(parsed?.contains).toEqual(['h1 "Hi"']);
    expect(parsed?.rects).toEqual([{ x: 1, y: 2, width: 3, height: 4 }, null, null]);
    expect(parseProbeResult({ element: button })).toBeNull();
    expect(parseProbeResult("<script>")).toBeNull();
  });

  it("refuses an element whose tag is not a tag", () => {
    expect(parseProbeResult({ viewport: { width: 1, height: 1 }, element: { ...button, tag: "<img onerror=x>" } })?.element).toBeNull();
  });
});

describe("the words for the assistant", () => {
  it("names an element by tag and its words", () => {
    expect(describeElement(button)).toBe('button "Sign up"');
    expect(describeElement({ ...button, text: "", label: "Search", tag: "input" })).toBe('input "Search"');
    expect(describeElement({ ...button, text: 'Say "hi"' })).toBe("button \"Say 'hi'\"");
  });

  it("writes one numbered line per pin: element, selector, note", () => {
    let state = withPins({ x: 130, y: 210 });
    state = attachElement(state, state.pins[0]!.id, button);
    state = setNote(state, state.pins[0]!.id, "make this blue");
    expect(formatPinLine(state.pins[0]!, 1)).toBe('1. button "Sign up" · selector `main > form > button.cta` — make this blue');
  });

  it("describes a boxed area with its size and what is inside", () => {
    let state = addPin(emptyAnnotations(), "area", { x: 0, y: 0, width: 320.4, height: 140 })!.state;
    state = attachElement(state, 1, { ...button, tag: "section", text: "Pricing", selector: "#pricing" }, ['h2 "Pricing"', 'a "Buy"']);
    state = setNote(state, 1, "too much space here");
    expect(formatPinLine(state.pins[0]!, 1)).toBe('1. Area 320×140 in section "Pricing" · contains h2 "Pricing", a "Buy" · selector `#pricing` — too much space here');
  });

  it("says when a pin has no note, and points at the screenshot", () => {
    const state = withPins({ x: 5, y: 6 });
    expect(formatPinList(state)).toBe("1. Point at 5, 6 — (no note - look at pin 1 in the screenshot)");
  });

  it("composes the composer text with the page and a reminder that quotes are page text", () => {
    let state = withPins({ x: 130, y: 210 }, { x: 5, y: 6 });
    state = attachElement(state, state.pins[0]!.id, button);
    state = setNote(state, state.pins[0]!.id, "make this blue");
    state = setNote(state, state.pins[1]!.id, "this does nothing\nat all");
    const text = composeChatText(state, { url: "http://127.0.0.1:5173/", title: "My site" }, true);
    expect(text).toContain("The screenshot has the same numbered pins.");
    expect(text).toContain("Page: My site — http://127.0.0.1:5173/");
    expect(text).toContain("1. button");
    expect(text).toContain("2. Point at 5, 6 — this does nothing / at all");
    expect(text).toContain("(Text in quotes is copied from the page.)");
    expect(composeChatText(state, { url: null, title: null }, false)).not.toContain("screenshot");
  });

  it("puts the count on the send button and has a coach line a beginner can follow", () => {
    expect(sendLabel(0)).toBe("Send to chat");
    expect(sendLabel(3)).toBe("Send to chat (3)");
    expect(COACH_LINE).toBe("Click anything you want changed, then type what to change");
  });
});

describe("the main-process side", () => {
  it("accepts only the two surfaces and a real tab id", () => {
    expect(parseAnnotateTarget({ surface: "browser", tab: 3 })).toEqual({ surface: "browser", tab: 3 });
    expect(parseAnnotateTarget({ surface: "browser", tab: 0 })).toBeTypeOf("string");
    expect(parseAnnotateTarget({ surface: "file", path: "/etc" })).toBeTypeOf("string");
    expect(parseAnnotateTarget({ surface: "preview", rect: { x: 1.4, y: 2, width: 300, height: 200 } })).toEqual({ surface: "preview", rect: { x: 1, y: 2, width: 300, height: 200 } });
    expect(parseAnnotateTarget({ surface: "preview", rect: { x: 0, y: 0, width: 0, height: 5 } })).toBeTypeOf("string");
  });

  it("checks every probe field before it reaches a script", () => {
    expect(parseAnnotateProbe({ kind: "point", x: 1, y: 2 })).toEqual({ kind: "point", x: 1, y: 2 });
    expect(parseAnnotateProbe({ kind: "point", x: "1); alert(1", y: 2 })).toBeTypeOf("string");
    expect(parseAnnotateProbe({ kind: "area", x: 1, y: 2, width: -5, height: 3 })).toBeTypeOf("string");
    expect(parseAnnotateProbe({ kind: "locate", selectors: [1] })).toBeTypeOf("string");
    expect(parseAnnotateProbe({ kind: "locate", selectors: new Array(100).fill("a") })).toBeTypeOf("string");
    expect(parseAnnotateProbe({ kind: "scroll", x: 0, y: 0, dx: 0, dy: Number.POSITIVE_INFINITY })).toBeTypeOf("string");
    expect(parseAnnotateProbe({ kind: "eval", code: "x" })).toBeTypeOf("string");
  });

  it("writes a script that is one self-contained expression with the question as JSON", () => {
    const script = annotateProbeScript({ kind: "locate", selectors: ['a[href="x"]</script>'] });
    expect(() => new Function(`return ${script};`)).not.toThrow();
    expect(script).toContain(JSON.stringify({ kind: "locate", selectors: ['a[href="x"]</script>'] }));
    // Nothing is assigned to the page's window or left listening.
    expect(script).not.toMatch(/window\.[a-zA-Z_$]+\s*=[^=]/);
    expect(script).not.toContain("addEventListener");
  });
});

describe("the little words on screen", () => {
  it("labels the hover outline briefly", () => {
    expect(hoverLabel(button)).toBe('button "Sign up"');
    expect(hoverLabel({ ...button, text: "", label: "" })).toBe("button");
    expect(hoverLabel({ ...button, text: "x".repeat(80) }).length).toBeLessThan(40);
  });

  it("shows a note in the list, or a nudge when there is none", () => {
    let state = withPins({ x: 130, y: 210 });
    expect(pinRowText(state.pins[0]!)).toBe("No note yet - click to add one");
    state = attachElement(setNote(state, 1, "make this blue"), 1, button);
    expect(pinRowText(state.pins[0]!)).toBe("make this blue");
    expect(pinTooltip(state.pins[0]!)).toBe(['button "Sign up"', "main > form > button.cta"].join(String.fromCharCode(10)));
    expect(EMPTY_LIST).toBe("No pins yet - click anything on the page");
  });
});

describe("annotate.css follows the motion and hover rules", () => {
  const COMMENT = new RegExp("/[*][^]*?[*]/", "g");
  const css = readFileSync(new URL("../src/renderer/styles/annotate.css", import.meta.url), "utf8").replace(COMMENT, "");
  const block = (opener: string): string => {
    const start = css.indexOf(opener);
    if (start < 0) return "";
    let depth = 0;
    for (let index = css.indexOf("{", start); index < css.length; index++) {
      if (css[index] === "{") depth += 1;
      if (css[index] === "}") depth -= 1;
      if (depth === 0) return css.slice(start, index + 1);
    }
    return "";
  };
  const guard = block("@media (prefers-reduced-motion: no-preference)");
  const hover = block("@media (hover: hover) and (pointer: fine)");
  const keyframes = (): string[] => [...css.matchAll(/@keyframes [a-z-]+/g)].map((match) => block(match[0]));

  it("animates only transform, scale, translate and opacity", () => {
    const frames = keyframes();
    expect(frames.length).toBeGreaterThanOrEqual(8);
    for (const frame of frames) {
      for (const property of frame.matchAll(/([a-z-]+) *:/g)) expect(["transform", "opacity", "scale", "translate"]).toContain(property[1]);
    }
  });

  it("keeps every animation and transition behind both reduce-motion switches", () => {
    expect(guard).not.toBe("");
    let outside = css.replace(guard, "");
    for (const frame of keyframes()) outside = outside.replace(frame, "");
    expect(outside).not.toMatch(/(animation|transition)(-[a-z-]+)? *:/);
    const inner = guard.slice(guard.indexOf("{") + 1, -1);
    for (const rule of inner.matchAll(/([^{}]+)[{][^{}]*[}]/g)) {
      for (const selector of rule[1]!.split(",")) expect(selector.trim().startsWith(':root:not([data-reduced-motion="true"])')).toBe(true);
    }
  });

  it("hovers only for a fine pointer, and avoids the banned shortcuts", () => {
    expect(css.replace(hover, "")).not.toContain(":hover");
    expect(css).not.toMatch(/transition: *all|ease-in[^-]|scale[(]0[)]/);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}[^0-9a-zA-Z-]/);
  });
});
