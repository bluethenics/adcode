#!/usr/bin/env node
/**
 * Export the two 20-second ADCode mascot Reels at 1080×1920 / 30 fps.
 *
 *   node marketing/ad-mascot-reel/render.mjs
 *   node marketing/ad-mascot-reel/render.mjs --hook 2
 *   node marketing/ad-mascot-reel/render.mjs --hook 1 --stills
 *   node marketing/ad-mascot-reel/render.mjs --hook 1 --stills 0,4.8,9,13,17.5
 *
 * Electron, FFmpeg, fonts and the shared drawing kit are reused from the repo.
 * There is no additional frame-rate conversion, grain or synthetic motion blur.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

const here = import.meta.dirname;
const repo = join(here, "..", "..");
const out = join(here, "out");
const tools = join(here, "..", "ad-payback", ".tools");
const ffmpeg = join(tools, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
const W = 1080, H = 1920, FPS = 30, DURATION = 20;
const REVIEW_TIMES = [0, 4.8, 9, 13, 17.5];
const BT709 = ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv"];

function flag(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  if (at === -1) return fallback;
  const value = process.argv[at + 1];
  return value === undefined || value.startsWith("--") ? true : value;
}

const stillFlag = flag("stills", null);
const from = Number(flag("from", 0));
const to = Number(flag("to", DURATION));
const video = stillFlag === null && !process.argv.includes("--no-video");
const audio = stillFlag === null && !process.argv.includes("--no-audio");
const full = video && audio && from === 0 && to === DURATION;
const hookFlag = flag("hook", null);
const hooks = hookFlag === null ? (full ? [1, 2] : [1]) : [Number(hookFlag)];
const stills = stillFlag === null ? (full ? REVIEW_TIMES : []) : stillFlag === true ? REVIEW_TIMES : String(stillFlag).split(",").map(Number);
if (hooks.some((hook) => ![1, 2].includes(hook))) throw new Error("--hook must be 1 or 2");
if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to > DURATION || to <= from) throw new Error("Render range must be within 0–20 seconds");
if (stills.some((t) => !Number.isFinite(t) || t < 0 || t >= DURATION)) throw new Error("Still times must be within 0–20 seconds (20 excluded)");
if (Number(flag("fps", FPS)) !== FPS || Number(flag("blur", 1)) !== 1 || Number(flag("grain", 0)) !== 0) {
  throw new Error("This Reel exports at 30 fps, blur 1 and grain 0");
}
if (!existsSync(ffmpeg) || !existsSync(join(tools, "fonts", "fonts.css"))) throw new Error("Missing tools. Run node marketing/ad-payback/fetch-tools.mjs");

function ff(args, capture = false) {
  const run = spawnSync(ffmpeg, ["-y", "-hide_banner", ...args], {
    windowsHide: true,
    ...(capture ? { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 } : { stdio: "inherit" }),
  });
  if (run.error) throw run.error;
  if (run.status !== 0) throw new Error(`FFmpeg failed (${run.status}): ${capture ? run.stderr : args.join(" ")}`);
  return capture ? `${run.stdout ?? ""}${run.stderr ?? ""}` : "";
}

/** Two-pass loudness keeps the original score's envelope while setting delivery level. */
function audioFilter(soundtrack) {
  const log = ff(["-i", soundtrack, "-af", "loudnorm=I=-14:TP=-2.5:LRA=11:print_format=json", "-f", "null", "-"], true);
  const match = log.match(/\{\s*"input_i"[\s\S]*?\}/);
  if (!match) throw new Error("FFmpeg did not return its loudness measurements");
  const measured = JSON.parse(match[0]);
  if (!["input_i", "input_tp", "input_lra", "input_thresh", "target_offset"].every((key) => Number.isFinite(Number(measured[key])))) {
    throw new Error("The soundtrack is silent or has invalid loudness measurements");
  }
  return {
    log,
    filter: `loudnorm=I=-14:TP=-2.5:LRA=11:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true,alimiter=limit=0.75:attack=1:release=50:level=false`,
  };
}

const electron = createRequire(join(repo, "package.json"))("electron");
const started = Date.now();
await mkdir(out, { recursive: true });
for (const hook of hooks) {
  const options = {
    out, ffmpeg, hook, width: W, height: H, fps: FPS, blur: 1, grain: 0,
    from, to, url: String(flag("url", "adcode.bluethenics.com")),
    stills,
    stillNames: stills.map((t) => t === 0 ? `cover-H${hook}.png` : `review-H${hook}-${String(t).replace(".", "_")}s.png`),
    video, audio,
  };
  const env = { ...process.env, AD_OPTIONS: JSON.stringify(options) };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electron, [join(here, "electron-main.mjs")], { env, stdio: "inherit", windowsHide: true });
  const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
  if (code !== 0) throw new Error(`Electron renderer failed (${code})`);

  const picture = join(out, `picture-H${hook}.mp4`);
  const soundtrack = join(out, `soundtrack-H${hook}.wav`);
  const slice = full ? "" : `-slice-${from}-${to}`;
  const master = join(out, `ADCode-Mascot-Reel-H${hook}-${W}x${H}${slice}.mp4`);
  if (video && audio) {
    const { filter, log } = audioFilter(soundtrack);
    await writeFile(join(out, `audio-normalization-H${hook}.log`), log);
    ff(["-loglevel", "error", "-i", picture, "-ss", String(from), "-i", soundtrack, "-map", "0:v:0", "-map", "1:a:0",
      "-c:v", "copy", "-af", filter, "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
      "-t", String(to - from), ...BT709, "-movflags", "+faststart", master]);
    if (full) {
      // Twelve views of the encoded result, including the exact opening and CTA frames.
      const frameNumbers = [0, 30, 60, 90, 144, 180, 225, 270, 330, 390, 465, 525];
      const select = frameNumbers.map((n) => `eq(n\\,${n})`).join("+");
      ff(["-loglevel", "error", "-i", master, "-vf", `select='${select}',scale=270:480,tile=3x4`, "-frames:v", "1", join(out, `contact-sheet-H${hook}.png`)]);
      await rm(picture, { force: true });
    }
    console.log(`export → ${master}`);
  }
}
console.log(`done in ${((Date.now() - started) / 1000).toFixed(0)} s → ${out}`);
