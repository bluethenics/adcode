/**
 * Buck, the ADCode mascot: the `<$>` mark come alive.
 *
 * The logo is a dollar sign between two angle brackets on a near-black plate. Buck is that
 * plate with a face: the two brackets are its hands, held at its sides and free to wave,
 * type, point and clasp, and the dollar is a coin it can pull out, flip and catch - which is
 * the whole product in one gesture, because ADCode pays the person using it. The name is the
 * dollar's own nickname. It is drawn here, in code, and belongs to nobody else.
 *
 * Presentation only: no Electron, no IPC, no storage, no network. A surface tells the mascot
 * its mood and this module owns the drawing, the blinking, the glance towards the pointer and
 * the reaction to a poke. Every mood is one `data-mood` value that `styles/adcodeMascot.css`
 * turns into a pose and, when motion is allowed, a loop on top of that pose - so with Reduce
 * motion on, each mood is still a different picture, it just holds still.
 *
 * The drawing never changes between moods. Every eye shape, mouth, prop and effect is in the
 * SVG from the start and the stylesheet fades the right ones in, which is what lets a mood
 * change cross-fade instead of snapping, and keeps an animation from restarting on a repaint.
 *
 * Each moving part is two nested groups: the inner one holds the mood's pose, the outer one
 * plays the loop. A single element cannot carry both, because a keyframe that sets
 * `transform` replaces the pose rather than adding to it.
 */

/** What the mascot is called wherever it is named to a person. */
export const ADCODE_MASCOT_NAME = "Buck";

export const ADCODE_MASCOT_MOODS = [
  "idle",
  "greeting",
  "thinking",
  "working",
  "searching",
  "listening",
  "loading",
  "celebrating",
  "success",
  "error",
  "sleeping",
  "surprised",
  "proud",
  "wink",
  "dancing",
  "earning",
  "connecting",
  "poked",
] as const;

export type AdcodeMascotMood = (typeof ADCODE_MASCOT_MOODS)[number];

export type AssistantMascotState = "idle" | "thinking" | "working" | "streaming" | "done" | "error";

export interface AdcodeMascotOptions {
  readonly mood?: AdcodeMascotMood;
  /** Edge length in CSS pixels. Left out, the stylesheet's `--mascot-size` decides. */
  readonly size?: number;
  readonly label?: string;
  /** A button that reacts to a press, rather than a decoration nobody can reach. */
  readonly interactive?: boolean;
}

export interface AdcodeMascot {
  readonly element: HTMLElement;
  setMood(mood: AdcodeMascotMood): void;
  /** Show a mood for a moment, then go back to the one set with `setMood`. */
  play(mood: AdcodeMascotMood, ms?: number): void;
  setSize(px: number): void;
  destroy(): void;
}

export function isAdcodeMascotMood(value: unknown): value is AdcodeMascotMood {
  return typeof value === "string" && (ADCODE_MASCOT_MOODS as readonly string[]).includes(value);
}

/**
 * The mood for each state of the chat assistant, so this mascot can take over from the chat's
 * own face. Tool work is mostly reading and looking things up, so it searches; an answer
 * arriving is the assistant typing, so it types.
 */
export function moodForAssistant(state: AssistantMascotState): AdcodeMascotMood {
  switch (state) {
    case "thinking": return "thinking";
    case "working": return "searching";
    case "streaming": return "working";
    case "done": return "success";
    case "error": return "error";
    case "idle": return "idle";
  }
}

/** How far the eyes may drift towards the pointer, in the drawing's own units (120 across). */
export const GAZE_LIMIT = { x: 4.5, y: 3.5 } as const;

/**
 * Where the eyes sit for a pointer `dx`,`dy` screen pixels from the mascot's centre.
 *
 * Only a pointer within `reach` pixels is followed: a mascot that stares at a cursor on the far
 * side of the window is unnerving, and one that never looks is furniture. The glance is at
 * full stretch once the pointer is a third of the way out, and eases back to centre over the
 * last quarter of the reach so the eyes do not snap when the pointer crosses the line.
 */
