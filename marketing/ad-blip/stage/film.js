/**
 * The film: `draw(ctx, t, hook)` paints time t. Nothing here keeps state between frames,
 * so any frame can be rendered alone, in any order, any number of times (the renderer
 * draws several sub-frame times per frame for motion blur).
 *
 * Text is drawn outside the camera so copy stays put while the set moves, and so frame 0
 * and the last frame of the scroll back match exactly.
 */
import { CAST, CUE, DURATION, H, HOOKS, LINES, W } from "./cues.js";
import {
  FACE, INK, MONEY, PAPER, TAU, bump, check, clamp, ease, fitSize, hash, lerp, mark, measure, mix, noise, pop, popWords, resetLayout, rrect, seg,
  softShadow, sparkle, text, wobble,
} from "./kit.js";
import { CROWN, bodyHeight, breathe, hop, mascot } from "./mascot.js";
import {
  COZY, CREAM, GOLD, NIGHT, blend, bubble, bug, clock, coin, confetti, crown, dust, finish, glow, lamp, magnifier, mug, phone, pill, rays, ring,
  room, splat, sponsoredCard, statusCard, sweatDrops, trail, vignette,
} from "./props.js";

const CX = W / 2;
const WHIP = 0.24;

function camera(ctx, zoom, cx = CX, cy = H / 2) {
  ctx.translate(cx, cy);
  ctx.scale(zoom, zoom);
  ctx.translate(-cx, -cy);
}
function impact(t, at, amp, dur = 0.35) {
  if (t < at || t > at + dur) return [0, 0];
  const k = (1 - (t - at) / dur) ** 2;
  return [noise(t * 55, 1) * amp * k, noise(t * 55, 2) * amp * k];
}
function shadowed(ctx, alpha = 0.45, blur = 36, dy = 8) {
  ctx.shadowColor = `rgba(0,0,0,${alpha})`;
  ctx.shadowBlur = blur;
  ctx.shadowOffsetY = dy;
}
/** Sum of several hops: [at, duration, height]. */
function hops(t, list) {
  let lift = 0;
  let squash = 0;
  for (const [a, d, h] of list) {
    const p = hop(t, a, d, h);
    lift += p.lift;
    squash += p.squash;
  }
  return { lift, squash };
}
/** Where a mascot's head is, for aiming things at it. */
const headY = (who, feet, size) => feet - bodyHeight(who, size) * 0.62;

/* ────────────────────────── 1 · The wait (hook, and "trying its best") ────────────────────────── */

function hookText(ctx, hook) {
  const lines = HOOKS[hook];
  const size = fitSize(ctx, lines, 128, 940, 900);
  ctx.save();
  shadowed(ctx);
  text(ctx, lines[0], CX, 410, { size, weight: 900, color: FACE });
  text(ctx, lines[1], CX, 410 + size * 1.06, { size, weight: 900, color: FACE });
  ctx.restore();
}

/** Little white strain marks either side of the load. */
function effort(ctx, t, x, y, dir) {
  if (Math.floor(t * 10) % 3 === 0) return;
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.75)";
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  for (let i = -1; i <= 1; i += 1) {
    const a = dir * (0.9 + i * 0.35);
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * 20 * dir, y + Math.sin(a) * 20);
    ctx.lineTo(x + Math.cos(a) * 48 * dir, y + Math.sin(a) * 48);
    ctx.stroke();
  }
  ctx.restore();
}

function waiting(ctx, t, hook, mode) {
  const best = mode === "best";
  const u = t - CUE.best;
  const feet = 1480;
  const size = 560;
  ctx.save();
  const zoom = best ? lerp(1, 1.07, ease.inOut2(seg(u, 0, 1.4))) : 1 + 0.035 * ease.inOut2(seg(t, 0, 2));
  camera(ctx, zoom, CX, 1250);
  room(ctx, t, NIGHT);
  lamp(ctx, 60, feet, 1);
  mug(ctx, 910, feet, 116, { steam: best ? 0 : 1, cold: best ? 1 : 0, t });

  const strain = !best || u < 0.6;
  let squash = -0.06 + 0.025 * Math.sin(TAU * 1.4 * t) - (best && u < 0.6 ? 0.04 : 0);
  let lift = 0;
  if (best) {
    const h = hop(t, CUE.best + 1.0, 0.24, 26);
    squash += h.squash;
    lift = h.lift;
  }
  const crownY = feet - lift - bodyHeight("blip", size) * (1 + squash);
  glow(ctx, CX, feet - 230, 470, "#ffb057", 0.16);
  mascot(ctx, {
    who: "blip", x: CX, y: feet - lift, ground: feet, size, t, squash,
    mood: strain ? "strain" : "thinking", eyes: strain ? [0, 0] : [0.6, -2.4],
    tremble: strain ? (best ? 4.5 : 2.8) : 0.8, sweat: 1, blink: strain ? 0 : undefined,
  });
  const cardY = crownY - 100 + 8;
  statusCard(ctx, CX + noise(t * 26, 4) * (strain ? 3 : 1), cardY, 840, 200, { pct: 99, t, rot: noise(t * 1.6, 8) * 0.022 });
  if (strain) {
    effort(ctx, t, CX - 300, cardY + 130, -1);
    effort(ctx, t + 0.13, CX + 300, cardY + 130, 1);
  }
  sweatDrops(ctx, t, CX, crownY + 80, 250, best ? 0.22 : 0.3);
  vignette(ctx, NIGHT.vignette);
  ctx.restore();

  if (best) {
    const line = "(it's trying its best)";
    const size2 = fitSize(ctx, [line], 92, 920, 800);
    ctx.save();
    shadowed(ctx);
    popWords(ctx, line, CX, 470, t, CUE.best + 0.12, { size: size2, weight: 800, color: FACE, stagger: 0.06 });
    ctx.restore();
  } else {
    hookText(ctx, hook);
  }
}

/* ────────────────────────── 2 · Every. Single. Prompt. ────────────────────────── */

