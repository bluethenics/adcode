/**
 * The stage for "Free, then Paid": builds the film and exposes it to the renderer as `window.AD`.
 *
 *   AD.ready()       fonts loaded, scenes mounted, frame 0 drawn
 *   AD.render(t)     draw time t, resolve once the frame has been painted
 *   AD.soundtrack()  the soundtrack as base64 16-bit WAV
 *
 * `?play` loops it in real time for previewing (`&fit` scales it to the window); `?t=12.5`
 * holds one frame.
 */
import { createTimeline } from "./shared/engine.js";
import { DURATION, H, W } from "./cues.js";
import { SCENES } from "./scenes/index.js";

const params = new URLSearchParams(location.search);
const settings = { url: params.get("url") || "adcode.bluethenics.com" };
const stage = document.getElementById("stage");

const timeline = createTimeline(stage, SCENES, settings);
const painted = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

async function ready() {
  await Promise.all([
    document.fonts.load('900 100px "Inter Tight"'),
    document.fonts.load('800 100px "Inter Tight"'),
    document.fonts.load('600 40px "Inter Tight"'),
    document.fonts.load('400 20px "Inter"'),
    document.fonts.load('600 20px "Inter"'),
    document.fonts.load('400 20px "JetBrains Mono"'),
  ]);
  await document.fonts.ready;
  const missing = ["Inter Tight", "Inter", "JetBrains Mono"].filter((family) => !document.fonts.check(`20px "${family}"`));
  if (missing.length > 0) throw new Error(`fonts missing: ${missing.join(", ")}`);
  timeline.render(0);
  await painted();
  return { duration: DURATION };
}

function base64(bytes) {
  let text = "";
  for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(text);
}

window.AD = {
  ready,
  async render(t) {
    timeline.render(t);
    await painted();
    return true;
  },
  async soundtrack() {
    const { renderSoundtrack } = await import("./audio.js");
    return base64(await renderSoundtrack());
  },
};

if (params.has("fit")) {
  const fit = () => { stage.style.transform = `scale(${Math.min(innerWidth / W, innerHeight / H)})`; };
  stage.style.transformOrigin = "0 0";
  addEventListener("resize", fit);
  fit();
}

if (params.has("play")) {
  void ready().then(() => {
    const start = performance.now();
    const loop = (now) => {
      timeline.render(((now - start) / 1000) % DURATION);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
} else if (params.has("t")) {
  void ready().then(() => timeline.render(Number(params.get("t"))));
}
