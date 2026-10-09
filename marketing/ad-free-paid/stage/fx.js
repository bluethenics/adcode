/**
 * The film's optics and camera. Everything is a pure function of `t` and a seed, like the
 * engine it builds on, so a still and the same frame of the video are identical.
 *
 *   view(cam)            the CSS transform that films a 3D world through a camera
 *   noise1(x, seed)      smooth value noise in [-1, 1], for handheld drift and smoke
 *   shake(t, amount)     a handheld camera offset
 *   decode(text, p, t)   text resolving out of code glyphs as p goes 0 → 1
 *   Streak               a directional blur whose length follows the camera's speed
 *   Dust                 out-of-focus motes of light on a canvas, with parallax
 */
import { clamp, h, lerp, rng } from "./shared/engine.js";
import { H, W } from "./cues.js";

/** Perspective distance of every 3D viewport: a moderate lens. */
export const LENS = 1600;

/**
 * A camera looking at world point (x, y, z) from `d` pixels away, pitched `rx`, yawed `ry`
 * and rolled `rz` degrees. At d = LENS a plane at the target is drawn at scale 1. The world
 * element sits at the viewport's centre with transform-origin 0 0.
 */
export function view({ x = 0, y = 0, z = 0, d = LENS, rx = 0, ry = 0, rz = 0 }) {
  const n = (v, k = 2) => Number(v.toFixed(k));
  return `translateZ(${n(LENS - d)}px) rotateZ(${n(-rz, 3)}deg) rotateX(${n(rx, 3)}deg) rotateY(${n(-ry, 3)}deg) translate3d(${n(-x)}px, ${n(-y)}px, ${n(-z)}px)`;
}

/** Blend two camera states. Distance blends in log space so a dolly feels even. */
export function mixCam(a, b, p) {
  const out = {};
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const from = a[key] ?? (key === "d" ? LENS : 0);
    const to = b[key] ?? (key === "d" ? LENS : 0);
    out[key] = key === "d" ? Math.exp(lerp(Math.log(from), Math.log(to), p)) : lerp(from, to, p);
  }
  return out;
}

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

/** Handheld: a few octaves of drift, `amount` = 1 is a nervous hand. */
export function shake(t, amount, seed = 7) {
  const o = (k, f) => noise1(t * f, seed + k) + 0.5 * noise1(t * f * 2.3, seed + k + 50);
  return { x: o(1, 1.7) * 14 * amount, y: o(2, 1.9) * 10 * amount, rz: o(3, 1.3) * 0.6 * amount, rx: o(4, 1.1) * 0.8 * amount, ry: o(5, 1.2) * 0.8 * amount };
}

const GLYPHS = "{}<>$;/=*[]()#&%+_";

/**
 * `text` resolving out of code glyphs. Each character has its own moment, spread over the
 * first 70% of p with a little seeded jitter; just before it, a flickering glyph stands in.
 * Spaces are always spaces. `t` makes the glyphs flicker at 30 changes a second.
 */
export function decode(text, p, t, seed = 3) {
  const flicker = Math.floor(t * 30);
  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === " ") { out += " "; continue; }
    const at = (i / Math.max(1, text.length - 1)) * 0.7 + hash(i, seed) * 0.25;
    if (p >= at) out += char;
    else if (p >= at - 0.3) out += GLYPHS[Math.floor(hash(i * 131 + flicker, seed) * GLYPHS.length)];
    else out += " ";
  }
  return out;
}

/**
 * A directional blur for whips: an SVG filter the world's wrapper points at. `set(px, axis)`
 * turns it off below a pixel, so still frames never pay for it.
 */
