/**
 * ADCode chat mascot — a friendly blue blob that replaces the three dots.
 *
 * Built on bloub's neutral avatar (https://bloub.vercel.app): a round body
 * with two light pill eyes punched through a mask, so the face reads as
 * calm rather than staring. No dark pupils, no gloss — the scary version
 * taught us that less is friendlier at 28px.
 *
 * Presentation only: no Electron, no IPC, no storage, no network. The activity
 * block owns the backend events and tells the mascot its mood; this module owns
 * the DOM shape, the eye tracking, blinking, and poke behaviour so all of it is
 * testable from the markup it produces.
 *
 * Visual contract (see `styles/ai.css`, section "Chat mascot"):
 * - A blue disc with two light pill eyes (bloub neutral, symmetrized).
 *   The eye group drifts toward the pointer (transform only, SVG user units).
 * - Moods via `data-mood`: idle (slow breathe), thinking (breathe),
 *   working (bounce), streaming (wiggle), done (settled), error (shake).
 *   Timings follow bloub's clips (idle 2.4s, thinking 2.6s, morphs ~0.45s
 *   on a quint-ish ease).
 * - Blinking like bloub: lids squash ~180ms every 2–4.5s, 18% double-blink,
 *   plus a forced blink whenever the mood changes.
 * - Interactive: click/tap squishes and pops a rotating playful quip so a
 *   long run never feels dead. Keyboard works too.
 * - Reduced motion: stillness. No tracking, no breathe, no quip pop animation.
 */

export type MascotMood = "idle" | "thinking" | "working" | "streaming" | "done" | "error";

export interface MascotHandle {
  readonly element: HTMLElement;
  setMood(mood: MascotMood): void;
  /** Playful squish + quip, as if poked. Returns the quip shown. */
  poke(): string;
  destroy(): void;
}

/**
 * Rotating quips so a long turn never reads as hung. Kept short, kind, and
 * work-flavoured — the mascot is boredom relief, not a second assistant.
 */
export const MASCOT_QUIPS: readonly string[] = [
  "Digging through files…",
  "Hmm, interesting…",
  "Connecting the dots…",
  "Almost there…",
  "Reading the fine print…",
  "Poking the code gently…",
  "Thinking hard…",
  "Boop! Still here.",
  "I live for this stuff.",
  "Squish me again!",
];

export function pickMascotQuip(seenCount: number): string {
  if (MASCOT_QUIPS.length === 0) return "";
  const index = ((seenCount % MASCOT_QUIPS.length) + MASCOT_QUIPS.length) % MASCOT_QUIPS.length;
  return MASCOT_QUIPS[index] ?? "";
}

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Bloub's neutral avatar geometry, symmetrized for a calm face. The export
 * this came from had caught a sideways glance (both eyes right of centre),
 * so neutral here is mirrored: two tilted pills at ±27, −44.
 */
const BLOUB_VIEWBOX = "-125 -125 250 250";
const BLOUB_BODY_R = 100;
/** Rounded-pill eye centred on the origin — bloub's own path. */
const BLOUB_EYE_PILL =
  "M-9.3 -11.3A9.3 9.3 0 0 1 0 -20.6L0 -20.6A9.3 9.3 0 0 1 9.3 -11.3L9.3 11.3A9.3 9.3 0 0 1 0 20.6L0 20.6A9.3 9.3 0 0 1 -9.3 11.3Z";
const BLOUB_EYE_PLACEMENTS = [
  "translate(-27,-44) rotate(8) scale(1.12)",
  "translate(27,-44) rotate(-8) scale(1.12)",
];

let mascotMaskSeq = 0;

function buildMascotSvg(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", BLOUB_VIEWBOX);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "chat-mascot-svg");
  // Unique mask ids: several mascots can share the transcript.
  mascotMaskSeq += 1;
  const maskId = `chat-mascot-mask-${mascotMaskSeq}`;

  const defs = document.createElementNS(SVG_NS, "defs");
  const mask = document.createElementNS(SVG_NS, "mask");
  mask.setAttribute("id", maskId);
  mask.setAttribute("maskUnits", "userSpaceOnUse");
  mask.setAttribute("x", "-125");
  mask.setAttribute("y", "-125");
  mask.setAttribute("width", "250");
  mask.setAttribute("height", "250");

  const maskBody = document.createElementNS(SVG_NS, "circle");
  maskBody.setAttribute("cx", "0");
  maskBody.setAttribute("cy", "0");
  maskBody.setAttribute("r", String(BLOUB_BODY_R));
  maskBody.setAttribute("fill", "#fff");
  mask.append(maskBody);

  // The eyes are holes punched out of the mask, so they read as the face
  // colour showing through — no staring pupils. The outer group drifts with
  // the pointer; the inner group squashes for blinks. Split, because one CSS
  // `transform` cannot do both at once.
  const look = document.createElementNS(SVG_NS, "g");
  look.setAttribute("class", "chat-mascot-look");
  const eyes = document.createElementNS(SVG_NS, "g");
  eyes.setAttribute("class", "chat-mascot-eyes");
  eyes.setAttribute("fill", "#000");
  for (const placement of BLOUB_EYE_PLACEMENTS) {
    const eye = document.createElementNS(SVG_NS, "path");
    eye.setAttribute("d", BLOUB_EYE_PILL);
    eye.setAttribute("transform", placement);
    eyes.append(eye);
  }
  look.append(eyes);
  mask.append(look);
  defs.append(mask);
  svg.append(defs);

  // Face colour, visible only through the eye holes.
  const base = document.createElementNS(SVG_NS, "circle");
  base.setAttribute("cx", "0");
  base.setAttribute("cy", "0");
  base.setAttribute("r", String(BLOUB_BODY_R));
  base.setAttribute("class", "chat-mascot-base");
  svg.append(base);

  // Blue body with the face punched out of it.
  const bodied = document.createElementNS(SVG_NS, "g");
  bodied.setAttribute("mask", `url(#${maskId})`);
  const body = document.createElementNS(SVG_NS, "rect");
  body.setAttribute("x", "-125");
  body.setAttribute("y", "-125");
  body.setAttribute("width", "250");
  body.setAttribute("height", "250");
  body.setAttribute("class", "chat-mascot-body");
  bodied.append(body);
  svg.append(bodied);

  return svg;
}

