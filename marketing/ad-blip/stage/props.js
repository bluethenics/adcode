/**
 * Props and sets: the rooms, the lamp, the mug, the clock, the phone, the cards, the coin,
 * confetti. Each draws itself at a time and position and keeps no state between frames.
 */
import { CAST, H, W } from "./cues.js";
import {
  FACE, INK, MONEY, MONEY_DEEP, PAPER, TAU, check, clamp, ease, hash, lerp, mark, mix, noise, rgba, rrect, seg, softShadow, sparkle, text,
} from "./kit.js";

/* ── Rooms: one composition, four lighting states ── */

export const NIGHT = { top: "#0a1023", bottom: "#1d2752", floor: "#0e1430", edge: 0.08, glow: "#ffb057", glowA: 0.26, stars: 1, vignette: 0.5 };
export const GOLD = { top: "#ffe8bb", bottom: "#ffc877", floor: "#f0b25c", edge: 0.5, glow: "#fff8e6", glowA: 0.8, stars: 0, vignette: 0.14 };
export const CREAM = { top: "#fdf9f1", bottom: "#f3e6cf", floor: "#ecdabb", edge: 0.7, glow: "#ffffff", glowA: 0.7, stars: 0, vignette: 0.1 };
export const COZY = { top: "#0f0c22", bottom: "#2d2353", floor: "#181230", edge: 0.07, glow: "#ffae55", glowA: 0.38, stars: 0.8, vignette: 0.42 };

export function blend(a, b, k) {
  return {
    top: mix(a.top, b.top, k), bottom: mix(a.bottom, b.bottom, k), floor: mix(a.floor, b.floor, k),
    edge: lerp(a.edge, b.edge, k), glow: mix(a.glow, b.glow, k), glowA: lerp(a.glowA, b.glowA, k),
    stars: lerp(a.stars, b.stars, k), vignette: lerp(a.vignette, b.vignette, k),
  };
}

const OVER = 260; // overscan, so a shake or a zoom-out never shows an edge

