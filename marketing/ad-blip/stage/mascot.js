/**
 * The mascots, drawn on canvas from ADCode's own agent art.
 *
 * Bodies and faces are copied path for path from apps/desktop/src/renderer/agents/
 * agentMascot.ts (48-unit grid, face stroke 2.4 as in agents.css), and the "!" badge is the
 * app's alert badge. What the film adds is acting: squash and stretch around the feet,
 * blinks, eyes that look somewhere, a mouth that opens on each babble syllable, sweat, blush,
 * and two extra expressions in the same line style - "strain" (>< eyes) and "wow".
 */
import { CAST, talk as talkAt } from "./cues.js";
import { FACE, TAU, WARN, bump, clamp, hash, noise, rgba, shade } from "./kit.js";

const BODIES = {
  circle: "M24 5a19 19 0 1 1 0 38a19 19 0 1 1 0-38z",
  capsule: "M15 9h18a15 15 0 0 1 0 30H15a15 15 0 0 1 0-30z",
  pebble: "M8 23c0-10 8-17 17-17 9.5 0 16 6.5 16 16 0 11-7.5 20-17 20S8 33.5 8 23z",
  drop: "M24 4c6 8 17 15.5 17 25a17 17 0 0 1-34 0c0-9.5 11-17 17-25z",
  hexagon: "M21 5.2a6 6 0 0 1 6 0l12 7a6 6 0 0 1 3 5.2v13.2a6 6 0 0 1-3 5.2l-12 7a6 6 0 0 1-6 0l-12-7a6 6 0 0 1-3-5.2V17.4a6 6 0 0 1 3-5.2z",
  cloud: "M15 39a10 10 0 0 1-2.5-19.7A12 12 0 0 1 35.3 17 9.5 9.5 0 0 1 37 39z",
  squircle: "M24 5c15.5 0 19 3.5 19 19s-3.5 19-19 19S5 39.5 5 24 8.5 5 24 5z",
  egg: "M24 4c9.5 0 16.5 13.5 16.5 23.5a16.5 16.5 0 0 1-33 0C7.5 17.5 14.5 4 24 4z",
};
/** Where each body touches the ground, in grid units. */
const FEET = { circle: 43, capsule: 39, pebble: 42, drop: 46, hexagon: 42.8, cloud: 39, squircle: 43, egg: 44 };
/** Top of each body, for placing things above a head. */
export const CROWN = { circle: 5, capsule: 9, pebble: 6, drop: 4, hexagon: 5, cloud: 7.5, squircle: 5, egg: 4 };

const FACES = {
  sleepy: [
    { d: "M15.5 25.5q3 2.2 6 0", part: "eye" },
    { d: "M26.5 25.5q3 2.2 6 0", part: "eye" },
    { d: "M22 32.5h4", part: "mouth" },
  ],
  thinking: [
    { d: "M17.5 20.5a2 2.6 0 1 1 0 .01z", fill: true, part: "eye" },
    { d: "M28.5 20.5a2 2.6 0 1 1 0 .01z", fill: true, part: "eye" },
    { d: "M21 31.5h6", part: "mouth" },
  ],
  alert: [
    { d: "M18.5 21a2.6 3 0 1 1 0 .01z", fill: true, part: "eye" },
    { d: "M29.5 21a2.6 3 0 1 1 0 .01z", fill: true, part: "eye" },
    { d: "M24 30.5a2 2 0 1 1 0 .01z", fill: true, part: "mouth" },
  ],
  proud: [
    { d: "M15.5 25q3-3 6 0", part: "eye" },
    { d: "M26.5 25q3-3 6 0", part: "eye" },
    { d: "M19.5 30.5q4.5 3.5 9 0", part: "mouth" },
  ],
  happy: [
    { d: "M18.5 22.5a2.2 2.8 0 1 1 0 .01z", fill: true, part: "eye" },
    { d: "M29.5 22.5a2.2 2.8 0 1 1 0 .01z", fill: true, part: "eye" },
    { d: "M18 29.5q6 6 12 0", part: "mouth" },
  ],
  confused: [
    { d: "M18.5 22.5a2.2 2.8 0 1 1 0 .01z", fill: true, part: "eye" },
    { d: "M29.5 23a1.6 2 0 1 1 0 .01z", fill: true, part: "eye" },
    { d: "M19 32q2.5-2 5 0t5 0", part: "mouth" },
  ],
  // Film-only expressions, in the same line style.
  strain: [
    { d: "M16.2 18.6l4.6 2.6-4.6 2.6", part: "eye" },
    { d: "M33.8 18.6l-4.6 2.6 4.6 2.6", part: "eye" },
    { d: "M19 32q2.5-2 5 0t5 0", part: "mouth" },
  ],
  wow: [
    { d: "M18.2 20.5a3 3.6 0 1 1 0 .01z", fill: true, part: "eye" },
    { d: "M29.8 20.5a3 3.6 0 1 1 0 .01z", fill: true, part: "eye" },
    { d: "M24 29.6a2.6 3 0 1 1 0 .01z", fill: true, part: "mouth" },
  ],
};