function montage(ctx, t) {
  const cut = t < CUE.clock ? 0 : t < CUE.phone ? 1 : 2;
  const u = t - [CUE.mug, CUE.clock, CUE.phone][cut];
  ctx.save();
  camera(ctx, 1 + 0.09 * (1 - ease.out3(seg(u, 0, 0.2))), CX, 1150);
  room(ctx, t, NIGHT, { floorY: cut === 0 ? 1450 : 2400, glowX: 300, glowY: 1000 });
  if (cut === 0) {
    const cold = ease.inOut2(seg(u, 0.22, 0.55));
    glow(ctx, CX, 1150, 620, "#ffb057", 0.22 * (1 - cold));
    mug(ctx, CX, 1450, 470, { steam: 1 - cold, cold, t });
  } else if (cut === 1) {
    clock(ctx, CX, 1150, 310, 0.15 + 5 * ease.inOut2(seg(u, 0.03, 0.62)));
  } else {
    phone(ctx, CX, 1190, 470, 860, 140 + 5200 * ease.inOut3(seg(u, 0.02, 0.58)));
  }
  vignette(ctx, 0.5);
  ctx.restore();

  ctx.save();
  shadowed(ctx);
  const size = 136;
  popWords(ctx, "Every.", CX, 360, t, CUE.mug, { size, color: FACE });
  popWords(ctx, "Single.", CX, 505, t, CUE.clock, { size, color: FACE });
  popWords(ctx, "Prompt.", CX, 650, t, CUE.phone, { size, color: FACE, highlight: { word: "Prompt.", at: CUE.phone + 0.04, color: FACE, text: INK } });
  ctx.restore();
}

/* ────────────────────────── 3 · A real fact ────────────────────────── */

const FACT = { x: 70, y: 250, w: 940, h: 920 };

function factCard(ctx, t, dy = 0, sy = 1) {
  const { x, y, w, h } = FACT;
  ctx.save();
  ctx.translate(0, dy);
  ctx.translate(CX, y + h);
  ctx.scale(1 / Math.sqrt(sy), sy);
  ctx.translate(-CX, -(y + h));
  softShadow(ctx, x, y, w, h, 46, 0.6, 54, 30);
  ctx.fillStyle = PAPER;
  rrect(ctx, x, y, w, h, 46);
  ctx.fill();

  pill(ctx, 120, 330, "REAL AI FACT", { anchor: "left", bg: INK, fg: FACE, size: 28, weight: 800, family: "body", spacing: 3, padX: 26, h: 58 });
  const hs = fitSize(ctx, ["Developers using", "AI agents"], 86, 840, 900);
  text(ctx, "Developers using", 120, 470, { size: hs, weight: 900, align: "left" });
  text(ctx, "AI agents", 120, 470 + hs * 1.0, { size: hs, weight: 900, align: "left" });

  const base = 990;
  const maxH = 290;
  const grow = ease.out3(seg(t, CUE.factLand + 0.05, CUE.count));
  const c = lerp(31, 59, ease.out3(seg(t, CUE.count, CUE.countEnd)));
  const lh = ((maxH * 31) / 59) * grow;
  const rh = ((maxH * c) / 59) * grow;
  ctx.fillStyle = "#d3cbbb";
  ctx.beginPath();
  ctx.roundRect(330 - 115, base - lh, 230, lh, [18, 18, 4, 4]);
  ctx.fill();
  const blue = ctx.createLinearGradient(0, base - rh, 0, base);
  blue.addColorStop(0, "#6fa0f5");
  blue.addColorStop(1, "#3f73da");
  ctx.fillStyle = blue;
  ctx.beginPath();
  ctx.roundRect(750 - 115, base - rh, 230, rh, [18, 18, 4, 4]);
  ctx.fill();
  if (grow > 0.25) {
    text(ctx, "31%", 330, base - lh - 28, { size: 84, weight: 900, alpha: grow });
    const landed = 1 + 0.12 * bump(t, CUE.countEnd, 0.25);
    ctx.save();
    ctx.translate(750, base - rh - 28);
    ctx.scale(landed, landed);
    text(ctx, `${Math.round(c)}%`, 0, 0, { size: 84, weight: 900, color: "#2f63c9", alpha: grow });
    ctx.restore();
  }
  ctx.fillStyle = "#cfc7b7";
  ctx.fillRect(170, base, 740, 4);
  text(ctx, "2025", 330, 1046, { size: 34, weight: 700, family: "body", color: "#6f6a60" });
  text(ctx, "April 2026", 750, 1046, { size: 34, weight: 700, family: "body", color: "#6f6a60" });

  // "nearly 2×", once the count lands: a pill between the bars with an arrow climbing to the right.
  const ak = pop(t, CUE.countEnd, 0.35, 2.2);
  if (ak > 0) {
    const arrow = (c, ax, ay, s) => {
      c.save();
      c.strokeStyle = FACE;
      c.lineWidth = s * 0.16;
      c.lineCap = "round";
      c.lineJoin = "round";
      c.beginPath();
      c.moveTo(ax - s * 0.38, ay + s * 0.34);
      c.lineTo(ax + s * 0.34, ay - s * 0.34);
      c.moveTo(ax - s * 0.06, ay - s * 0.36);
      c.lineTo(ax + s * 0.36, ay - s * 0.36);
      c.lineTo(ax + s * 0.36, ay + s * 0.06);
      c.stroke();
      c.restore();
    };
    pill(ctx, 540, 900, "nearly 2×", { bg: "#2f63c9", fg: FACE, size: 28, weight: 800, family: "body", h: 56, padX: 16, scale: ak, icon: arrow });
  }
  text(ctx, "Source: Stack Overflow Developer Survey 2025", 120, 1100, { size: 26, weight: 500, family: "body", color: "#7a756b", align: "left" });
  text(ctx, "and its April 2026 pulse survey.", 120, 1136, { size: 26, weight: 500, family: "body", color: "#7a756b", align: "left" });
  ctx.restore();
}

function factScene(ctx, t) {
  const land = CUE.factLand;
  const [sx, sy] = impact(t, land, 24, 0.4);
  ctx.save();
  ctx.translate(sx, sy);
  room(ctx, t, NIGHT, { floorY: 1640, glowX: 540, glowY: 1500 });
  // Starts with its lower edge already in view, so the cut is never an empty sky.
  const fall = t < land ? -1000 * (1 - ease.in3(seg(t, CUE.fact, land))) : 0;
  factCard(ctx, t, fall, 1 - 0.04 * wobble(t, land, 5, 8));
  dust(ctx, t, land, 130, 1170);
  dust(ctx, t, land, 950, 1170);

  const feet = 1640;
  const size = 280;
  let mood = t < land ? "alert" : "wow";
  let eyes = [0, -3];
  let sweat = 0;
  let { lift, squash } = hops(t, [[land, 0.3, 80]]);
  squash += breathe(t, 1);
  if (t < land) squash -= 0.1 * seg(t, CUE.fact, land);
  if (t >= land + 0.35) mood = "thinking";
  if (t >= CUE.count) { mood = t > 6.5 ? "wow" : "thinking"; eyes = [2.2, -3]; }
  if (t >= CUE.lot) {
    mood = "sleepy";
    eyes = [0, 1];
    squash -= 0.1 * ease.out3(seg(t, CUE.lot, CUE.lot + 0.3));
    sweat = 1;
  }
  mascot(ctx, { who: "blip", x: CX, y: feet - lift, ground: feet, size, t, mood, eyes, squash, sweat });
  vignette(ctx, 0.4);
  ctx.restore();

  ctx.save();
  shadowed(ctx);
  const line = "That's a lot of waiting.";
  popWords(ctx, line, CX, 1300, t, CUE.lot, { size: fitSize(ctx, [line], 72, 900, 800), weight: 800, color: FACE, stagger: 0.05 });
  ctx.restore();
}

