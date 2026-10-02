// Renders adcode-film.html to video in two passes.
//
// 1. Master: each output frame is the average of SUB sub-frames spread over a 180-degree
//    shutter, which gives real motion blur on every move. Written clean (no grain) at high
//    quality to master-<w>x<h>.mp4. This is the slow pass.
// 2. Delivery: adds film grain, muxes the score, and encodes for X (H.264 High, yuv420p,
//    AAC, bitrate capped so X's re-encode has little to destroy). Seconds.
//
//   node render.mjs <w> <h> <out.mp4> [--audio=score.wav] [--finish-only] [--stills=0.5,1.2]
import { chromium } from "playwright";
import { mkdirSync, rmSync, existsSync } from "fs";
import { execFileSync } from "child_process";

const args = process.argv.slice(2);
const [W = "1080", H = "1080", out = "out.mp4"] = args.filter((a) => !a.startsWith("--"));
const opt = (k) => (args.find((a) => a.startsWith(`--${k}=`)) || "").slice(k.length + 3);
const stills = opt("stills"), audio = opt("audio") || "score.wav", finishOnly = args.includes("--finish-only");
const FPS = 60, SUB = 4, SHUTTER = 0.5, DUR = 5.0, GRAIN = 3;
const dir = new URL(".", import.meta.url).pathname;
const master = `${dir}master-${W}x${H}.mp4`;
const ff = (a) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...a], { stdio: "inherit" });

async function capture() {
  const frames = `${dir}frames_${W}x${H}${stills ? "_stills" : ""}`;
  rmSync(frames, { recursive: true, force: true }); mkdirSync(frames);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: +W, height: +H } });
  await page.goto(`file://${dir}adcode-film.html?render=1&grain=${stills ? 1 : 0}&w=${W}&h=${H}`);
  await page.evaluate(() => window.ready);
  const shot = async (t, i) => {
    await page.evaluate((t) => window.seek(t), t);
    await page.screenshot({ path: `${frames}/f${String(i).padStart(5, "0")}.png` });
  };
  if (stills) {
    let i = 0; for (const t of stills.split(",").map(Number)) await shot(t, i++);
    await browser.close(); console.log("stills in", frames); return false;
  }
  let i = 0;
  for (let f = 0; f < Math.round(DUR * FPS); f++) for (let s = 0; s < SUB; s++) await shot((f + (s / SUB) * SHUTTER) / FPS, i++);
  await browser.close();
  ff(["-framerate", String(FPS * SUB), "-i", `${frames}/f%05d.png`,
    "-vf", `tmix=frames=${SUB},select='eq(mod(n\\,${SUB})\\,${SUB - 1})',setpts=N/${FPS}/TB`, "-r", String(FPS),
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "10", "-preset", "slow", master]);
  rmSync(frames, { recursive: true, force: true });
  return true;
}

if (finishOnly ? existsSync(master) : await capture()) {
  ff(["-i", master, "-i", `${dir}${audio}`, "-map", "0:v", "-map", "1:a",
    "-vf", `noise=alls=${GRAIN}:allf=t+u`,
    "-c:v", "libx264", "-profile:v", "high", "-level", "4.2", "-pix_fmt", "yuv420p", "-preset", "slow",
    "-crf", "17", "-maxrate", "20M", "-bufsize", "40M", "-g", "60",
    "-c:a", "aac", "-b:a", "320k", "-ar", "48000", "-shortest", "-movflags", "+faststart", `${dir}${out}`]);
  console.log("wrote", out);
}
