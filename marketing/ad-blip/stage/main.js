/**
 * The stage for "Blip": exposes the film to the renderer as `window.AD`.
 *
 *   AD.ready()           fonts loaded, frame 0 drawn
 *   AD.frame(n, base, max)  draw output frame n with motion blur; resolves once painted
 *   AD.still(t)          draw exactly time t, no blur
 *   AD.png()             the frame as base64 PNG
 *   AD.layout(step)      every critical text box the film draws, sampled every `step` s
 *   AD.soundtrack()      the soundtrack as base64 16-bit WAV
 *
 * Motion blur happens here, in the page: a frame is the average of several drawings spread
 * over half a frame's time (a 180° shutter that opens forward, so a cut on a frame boundary
 * stays clean). Two drawings measure how far the frame moves; a still frame keeps two, a
 * whip or a slam gets up to `max`.
 *
 * `?play` loops it in real time (`&fit` scales it to the window), `?t=12.5` holds a frame,
 * `?hook=2` picks the second opening.
 */
import { DURATION, FPS, H, W } from "./cues.js";
import { draw } from "./film.js";
import { layout } from "./kit.js";

const params = new URLSearchParams(location.search);
const hook = Number(params.get("hook") || 1);
const display = document.getElementById("stage");
const out = display.getContext("2d");
const work = document.createElement("canvas");
work.width = W;
work.height = H;
const ctx = work.getContext("2d", { willReadFrequently: true });
const painted = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

async function ready() {
  await Promise.all([
    document.fonts.load('900 100px "Inter Tight"'),
    document.fonts.load('800 100px "Inter Tight"'),
    document.fonts.load('700 40px "Inter"'),
    document.fonts.load('600 40px "Inter"'),
    document.fonts.load('500 40px "Inter"'),
    document.fonts.load('500 20px "JetBrains Mono"'),
  ]);
  await document.fonts.ready;
  const missing = ["Inter Tight", "Inter", "JetBrains Mono"].filter((family) => !document.fonts.check(`20px "${family}"`));
  if (missing.length > 0) throw new Error(`fonts missing: ${missing.join(", ")}`);
  await still(0);
  return { duration: DURATION, fps: FPS, width: W, height: H };
}

async function still(t) {
  draw(ctx, t, hook);
  out.drawImage(work, 0, 0);
  return true;
}

/** The display canvas as PNG, read straight from the canvas: a hidden window on Windows is
 *  clamped to the screen's height, so a screenshot of a 1920-tall page comes back cut off. */
const png = () => display.toDataURL("image/png").split(",")[1];

/** Mean absolute difference of two RGBA buffers, sampled sparsely: how far the frame moved. */
function moved(a, b) {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < a.length; i += 397) { sum += Math.abs(a[i] - b[i]); n += 1; }
  return sum / n;
}

const acc = new Uint32Array(W * H * 4);
const result = out.createImageData(W, H);

async function frame(n, base = 2, max = 16) {
  const times = (k) => Array.from({ length: k }, (_, j) => Math.min(DURATION - 1e-4, (n + ((j + 0.5) / k) * 0.5) / FPS));
  if (base <= 1) return still(n / FPS).then(() => 1);
  const grab = (t) => { draw(ctx, t, hook); return ctx.getImageData(0, 0, W, H).data; };
  const probe = times(base).map(grab);
  const spread = moved(probe[0], probe.at(-1));
  const k = spread > 2.5 ? Math.min(max, Math.max(base * 2, Math.round(base + spread * 2))) : base;
  acc.fill(0);
  const add = (d) => { for (let i = 0; i < d.length; i += 1) acc[i] += d[i]; };
  if (k === base) probe.forEach(add);
  else for (const t of times(k)) add(grab(t));
  const d = result.data;
  const half = k >> 1;
  for (let i = 0; i < d.length; i += 1) d[i] = (acc[i] + half) / k;
  out.putImageData(result, 0, 0);
  return k;
}

function layoutDump(step = 0.1) {
  const samples = [];
  for (let i = 0; i * step < DURATION - 1e-6; i += 1) {
    const t = Number((i * step).toFixed(4));
    draw(ctx, t, hook);
    samples.push({ t, boxes: layout.map((b) => ({ ...b, x0: Math.round(b.x0), y0: Math.round(b.y0), x1: Math.round(b.x1), y1: Math.round(b.y1), scale: Number(b.scale.toFixed(3)) })) });
  }
  return samples;
}

function base64(bytes) {
  let s = "";
  for (let at = 0; at < bytes.length; at += 0x8000) s += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(s);
}

window.AD = {
  ready,
  frame,
  still,
  png,
  layout: layoutDump,
  async soundtrack() {
    const { renderSoundtrack } = await import("./audio.js");
    return base64(await renderSoundtrack());
  },
};

if (params.has("fit")) {
  const fit = () => { display.style.transform = `scale(${Math.min(innerWidth / W, innerHeight / H)})`; };
  display.style.transformOrigin = "0 0";
  addEventListener("resize", fit);
  fit();
}
if (params.has("play")) {
  void ready().then(() => {
    const start = performance.now();
    const loop = (now) => {
      draw(out, ((now - start) / 1000) % DURATION, hook);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
} else if (params.has("t")) {
  void ready().then(() => still(Number(params.get("t"))));
}