/* ────────────────────────── 4 · What if the wait… paid you? ────────────────────────── */

const TW = { feet: 1480, size: 400 };

function coinState(t) {
  if (t < CUE.coin || t >= CUE.split + 0.32) return null;
  if (t < CUE.split) {
    const p = seg(t, CUE.coin, CUE.split);
    // Drops out of the card's lower edge, growing as it comes towards us.
    return { whole: true, x: CX, y: lerp(575, 790, ease.out3(p)) + 18 * Math.sin(Math.PI * p), r: lerp(26, 86, ease.out3(p)), spin: t * 16 };
  }
  const p = ease.out3(seg(t, CUE.split, CUE.split + 0.24));
  return { whole: false, p, x: CX, y: 790, alpha: 1 - seg(t, CUE.split + 0.2, CUE.split + 0.32) };
}

function twistScene(ctx, t, { withBlip = true } = {}) {
  const gk = ease.inOut2(seg(t, CUE.gold, CUE.gold + 0.4));
  const pal = blend(NIGHT, GOLD, gk);
  const punch = t >= CUE.drop ? 1 + 0.06 * (1 - ease.out3(seg(t, CUE.drop, CUE.drop + 0.45))) : 1;
  const [sx, sy] = impact(t, CUE.drop, 12, 0.3);
  ctx.save();
  ctx.translate(sx, sy);
  camera(ctx, punch, CX, 1100);
  room(ctx, t, pal);
  lamp(ctx, 60, TW.feet, 1 - gk, 1 - gk);
  rays(ctx, t, CX, 1320, 0.2 * gk);

  const coinNow = coinState(t);
  if (withBlip) {
    const { feet, size } = TW;
    const { lift, squash: hopSquash } = hops(t, [[CUE.badge, 0.3, 70], [CUE.drop, 0.36, 60], [CUE.drop + 0.75, 0.3, 40], [CUE.drop + 1.25, 0.3, 40]]);
    const squash = hopSquash + breathe(t, 1, 0.02);
    let mood = "alert";
    if (t >= CUE.card) mood = "wow";
    if (t >= CUE.split + 0.15) mood = "happy";
    let eyes = [0, 0];
    if (coinNow?.whole) eyes = [clamp((coinNow.x - CX) / 60, -3, 3), clamp((coinNow.y - headY("blip", feet, size)) / 120, -3, 3)];
    else if (t >= CUE.card && t < CUE.split) eyes = [1.5, -3];
    const badge = pop(t, CUE.badge, 0.28) * (1 - seg(t, CUE.card - 0.1, CUE.card + 0.1));
    glow(ctx, CX, feet - 200, 380, "#ffffff", 0.18 * gk);
    mascot(ctx, {
      who: "blip", x: CX, y: feet - lift, ground: feet, size, t, mood, eyes, squash, badge,
      blush: ease.out3(seg(t, CUE.split + 0.1, CUE.split + 0.4)), badgeStroke: "#141a33",
    });
    ring(ctx, t, CUE.badge, CX + (16 / 48) * size, feet - (35 / 48) * size, 30, 170, "#ffd27a", 12, 0.45);
  }

  // The sponsored card arrives, and gives up a coin.
  const inK = ease.out3(seg(t, CUE.card, CUE.card + 0.28));
  const outK = ease.in3(seg(t, CUE.split + 0.12, CUE.split + 0.32));
  if (inK > 0 && outK < 1) {
    ctx.save();
    ctx.globalAlpha *= 1 - seg(t, CUE.split + 0.12, CUE.split + 0.2);
    sponsoredCard(ctx, 150 + (1 - inK) * 980, 330 - outK * 760, 780, 230);
    ctx.restore();
  }
  if (coinNow?.whole) coin(ctx, coinNow.x, coinNow.y, coinNow.r, coinNow.spin);
  else if (coinNow) {
    const { p } = coinNow;
    for (const [side, tx] of [["left", 330], ["right", 750]]) {
      ctx.save();
      ctx.translate(lerp(CX, tx, p), lerp(790, 910, p) - 110 * Math.sin(Math.PI * p));
      ctx.rotate((side === "left" ? -0.7 : 0.7) * p);
      coin(ctx, 0, 0, lerp(86, 56, p), 0, side, coinNow.alpha);
      ctx.restore();
    }
  }
  ring(ctx, t, CUE.split, CX, 790, 40, 240, MONEY, 14, 0.4);
  if (t >= CUE.split && t < CUE.split + 0.5) {
    for (let i = 0; i < 10; i += 1) {
      const a = (i / 10) * TAU + 0.3;
      const k = ease.out3(seg(t, CUE.split, CUE.split + 0.45));
      sparkle(ctx, CX + Math.cos(a) * 200 * k, 790 + Math.sin(a) * 200 * k, 22 * (1 - k), MONEY, 1);
    }
  }
  // Half to you, half to ADCode.
  const ck = pop(t, CUE.split + 0.22, 0.3);
  const exit = 1 - seg(t, 13.0, 13.15);
  pill(ctx, 330, 910, "+$0.04 · you", { bg: MONEY, fg: INK, size: 40, weight: 900, scale: ck, alpha: exit });
  pill(ctx, 750, 910, "+$0.04 · ADCode", { bg: INK, fg: FACE, size: 40, weight: 900, scale: ck, alpha: exit });
  if (ck > 0) {
    [[-195, -48], [182, -44], [-172, 50], [198, 38], [10, -72], [-40, 72]].forEach(([dx, dy], i) => {
      const tw = 0.5 + 0.5 * Math.sin(t * 7 + i * 2.1);
      sparkle(ctx, 330 + dx, 910 + dy, 18 * tw * exit * ck, MONEY, 1);
    });
  }
  vignette(ctx, pal.vignette);
  ctx.restore();

  // The question.
  const bk = pop(t, CUE.ask, 0.3) * (1 - ease.in3(seg(t, CUE.card - 0.12, CUE.card + 0.02)));
  bubble(ctx, { x: 110, y: 470, w: 860, h: 330, tailX: 600, tailY: 930, k: bk }, (c) => {
    const words = LINES.ask.reveal;
    const size = fitSize(c, ["What if the wait…"], 98, 760, 900);
    popWords(c, "What if the wait…", CX, 610, t, 0, { size, times: words.slice(0, 4).map((r) => r.t), d: 0.18 });
    popWords(c, "paid you?", CX, 610 + size * 1.1, t, 0, {
      size, times: words.slice(4).map((r) => r.t), d: 0.18, highlight: { word: "paid", at: words[4].t + 0.1, color: MONEY },
    });
  });

  // The answer.
  if (t >= CUE.drop) {
    const lines = ["Get paid", "to wait."];
    const size = fitSize(ctx, lines, 180, 940, 900);
    popWords(ctx, lines[0], CX, 450, t, CUE.drop, { size, alpha: exit, highlight: { word: "paid", at: CUE.drop + 0.2, color: MONEY } });
    popWords(ctx, lines[1], CX, 450 + size * 0.98, t, CUE.drop + 0.12, { size, alpha: exit });
    popWords(ctx, "Half the ad money is yours.", CX, 450 + size * 0.98 + 100, t, CUE.drop + 0.3, { size: 50, weight: 800, alpha: exit, stagger: 0.04 });
  }
  if (t >= CUE.card) {
    const color = mix(FACE, INK, gk);
    text(ctx, "Occasional sponsored card. Example amount. Earnings vary.", CX, 1030, {
      size: 30, weight: 500, family: "body", color, alpha: 0.85 * seg(t, CUE.card, CUE.card + 0.2) * exit, fit: 820,
    });
  }
}