export function room(ctx, t, p, { floorY = 1480, glowX = 250, glowY = 1150 } = {}) {
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, p.top);
  sky.addColorStop(1, p.bottom);
  ctx.fillStyle = sky;
  ctx.fillRect(-OVER, -OVER, W + OVER * 2, H + OVER * 2);
  if (p.stars > 0.01) stars(ctx, t, p.stars);
  const glow = ctx.createRadialGradient(glowX, glowY, 0, glowX, glowY, 1200);
  glow.addColorStop(0, rgba(p.glow, p.glowA));
  glow.addColorStop(1, rgba(p.glow, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(-OVER, -OVER, W + OVER * 2, H + OVER * 2);
  ctx.fillStyle = p.floor;
  ctx.fillRect(-OVER, floorY, W + OVER * 2, H - floorY + OVER * 2);
  const fall = ctx.createLinearGradient(0, floorY, 0, floorY + 420);
  fall.addColorStop(0, "rgba(0,0,0,0)");
  fall.addColorStop(1, "rgba(0,0,0,0.22)");
  ctx.fillStyle = fall;
  ctx.fillRect(-OVER, floorY, W + OVER * 2, H - floorY + OVER * 2);
  ctx.fillStyle = `rgba(255,255,255,${p.edge})`;
  ctx.fillRect(-OVER, floorY, W + OVER * 2, 3);
}

function stars(ctx, t, amount) {
  for (let i = 0; i < 80; i += 1) {
    const x = hash(i, 1) * W;
    const y = hash(i, 2) * 1350;
    const r = 1.1 + hash(i, 3) * 2.4;
    const tw = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * (1.2 + hash(i, 4) * 2.2) + i * 1.7));
    ctx.fillStyle = `rgba(255,250,235,${amount * tw * 0.85})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }
}

export function vignette(ctx, amount) {
  if (amount <= 0) return;
  const g = ctx.createRadialGradient(W / 2, H * 0.46, H * 0.28, W / 2, H * 0.46, H * 0.78);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, `rgba(0,0,0,${amount})`);
  ctx.fillStyle = g;
  ctx.fillRect(-OVER, -OVER, W + OVER * 2, H + OVER * 2);
}

export function glow(ctx, x, y, r, color, alpha) {
  if (alpha <= 0) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(color, alpha));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

/** Slow rays of light behind a moment, rotating. */
export function rays(ctx, t, x, y, alpha, color = "#ffffff") {
  if (alpha <= 0) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(t * 0.12);
  for (let i = 0; i < 14; i += 1) {
    ctx.rotate(TAU / 14);
    const g = ctx.createLinearGradient(0, 0, 0, -1400);
    g.addColorStop(0, rgba(color, alpha));
    g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-70, -1400);
    ctx.lineTo(70, -1400);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/* ── The desk lamp: the only warm light in the night scenes ── */

export function lamp(ctx, x, floorY, on = 1, alpha = 1) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha *= alpha;
  const hx = x + 190;
  const hy = floorY - 400;
  if (on > 0) {
    const cone = ctx.createLinearGradient(hx, hy, hx + 160, floorY);
    cone.addColorStop(0, `rgba(255,196,120,${0.3 * on})`);
    cone.addColorStop(1, "rgba(255,196,120,0)");
    ctx.fillStyle = cone;
    ctx.beginPath();
    ctx.moveTo(hx - 30, hy + 40);
    ctx.lineTo(hx + 90, hy + 20);
    ctx.lineTo(hx + 640, floorY);
    ctx.lineTo(hx - 140, floorY);
    ctx.closePath();
    ctx.fill();
    const pool = ctx.createRadialGradient(hx + 220, floorY, 0, hx + 220, floorY, 420);
    pool.addColorStop(0, `rgba(255,196,120,${0.22 * on})`);
    pool.addColorStop(1, "rgba(255,196,120,0)");
    ctx.fillStyle = pool;
    ctx.fillRect(hx - 300, floorY - 200, 1000, 400);
  }
  ctx.fillStyle = "#273061";
  ctx.beginPath();
  ctx.ellipse(x, floorY - 10, 88, 20, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = "#3b4682";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = 16;
  ctx.beginPath();
  ctx.moveTo(x, floorY - 18);
  ctx.lineTo(x + 34, floorY - 250);
  ctx.lineTo(hx - 18, hy - 22);
  ctx.stroke();
  ctx.fillStyle = "#4a5596";
  for (const [jx, jy] of [[x + 34, floorY - 250], [hx - 18, hy - 22]]) {
    ctx.beginPath();
    ctx.arc(jx, jy, 15, 0, TAU);
    ctx.fill();
  }
  ctx.save();
  ctx.translate(hx, hy);
  ctx.rotate(0.62);
  ctx.fillStyle = "#56619f";
  ctx.beginPath();
  ctx.moveTo(-46, -50);
  ctx.lineTo(46, -50);
  ctx.lineTo(84, 42);
  ctx.lineTo(-84, 42);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fillRect(-40, -46, 18, 86);
  if (on > 0) {
    const bulb = ctx.createRadialGradient(0, 46, 0, 0, 46, 120);
    bulb.addColorStop(0, `rgba(255,236,190,${0.95 * on})`);
    bulb.addColorStop(0.3, `rgba(255,200,120,${0.45 * on})`);
    bulb.addColorStop(1, "rgba(255,200,120,0)");
    ctx.fillStyle = bulb;
    ctx.fillRect(-130, -80, 260, 260);
  }
  ctx.restore();
  ctx.restore();
}

/* ── A mug with the ADCode mark: steaming, or gone cold ── */

export function mug(ctx, cx, baseY, s, { steam = 1, cold = 0, t = 0 } = {}) {
  const h = s * 1.02;
  const x = cx - s / 2;
  const y = baseY - h;
  // Steam first, behind the rim.
  if (steam > 0.01) {
    for (let i = 0; i < 3; i += 1) {
      const sx = cx + (i - 1) * s * 0.22;
      const top = y - s * (0.95 + 0.15 * i);
      const g = ctx.createLinearGradient(0, y, 0, top);
      g.addColorStop(0, `rgba(255,255,255,${0.42 * steam})`);
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.strokeStyle = g;
      ctx.lineWidth = s * 0.07;
      ctx.lineCap = "round";
      ctx.beginPath();
      const segs = 18;
      for (let k = 0; k <= segs; k += 1) {
        const p = k / segs;
        const px = sx + Math.sin(p * 5 + t * 3.2 + i * 2) * s * 0.07 * (0.4 + p);
        const py = lerp(y - s * 0.04, top, p);
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
  }
  // Handle.
  ctx.strokeStyle = mix("#e9e4d8", "#c9d8ec", cold * 0.6);
  ctx.lineWidth = s * 0.11;
  ctx.beginPath();
  ctx.ellipse(x + s, y + h * 0.48, s * 0.2, h * 0.24, 0, -Math.PI / 2, Math.PI / 2);
  ctx.stroke();
  // Body, lit from the left.
  const body = ctx.createLinearGradient(x, 0, x + s, 0);
  body.addColorStop(0, mix("#fbf8f1", "#e4eefb", cold * 0.6));
  body.addColorStop(1, mix("#d9d2c3", "#aebfd8", cold * 0.6));
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + s, y);
  ctx.lineTo(x + s * 0.97, baseY - s * 0.1);
  ctx.quadraticCurveTo(x + s * 0.96, baseY, x + s * 0.84, baseY);
  ctx.lineTo(x + s * 0.16, baseY);
  ctx.quadraticCurveTo(x + s * 0.04, baseY, x + s * 0.03, baseY - s * 0.1);
  ctx.closePath();
  ctx.fill();
  // Rim and coffee.
  ctx.fillStyle = mix("#ece6da", "#d6e2f2", cold * 0.6);
  ctx.beginPath();
  ctx.ellipse(cx, y, s / 2, s * 0.11, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = mix("#5a321c", "#3a3340", cold);
  ctx.beginPath();
  ctx.ellipse(cx, y + s * 0.012, s / 2 - s * 0.055, s * 0.075, 0, 0, TAU);
  ctx.fill();
  mark(ctx, cx - s * 0.2, y + h * 0.3, s * 0.4, INK);
  // Gone cold: a blue shiver either side.
  if (cold > 0.01) {
    ctx.strokeStyle = `rgba(160,205,255,${0.85 * cold})`;
    ctx.lineWidth = s * 0.028;
    ctx.lineCap = "round";
    for (const side of [-1, 1]) {
      for (let k = 0; k < 3; k += 1) {
        const bx = cx + side * (s * 0.68 + k * s * 0.05);
        const by = y + h * (0.25 + k * 0.2);
        const jit = Math.sin(t * 40 + k) * s * 0.012;
        ctx.beginPath();
        ctx.moveTo(bx + jit, by);
        ctx.lineTo(bx + side * s * 0.09 + jit, by - s * 0.03);
        ctx.stroke();
      }
    }
    for (let k = 0; k < 4; k += 1) {
      sparkle(ctx, cx + (hash(k, 31) - 0.5) * s * 1.2, y - s * 0.15 + hash(k, 32) * s * 0.5, s * 0.05 * (0.6 + 0.4 * Math.sin(t * 9 + k)), "#d8ecff", cold);
    }
  }
}

/* ── The clock that will not stop ── */

export function clock(ctx, cx, cy, r, turns) {
  softShadow(ctx, cx - r, cy - r, r * 2, r * 2, r, 0.5, 40, 24);
  ctx.fillStyle = "#2a3366";
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.fill();
  ctx.fillStyle = PAPER;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.9, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineCap = "round";
  for (let i = 0; i < 60; i += 1) {
    const a = (i / 60) * TAU;
    const major = i % 5 === 0;
    ctx.lineWidth = major ? r * 0.035 : r * 0.012;
    const r0 = r * (major ? 0.72 : 0.79);
    ctx.beginPath();
    ctx.moveTo(cx + Math.sin(a) * r0, cy - Math.cos(a) * r0);
    ctx.lineTo(cx + Math.sin(a) * r * 0.84, cy - Math.cos(a) * r * 0.84);
    ctx.stroke();
  }
  const hand = (angle, length, width, color) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(cx - Math.sin(angle) * length * 0.16, cy + Math.cos(angle) * length * 0.16);
    ctx.lineTo(cx + Math.sin(angle) * length, cy - Math.cos(angle) * length);
    ctx.stroke();
  };
  hand(TAU * (10 / 12) + (turns * TAU) / 12, r * 0.45, r * 0.065, INK);
  hand(turns * TAU, r * 0.7, r * 0.04, INK);
  ctx.fillStyle = "#e0584e";
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.05, 0, TAU);
  ctx.fill();
}

/* ── A phone mid-doomscroll ── */

const FEED = ["#5a92f0", "#e25c9f", "#e09a22", "#9076ec", "#3fb173", "#ea6c62", "#25b5a5"];
export function phone(ctx, cx, cy, w, h, scroll) {
  const x = cx - w / 2;
  const y = cy - h / 2;
  softShadow(ctx, x, y, w, h, w * 0.14, 0.55, 46, 26);
  ctx.fillStyle = "#0b0d15";
  rrect(ctx, x, y, w, h, w * 0.14);
  ctx.fill();
  ctx.strokeStyle = "#323a5c";
  ctx.lineWidth = 6;
  ctx.stroke();
  const sx = x + 18;
  const sy = y + 18;
  const sw = w - 36;
  const sh = h - 36;
  ctx.save();
  rrect(ctx, sx, sy, sw, sh, w * 0.11);
  ctx.clip();
  ctx.fillStyle = "#f5f1e9";
  ctx.fillRect(sx, sy, sw, sh);
  const item = 360;
  const first = Math.floor(scroll / item) - 1;
  for (let n = first; n < first + Math.ceil(sh / item) + 3; n += 1) {
    const iy = sy + 70 + n * item - scroll;
    if (iy > sy + sh || iy + item < sy) continue;
    ctx.fillStyle = FEED[((n % FEED.length) + FEED.length) % FEED.length];
    ctx.beginPath();
    ctx.arc(sx + 50, iy + 28, 22, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#d8d2c6";
    rrect(ctx, sx + 86, iy + 14, 160, 14, 7);
    ctx.fill();
    rrect(ctx, sx + 86, iy + 36, 100, 12, 6);
    ctx.fill();
    const g = ctx.createLinearGradient(sx, iy + 60, sx + sw, iy + 290);
    const c = FEED[(((n + 3) % FEED.length) + FEED.length) % FEED.length];
    g.addColorStop(0, c);
    g.addColorStop(1, mix(c, "#ffffff", 0.45));
    ctx.fillStyle = g;
    rrect(ctx, sx + 24, iy + 62, sw - 48, 230, 22);
    ctx.fill();
  }
  ctx.restore();
  ctx.fillStyle = "#0b0d15";
  rrect(ctx, cx - w * 0.15, y + 30, w * 0.3, 34, 17);
  ctx.fill();
}

/* ── The waiting card: "Thinking… 99%", or "Done 100%" ── */

export function statusCard(ctx, cx, cy, w, h, { pct = 99, t = 0, rot = 0, done = false, alpha = 1, scale = 1 } = {}) {
  if (alpha <= 0 || scale <= 0) return;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  ctx.scale(scale, scale);
  ctx.globalAlpha *= alpha;
  const x = -w / 2;
  const y = -h / 2;
  softShadow(ctx, x, y, w, h, 38, 0.55, 44, 24);
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, "#2a3466");
  g.addColorStop(1, "#1c244c");
  ctx.fillStyle = g;
  rrect(ctx, x, y, w, h, 38);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.lineWidth = 2;
  ctx.stroke();
  const ix = x + 70;
  const iy = y + h * 0.36;
  if (done) {
    ctx.fillStyle = CAST.blip.color;
    ctx.beginPath();
    ctx.arc(ix, iy, 25, 0, TAU);
    ctx.fill();
    check(ctx, ix, iy + 1, 28, FACE, 5.5);
  } else {
    ctx.lineWidth = 7;
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.beginPath();
    ctx.arc(ix, iy, 21, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = "#9cbcff";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(ix, iy, 21, t * 7, t * 7 + 1.7);
    ctx.stroke();
  }
  text(ctx, done ? "Done" : "Thinking…", x + 116, iy + 16, { size: 46, weight: 600, family: "body", color: FACE, align: "left" });
  text(ctx, `${pct}%`, x + w - 50, iy + 22, { size: 68, weight: 900, color: FACE, align: "right" });
  const bx = x + 50;
  const by = y + h - 64;
  const bw = w - 100;
  ctx.fillStyle = "rgba(255,255,255,0.1)";
  rrect(ctx, bx, by, bw, 30, 15);
  ctx.fill();
  const fw = (bw * pct) / 100;
  const bar = ctx.createLinearGradient(bx, 0, bx + fw, 0);
  bar.addColorStop(0, "#4b7fe0");
  bar.addColorStop(1, "#9cbcff");
  ctx.fillStyle = bar;
  rrect(ctx, bx, by, fw, 30, 15);
  ctx.fill();
  if (!done) {
    ctx.save();
    rrect(ctx, bx, by, fw, 30, 15);
    ctx.clip();
    const p = ((t * 0.8) % 1.3) - 0.15;
    const shine = ctx.createLinearGradient(bx + p * bw - 90, 0, bx + p * bw + 90, 0);
    shine.addColorStop(0, "rgba(255,255,255,0)");
    shine.addColorStop(0.5, "rgba(255,255,255,0.55)");
    shine.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = shine;
    ctx.fillRect(bx, by, bw, 30);
    ctx.restore();
  }
  ctx.restore();
}

/* ── Speech bubble, scaled from its tail ── */

export function bubble(ctx, { x, y, w, h, tailX, tailY, k = 1, fill = "#ffffff" }, content) {
  if (k <= 0.01) return;
  ctx.save();
  ctx.translate(tailX, tailY);
  ctx.scale(k, k);
  ctx.translate(-tailX, -tailY);
  softShadow(ctx, x, y, w, h, 64, 0.38, 36, 18);
  ctx.fillStyle = fill;
  rrect(ctx, x, y, w, h, 64);
  ctx.fill();
  const bx = clamp(tailX, x + 120, x + w - 120);
  ctx.beginPath();
  ctx.moveTo(bx - 56, y + h - 4);
  ctx.quadraticCurveTo(bx - 6, y + h + 30, tailX, tailY);
  ctx.quadraticCurveTo(bx + 18, y + h + 24, bx + 50, y + h - 4);
  ctx.closePath();
  ctx.fill();
  content?.(ctx);
  ctx.restore();
}

/* ── A pill label ── */

export function pill(ctx, cx, cy, label, { bg = INK, fg = FACE, size = 36, weight = 800, family = "display", padX = 30, h = size * 1.9, scale = 1, alpha = 1, spacing, critical = true, icon = null, anchor = "center" } = {}) {
  if (scale <= 0 || alpha <= 0) return 0;
  ctx.save();
  ctx.font = `${weight} ${size}px ${family === "display" ? '"Inter Tight"' : '"Inter"'}`;
  ctx.letterSpacing = `${spacing ?? 0}px`;
  const iconW = icon ? size * 1.05 : 0;
  const w = ctx.measureText(label).width + padX * 2 + iconW;
  ctx.translate(anchor === "left" ? cx + w / 2 : cx, cy);
  ctx.scale(scale, scale);
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = bg;
  rrect(ctx, -w / 2, -h / 2, w, h, h / 2);
  ctx.fill();
  if (icon) icon(ctx, -w / 2 + padX + size * 0.4, 0, size * 0.8);
  text(ctx, label, iconW / 2, size * 0.36, { size, weight, family, color: fg, spacing: spacing ?? 0, critical });
  ctx.restore();
  return w;
}

/* ── The sponsored card. The advertiser is fictional. ── */

export function sponsoredCard(ctx, x, y, w, h) {
  softShadow(ctx, x, y, w, h, 34, 0.42, 40, 22);
  ctx.fillStyle = "#ffffff";
  rrect(ctx, x, y, w, h, 34);
  ctx.fill();
  ctx.fillStyle = "#5f6b7d";
  rrect(ctx, x + 40, y + (h - 130) / 2, 130, 130, 30);
  ctx.fill();
  // A cloud glyph for the fictional Acme Cloud.
  const gx = x + 105;
  const gy = y + h / 2 + 8;
  ctx.fillStyle = FACE;
  for (const [dx, dy, r] of [[-20, 4, 20], [6, -8, 26], [28, 6, 17]]) {
    ctx.beginPath();
    ctx.arc(gx + dx, gy + dy, r, 0, TAU);
    ctx.fill();
  }
  ctx.fillRect(gx - 38, gy + 4, 82, 20);
  text(ctx, "Sponsored", x + 205, y + 72, { size: 28, weight: 600, family: "body", color: "#8a8578", align: "left" });
  text(ctx, "Acme Cloud", x + 205, y + 134, { size: 58, weight: 800, color: INK, align: "left" });
  text(ctx, "Deploy in one click.", x + 205, y + 186, { size: 32, weight: 500, family: "body", color: "#6b665c", align: "left" });
}

/* ── The coin, whole or as one of its halves ── */

const CRACK = [[0, -1], [0.14, -0.6], [-0.12, -0.25], [0.12, 0.1], [-0.1, 0.45], [0.08, 0.75], [0, 1]];
export function coin(ctx, x, y, r, spin, part = "whole", alpha = 1) {
  if (r <= 0 || alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha *= alpha;
  const g0 = ctx.createRadialGradient(x, y, 0, x, y, r * 2.4);
  g0.addColorStop(0, rgba(MONEY, 0.42));
  g0.addColorStop(1, rgba(MONEY, 0));
  ctx.fillStyle = g0;
  ctx.fillRect(x - r * 2.4, y - r * 2.4, r * 4.8, r * 4.8);
  ctx.translate(x, y);
  if (part !== "whole") {
    ctx.beginPath();
    const side = part === "left" ? -1 : 1;
    ctx.moveTo(side * r * 1.2, -r * 1.2);
    for (const [cx, cy] of CRACK) ctx.lineTo(cx * r, cy * r * 1.02);
    ctx.lineTo(side * r * 1.2, r * 1.2);
    ctx.closePath();
    ctx.clip();
  }
  ctx.scale(Math.max(0.1, Math.abs(Math.cos(spin))), 1);
  const face = ctx.createRadialGradient(-r * 0.35, -r * 0.4, 0, 0, 0, r);
  face.addColorStop(0, "#8ff5ad");
  face.addColorStop(0.55, MONEY);
  face.addColorStop(1, MONEY_DEEP);
  ctx.fillStyle = face;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = "#16823a";
  ctx.lineWidth = r * 0.09;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.82, 0, TAU);
  ctx.stroke();
  if (Math.abs(Math.cos(spin)) > 0.35) text(ctx, "$", 0, r * 0.4, { size: r * 1.15, weight: 900, color: FACE, critical: false });
  ctx.restore();
}

/* ── Confetti: deterministic paper in the cast's colours ── */

const CONFETTI = [CAST.blip.color, CAST.hex.color, CAST.pip.color, CAST.bloom.color, CAST.patch.color, CAST.quill.color, "#ffffff"];
export function confetti(ctx, t, at, x0, y0, spreadX, count = 110, seed = 1) {
  const age = t - at;
  if (age < 0 || age > 2.4) return;
  for (let i = 0; i < count; i += 1) {
    const a = age - hash(i, seed + 7) * 0.12;
    if (a < 0) continue;
    const vx = (hash(i, seed + 1) - 0.5) * 1500;
    const vy = -(700 + hash(i, seed + 2) * 1100);
    const drag = 1.6;
    const x = x0 + (hash(i, seed + 3) - 0.5) * spreadX + (vx / drag) * (1 - Math.exp(-drag * a)) + Math.sin(a * 6 + i) * 18;
    const y = y0 + (vy / drag) * (1 - Math.exp(-drag * a)) + 0.5 * 1400 * a * a * 0.7;
    const flip = Math.cos(a * (9 + hash(i, seed + 4) * 8) + i);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a * (4 + hash(i, seed + 5) * 6) + i);
    ctx.scale(1, flip);
    ctx.globalAlpha *= clamp((2.4 - age) / 0.5);
    ctx.fillStyle = CONFETTI[i % CONFETTI.length];
    if (i % 3 === 0) {
      ctx.beginPath();
      ctx.arc(0, 0, 9, 0, TAU);
      ctx.fill();
    } else {
      ctx.fillRect(-8, -14, 16, 28);
    }
    ctx.restore();
  }
}

/** A drop of sweat flung from a straining body; periodic so it works at any t, even < 0. */
export function sweatDrops(ctx, t, cx, cy, spread, period) {
  for (let k = 0; k < 3; k += 1) {
    const n = Math.floor(t / period) - k;
    const age = t - n * period;
    if (age < 0 || age > 0.75) continue;
    const side = hash(n, 11) < 0.5 ? -1 : 1;
    const x0 = cx + side * (spread * 0.55 + hash(n, 12) * spread * 0.3);
    const y0 = cy + hash(n, 13) * 70;
    const vx = side * (240 + hash(n, 14) * 220);
    const vy = -(420 + hash(n, 15) * 260);
    const x = x0 + vx * age;
    const y = y0 + vy * age + 0.5 * 2000 * age * age;
    const angle = Math.atan2(vy + 2000 * age, vx) + Math.PI / 2;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.scale(5.5, 5.5);
    ctx.globalAlpha *= clamp(1 - age / 0.75);
    ctx.fillStyle = "#bfe6ff";
    ctx.beginPath();
    ctx.moveTo(0, -5);
    ctx.bezierCurveTo(2.4, -1.6, 3.2, 0.6, 3.2, 1.8);
    ctx.arc(0, 1.8, 3.2, 0, Math.PI);
    ctx.bezierCurveTo(-3.2, 0.6, -2.4, -1.6, 0, -5);
    ctx.fill();
    ctx.restore();
  }
}

/** A puff of dust where something heavy landed. */
export function dust(ctx, t, at, x, y, color = "rgba(255,255,255,0.5)") {
  const a = t - at;
  if (a < 0 || a > 0.55) return;
  const k = a / 0.55;
  ctx.fillStyle = color.replace(/[\d.]+\)$/, `${0.5 * (1 - k)})`);
  for (let i = 0; i < 6; i += 1) {
    const dir = (i / 5 - 0.5) * 2.6;
    ctx.beginPath();
    ctx.arc(x + Math.sin(dir) * 160 * ease.out3(k), y - Math.abs(Math.cos(dir)) * 50 * ease.out3(k), 26 + 38 * k, 0, TAU);
    ctx.fill();
  }
}

/** A burst ring. */
export function ring(ctx, t, at, x, y, r0, r1, color, width = 8, d = 0.4) {
  const a = t - at;
  if (a < 0 || a > d) return;
  const k = ease.out3(a / d);
  ctx.strokeStyle = rgba(color, 1 - a / d);
  ctx.lineWidth = width * (1 - k * 0.6);
  ctx.beginPath();
  ctx.arc(x, y, lerp(r0, r1, k), 0, TAU);
  ctx.stroke();
}

/** Sparkles along a path from (x0, y0) to (x1, y1), drawn as a travelling trail. */
export function trail(ctx, t, at, x0, y0, x1, y1, color, d = 0.24) {
  const a = t - at;
  if (a < 0 || a > d + 0.3) return;
  const head = clamp(a / d);
  for (let i = 0; i < 8; i += 1) {
    const p = head - i * 0.06;
    if (p < 0 || p > 1) continue;
    const fade = clamp(1 - (a - d) / 0.3) * (1 - i / 8);
    const x = lerp(x0, x1, p);
    const y = lerp(y0, y1, p) - Math.sin(p * Math.PI) * 120;
    sparkle(ctx, x, y, 16 * (1 - i / 10), color, fade);
  }
  if (head >= 1) sparkle(ctx, x1, y1, 34 * (1 - clamp((a - d) / 0.3)), color, 1);
}

/** A wobbly magnifier, for the Reviewer. */
export function magnifier(ctx, x, y, r) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.strokeStyle = "#4b3f8f";
  ctx.lineWidth = r * 0.24;
  ctx.beginPath();
  ctx.moveTo(x + r * 0.7, y + r * 0.7);
  ctx.lineTo(x + r * 1.5, y + r * 1.5);
  ctx.stroke();
  ctx.fillStyle = "rgba(200,220,255,0.35)";
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  ctx.lineWidth = r * 0.16;
  ctx.strokeStyle = CAST.hex.color;
  ctx.stroke();
  ctx.restore();
}

/** A small beetle for the Bug fixer to squash. */
export function bug(ctx, x, y, s, t) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = "#2b2b33";
  ctx.lineWidth = s * 0.09;
  ctx.lineCap = "round";
  for (let i = -1; i <= 1; i += 1) {
    const w = Math.sin(t * 30 + i) * s * 0.12;
    ctx.beginPath();
    ctx.moveTo(-s * 0.3, i * s * 0.25);
    ctx.lineTo(-s * 0.62, i * s * 0.32 + w);
    ctx.moveTo(s * 0.3, i * s * 0.25);
    ctx.lineTo(s * 0.62, i * s * 0.32 - w);
    ctx.stroke();
  }
  ctx.fillStyle = "#2b2b33";
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 0.36, s * 0.48, 0, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, -s * 0.52, s * 0.2, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "#e0584e";
  ctx.beginPath();
  ctx.arc(-s * 0.12, -s * 0.05, s * 0.07, 0, TAU);
  ctx.arc(s * 0.14, s * 0.15, s * 0.06, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** A comic splat star. */
export function splat(ctx, x, y, r, color, alpha) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 16; i += 1) {
    const a = (i / 16) * TAU;
    const rr = i % 2 ? r * 0.45 : r * (0.85 + 0.15 * hash(i, 5));
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Checkered finish line. */
export function finish(ctx, x, y, w, h) {
  const n = Math.ceil(h / w);
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < 2; j += 1) {
      ctx.fillStyle = (i + j) % 2 ? INK : "#ffffff";
      ctx.fillRect(x + (j * w) / 2, y + (i * h) / n, w / 2, h / n);
    }
  }
}

/** A small crown. */
export function crown(ctx, x, y, s) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = "#f5c542";
  ctx.beginPath();
  ctx.moveTo(-s, s * 0.45);
  ctx.lineTo(-s, -s * 0.35);
  ctx.lineTo(-s * 0.5, s * 0.05);
  ctx.lineTo(0, -s * 0.6);
  ctx.lineTo(s * 0.5, s * 0.05);
  ctx.lineTo(s, -s * 0.35);
  ctx.lineTo(s, s * 0.45);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#e0584e";
  ctx.beginPath();
  ctx.arc(0, s * 0.12, s * 0.14, 0, TAU);
  ctx.fill();
  ctx.restore();
}

export { noise };