export function gazeOffset(dx: number, dy: number, reach: number, limit: { readonly x: number; readonly y: number } = GAZE_LIMIT): { x: number; y: number } {
  const distance = Math.hypot(dx, dy);
  if (!Number.isFinite(distance) || !(reach > 0) || distance === 0 || distance >= reach) return { x: 0, y: 0 };
  const pull = Math.min(1, distance / (reach * 0.35));
  const fade = Math.min(1, (reach - distance) / (reach * 0.25));
  const clamp = (value: number, most: number): number => Math.round(Math.max(-most, Math.min(most, value)) * 100) / 100 || 0;
  return {
    x: clamp((dx / distance) * limit.x * pull * fade, limit.x),
    y: clamp((dy / distance) * limit.y * pull * fade, limit.y),
  };
}

/** The pointer is followed from this far away: further for a big mascot than a small one. */
export function gazeReach(size: number): number {
  return Math.max(180, (Number.isFinite(size) ? size : 0) * 2.6);
}

/** Milliseconds until the next blink, for a random number in [0, 1): between 1.8 and 6 seconds. */
export function nextBlinkDelay(random: number): number {
  const unit = Number.isFinite(random) ? Math.max(0, Math.min(1, random)) : 0.5;
  return Math.round(1800 + unit * 4200);
}

/** About one blink in six is a double. */
export function isDoubleBlink(random: number): boolean {
  return random < 0.16;
}

/** Moods whose eyes are already shut or squeezed, where a blink would open them. */
const NO_BLINK: ReadonlySet<AdcodeMascotMood> = new Set(["sleeping", "celebrating", "success", "proud", "dancing", "poked"]);

export function moodBlinks(mood: AdcodeMascotMood): boolean {
  return !NO_BLINK.has(mood);
}

/** How long `play` shows a mood when the caller does not say: long enough for its loop to read once. */
const TRANSIENT_MS: Readonly<Partial<Record<AdcodeMascotMood, number>>> = {
  poked: 720,
  wink: 1300,
  surprised: 1400,
  success: 2000,
  greeting: 2800,
  celebrating: 3300,
  earning: 2800,
  dancing: 3600,
};

export function transientDuration(mood: AdcodeMascotMood): number {
  return TRANSIENT_MS[mood] ?? 2400;
}

/** Below this the mouth is a smudge, so the small mascot is eyes and hands only. */
export function isCompactSize(px: number): boolean {
  return Number.isFinite(px) && px > 0 && px < 44;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const LIGHT = "#f4f2ec";
const DARK = "#0a0a0b";

type Attrs = Readonly<Record<string, string | number>>;

function shape(tag: string, attrs: Attrs = {}, children: readonly SVGElement[] = []): SVGElement {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, String(value));
  element.append(...children);
  return element;
}