/** The fact card leaving upwards at the cut to the idea. */
function factExit(ctx, t) {
  const k = ease.in3(seg(t, CUE.badge, CUE.badge + 0.2));
  if (k >= 1) return;
  factCard(ctx, t, -1900 * k);
}

/* ────────────────────────── 5 · Build with AI ────────────────────────── */

const CREW = ["hex", "pip", "bloom", "patch", "quill"];
const ROW = { hex: 176, pip: 358, bloom: 540, patch: 722, quill: 904 };
const ROW_FEET = 1330;
const ROW_SIZE = 150;
const FRONT = { x: CX, y: 1600, size: 230 };
const STAGE = { x: CX, y: 1200, size: 310 };
const CARD = { x: 150, y: 450, w: 780, h: 620 };
/** What each one's act points at on the page. */
const TARGET = {
  blip: [CARD.x + 260, CARD.y + 210],
  hex: [CARD.x + 131, CARD.y + CARD.h - 58],
  pip: [CARD.x + 360, CARD.y + CARD.h - 58],
  bloom: [CARD.x + 170, CARD.y + 372],
  patch: null,
  quill: [CARD.x + 608, CARD.y + CARD.h - 58],
};
const ACT = { blip: 0, hex: 1, pip: 2, bloom: 3, patch: 4, quill: 5 };
const bugAt = (t) => [CARD.x + 300 + (Math.min(t, CUE.acts[4]) - CUE.work) * 230, CARD.y + 470 + Math.sin(Math.min(t, CUE.acts[4]) * 14) * 6];

/** Where `who` is during the introductions: entering, centre stage, then off to its place. */
function introPose(who, i, t) {
  const Ti = CUE.intro[i];
  const slot = who === "blip" ? FRONT : { x: ROW[who], y: ROW_FEET, size: ROW_SIZE };
  const side = i % 2 ? -1 : 1;
  const start = who === "blip" ? { x: CX, y: TW.feet, size: TW.size } : { x: CX + side * 900, y: 900, size: STAGE.size };
  const tIn = 0.18;
  const tHold = 0.42;
  const tMove = 0.2;
  if (t < Ti) return who === "blip" ? { ...start, ground: start.y, land: -1 } : null;
  if (t < Ti + tIn) {
    const p = ease.out3(seg(t, Ti, Ti + tIn));
    const ground = lerp(start.y, STAGE.y, p);
    return { x: lerp(start.x, STAGE.x, p), y: ground - (who === "blip" ? 160 : 260) * Math.sin(Math.PI * p), size: lerp(start.size, STAGE.size, p), ground, air: true };
  }
  if (t < Ti + tHold) return { ...STAGE, ground: STAGE.y, land: Ti + tIn, hold: true };
  if (t < Ti + tHold + tMove) {
    const p = ease.inOut3(seg(t, Ti + tHold, Ti + tHold + tMove));
    const ground = lerp(STAGE.y, slot.y, p);
    return { x: lerp(STAGE.x, slot.x, p), y: ground - 140 * Math.sin(Math.PI * p), size: lerp(STAGE.size, slot.size, p), ground, air: true };
  }
  return { ...slot, ground: slot.y, land: Ti + tHold + tMove };
}

/** A personality beat while centre stage. */
function quirk(who, t, Ti) {
  const a = t - (Ti + 0.18);
  if (a < 0 || a > 0.24) return {};
  switch (who) {
    case "blip": return { rot: 0.1 * Math.sin(TAU * 4 * a) };
    case "hex": return { mood: "thinking", eyes: [Math.sin(TAU * 3 * a) > 0 ? 2.8 : -2.8, 0] };
    case "pip": { const h = hops(t, [[Ti + 0.2, 0.1, 34], [Ti + 0.31, 0.1, 34]]); return { lift: h.lift, squash: h.squash }; }
    case "bloom": return { rot: 0.28 * Math.sin(TAU * 2.5 * a) * (1 - a / 0.24), sparkles: true };
    case "patch": return { mood: "alert", squash: 0.08 * Math.sin(TAU * 5 * a) };
    case "quill": return { rot: 0.3 * bump(t, Ti + 0.2, 0.24), mood: "proud" };
    default: return {};
  }
}