const BODY_PATHS = Object.fromEntries(Object.entries(BODIES).map(([k, d]) => [k, new Path2D(d)]));
const FACE_PATHS = Object.fromEntries(Object.entries(FACES).map(([mood, parts]) => [mood, parts.map((p) => {
  const [, , y0] = /^M([\d.]+) ([\d.]+)/.exec(p.d) ?? [];
  return { ...p, path: new Path2D(p.d), y0: Number(y0) };
})]));
const SWEAT = new Path2D("M0-5C2.4-1.6 3.2 0.6 3.2 1.8a3.2 3.2 0 0 1-6.4 0C-3.2 0.6-2.4-1.6 0-5z");
const BADGE_MARK = new Path2D("M40 4.8v3.8M40 11.2v.1");

/** A blink every few seconds, on each mascot's own clock. 0 open, 1 shut. */
export function blinkAt(t, seed) {
  const period = 2.6 + hash(seed, 7) * 1.6;
  const phase = (t + hash(seed, 3) * period) % period;
  const p = phase < 0 ? phase + period : phase;
  return bump(p, 0, 0.16) ** 0.7;
}
/** A slow breath: squash amount around 0. */
export const breathe = (t, seed, amount = 0.025) => amount * Math.sin(TAU * (0.7 + hash(seed, 5) * 0.2) * t + hash(seed, 9) * TAU);

/**
 * Draw `who` with its feet at (x, y). `size` is the 48-unit grid in pixels.
 * squash > 0 stretches tall, < 0 squashes flat; volume is kept.
 */