/** `part("eye eye-l")` is a group classed `adcode-mascot-eye adcode-mascot-eye-l`. */
const classes = (names: string): string => names.split(" ").map((name) => `adcode-mascot-${name}`).join(" ");
const part = (names: string, children: readonly SVGElement[] = []): SVGElement => shape("g", { class: classes(names) }, children);
const line = (names: string, d: string, attrs: Attrs = {}): SVGElement =>
  shape("path", { class: classes(names), d, fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round", ...attrs });

function stops(id: string, kind: "linearGradient" | "radialGradient", attrs: Attrs, list: readonly (readonly [string, string, string])[]): SVGElement {
  return shape(kind, { id, ...attrs }, list.map(([offset, color, opacity]) => shape("stop", { offset, "stop-color": color, "stop-opacity": opacity })));
}

/**
 * The coin: the logo's own dollar sign, path for path (`build/icon.svg`), scaled onto a gold
 * disc. Drawn at the centre of the body; the stylesheet carries it from there.
 */
function coin(names: string, fill: string): SVGElement {
  const dollar = shape("g", { transform: "translate(60 64) scale(0.0245) translate(-506 -512)", fill: "none", stroke: "#5b3604", "stroke-linecap": "round", "stroke-linejoin": "round" }, [
    shape("path", { d: "M512 296V388", "stroke-width": 64 }),
    shape("path", { d: "M512 636V728", "stroke-width": 64 }),
    shape("path", { d: "M584 405C563 374 531 356 494 356C446 356 413 383 413 423C413 463 444 484 505 500C569 517 606 541 606 590C606 641 565 671 511 671C466 671 429 651 405 619", "stroke-width": 92 }),
  ]);
  return part(names, [part("coin-x", [part("coin-y", [part("coin-face", [
    shape("circle", { cx: 60, cy: 64, r: 8.6, fill: `url(#${fill})`, stroke: "#a86a0a", "stroke-width": 1.2 }),
    shape("circle", { cx: 60, cy: 64, r: 6.3, fill: "none", stroke: "#fff", "stroke-opacity": 0.38, "stroke-width": 0.8 }),
    dollar,
    line("coin-shine", "M54.3 60.4A7 7 0 0 1 59.6 57.1", { stroke: "#fff", "stroke-opacity": 0.75, "stroke-width": 1.1 }),
  ])])])]);
}

/** One bracket: a dark edge so it shows on paper, a light face so it shows on charcoal. */
function arm(side: "l" | "r"): SVGElement {
  const d = side === "l" ? "M19.5 55L8.5 66L19.5 77" : "M100.5 55L111.5 66L100.5 77";
  const fold = side === "l" ? "M8.5 66L19.5 77" : "M111.5 66L100.5 77";
  return part(`arm arm-${side}`, [part("arm-pose", [
    line("arm-edge", d, { stroke: DARK, "stroke-width": 10.5 }),
    line("arm-light", d, { stroke: LIGHT, "stroke-width": 6 }),
    // The lower stroke sits a shade darker, like the fold in the logo's ribbon.
    line("arm-fold", fold, { stroke: "#000", "stroke-opacity": 0.13, "stroke-width": 6 }),
  ])]);
}

/** One eye, in every shape a mood can ask for. Only the one in use is opaque. */
function eye(side: "l" | "r", cx: number): SVGElement {
  const out = side === "l" ? -1 : 1;
  return part(`eye eye-${side}`, [
    shape("rect", { class: classes("eye-open"), x: cx - 5, y: 52.5, width: 10, height: 15, rx: 5, fill: LIGHT }),
    line("eye-happy", `M${cx - 5.5} 62.5Q${cx} 53 ${cx + 5.5} 62.5`, { stroke: LIGHT, "stroke-width": 3.4 }),
    line("eye-sleep", `M${cx - 5.5} 58.5Q${cx} 64.5 ${cx + 5.5} 58.5`, { stroke: LIGHT, "stroke-width": 3.2 }),
    // Squeezed shut, the eyes are the two brackets again.
    line("eye-squint", `M${cx + out * 4.5} 54.5L${cx - out * 4} 60L${cx + out * 4.5} 65.5`, { stroke: LIGHT, "stroke-width": 3.2 }),
  ]);
}

const CONFETTI: readonly (readonly ["bar" | "dot" | "chip", number, number, number, string])[] = [
  ["bar", -46, -8, -140, "a"],
  ["chip", -38, -20, 200, "b"],
  ["dot", -24, -26, 0, "c"],
  ["bar", -10, -27, 160, "d"],
  ["chip", 6, -25, -220, "e"],
  ["dot", 20, -27, 0, "a"],
  ["bar", 34, -22, 260, "c"],
  ["chip", 45, -10, -180, "b"],
  ["dot", -52, 6, 0, "d"],
  ["bar", 52, 8, 120, "e"],
];

function confetti(): SVGElement {
  return part("confetti", CONFETTI.map(([kind, dx, dy, turn, tint]) => {
    const piece = kind === "bar" ? shape("rect", { x: 57.4, y: 28.6, width: 5.2, height: 2.8, rx: 0.8 })
      : kind === "dot" ? shape("circle", { cx: 60, cy: 30, r: 1.9 })
      : shape("path", { d: "M60 27.4l2.5 4.4h-5z" });
    piece.setAttribute("class", classes(`confetti-piece confetti-${tint}`));
    piece.setAttribute("style", `--dx:${dx.toString()}px;--dy:${dy.toString()}px;--turn:${turn.toString()}deg`);
    return piece;
  }));
}

/** Gradient ids are document-wide, and a page can show several mascots at once. */
let mascotSeq = 0;

function draw(): SVGSVGElement {
  mascotSeq += 1;
  const id = (name: string): string => `adcode-mascot-${name}-${mascotSeq.toString()}`;
  const plate = { x: 27, y: 29, width: 66, height: 66, rx: 16 };

  const defs = shape("defs", {}, [
    // Lit from the upper left: the plate is charcoal there and true black at the far corner.
    stops(id("plate"), "linearGradient", { x1: 0, y1: 0, x2: 1, y2: 1 }, [["0", "#3a3a41", "1"], ["0.48", "#18181b", "1"], ["1", "#060607", "1"]]),
    // The rim light is what keeps a near-black body visible on a near-black window.
    stops(id("rim"), "linearGradient", { x1: 0, y1: 0, x2: 0.85, y2: 1 }, [["0", "#ffffff", "0.9"], ["0.45", "#ffffff", "0.34"], ["1", "#ffffff", "0.16"]]),
    stops(id("gloss"), "radialGradient", { cx: 0.28, cy: 0.18, r: 0.62 }, [["0", "#ffffff", "0.26"], ["1", "#ffffff", "0"]]),
    stops(id("coin"), "linearGradient", { x1: 0.2, y1: 0, x2: 0.8, y2: 1 }, [["0", "#ffe48f", "1"], ["0.55", "#f3b73d", "1"], ["1", "#d48a0c", "1"]]),
  ]);

  const face = part("face", [
    shape("ellipse", { class: classes("cheek"), cx: 38.5, cy: 71, rx: 4.6, ry: 2.8 }),
    shape("ellipse", { class: classes("cheek"), cx: 81.5, cy: 71, rx: 4.6, ry: 2.8 }),
    part("look", [part("gaze-move", [part("gaze", [
      line("brow", "M40.5 49.5L51.5 46", { stroke: LIGHT, "stroke-width": 2.6 }),
      line("brow", "M79.5 49.5L68.5 46", { stroke: LIGHT, "stroke-width": 2.6 }),
      eye("l", 47),
      eye("r", 73),
    ])])]),
    line("mouth mouth-smile", "M55.5 73.5Q60 78 64.5 73.5", { stroke: LIGHT, "stroke-width": 2.6 }),
    shape("path", { class: classes("mouth mouth-grin"), d: "M53.5 72.5H66.5Q66.5 80.5 60 80.5Q53.5 80.5 53.5 72.5Z", fill: LIGHT }),
    shape("ellipse", { class: classes("mouth mouth-o"), cx: 60, cy: 76.2, rx: 3.2, ry: 3.8, fill: LIGHT }),
    line("mouth mouth-wavy", "M54 76Q57 73 60 76T66 76", { stroke: LIGHT, "stroke-width": 2.4 }),
    line("mouth mouth-flat", "M56 75.5H64", { stroke: LIGHT, "stroke-width": 2.6 }),
    shape("path", { class: classes("sweat"), d: "M83 36.5C85 39.5 86 41 86 42.6A3 3 0 0 1 80 42.6C80 41 81 39.5 83 36.5Z" }),
  ]);

  const body = part("body", [
    // A second plate a little lower gives the first one an edge, so it reads as a tile with thickness.
    shape("rect", { ...plate, y: plate.y + 4, fill: "#020202", stroke: "#fff", "stroke-opacity": 0.16, "stroke-width": 1 }),
    shape("rect", { ...plate, fill: `url(#${id("plate")})` }),
    shape("rect", { ...plate, fill: `url(#${id("gloss")})` }),
    line("highlight", "M34.5 49V44.5Q34.5 36.5 42.5 36.5H55", { stroke: "#fff", "stroke-opacity": 0.2, "stroke-width": 2.6 }),
    shape("rect", { x: 27.7, y: 29.7, width: 64.6, height: 64.6, rx: 15.3, fill: "none", stroke: `url(#${id("rim")})`, "stroke-width": 1.4 }),
    face,
  ]);

  // Set below the plate rather than against it, so the typing hands rest on the keys and not
  // across the bottom of the face.
  const keys = part("keys", [
    shape("rect", { x: 31, y: 101, width: 58, height: 7, rx: 3.2, fill: "#101012", stroke: "#fff", "stroke-opacity": 0.32, "stroke-width": 1 }),
    ...[0, 1, 2, 3, 4, 5].map((index) => shape("rect", { x: 35.9 + index * 8.4, y: 103.4, width: 5.4, height: 2.2, rx: 1, fill: LIGHT, "fill-opacity": 0.6 })),
  ]);

  const figure = part("figure", [part("figure-pose", [
    // Nothing is painted here. It pins the group's box to the ground line, so a raised hand or
    // a coin in flight cannot move the point the whole figure leans and hops about.
    shape("rect", { class: classes("anchor"), x: -40, y: -46, width: 200, height: 150, fill: "none" }),
    coin("coin coin-back", id("coin")),
    body,
    keys,
    arm("l"),
    arm("r"),
    coin("coin coin-front", id("coin")),
  ])]);

  const effects = part("fx", [
    part("dots", [
      shape("circle", { class: classes("ink-fill dot"), cx: 89, cy: 27, r: 2.1 }),
      shape("circle", { class: classes("ink-fill dot"), cx: 97, cy: 19.5, r: 2.9 }),
      shape("circle", { class: classes("ink-fill dot"), cx: 107, cy: 11, r: 3.8 }),
    ]),
    part("zs", [
      line("ink z", "M86 22h5l-5 6h5", { "stroke-width": 2 }),
      line("ink z", "M94.5 11.5h6.5l-6.5 7.5h6.5", { "stroke-width": 2.3 }),
      line("ink z", "M104.5 1.5h8l-8 9h8", { "stroke-width": 2.6 }),
    ]),
    part("check", [
      shape("circle", { class: classes("check-disc"), cx: 97, cy: 27, r: 9.5 }),
      line("check-mark", "M92.3 27.2l3.3 3.4l6.3-6.9", { stroke: "#fff", "stroke-width": 2.6, pathLength: 1 }),
    ]),
    confetti(),
    part("marks", [
      line("ink", "M60 19V10", { "stroke-width": 2.6 }),
      line("ink", "M46 21.5L41.5 14", { "stroke-width": 2.6 }),
      line("ink", "M74 21.5L78.5 14", { "stroke-width": 2.6 }),
    ]),
    part("glint", [
      line("ink", "M97.5 33.5l3.5-5.5", { "stroke-width": 2.4 }),
      line("ink", "M100.5 40l6.5-2", { "stroke-width": 2.4 }),
      line("ink", "M93 28.5l.5-6", { "stroke-width": 2.4 }),
    ]),
    part("waves", [
      line("ink wave", "M113.5 42Q117.5 50 113.5 58", { "stroke-width": 2.2 }),
      line("ink wave", "M117.5 39Q122.5 50 117.5 61", { "stroke-width": 2.2 }),
    ]),
    // Around the diamond the two hands make overhead when connecting.
    shape("circle", { class: classes("ink ring"), cx: 60, cy: 16, r: 14, fill: "none", "stroke-width": 1.8 }),
    line("plus", "M108 22.5v9M103.5 27h9", { "stroke-width": 2.6 }),
  ]);

  return shape("svg", { class: "adcode-mascot-svg", viewBox: "0 0 120 120", "aria-hidden": "true", focusable: "false" }, [
    defs,
    shape("ellipse", { class: classes("shadow"), cx: 60, cy: 107, rx: 28, ry: 4.2 }),
    figure,
    effects,
  ]) as SVGSVGElement;
}

export function createAdcodeMascot(options: AdcodeMascotOptions = {}): AdcodeMascot {
  const interactive = options.interactive === true;
  const element = document.createElement(interactive ? "button" : "span");
  element.className = "adcode-mascot";
  if (element instanceof HTMLButtonElement) {
    element.type = "button";
    element.setAttribute("aria-label", options.label ?? `${ADCODE_MASCOT_NAME}, the ADCode mascot. Activate for a reaction.`);
  } else {
    // Decoration: whatever it is reacting to is already said in words beside it.
    element.setAttribute("aria-hidden", "true");
  }
  // Each mascot floats and blinks on its own clock, so two on one page never move in step.
  element.style.setProperty("--mascot-phase", `-${(Math.random() * 4).toFixed(2)}s`);
  element.append(draw());

  let mood: AdcodeMascotMood = options.mood ?? "idle";
  let size = options.size ?? 0;
  let destroyed = false;
  let visible = false;
  let running = false;
  let blinkTimer: number | null = null;
  let lidTimer: number | null = null;
  let secondBlinkTimer: number | null = null;
  let transientTimer: number | null = null;
  let frame: number | null = null;
  let pointer: { x: number; y: number } | null = null;

  const still = (): boolean => {
    try {
      const root = document.documentElement;
      // A low-end machine keeps the poses and drops the loops, the same as Reduce motion.
      return root.dataset["reducedMotion"] === "true" || root.dataset["perf"] === "lite" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      return false;
    }
  };

  function show(next: AdcodeMascotMood, restart: boolean): void {
    if (restart && element.dataset["mood"] === next) {
      // The same mood again: clear it and read layout, or its animation would not start over.
      delete element.dataset["mood"];
      void element.offsetWidth;
    }
    element.dataset["mood"] = next;
  }

  function clear(timer: number | null): null {
    if (timer !== null) window.clearTimeout(timer);
    return null;
  }

  function blink(): void {
    const shown = element.dataset["mood"];
    if (destroyed || !running || !isAdcodeMascotMood(shown) || !moodBlinks(shown)) return;
    element.classList.add("is-blinking");
    lidTimer = clear(lidTimer);
    lidTimer = window.setTimeout(() => { element.classList.remove("is-blinking"); lidTimer = null; }, 130);
  }

  function scheduleBlink(): void {
    blinkTimer = clear(blinkTimer);
    if (!running) return;
    blinkTimer = window.setTimeout(() => {
      blink();
      if (isDoubleBlink(Math.random())) secondBlinkTimer = window.setTimeout(() => { secondBlinkTimer = null; blink(); }, 300);
      scheduleBlink();
    }, nextBlinkDelay(Math.random()));
  }

  function lookAt(): void {
    frame = null;
    if (destroyed || !running || pointer === null) return;
    const box = element.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return;
    const offset = gazeOffset(pointer.x - (box.left + box.width / 2), pointer.y - (box.top + box.height / 2), gazeReach(box.width));
    element.style.setProperty("--mascot-gaze-x", `${offset.x.toString()}px`);
    element.style.setProperty("--mascot-gaze-y", `${offset.y.toString()}px`);
  }

  function onPointerMove(event: PointerEvent): void {
    pointer = { x: event.clientX, y: event.clientY };
    // One measurement a frame, however many pointer events arrive in it.
    if (frame === null) frame = window.requestAnimationFrame(lookAt);
  }

  /** Start or stop everything that costs something, to match whether anybody can see it. */
  function sync(): void {
    const wanted = !destroyed && visible && !document.hidden;
    const quiet = still();
    if (quiet) element.dataset["still"] = "true"; else delete element.dataset["still"];
    if (wanted) delete element.dataset["paused"]; else element.dataset["paused"] = "true";
    const next = wanted && !quiet;
    if (next === running) return;
    running = next;
    if (running) {
      window.addEventListener("pointermove", onPointerMove, { passive: true });
      scheduleBlink();
      return;
    }
    window.removeEventListener("pointermove", onPointerMove);
    blinkTimer = clear(blinkTimer);
    lidTimer = clear(lidTimer);
    secondBlinkTimer = clear(secondBlinkTimer);
    if (frame !== null) { window.cancelAnimationFrame(frame); frame = null; }
    pointer = null;
    element.classList.remove("is-blinking");
    element.style.removeProperty("--mascot-gaze-x");
    element.style.removeProperty("--mascot-gaze-y");
  }

  function setCompact(px: number): void {
    if (isCompactSize(px)) element.dataset["compact"] = "true"; else delete element.dataset["compact"];
  }

  function setSize(px: number): void {
    if (!Number.isFinite(px) || px <= 0) return;
    size = px;
    element.style.setProperty("--mascot-size", `${px.toString()}px`);
    setCompact(px);
  }

  function setMood(next: AdcodeMascotMood): void {
    if (destroyed) return;
    mood = next;
    // A new standing mood outranks whatever was playing: the surface knows something changed.
    transientTimer = clear(transientTimer);
    if (element.dataset["mood"] !== next) show(next, false);
  }

  function play(next: AdcodeMascotMood, ms?: number): void {
    if (destroyed) return;
    transientTimer = clear(transientTimer);
    show(next, true);
    transientTimer = window.setTimeout(() => {
      transientTimer = null;
      show(mood, false);
    }, ms !== undefined && Number.isFinite(ms) && ms > 0 ? ms : transientDuration(next));
  }

  const onClick = (): void => play("poked");
  const onVisibility = (): void => sync();
  if (interactive) element.addEventListener("click", onClick);
  document.addEventListener("visibilitychange", onVisibility);

  // Off screen, in a closed dialog or in a hidden tab, nothing blinks and nothing is measured.
  const seen = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver((entries) => {
    visible = entries[entries.length - 1]?.isIntersecting === true;
    sync();
  });
  // The stylesheet can size the mascot too, so the drawing is told how big it really is.
  const sized = typeof ResizeObserver === "undefined" ? null : new ResizeObserver((entries) => {
    const width = entries[entries.length - 1]?.contentRect.width ?? 0;
    if (width > 0) setCompact(width);
  });
  if (seen === null) visible = true; else seen.observe(element);
  sized?.observe(element);
  // Reduce motion can be switched while the mascot is on screen, in ADCode or in the system.
  const switched = typeof MutationObserver === "undefined" ? null : new MutationObserver(() => sync());
  switched?.observe(document.documentElement, { attributes: true, attributeFilter: ["data-reduced-motion", "data-perf"] });
  let systemMotion: MediaQueryList | null = null;
  try { systemMotion = window.matchMedia("(prefers-reduced-motion: reduce)"); } catch { /* No media queries here: the attribute is the only switch. */ }
  systemMotion?.addEventListener("change", onVisibility);

  show(mood, false);
  if (size > 0) setSize(size);
  sync();

  return {
    element,
    setMood,
    play,
    setSize,
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      transientTimer = clear(transientTimer);
      seen?.disconnect();
      sized?.disconnect();
      switched?.disconnect();
      systemMotion?.removeEventListener("change", onVisibility);
      document.removeEventListener("visibilitychange", onVisibility);
      element.removeEventListener("click", onClick);
      sync();
      element.remove();
    },
  };
}
