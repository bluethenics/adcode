/**
 * The frame engine. Every frame is a pure function of `t` (seconds): scenes set styles
 * directly from `t`, nothing uses CSS transitions or animations, and randomness is seeded.
 * That is what makes a render repeatable, and a still at `t` identical to that frame of
 * the video.
 */

export const clamp = (value, low = 0, high = 1) => Math.min(high, Math.max(low, value));
export const lerp = (from, to, progress) => from + (to - from) * progress;
/** Progress of `t` through [a, b], clamped to 0..1. */
export const seg = (t, a, b) => clamp((t - a) / (b - a));

export const ease = {
  linear: (p) => p,
  inCubic: (p) => p ** 3,
  outCubic: (p) => 1 - (1 - p) ** 3,
  inOutCubic: (p) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2),
  outQuint: (p) => 1 - (1 - p) ** 5,
  inOutQuint: (p) => (p < 0.5 ? 16 * p ** 5 : 1 - (-2 * p + 2) ** 5 / 2),
  inExpo: (p) => (p <= 0 ? 0 : 2 ** (10 * p - 10)),
  outExpo: (p) => (p >= 1 ? 1 : 1 - 2 ** (-10 * p)),
  inOutExpo: (p) =>
    p <= 0 ? 0 : p >= 1 ? 1 : p < 0.5 ? 2 ** (20 * p - 10) / 2 : (2 - 2 ** (-20 * p + 10)) / 2,
  outBack: (p) => 1 + 2.70158 * (p - 1) ** 3 + 1.70158 * (p - 1) ** 2,
};

/** A damped spring from 0 to 1, `elapsed` seconds after release. Overshoots when light. */
export function spring(elapsed, stiffness = 180, damping = 14) {
  if (elapsed <= 0) return 0;
  const w0 = Math.sqrt(stiffness);
  const zeta = damping / (2 * w0);
  if (zeta >= 1) return 1 - Math.exp(-w0 * elapsed) * (1 + w0 * elapsed);
  const wd = w0 * Math.sqrt(1 - zeta * zeta);
  return 1 - Math.exp(-zeta * w0 * elapsed) * (Math.cos(wd * elapsed) + ((zeta * w0) / wd) * Math.sin(wd * elapsed));
}

/** Opacity for something alive in [a, b] that fades in over `fin` and out over `fout`. */
export function life(t, a, b, fin = 0.2, fout = 0.2) {
  if (t < a || t > b) return 0;
  const rise = fin > 0 ? seg(t, a, a + fin) : 1;
  const fall = fout > 0 ? 1 - seg(t, b - fout, b) : 1;
  return Math.min(rise, fall);
}

const n = (value, digits = 3) => Number(value.toFixed(digits));

export function tf({ x = 0, y = 0, z = 0, s = 1, sx = s, sy = s, r = 0, rx = 0, ry = 0 } = {}) {
  return `translate3d(${n(x, 2)}px, ${n(y, 2)}px, ${n(z, 2)}px) rotateX(${n(rx)}deg) rotateY(${n(ry)}deg) rotate(${n(r)}deg) scale(${n(sx, 4)}, ${n(sy, 4)})`;
}

/** Write styles; `--x` names become custom properties. */
export function put(element, properties) {
  for (const [key, value] of Object.entries(properties)) {
    const text = typeof value === "number" ? String(n(value, 4)) : String(value);
    if (key.startsWith("--")) element.style.setProperty(key, text);
    else element.style[key] = text;
  }
}

const SVG = new Set(["svg", "path", "g", "circle", "rect", "defs", "radialGradient", "linearGradient", "stop", "line", "polyline", "ellipse", "mask"]);

/** A tiny DOM builder: h("div", { class, text, style }, ...children). */
export function h(tag, attributes = {}, ...children) {
  const element = SVG.has(tag)
    ? document.createElementNS("http://www.w3.org/2000/svg", tag)
    : document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "text") element.textContent = String(value);
    else if (key === "style") Object.assign(element.style, value);
    else element.setAttribute(key, String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child !== null && child !== undefined && child !== false) element.append(child);
  }
  return element;
}

/** Seeded random numbers (mulberry32): the same seed draws the same film every time. */
export function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** The characters of `text` typed so far at `t`, starting at `start`, `perSecond` fast. */
export function typed(text, t, start, perSecond) {
  const count = Math.floor(clamp((t - start) * perSecond, 0, text.length));
  return text.slice(0, count);
}

/** Mount every scene once; each frame, show the live ones and let them draw. */
export function createTimeline(stage, scenes, settings) {
  for (const scene of scenes) {
    scene.root = h("section", { class: `scene scene-${scene.id}` });
    stage.append(scene.root);
    scene.mount(scene.root, settings);
  }
  return {
    render(t) {
      for (const scene of scenes) {
        const live = t >= scene.from && t < scene.to;
        scene.root.style.visibility = live ? "visible" : "hidden";
        if (live) scene.draw(t);
      }
    },
  };
}
