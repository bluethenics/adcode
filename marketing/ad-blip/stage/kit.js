/**
 * The drawing kit: easing, deterministic noise, colour, and text that records where it lands.
 *
 * Every frame is a pure function of t, so nothing here reads a clock or Math.random.
 * `text()` writes each box it draws, in screen pixels, to `layout`; verify.mjs reads a dump
 * of it to check the copy the film actually showed, not the copy it meant to show.
 */
export const TAU = Math.PI * 2;
export const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, k) => a + (b - a) * k;
/** Progress through [a, b], clamped to 0..1. */
export const seg = (t, a, b) => clamp((t - a) / (b - a));
/** 1 inside [a, b] with fades of `fin` / `fout` either side, 0 outside. */
export const life = (t, a, b, fin = 0.15, fout = 0.15) => Math.min(seg(t, a, a + fin), 1 - seg(t, b - fout, b));

export const ease = {
  linear: (x) => x,
  in2: (x) => x * x,
  out2: (x) => 1 - (1 - x) * (1 - x),
  inOut2: (x) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2),
  in3: (x) => x * x * x,
  out3: (x) => 1 - (1 - x) ** 3,
  inOut3: (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2),
  out5: (x) => 1 - (1 - x) ** 5,
  outBack: (x, s = 1.9) => 1 + (s + 1) * (x - 1) ** 3 + s * (x - 1) ** 2,
  inBack: (x, s = 1.7) => (s + 1) * x * x * x - s * x * x,
  outElastic: (x) => (x <= 0 ? 0 : x >= 1 ? 1 : 2 ** (-9 * x) * Math.sin((x * 10 - 0.75) * (TAU / 3)) + 1),
};

/** A pop: 0 before `a`, overshoots to 1 over `d`. */
export const pop = (t, a, d = 0.32, s = 2.2) => (t < a ? 0 : ease.outBack(seg(t, a, a + d), s));
/** A damped wobble that starts at 1 at `a` and dies away. */
export const wobble = (t, a, freq = 5, decay = 7) => (t < a ? 0 : Math.exp(-decay * (t - a)) * Math.cos(TAU * freq * (t - a)));
/** A one-shot bump: 0 → 1 → 0 over [a, a + d]. */
export const bump = (t, a, d) => (t < a || t > a + d ? 0 : Math.sin(Math.PI * ((t - a) / d)));

/** Stable 0..1 from an integer and a seed. */
export function hash(n, seed = 0) {
  let x = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(seed | 0, 0xc2b2ae35);
  x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d); x ^= x >>> 12; x = Math.imul(x, 0x297a2d39); x ^= x >>> 15;
  return (x >>> 0) / 4294967296;
}
/** Smooth noise in -1..1, continuous in x. */
export function noise(x, seed = 0) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return lerp(hash(i, seed), hash(i + 1, seed), u) * 2 - 1;
}

/* ── Colour ── */
const parse = (hex) => {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};
export function mix(a, b, k) {
  const [x, y] = [parse(a), parse(b)];
  const c = x.map((v, i) => Math.round(lerp(v, y[i], clamp(k))));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
export function rgba(hex, alpha) {
  const [r, g, b] = parse(hex);
  return `rgba(${r},${g},${b},${clamp(alpha)})`;
}
export const shade = (hex, k) => (k >= 0 ? mix(hex, "#ffffff", k) : mix(hex, "#000000", -k));

/* ── Palette ── */
export const INK = "#16171b";
export const PAPER = "#fbf6ec";
export const MONEY = "#30d158";
export const MONEY_DEEP = "#1d9e45";
export const WARN = "#d9a03f";
export const FACE = "#fffdf8";

/* ── Text that records itself ── */

export const layout = [];
export const resetLayout = () => { layout.length = 0; };

const FAMILY = { display: '"Inter Tight"', body: '"Inter"', mono: '"JetBrains Mono"' };
export function font(ctx, size, weight = 800, family = "display") {
  ctx.font = `${weight} ${size}px ${FAMILY[family]}`;
}

/** Record a box drawn in the current transform, in screen pixels. */
function record(ctx, str, x0, y0, x1, y1, alpha, critical) {
  if (alpha < 0.5 || !critical) return;
  const m = ctx.getTransform();
  const pts = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const scale = Math.hypot(m.a, m.b);
  layout.push({ text: str, x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys), scale });
}

/**
 * Draw one line. `fit` shrinks the size until the line is no wider than `fit` pixels.
 * Returns the width drawn. Options: size, weight, family, color, align, alpha, fit,
 * spacing (px of letter spacing), critical (record for verify; default true).
 */
export function text(ctx, str, x, y, o = {}) {
  const { weight = 800, family = "display", color = INK, align = "center", alpha = 1, fit = 0, spacing, critical = true } = o;
  let size = o.size ?? 64;
  ctx.save();
  font(ctx, size, weight, family);
  ctx.letterSpacing = `${spacing ?? (family === "display" ? -size * 0.025 : 0)}px`;
  let width = ctx.measureText(str).width;
  if (fit && width > fit) {
    size = Math.floor(size * (fit / width));
    font(ctx, size, weight, family);
    ctx.letterSpacing = `${spacing ?? (family === "display" ? -size * 0.025 : 0)}px`;
    width = ctx.measureText(str).width;
  }
  ctx.globalAlpha *= clamp(alpha);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(str, x, y);
  const m = ctx.measureText(str);
  const left = align === "center" ? x - width / 2 : align === "right" ? x - width : x;
  record(ctx, str, left, y - m.actualBoundingBoxAscent, left + width, y + m.actualBoundingBoxDescent, ctx.globalAlpha, critical);
  ctx.restore();
  return width;
}