function browserCard(ctx, t) {
  const k = pop(t, CUE.work - 0.06, 0.36, 1.6);
  if (k <= 0) return;
  const { x, y, w, h } = CARD;
  const A = CUE.acts;
  ctx.save();
  ctx.translate(CX, y + h / 2);
  ctx.scale(0.85 + 0.15 * k, 0.85 + 0.15 * k);
  ctx.translate(-CX, -(y + h / 2));
  ctx.globalAlpha *= clamp(k * 1.6);
  softShadow(ctx, x, y, w, h, 30, 0.3, 40, 22);
  ctx.fillStyle = "#ffffff";
  rrect(ctx, x, y, w, h, 30);
  ctx.fill();
  ctx.fillStyle = "#f3eee4";
  ctx.beginPath();
  ctx.roundRect(x, y, w, 64, [30, 30, 0, 0]);
  ctx.fill();
  for (let i = 0; i < 3; i += 1) {
    ctx.fillStyle = "#d9d2c4";
    ctx.beginPath();
    ctx.arc(x + 38 + i * 26, y + 32, 9, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = "#ffffff";
  rrect(ctx, x + 124, y + 14, 330, 36, 18);
  ctx.fill();
  const live = t >= CUE.works;
  ctx.fillStyle = live ? CAST.blip.color : "#d9d2c4";
  ctx.beginPath();
  ctx.arc(x + 146, y + 32, 7, 0, TAU);
  ctx.fill();
  text(ctx, "localhost:5173", x + 162, y + 40, { size: 22, weight: 500, family: "mono", color: "#7a756b", align: "left", critical: false });
  text(ctx, "Illustration", x + w - 28, y + 40, { size: 20, weight: 500, family: "body", color: "#aaa396", align: "right", critical: false });

  // Blip: nav, the headline, the picture.
  const kb = ease.out3(seg(t, A[0], A[0] + 0.3));
  ctx.fillStyle = CAST.blip.color;
  ctx.beginPath();
  ctx.arc(x + 62, y + 112, 14 * kb, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "#e4ded2";
  for (let j = 0; j < 3; j += 1) {
    rrect(ctx, x + w - 300 + j * 92, y + 106, 64 * kb, 12, 6);
    ctx.fill();
  }
  const hello = "Hello, world.";
  const n = Math.round(seg(t, A[0], A[0] + 0.32) * hello.length);
  if (n > 0) text(ctx, hello.slice(0, n), x + 50, y + 232, { size: 64, weight: 900, align: "left", critical: n === hello.length });
  ctx.fillStyle = "#e9e3d7";
  rrect(ctx, x + 50, y + 266, 380 * kb, 16, 8);
  ctx.fill();
  rrect(ctx, x + 50, y + 296, 280 * kb, 16, 8);
  ctx.fill();
  const ix = x + 506;
  const iy = y + 150;
  if (kb < 1) {
    ctx.save();
    ctx.setLineDash([14, 12]);
    ctx.strokeStyle = "#d9d2c4";
    ctx.lineWidth = 4;
    rrect(ctx, ix, iy, 226, 250, 26);
    ctx.stroke();
    ctx.restore();
  }
  if (kb > 0) {
    ctx.save();
    ctx.globalAlpha *= kb;
    const g = ctx.createLinearGradient(ix, iy, ix + 226, iy + 250);
    g.addColorStop(0, "#9cbcff");
    g.addColorStop(1, CAST.hex.color);
    ctx.fillStyle = g;
    rrect(ctx, ix, iy, 226, 250, 26);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.beginPath();
    ctx.arc(ix + 166, iy + 70, 26, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.beginPath();
    ctx.moveTo(ix + 20, iy + 230);
    ctx.lineTo(ix + 100, iy + 120);
    ctx.lineTo(ix + 160, iy + 190);
    ctx.lineTo(ix + 180, iy + 150);
    ctx.lineTo(ix + 214, iy + 230);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Bloom: the button gets its polish.
  const kp = ease.out3(seg(t, A[3], A[3] + 0.3));
  ctx.fillStyle = mix("#ddd7cb", CAST.bloom.color, kp);
  rrect(ctx, x + 50, y + 340, lerp(206, 236, kp), 64, lerp(6, 32, kp));
  ctx.fill();
  text(ctx, "Get started", x + 50 + lerp(206, 236, kp) / 2, y + 381, { size: 26, weight: 700, family: "body", color: mix("#77736b", "#ffffff", kp), critical: false });
  if (kp > 0 && kp < 1) {
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * TAU + t * 3;
      sparkle(ctx, x + 168 + Math.cos(a) * 150 * kp, y + 372 + Math.sin(a) * 60 * kp, 16 * (1 - kp) + 4, CAST.bloom.color, 1);
    }
  }

  // Patch: the bug, until it is squashed.
  const [bx, by] = bugAt(t);
  if (t < A[4]) bug(ctx, bx, by, 34, t);
  else splat(ctx, bx, by, 46 * ease.outBack(seg(t, A[4], A[4] + 0.15)), CAST.patch.color, 1 - seg(t, A[4] + 0.3, A[4] + 0.6));

  // Hex: the magnifier passes over the page.
  if (t > A[1] - 0.05 && t < A[1] + 0.45) {
    const p = ease.inOut2(seg(t, A[1] - 0.05, A[1] + 0.4));
    magnifier(ctx, x + lerp(120, 430, p), y + 200 + Math.sin(p * TAU) * 20, 54);
  }

  // Proof of work: what each one actually did.
  const chipIcon = (c, cx, cy, s) => check(c, cx, cy, s, FACE, s * 0.2);
  const chip = (label, cx, color, at) => pill(ctx, cx, y + h - 58, label, {
    bg: color, fg: FACE, size: 24, weight: 800, family: "body", h: 46, padX: 18, scale: pop(t, at, 0.3), icon: chipIcon, critical: false,
  });
  chip("Reviewed", x + 131, CAST.hex.color, A[1] + 0.25);
  chip("12 tests passed", x + 360, CAST.pip.color, A[2] + 0.2);
  chip("Docs written", x + 608, CAST.quill.color, A[5] + 0.2);
  ctx.restore();
}

function buildScene(ctx, t) {
  const works = CUE.works;
  const punch = t >= works ? 1 + 0.05 * (1 - ease.out3(seg(t, works, works + 0.4))) : 1;
  ctx.save();
  camera(ctx, punch, CX, 900);
  room(ctx, t, CREAM, { floorY: 1340, glowX: 540, glowY: 700 });
  browserCard(ctx, t);
  confetti(ctx, t, works + 0.02, CX, CARD.y + 30, 700, 130, 3);

  const everyone = ["blip", ...CREW];
  // Draw the row first, then whoever is centre stage, then Blip in front.
  const order = [...CREW].sort((a, b) => (introPose(a, everyone.indexOf(a), t)?.hold ? 1 : 0) - (introPose(b, everyone.indexOf(b), t)?.hold ? 1 : 0));
  for (const who of [...order, "blip"]) {
    const i = everyone.indexOf(who);
    const pose = introPose(who, i, t);
    if (!pose) continue;
    let { x, y, size, ground } = pose;
    let squash = breathe(t, i + 1);
    let rot = 0;
    let mood = "happy";
    let eyes = [clamp((CX - x) / 120, -2.5, 2.5), -0.5];
    let blush = 0;
    if (pose.land > 0) {
      const a = t - pose.land;
      squash += -0.2 * Math.exp(-11 * a) * Math.cos(a * 30);
    }
    if (pose.air) squash += 0.1;
    if (pose.hold) {
      const q = quirk(who, t, CUE.intro[i]);
      rot = q.rot ?? 0;
      mood = q.mood ?? mood;
      eyes = q.eyes ?? [0, 0];
      squash += q.squash ?? 0;
      y -= q.lift ?? 0;
      if (q.sparkles) for (let k = 0; k < 5; k += 1) sparkle(ctx, x + Math.cos(k * 1.3 + t * 5) * size * 0.6, y - size * 0.5 + Math.sin(k * 1.3 + t * 5) * size * 0.4, 18, CAST.bloom.color, 0.9);
    }
    // The build: thinking until its act lands, proud after; a hop and a trail to the page.
    if (t >= CUE.work && !pose.air && !pose.hold) {
      const act = CUE.acts[ACT[who]];
      mood = t < act ? "thinking" : "proud";
      eyes = [clamp((CX - x) / 150, -2, 2), -2.6];
      const h = hop(t, act, 0.32, who === "blip" ? 70 : 90);
      y -= h.lift;
      squash += h.squash;
      const target = who === "patch" ? bugAt(act) : TARGET[who];
      trail(ctx, t, act, x, y - size * 0.75, target[0], target[1], CAST[who].color);
    }
    // It works.
    if (t >= works - 0.1) {
      const h = hops(t, [[works + i * 0.04, 0.42, who === "blip" ? 190 : 170], [works + 0.8 + i * 0.03, 0.3, 70]]);
      y -= h.lift;
      squash += h.squash;
      if (t >= works) { mood = "happy"; blush = 1; eyes = [0, -1]; }
    }
    mascot(ctx, { who, x, y, ground, size, t, mood, eyes, squash, rot, blush });
    if (t >= CUE.work + 0.1 && !pose.air && !pose.hold && who !== "blip" && t < CUE.news + WHIP) {
      text(ctx, CAST[who].name, x, ROW_FEET + 40, { size: 28, weight: 800, family: "body", color: "#6b6457", critical: false, alpha: seg(t, CUE.work, CUE.work + 0.2) });
    }
  }
  vignette(ctx, CREAM.vignette);
  ctx.restore();

  // Copy.
  const head = "Build with AI.";
  const hs = fitSize(ctx, [head], 128, 920, 900);
  popWords(ctx, head, CX, 340, t, CUE.build + 0.12, { size: hs, alpha: 1 - seg(t, works - 0.1, works) });
  if (t >= works) {
    ctx.save();
    ctx.translate(CX, 360);
    ctx.rotate(0.05 * wobble(t, works, 4, 5));
    popWords(ctx, "It works!", 0, 0, t, works, { size: fitSize(ctx, ["It works!"], 170, 920, 900), stagger: 0.08 });
    ctx.restore();
  }
  for (let i = 0; i < 6; i += 1) {
    const who = ["blip", ...CREW][i];
    const Ti = CUE.intro[i];
    const until = i === 5 ? CUE.work : Ti + 0.5;
    if (t < Ti + 0.02 || t >= until) continue;
    const alpha = 1 - seg(t, until - 0.03, until);
    const nameW = popWords(ctx, CAST[who].name, CX, 720, t, Ti + 0.02, { size: 150, alpha, d: 0.24 });
    const u = ease.out3(seg(t, Ti + 0.1, Ti + 0.3));
    ctx.fillStyle = CAST[who].color;
    ctx.globalAlpha = alpha;
    rrect(ctx, CX - (nameW * 0.6 * u) / 2, 748, nameW * 0.6 * u, 14, 7);
    ctx.fill();
    ctx.globalAlpha = 1;
    popWords(ctx, CAST[who].role, CX, 830, t, Ti + 0.05, { size: 54, weight: 700, family: "body", color: "#6b6457", alpha, d: 0.22, stagger: 0.03 });
  }
}

/* ────────────────────────── 6 · New in ADCode ────────────────────────── */

const NEWS = { x: 100, y: 400, w: 880, h: 700 };

function newsCard(ctx, t) {
  const { x, y, w, h } = NEWS;
  const [c0, c1, c2] = CUE.cards;
  const idx = t < c1 ? 0 : t < c2 ? 1 : 2;
  let flip = 1;
  for (const s of [c1, c2]) if (t > s - 0.13 && t < s + 0.13) flip = Math.max(0.02, Math.abs(Math.cos(Math.PI * seg(t, s - 0.13, s + 0.13))));
  const k = pop(t, c0 + 0.05, 0.36, 1.7);
  if (k <= 0) return;
  ctx.save();
  ctx.translate(CX, y + h / 2);
  ctx.scale(flip * (0.8 + 0.2 * k), 0.8 + 0.2 * k);
  ctx.translate(-CX, -(y + h / 2));
  ctx.globalAlpha *= clamp(k * 1.6);
  softShadow(ctx, x, y, w, h, 48, 0.3, 44, 24);
  ctx.fillStyle = "#ffffff";
  rrect(ctx, x, y, w, h, 48);
  ctx.fill();

  if (idx === 0) {
    const mk = pop(t, c0 + 0.15, 0.35);
    ctx.save();
    ctx.translate(CX, y + 190);
    ctx.scale(mk, mk);
    mark(ctx, -130, -130, 260, INK);
    ctx.restore();
    const ts = fitSize(ctx, ["Open source"], 132, 760, 900);
    popWords(ctx, "Open source", CX, y + 470, t, c0 + 0.22, { size: ts });
    popWords(ctx, "Apache-2.0. Read every line.", CX, y + 555, t, c0 + 0.28, { size: 46, weight: 600, family: "body", color: "#5f5a50", stagger: 0.03 });
    text(ctx, "LICENSE · Apache License 2.0", CX, y + 640, { size: 26, weight: 500, family: "mono", color: "#9a948a", alpha: seg(t, c0 + 0.5, c0 + 0.7), critical: false });
  } else if (idx === 1) {
    const ts = fitSize(ctx, ["Run 3 agents at once"], 100, 780, 900);
    popWords(ctx, "Run 3 agents at once", CX, y + 140, t, c1 + 0.02, { size: ts, stagger: 0.05 });
    popWords(ctx, "Your crew works in parallel.", CX, y + 210, t, c1 + 0.12, { size: 42, weight: 600, family: "body", color: "#5f5a50", stagger: 0.03 });
    ["hex", "pip", "bloom"].forEach((who, j) => {
      const ly = y + 280 + j * 128;
      const p = ease.inOut2(seg(t, c1 + 0.2, c1 + 0.2 + [0.85, 1.05, 0.7][j]));
      mascot(ctx, { who, x: x + 110, y: ly + 100, size: 96, t, mood: p < 1 ? "thinking" : "proud", eyes: [2, 0], shadow: 0.6 });
      text(ctx, CAST[who].name, x + 185, ly + 42, { size: 30, weight: 800, family: "body", color: INK, align: "left", critical: false });
      ctx.fillStyle = "#efe9de";
      rrect(ctx, x + 185, ly + 62, 520, 24, 12);
      ctx.fill();
      ctx.fillStyle = CAST[who].color;
      rrect(ctx, x + 185, ly + 62, 520 * p, 24, 12);
      ctx.fill();
      const sx = x + w - 90;
      const sy = ly + 74;
      if (p < 1) {
        ctx.strokeStyle = CAST[who].color;
        ctx.lineWidth = 6;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.arc(sx, sy, 20, t * 8 + j, t * 8 + j + 1.8);
        ctx.stroke();
      } else {
        const ok = pop(t, c1 + 0.2 + [0.85, 1.05, 0.7][j], 0.25);
        ctx.fillStyle = CAST[who].color;
        ctx.beginPath();
        ctx.arc(sx, sy, 24 * ok, 0, TAU);
        ctx.fill();
        check(ctx, sx, sy + 1, 26 * ok, FACE, 5);
      }
    });
  } else {
    const ts = fitSize(ctx, ["Race mode"], 130, 780, 900);
    popWords(ctx, "Race mode", CX, y + 150, t, c2 + 0.02, { size: ts });
    const sub = "One task. 3 agents. Keep the best.";
    popWords(ctx, sub, CX, y + 220, t, c2 + 0.12, { size: fitSize(ctx, [sub], 42, 760, 600), weight: 600, family: "body", color: "#5f5a50", stagger: 0.03 });
    const fx = x + w - 110;
    finish(ctx, fx, y + 280, 28, 360);
    const winAt = c2 + 0.25 + 0.85;
    ["patch", "bloom", "pip"].forEach((who, j) => {
      const ly = y + 290 + j * 120;
      ctx.strokeStyle = "#ebe4d7";
      ctx.lineWidth = 4;
      ctx.setLineDash([18, 14]);
      ctx.beginPath();
      ctx.moveTo(x + 50, ly + 106);
      ctx.lineTo(fx - 10, ly + 106);
      ctx.stroke();
      ctx.setLineDash([]);
      const dur = [0.85, 1.05, 1.2][j];
      const p = ease.inOut2(seg(t, c2 + 0.25, c2 + 0.25 + dur));
      const running = p > 0 && p < 1;
      const lift = running ? Math.abs(Math.sin(t * 17 + j * 1.3)) * 24 : 0;
      const loser = who !== "patch" && t > winAt + 0.05;
      const px = lerp(x + 100, fx - 60, p);
      mascot(ctx, {
        who, x: px, y: ly + 100 - lift, ground: ly + 100, size: 92, t,
        mood: t > winAt && who === "patch" ? "happy" : running ? "alert" : "thinking",
        eyes: [2.5, 0], rot: running ? 0.12 : 0, squash: running ? 0.08 * Math.sin(t * 34 + j) : 0,
        alpha: loser ? lerp(1, 0.35, seg(t, winAt + 0.05, winAt + 0.3)) : 1, shadow: 0.6,
      });
      if (who === "patch") {
        const ck = pop(t, winAt, 0.3);
        if (ck > 0) crown(ctx, px, ly + 100 - bodyHeight("patch", 92) - 16, 26 * ck);
      }
    });
    const kept = pop(t, winAt + 0.08, 0.3);
    pill(ctx, x + 200, y + h - 40, "Kept the best", { bg: INK, fg: FACE, size: 26, weight: 800, family: "body", h: 50, padX: 20, scale: kept, critical: false });
  }
  ctx.restore();
}

function newsScene(ctx, t) {
  room(ctx, t, CREAM, { floorY: 1500, glowX: 540, glowY: 760 });
  pill(ctx, CX, 300, "NEW IN ADCODE", { bg: INK, fg: FACE, size: 32, weight: 800, family: "body", spacing: 4, padX: 34, h: 66, scale: pop(t, CUE.news + 0.08, 0.3) });
  newsCard(ctx, t);
  const { lift, squash } = hops(t, [[CUE.cards[0] + 0.05, 0.3, 60], [CUE.cards[1], 0.3, 50], [CUE.cards[2], 0.3, 50], [CUE.cards[2] + 1.12, 0.32, 80]]);
  mascot(ctx, { who: "blip", x: CX, y: 1430 - lift, ground: 1430, size: 260, t, mood: "happy", eyes: [0, -2.6], squash: squash + breathe(t, 1) });
  vignette(ctx, CREAM.vignette);
}

/* ────────────────────────── 7 · Thanks for waiting ────────────────────────── */

function closeScene(ctx, t) {
  const dim = ease.inOut2(seg(t, CUE.close, CUE.close + 0.45));
  room(ctx, t, blend(CREAM, COZY, dim), { floorY: 1460 });
  lamp(ctx, 60, 1460, dim, dim);
  ctx.save();
  ctx.globalAlpha = dim;
  mug(ctx, 330, 1460, 150, { steam: dim, t });
  ctx.restore();
  if (t < CUE.close + 0.35) {
    ctx.save();
    ctx.translate(0, H * ease.in3(seg(t, CUE.close, CUE.close + 0.35)));
    newsCard(ctx, t);
    ctx.restore();
  }
  // A shooting star, for the feeling.
  const sk = seg(t, 24.7, 25.15);
  if (sk > 0 && sk < 1) {
    const sx = lerp(980, 640, sk);
    const sy = lerp(160, 330, sk);
    const g = ctx.createLinearGradient(sx, sy, sx + 180, sy - 90);
    g.addColorStop(0, `rgba(255,250,235,${0.9 * (1 - sk)})`);
    g.addColorStop(1, "rgba(255,250,235,0)");
    ctx.strokeStyle = g;
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + 180, sy - 90);
    ctx.stroke();
  }
  const p = ease.inOut2(seg(t, CUE.close, CUE.close + 0.35));
  const feet = lerp(1430, 1460, p);
  const size = lerp(260, 400, p);
  const x = lerp(CX, 640, p);
  const air = 200 * Math.sin(Math.PI * p);
  const settle = t > CUE.close + 0.35 ? -0.18 * Math.exp(-10 * (t - CUE.close - 0.35)) * Math.cos((t - CUE.close - 0.35) * 28) : 0;
  glow(ctx, x, feet - 200, 380, "#ffb057", 0.2 * dim);
  mascot(ctx, {
    who: "blip", x, y: feet - air, ground: feet, size, t, mood: "proud", eyes: [-0.6, -0.3],
    blush: dim, rot: 0.035 * Math.sin(TAU * 0.6 * t), squash: settle + breathe(t, 1),
  });
  vignette(ctx, COZY.vignette * dim);
  const out = 1 - seg(t, CUE.end - 0.15, CUE.end);
  statusCard(ctx, CX, 335, 620, 170, { pct: 100, done: true, t, scale: pop(t, CUE.done, 0.35), alpha: out });
  ring(ctx, t, CUE.done + 0.1, CX, 335, 120, 420, "#9cbcff", 10, 0.5);
  const bk = pop(t, CUE.thanks - 0.05, 0.3) * (1 - ease.in3(seg(t, CUE.end - 0.15, CUE.end)));
  bubble(ctx, { x: 150, y: 500, w: 780, h: 300, tailX: 640, tailY: 960, k: bk }, (c) => {
    const words = LINES.thanks.reveal;
    const size = fitSize(c, ["Thanks for", "waiting."], 120, 660, 900);
    popWords(c, "Thanks for", CX, 630, t, 0, { size, times: words.slice(0, 2).map((r) => r.t), d: 0.2 });
    popWords(c, "waiting.", CX, 630 + size * 1.04, t, 0, { size, times: words.slice(2).map((r) => r.t), d: 0.2 });
  });
}

/* ────────────────────────── 8 · The end card ────────────────────────── */

const LINEUP = ["hex", "pip", "blip", "bloom", "patch", "quill"];
const LINE_X = [150, 306, 462, 618, 774, 930];

function endScene(ctx, t) {
  const e = CUE.end;
  ctx.save();
  camera(ctx, 1 + 0.025 * ease.inOut2(seg(t, e, CUE.scroll)), CX, 800);
  room(ctx, t, COZY, { floorY: 1610, glowX: 540, glowY: 700 });
  const fade = 1 - seg(t, e, e + 0.3);
  lamp(ctx, 60, 1460, fade, fade);
  if (fade > 0) {
    ctx.save();
    ctx.globalAlpha = fade;
    mug(ctx, 330, 1460, 150, { steam: 1, t });
    ctx.restore();
  }
  glow(ctx, CX, 430, 420, "#ffffff", 0.12 * seg(t, e, e + 0.4));
  LINEUP.forEach((who, i) => {
    let x = LINE_X[i];
    let feet = 1600;
    let size = who === "blip" ? 150 : 130;
    let y = feet;
    if (who === "blip") {
      const p = ease.inOut3(seg(t, e, e + 0.32));
      x = lerp(640, x, p);
      feet = lerp(1460, 1600, p);
      size = lerp(400, 150, p);
      y = feet - 160 * Math.sin(Math.PI * p);
    } else {
      const p = ease.outBack(seg(t, e + 0.1 + i * 0.05, e + 0.4 + i * 0.05), 1.4);
      y = lerp(2150, feet, p);
    }
    const beat = Math.max(0, t - (e + 0.5));
    const bounce = beat > 0 ? Math.abs(Math.sin(Math.PI * (beat / 0.5) + i * 0.6)) * 14 : 0;
    mascot(ctx, { who, x, y: y - bounce, ground: feet, size, t, mood: "happy", eyes: [clamp((CX - x) / 200, -2, 2), -1], blush: 0.8, squash: breathe(t, i + 2, 0.03) });
  });
  vignette(ctx, COZY.vignette);
  ctx.restore();

  const mk = pop(t, e + 0.05, 0.4, 1.8);
  if (mk > 0) {
    ctx.save();
    ctx.translate(CX, 410);
    ctx.scale(mk, mk);
    mark(ctx, -100, -100, 200, FACE);
    ctx.restore();
    ring(ctx, t, e + 0.1, CX, 410, 90, 380, "#ffffff", 8, 0.6);
  }
  ctx.save();
  shadowed(ctx, 0.35, 24, 6);
  popWords(ctx, "ADCode", CX, 690, t, e + 0.2, { size: 128, color: FACE });
  popWords(ctx, "Build with AI.", CX, 805, t, e + 0.35, { size: 76, weight: 800, color: FACE, stagger: 0.05 });
  popWords(ctx, "Get paid to wait.", CX, 897, t, e + 0.45, { size: 76, weight: 800, color: FACE, stagger: 0.05, highlight: { word: "paid", at: e + 0.6, color: MONEY, text: INK } });
  const facts = "Free & open source · Windows & Linux";
  popWords(ctx, facts, CX, 985, t, e + 0.6, { size: fitSize(ctx, [facts], 38, 900, 600), weight: 600, family: "body", color: FACE, alpha: 0.85, stagger: 0.025 });
  ctx.restore();
  const ck = pop(t, e + 0.75, 0.4, 2.4);
  const pulse = 1 + 0.035 * Math.max(0, Math.sin(TAU * 2 * (t - e - 1.2))) * seg(t, e + 1.2, e + 1.3);
  pill(ctx, CX, 1095, "Link in bio", { bg: FACE, fg: INK, size: 56, weight: 900, h: 112, padX: 54, scale: ck * pulse });
  const small = seg(t, e + 0.4, e + 0.55);
  text(ctx, "Bring your own AI key or local model.", CX, 1215, { size: 29, weight: 500, family: "body", color: FACE, alpha: 0.7 * small });
  text(ctx, "Occasional sponsored cards. Earnings vary.", CX, 1255, { size: 29, weight: 500, family: "body", color: FACE, alpha: 0.7 * small });
}

/* ────────────────────────── The cut list ────────────────────────── */

export function draw(ctx, t, hook) {
  resetLayout();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  if (t < CUE.mug) return waiting(ctx, t, hook, "hook");
  if (t < CUE.best) return montage(ctx, t);
  if (t < CUE.fact) return waiting(ctx, t, hook, "best");
  if (t < CUE.badge) return factScene(ctx, t);
  if (t < CUE.build) {
    twistScene(ctx, t);
    factExit(ctx, t);
    return undefined;
  }
  if (t < CUE.build + 0.3) {
    // A circle of daylight opens from Blip and the build stage is inside it.
    twistScene(ctx, t, { withBlip: false });
    ctx.save();
    ctx.beginPath();
    ctx.arc(CX, 1250, 2300 * ease.inOut2(seg(t, CUE.build, CUE.build + 0.3)), 0, TAU);
    ctx.clip();
    buildScene(ctx, t);
    ctx.restore();
    return undefined;
  }
  if (t < CUE.news) return buildScene(ctx, t);
  if (t < CUE.news + WHIP) {
    const e = ease.inOut3(seg(t, CUE.news, CUE.news + WHIP));
    ctx.save();
    ctx.translate(0, -H * e);
    buildScene(ctx, t);
    ctx.restore();
    ctx.save();
    ctx.translate(0, H * (1 - e));
    newsScene(ctx, t);
    ctx.restore();
    return undefined;
  }
  if (t < CUE.close) return newsScene(ctx, t);
  if (t < CUE.end) return closeScene(ctx, t);
  if (t < CUE.scroll) return endScene(ctx, t);
  // The scroll back: the end card flicks up like the next Reel, and frame 0 lands.
  const e = ease.out3(seg(t, CUE.scroll, DURATION));
  ctx.save();
  ctx.translate(0, -H * e);
  endScene(ctx, t);
  ctx.restore();
  ctx.save();
  ctx.translate(0, H * (1 - e));
  waiting(ctx, t - DURATION, hook, "hook");
  ctx.restore();
  return undefined;
}

export { CROWN, measure };
