/**
 * The film's optics, as pure functions of `t` and a seed: a still at `t` and that frame of
 * the video are identical.
 *
 *   SIZE                 the frame for this render: wide (1920 × 1080) or square (1080 × 1080)
 *   noise1(x, seed)      smooth value noise in [-1, 1]
 *   drift(t, amount)     a slow handheld offset
 *   decode(text, p, t)   text resolving out of code glyphs as p goes 0 → 1
 *   wordSpans/letterSpans  split copy for staggered reveals
 */
import { h, lerp } from "./shared/engine.js";
import { FORMATS } from "./cues.js";

const params = new URLSearchParams(globalThis.location?.search ?? "");
export const FORMAT = params.get("format") === "square" ? "square" : "wide";
export const SIZE = FORMATS[FORMAT];
export const SQUARE = FORMAT === "square";

function hash(i, seed) {
  let x = Math.imul(i ^ (seed * 0x9e3779b1), 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/** Smooth 1D value noise in [-1, 1]. */
export function noise1(x, seed = 1) {
  const i = Math.floor(x);
  const f = x - i;
  const s = f * f * (3 - 2 * f);
  return lerp(hash(i, seed), hash(i + 1, seed), s) * 2 - 1;
}

/** A slow handheld drift; `amount` = 1 is a few pixels and a fraction of a degree. */
export function drift(t, amount = 1, seed = 7) {
  const o = (k, f) => noise1(t * f, seed + k) + 0.5 * noise1(t * f * 2.3, seed + k + 50);
  return { x: o(1, 0.9) * 6 * amount, y: o(2, 1.1) * 4 * amount, r: o(3, 0.7) * 0.25 * amount };
}

const GLYPHS = "{}<>$;/=*[]()#&%+_";

/** `text` resolving out of code glyphs; spaces stay spaces; `t` drives the flicker. */
export function decode(text, p, t, seed = 3) {
  const flicker = Math.floor(t * 30);
  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === " ") { out += " "; continue; }
    const at = (i / Math.max(1, text.length - 1)) * 0.7 + hash(i, seed) * 0.25;
    if (p >= at) out += char;
    else if (p >= at - 0.3) out += GLYPHS[Math.floor(hash(i * 131 + flicker, seed) * GLYPHS.length)];
    else out += " ";
  }
  return out;
}

/** Split a string into word spans (for staggered reveals). */
export function wordSpans(text, className = "word") {
  return text.split(" ").flatMap((word, i) => [i === 0 ? null : " ", h("span", { class: className, text: word })]).filter(Boolean);
}

/** Split a string into letter spans. */
export function letterSpans(text, className = "letter") {
  return [...text].map((char) => h("span", { class: className, text: char === " " ? " " : char }));
}

/** Ease in with a pull back first - the engine's `ease` has only the out form. */
export const inBack = (p) => 2.70158 * p ** 3 - 1.70158 * p ** 2;

/** A two-digit, zero-padded timecode like the reference's HUD: T+00:07.42. */
export function timecode(t) {
  const whole = Math.floor(t);
  const hundredths = Math.floor((t - whole) * 100);
  return `T+00:${String(whole).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}`;
}