export function mascot(ctx, o) {
  const look = CAST[o.who];
  const {
    x, y, size, t = 0, mood = "happy", eyes = [0, 0], squash = 0, rot = 0, blink = null, talk = null,
    badge = 0, sweat = 0, blush = 0, alpha = 1, ground = y, shadow = 1, tremble = 0, badgeStroke = "#141a33",
    color = look.color, lean = 0,
  } = o;
  if (alpha <= 0 || size <= 0) return;
  const shape = look.shape;
  const k = size / 48;
  const seed = Object.keys(CAST).indexOf(o.who) + 1;
  const open = talk ?? talkAt(o.who, t);
  const shut = blink ?? blinkAt(t, seed);

  ctx.save();
  ctx.globalAlpha *= alpha;

  // Contact shadow, shrinking as the body leaves the ground.
  if (shadow > 0) {
    const lift = Math.max(0, ground - y);
    const s = 1 / (1 + lift / (size * 0.9));
    const g = ctx.createRadialGradient(x, ground, 0, x, ground, size * 0.42 * s);
    g.addColorStop(0, `rgba(5,8,20,${0.34 * shadow * s})`);
    g.addColorStop(1, "rgba(5,8,20,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, ground, size * 0.42 * s, size * 0.085 * s, 0, 0, TAU);
    ctx.fill();
  }

  const jitter = tremble > 0 ? [noise(t * 38, seed) * tremble, noise(t * 41, seed + 9) * tremble * 0.5] : [0, 0];
  ctx.translate(x + jitter[0], y + jitter[1]);
  ctx.rotate(rot);
  if (lean) ctx.transform(1, 0, -lean, 1, 0, 0);
  const sy = 1 + squash;
  const sx = 1 / Math.sqrt(Math.max(0.2, sy)) ** 1.6;
  ctx.scale(sx * k, sy * k);
  ctx.translate(-24, -FEET[shape]);

  // Body with soft vinyl-toy shading.
  const body = BODY_PATHS[shape];
  ctx.fillStyle = color;
  ctx.fill(body);
  ctx.save();
  ctx.clip(body);
  const hi = ctx.createRadialGradient(16, 12, 0, 16, 12, 30);
  hi.addColorStop(0, "rgba(255,255,255,0.34)");
  hi.addColorStop(0.55, "rgba(255,255,255,0.06)");
  hi.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = hi;
  ctx.fillRect(0, 0, 48, 48);
  const lo = ctx.createLinearGradient(0, 24, 0, 48);
  lo.addColorStop(0, "rgba(0,0,0,0)");
  lo.addColorStop(1, "rgba(10,10,40,0.2)");
  ctx.fillStyle = lo;
  ctx.fillRect(0, 0, 48, 48);
  ctx.restore();

  // Blush under the eyes.
  if (blush > 0) {
    ctx.fillStyle = rgba("#ff8fab", 0.55 * clamp(blush));
    for (const bx of [15, 33]) {
      ctx.beginPath();
      ctx.ellipse(bx + eyes[0] * 0.5, 28.6 + eyes[1] * 0.4, 3.1, 1.7, 0, 0, TAU);
      ctx.fill();
    }
  }

  // Face: eyes and mouth in the face colour, stroked as in the app.
  ctx.save();
  ctx.translate(clamp(eyes[0], -3.2, 3.2), clamp(eyes[1], -3, 3));
  ctx.strokeStyle = FACE;
  ctx.fillStyle = FACE;
  ctx.lineWidth = 2.4;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const part of FACE_PATHS[mood] ?? FACE_PATHS.happy) {
    if (part.part === "mouth" && open > 0.08) continue;
    ctx.save();
    if (part.part === "eye" && part.fill && shut > 0) {
      ctx.translate(0, part.y0);
      ctx.scale(1, 1 - 0.88 * shut);
      ctx.translate(0, -part.y0);
    }
    if (part.fill) ctx.fill(part.path);
    else ctx.stroke(part.path);
    ctx.restore();
  }
  if (open > 0.08) {
    // A talking mouth: cream rim, darker inside.
    const rx = 2.4 + open * 0.8;
    const ry = 0.9 + open * 2.4;
    ctx.beginPath();
    ctx.ellipse(24, 31, rx, ry, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = shade(color, -0.55);
    ctx.beginPath();
    ctx.ellipse(24, 31 + ry * 0.18, rx * 0.68, ry * 0.62, 0, 0, TAU);
    ctx.fill();
  }
  ctx.restore();

  // Sweat at the temple.
  if (sweat > 0) {
    ctx.save();
    ctx.translate(39.5, 14 + Math.sin(t * 9) * 0.4);
    ctx.globalAlpha *= clamp(sweat);
    ctx.fillStyle = "#bfe6ff";
    ctx.fill(SWEAT);
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.beginPath();
    ctx.ellipse(-0.9, 1.4, 0.8, 1.2, -0.3, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  // The app's alert badge: amber dot, cream "!".
  if (badge > 0) {
    ctx.save();
    ctx.translate(40, 8);
    ctx.scale(badge, badge);
    ctx.translate(-40, -8);
    ctx.beginPath();
    ctx.arc(40, 8, 6.5, 0, TAU);
    ctx.fillStyle = WARN;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = badgeStroke;
    ctx.stroke();
    ctx.strokeStyle = FACE;
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.stroke(BADGE_MARK);
    ctx.restore();
  }
  ctx.restore();
}

/** The height of a mascot's body in pixels at `size`, feet to crown. */
export const bodyHeight = (who, size) => ((FEET[CAST[who].shape] - CROWN[CAST[who].shape]) / 48) * size;

/**
 * A hop: returns { lift, squash } for a jump that leaves at `a` and lands `d` later.
 * Anticipation squash before, stretch in the air, squash on landing, settle.
 */
export function hop(t, a, d = 0.42, height = 120) {
  const pre = 0.08;
  if (t < a - pre) return { lift: 0, squash: 0 };
  if (t < a) return { lift: 0, squash: -0.16 * Math.sin((Math.PI / 2) * ((t - (a - pre)) / pre)) };
  if (t < a + d) {
    const p = (t - a) / d;
    return { lift: height * 4 * p * (1 - p), squash: 0.14 * Math.cos(Math.PI * p) };
  }
  const after = t - (a + d);
  return { lift: 0, squash: -0.2 * Math.exp(-11 * after) * Math.cos(after * 30) };
}