export function createMascot(options?: {
  readonly mood?: MascotMood;
  readonly label?: string;
}): MascotHandle {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "chat-mascot";
  element.dataset["mood"] = options?.mood ?? "thinking";
  element.setAttribute("aria-label", options?.label ?? "Assistant mascot — working. Activate for a morale boost.");
  element.title = "Poke the mascot";

  const svg = buildMascotSvg();
  element.append(svg);

  const bubble = document.createElement("span");
  bubble.className = "chat-mascot-bubble";
  bubble.setAttribute("aria-hidden", "true");
  bubble.hidden = true;
  element.append(bubble);

  let destroyed = false;
  let pokeCount = 0;
  let bubbleTimer: number | null = null;
  let blinkTimer: number | null = null;

  const reducedMotion = (): boolean => {
    try {
      if (document.documentElement.dataset["reducedMotion"] === "true") return true;
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      return false;
    }
  };

  function showQuip(text: string): void {
    if (destroyed || text.length === 0) return;
    bubble.textContent = text;
    bubble.hidden = false;
    element.dataset["quipping"] = "true";
    if (bubbleTimer !== null) window.clearTimeout(bubbleTimer);
    bubbleTimer = window.setTimeout(() => {
      bubble.hidden = true;
      delete element.dataset["quipping"];
      bubbleTimer = null;
    }, 2200);
  }

  /** Bloub's blinkIn: a forced blink whenever the face changes state. */
  function blinkNow(): void {
    if (destroyed || reducedMotion()) return;
    element.classList.add("is-blinking");
    window.setTimeout(() => element.classList.remove("is-blinking"), 180);
  }

  function poke(): string {
    if (destroyed) return "";
    pokeCount += 1;
    const quip = pickMascotQuip(pokeCount - 1 + Math.floor(Math.random() * 2));
    // Squish: re-trigger the CSS animation by re-adding the class.
    element.classList.remove("is-poked");
    // Force reflow so a rapid double-poke replays the squish.
    void element.offsetWidth;
    element.classList.add("is-poked");
    window.setTimeout(() => element.classList.remove("is-poked"), 450);
    blinkNow();
    showQuip(quip);
    return quip;
  }

  function onPointerMove(event: PointerEvent): void {
    if (destroyed || reducedMotion()) return;
    try {
      const box = element.getBoundingClientRect();
      if (box.width === 0 && box.height === 0) return;
      const cx = box.left + box.width / 2;
      const cy = box.top + box.height / 2;
      const dx = event.clientX - cx;
      const dy = event.clientY - cy;
      const distance = Math.hypot(dx, dy) || 1;
      // Eyes drift at most ~14 SVG units toward the pointer — about 1.5px on
      // screen, a glance, not a stare. (CSS px on SVG children resolve as
      // user units, so this range is in viewBox units, not screen pixels.)
      const range = 14;
      const mx = (dx / distance) * Math.min(1, distance / 220) * range;
      const my = (dy / distance) * Math.min(1, distance / 220) * range;
      element.style.setProperty("--mx", `${mx.toFixed(2)}px`);
      element.style.setProperty("--my", `${my.toFixed(2)}px`);
    } catch {
      // Tracking is decoration; never break the chat.
    }
  }

  function scheduleBlink(): void {
    if (blinkTimer !== null) window.clearTimeout(blinkTimer);
    // Bloub's ambient rhythm: every ~2–4.5s, with an 18% double-blink.
    const next = 2000 + Math.random() * 2500;
    blinkTimer = window.setTimeout(() => {
      if (destroyed || reducedMotion()) {
        scheduleBlink();
        return;
      }
      blinkNow();
      if (Math.random() < 0.18) {
        window.setTimeout(() => blinkNow(), 420);
      }
      scheduleBlink();
    }, next);
  }

  element.addEventListener("click", () => poke());
  element.addEventListener("mouseenter", () => {
    if (destroyed || reducedMotion()) return;
    // Hover earns a glance, not a quip — quips are for pokes and long runs.
    element.dataset["hover"] = "true";
  });
  element.addEventListener("mouseleave", () => {
    delete element.dataset["hover"];
  });
  window.addEventListener("pointermove", onPointerMove, { passive: true });
  scheduleBlink();

  return {
    element,
    setMood(mood: MascotMood): void {
      const changed = element.dataset["mood"] !== mood;
      element.dataset["mood"] = mood;
      element.setAttribute(
        "aria-label",
        mood === "done"
          ? "Assistant mascot — done. Activate for a morale boost."
          : mood === "error"
            ? "Assistant mascot — something went wrong. Activate for a morale boost."
            : "Assistant mascot — working. Activate for a morale boost.",
      );
      // A new state earns a blink, like bloub's blinkIn clips.
      if (changed) blinkNow();
    },
    poke,
    destroy(): void {
      destroyed = true;
      window.removeEventListener("pointermove", onPointerMove);
      if (bubbleTimer !== null) window.clearTimeout(bubbleTimer);
      if (blinkTimer !== null) window.clearTimeout(blinkTimer);
      element.remove();
    },
  };
}
