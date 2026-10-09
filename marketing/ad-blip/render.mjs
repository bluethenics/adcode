#!/usr/bin/env node
/**
 * Render "Blip": the 29-second Instagram Reel, 1080 × 1920, 30 fps, two hook variants.
 *
 *   node marketing/ad-blip/render.mjs                         # both hooks, the deliverables
 *   node marketing/ad-blip/render.mjs --hook 1                # one hook
 *   node marketing/ad-blip/render.mjs --stills 0,6.9,11.6     # just those frames, as PNG
 *   node marketing/ad-blip/render.mjs --from 8 --to 12 --no-audio   # a quick slice
 *   node marketing/ad-blip/render.mjs --preview               # watch it loop in a window
 *
 * Options: --blur 2 (base motion-blur samples; 1 = none), --max-blur 32.
 * Borrows ffmpeg and fonts from ad-payback: run `node marketing/ad-payback/fetch-tools.mjs`
 * once. Electron comes from the repo. Never run two renders at once - the machine has no
 * headroom and the frame pipe stalls.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { DURATION, FPS, H, W } from "./stage/cues.js";

const here = import.meta.dirname;
const repo = join(here, "..", "..");
const out = join(here, "out");
const tools = join(here, "..", "ad-payback", ".tools");
const ffmpeg = join(tools, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
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
const preview = flag("preview", false) === true;
const video = stillFlag === null && !preview && !process.argv.includes("--no-video");
const audio = stillFlag === null && !preview && !process.argv.includes("--no-audio");
const full = video && audio && from === 0 && to === DURATION;
const hooks = flag("hook", null) === null ? (full ? [1, 2] : [1]) : [Number(flag("hook", 1))];
/** Review frames: the hook, the montage, the fact, the twist, the drop, the crew, it works, news ×3, thanks, the end card. */
const REVIEW = [0, 3.7, 6.95, 9.8, 11.9, 14.45, 18.2, 20.0, 21.9, 23.45, 25.1, 27.4];
const stills = stillFlag === null ? (full ? REVIEW : []) : stillFlag === true ? REVIEW : String(stillFlag).split(",").map(Number);
if (hooks.some((h) => ![1, 2].includes(h))) throw new Error("--hook must be 1 or 2");
if (!(from >= 0 && to <= DURATION && to > from)) throw new Error(`Render range must be within 0–${DURATION} s`);

if (!existsSync(ffmpeg) || !existsSync(join(tools, "fonts", "fonts.css"))) {
  console.error("Missing tools. Run: node marketing/ad-payback/fetch-tools.mjs");
  process.exit(1);
}

function ff(args, capture = false) {
  const run = spawnSync(ffmpeg, ["-y", "-hide_banner", ...args], {
    windowsHide: true,
    ...(capture ? { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 } : { stdio: "inherit" }),
  });
  if (run.error) throw run.error;
  if (run.status !== 0) throw new Error(`ffmpeg failed (${run.status}): ${capture ? run.stderr : args.join(" ")}`);
  return capture ? `${run.stdout ?? ""}${run.stderr ?? ""}` : "";
}

/** Two-pass loudness to −14 LUFS, then a limiter: AAC adds inter-sample peaks of its own. */
function audioFilter(soundtrack) {
  const log = ff(["-i", soundtrack, "-af", "loudnorm=I=-14:TP=-2:LRA=11:print_format=json", "-f", "null", "-"], true);
  const m = log.match(/\{\s*"input_i"[\s\S]*?\}/);
  if (!m) throw new Error("ffmpeg did not report loudness");
  const j = JSON.parse(m[0]);
  return `loudnorm=I=-14:TP=-2:LRA=11:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true,alimiter=limit=0.7:attack=1:release=50:level=false`;
}

const electron = createRequire(join(repo, "package.json"))("electron");
const started = Date.now();
await mkdir(out, { recursive: true });
for (const [i, hook] of hooks.entries()) {
  const options = {
    out, ffmpeg, hook, from, to, preview, video,
    audio: audio && i === 0,
    layout: full || process.argv.includes("--layout"),
    blur: Number(flag("blur", 2)),
    maxBlur: Number(flag("max-blur", 32)),
    stills,
    stillNames: stills.map((t) => (t === 0 ? `cover-H${hook}.png` : `review-H${hook}-${String(t).replace(".", "_")}s.png`)),
  };
  const env = { ...process.env, AD_OPTIONS: JSON.stringify(options) };
  delete env["ELECTRON_RUN_AS_NODE"];
  const child = spawn(electron, [join(here, "electron-main.mjs")], { env, stdio: "inherit", windowsHide: true });
  const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
  if (code !== 0) throw new Error(`Electron renderer failed (${code})`);
  if (preview) process.exit(0);

  const picture = join(out, `picture-H${hook}.mp4`);
  const soundtrack = join(out, "soundtrack.wav");
  const slice = full ? "" : `-slice-${from}-${to}`;
  const master = join(out, `ADCode-Blip-H${hook}-${W}x${H}${slice}.mp4`);
  if (video && !process.argv.includes("--no-audio") && existsSync(soundtrack)) {
    ff(["-loglevel", "error", "-i", picture, "-ss", String(from), "-i", soundtrack, "-map", "0:v:0", "-map", "1:a:0",
      "-c:v", "copy", "-af", audioFilter(soundtrack), "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
      "-t", String(to - from), ...BT709, "-movflags", "+faststart", master]);
    if (full) {
      // One frame a second, 6 × 5: the whole film on one page, read back from the encoded file.
      ff(["-loglevel", "error", "-i", master, "-vf", "fps=1,scale=216:384,tile=6x5", "-frames:v", "1", join(out, `contact-sheet-H${hook}.png`)]);
      await rm(picture, { force: true });
    }
    console.log(`export → ${master}`);
  } else if (video) {
    console.log(`picture only → ${picture}`);
  }
}
await writeFile(join(out, "render.json"), JSON.stringify({ hooks, from, to, fps: FPS, seconds: Math.round((Date.now() - started) / 1000) }, null, 2));
console.log(`done in ${((Date.now() - started) / 1000).toFixed(0)} s → ${out}`);