/** Width of a line at a size, without drawing it. */
export function measure(ctx, str, size, weight = 800, family = "display") {
  ctx.save();
  font(ctx, size, weight, family);
  ctx.letterSpacing = `${family === "display" ? -size * 0.025 : 0}px`;
  const width = ctx.measureText(str).width;
  ctx.restore();
  return width;
}

/** The largest size at which every line fits `width`, capped at `max`. */
export function fitSize(ctx, lines, max, width, weight = 900) {
  const widest = Math.max(...lines.map((l) => measure(ctx, l, max, weight)));
  return widest > width ? Math.floor(max * (width / widest)) : max;
}

/**
 * Words that pop in one after another, centred on x. `at` is when the first word starts;
 * each word scales up from below with a small overshoot. Returns the line width.
 */
export function popWords(ctx, str, x, y, t, at, o = {}) {
  const { size = 100, weight = 900, color = INK, stagger = 0.07, d = 0.3, alpha = 1, highlight = null, times = null, family = "display", align = "center" } = o;
  const words = str.split(" ");
  // Inter Tight's space is a narrow 0.19 em; at heavy weights words run together without more.
  const space = measure(ctx, " ", size, weight, family) + size * (o.gap ?? 0.1);
  const widths = words.map((w) => measure(ctx, w, size, weight, family));
  const total = widths.reduce((a, b) => a + b, 0) + space * (words.length - 1);
  const left = align === "left" ? x : x - total / 2;
  let cx = left;
  let settled = alpha > 0;
  words.forEach((word, i) => {
    const start = times ? times[i] : at + i * stagger;
    const k = pop(t, start, d, 2.4);
    if (k < 0.85) settled = false;
    const fade = clamp(seg(t, start, start + 0.08));
    if (fade > 0 && alpha > 0) {
      ctx.save();
      const wx = cx + widths[i] / 2;
      ctx.translate(wx, y + (1 - k) * size * 0.35);
      ctx.scale(0.6 + 0.4 * k, 0.6 + 0.4 * k);
      const lit = highlight && highlight.word === word;
      if (lit) {
        const hk = ease.out3(seg(t, highlight.at, highlight.at + 0.25));
        ctx.fillStyle = highlight.color;
        ctx.globalAlpha *= alpha;
        const pad = size * 0.09;
        ctx.beginPath();
        ctx.roundRect(-widths[i] / 2 - pad, -size * 0.7, (widths[i] + pad * 2) * hk, size * 0.86, size * 0.14);
        ctx.fill();
        ctx.globalAlpha /= alpha;
      }
      const fg = lit && highlight.text && t >= highlight.at + 0.08 ? highlight.text : color;
      text(ctx, word, 0, 0, { size, weight, family, color: fg, alpha: alpha * fade, critical: false });
      ctx.restore();
    }
    cx += widths[i] + space;
  });
  // Verify reads whole lines: record this one once every word has landed.
  if (settled && o.critical !== false) record(ctx, str, left, y - size * 0.74, left + total, y + size * 0.22, ctx.globalAlpha * alpha, true);
  return total;
}

/* ── Shapes ── */

export function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** A soft drop shadow drawn as a blurred-looking stack of rounded rects (no shadowBlur). */
export function softShadow(ctx, x, y, w, h, r, alpha = 0.25, spread = 28, dy = 18) {
  ctx.save();
  for (let i = 6; i >= 1; i -= 1) {
    const g = (spread * i) / 6;
    ctx.fillStyle = `rgba(10,12,25,${(alpha / 6) * (1 - (i - 1) / 7)})`;
    rrect(ctx, x - g / 2, y - g / 2 + dy, w + g, h + g, r + g / 2);
    ctx.fill();
  }
  ctx.restore();
}

/** A filled check mark path centred on (x, y). */
export function check(ctx, x, y, s, color, width = s * 0.18) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(x - s * 0.42, y + s * 0.02);
  ctx.lineTo(x - s * 0.12, y + s * 0.3);
  ctx.lineTo(x + s * 0.44, y - s * 0.32);
  ctx.stroke();
  ctx.restore();
}

/** Four-point sparkle. */
export function sparkle(ctx, x, y, r, color, alpha = 1) {
  if (r <= 0 || alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.quadraticCurveTo(x, y, x, y + r);
  ctx.quadraticCurveTo(x, y, x - r, y);
  ctx.quadraticCurveTo(x, y, x, y - r);
  ctx.fill();
  ctx.restore();
}

/** The ADCode mark — the same paths as build/icon.svg — drawn `size` px square at (x, y). */
const MARK = [
  ["M320 348L140 512L320 676", 96],
  ["M704 348L884 512L704 676", 96],
  ["M512 296V388", 64],
  ["M512 636V728", 64],
  ["M584 405C563 374 531 356 494 356C446 356 413 383 413 423C413 463 444 484 505 500C569 517 606 541 606 590C606 641 565 671 511 671C466 671 429 651 405 619", 92],
].map(([d, w]) => [new Path2D(d), w]);
export function mark(ctx, x, y, size, color, { brackets = 1, dollar = 1, spread = 0 } = {}) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 1024, size / 1024);
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  MARK.forEach(([path, width], i) => {
    const isBracket = i < 2;
    const a = isBracket ? brackets : dollar;
    if (a <= 0) return;
    ctx.save();
    ctx.globalAlpha *= a;
    if (isBracket) ctx.translate(i === 0 ? -spread : spread, 0);
    ctx.lineWidth = width;
    ctx.stroke(path);
    ctx.restore();
  });
  ctx.restore();
}