export class Streak {
  constructor(id) {
    this.id = id;
    this.blur = h("feGaussianBlur", { stdDeviation: "0 0", edgeMode: "none" });
    this.svg = h("svg", { width: 0, height: 0, style: { position: "absolute" } },
      h("defs", {}, h("filter", { id, x: "-10%", y: "-10%", width: "120%", height: "120%", "color-interpolation-filters": "sRGB" }, this.blur)));
  }
  /** Returns the CSS filter value for a smear of `px` along x and `py` along y. */
  set(px, py = 0) {
    const [sx, sy] = [Math.abs(px), Math.abs(py)];
    if (sx < 1 && sy < 1) return "none";
    this.blur.setAttribute("stdDeviation", `${sx.toFixed(1)} ${sy.toFixed(1)}`);
    return `url(#${this.id})`;
  }
}

/** Camera speed in px/s on screen at time t, from a camera function, for the streak. */
export function camSpeed(camAt, t, scale = 1) {
  const dt = 1 / 240;
  const [a, b] = [camAt(t - dt), camAt(t + dt)];
  const za = LENS / a.d;
  const zb = LENS / b.d;
  return {
    x: ((b.x * zb - a.x * za) / (2 * dt) + ((b.ry - a.ry) / (2 * dt)) * 18) * scale,
    y: ((b.y * zb - a.y * za) / (2 * dt) - ((b.rx - a.rx) / (2 * dt)) * 18) * scale,
    z: Math.log(a.d / b.d) / (2 * dt),
  };
}

/**
 * Motes of light drifting in a shaft, drawn on a canvas. Each has a depth; the further it is
 * from the focus depth, the larger and fainter its disc - bokeh. `pan` shifts them by
 * depth for parallax as the camera moves.
 */
export class Dust {
  constructor(root, count = 150, seed = 11) {
    this.canvas = h("canvas", { width: W, height: H, class: "dust" });
    root.append(this.canvas);
    this.ctx = this.canvas.getContext("2d");
    const random = rng(seed);
    this.motes = Array.from({ length: count }, () => ({
      x: random() * W, y: random() * H, depth: 0.25 + random() * 2.2,
      vx: (random() - 0.5) * 14, vy: -4 - random() * 10, phase: random() * 10, bright: 0.4 + random() * 0.6,
    }));
  }
  draw(t, { focus = 1, pan = { x: 0, y: 0 }, alpha = 1, zoom = 1 } = {}) {
    const { ctx } = this;
    ctx.clearRect(0, 0, W, H);
    if (alpha <= 0.001) return;
    ctx.globalCompositeOperation = "lighter";
    for (const mote of this.motes) {
      const px = (((mote.x + mote.vx * t - pan.x * mote.depth) % W) + W) % W;
      const py = (((mote.y + mote.vy * t - pan.y * mote.depth + noise1(t * 0.4 + mote.phase, 5) * 20) % H) + H) % H;
      const cx = W / 2 + (px - W / 2) * zoom ** mote.depth;
      const cy = H / 2 + (py - H / 2) * zoom ** mote.depth;
      const defocus = Math.abs(mote.depth - focus);
      const radius = 1.2 + defocus * 9 * mote.depth;
      const a = alpha * mote.bright * clamp(0.9 / (1 + defocus * 3.2)) * (0.6 + 0.4 * noise1(t * 1.3 + mote.phase, 9));
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      g.addColorStop(0, `rgba(255,255,255,${a.toFixed(3)})`);
      g.addColorStop(defocus > 0.4 ? 0.7 : 0.35, `rgba(255,255,255,${(a * 0.55).toFixed(3)})`);
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
    }
    ctx.globalCompositeOperation = "source-over";
  }
}

/** Split a string into word spans (for staggered reveals). */
export function wordSpans(text, className = "word") {
  return text.split(" ").flatMap((word, i) => [i === 0 ? null : " ", h("span", { class: className, text: word })]).filter(Boolean);
}

/** Split a string into letter spans. */
export function letterSpans(text, className = "letter") {
  return [...text].map((char) => h("span", { class: className, text: char === " " ? " " : char }));
}

/** Ease in with a pull back first - the engine's `ease` has only the out form. */
export const inBack = (p) => 2.70158 * p ** 3 - 1.70158 * p ** 2;
