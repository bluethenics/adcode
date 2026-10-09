#!/usr/bin/env node
/**
 * Render "Now on the Microsoft Store": the 20-second launch spot, in two cuts from one
 * timeline - 1920 × 1080 (the Store trailer, YouTube, the site) and 1080 × 1080 (the feed).
 *
 *   node marketing/ad-store/render.mjs                         # both cuts, the deliverables
 *   node marketing/ad-store/render.mjs --format square         # one cut
 *   node marketing/ad-store/render.mjs --stills 0,5.5,11.6     # just those frames, as PNG
 *   node marketing/ad-store/render.mjs --from 6 --to 9 --no-audio --blur 1   # a quick slice
 *   node marketing/ad-store/render.mjs --preview               # watch it loop in a window
 *
 * Options: --format wide|square|both, --fps 60, --blur 4 (shutter samples per frame; 1 = no
 * motion blur), --grain 5, --url adcode.bluethenics.com, --stills a,b,c, --no-video,
 * --no-audio, --from, --to.
 *
 * Borrows ffmpeg, fonts and the frame engine from ad-payback: run
 * `node marketing/ad-payback/fetch-tools.mjs` once. Electron comes from the repo. Never run
 * two renders at once: they fight over the GPU and both slow to a crawl.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { DURATION, FORMATS } from "./stage/cues.js";

const here = import.meta.dirname;
const repo = join(here, "..", "..");
const out = join(here, "out");
const tools = join(here, "..", "ad-payback", ".tools");
const ffmpeg = join(tools, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");

function flag(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  if (at === -1) return fallback;
  const value = process.argv[at + 1];
  return value === undefined || value.startsWith("--") ? true : value;
}

if (!existsSync(ffmpeg) || !existsSync(join(tools, "fonts", "fonts.css"))) {
  console.error("Missing tools. Run: node marketing/ad-payback/fetch-tools.mjs");
  process.exit(1);
}

function ff(args) {
  const run = spawnSync(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", ...args], { stdio: "inherit" });
  if (run.status !== 0) throw new Error(`ffmpeg ${args.join(" ")} failed`);
}

const requested = String(flag("format", "both"));
const formats = requested === "both" ? ["wide", "square"] : [requested];
for (const format of formats) if (!(format in FORMATS)) { console.error(`Unknown format ${format}`); process.exit(1); }

const stills = flag("stills", null);
const full = stills === null && !process.argv.includes("--no-video") && !process.argv.includes("--no-audio")
  && flag("from", null) === null && flag("to", null) === null;
const THUMBS = [[0, "thumb-hook"], [8.9, "thumb-fifty"], [19.5, "thumb-endcard"]];
// Loudness to -14 LUFS, then a limiter under -3.3 dBFS: AAC adds inter-sample peaks of its
// own, and loudnorm alone lets them reach -0.5 dBTP.
const AUDIO_FILTER = "loudnorm=I=-14:TP=-2:LRA=11,alimiter=limit=0.68:attack=1:release=50:level=false";
const BT709 = ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv"];
const electron = createRequire(join(repo, "package.json"))("electron");
const started = Date.now();

for (const format of formats) {
  const { w, h } = FORMATS[format];
  const options = {
    out,
    ffmpeg,
    format,
    width: w,
    height: h,
    fps: Number(flag("fps", 60)),
    blur: Number(flag("blur", 4)),
    grain: Number(flag("grain", 5)),
    from: Number(flag("from", 0)),
    to: Number(flag("to", DURATION)),
    url: String(flag("url", "adcode.bluethenics.com")),
    preview: flag("preview", false) === true,
    stills: stills === null ? (full ? THUMBS.map(([t]) => t) : []) : String(stills).split(",").map(Number),
    stillNames: stills === null && full
      ? THUMBS.map(([, name]) => `${name}-${w}x${h}.png`)
      : (stills === null ? [] : String(stills).split(",").map((t) => `still-${format}-${t.replace(".", "_")}.png`)),
    video: stills === null && !process.argv.includes("--no-video"),
    audio: stills === null && !process.argv.includes("--no-audio"),
  };

  // Electron's package export is the path to the executable; it must not run as plain Node.
  const env = { ...process.env, AD_OPTIONS: JSON.stringify(options) };
  delete env["ELECTRON_RUN_AS_NODE"];
  console.log(`── ${format} ${w}×${h} ──`);
  const child = spawn(electron, [join(here, "electron-main.mjs")], { env, stdio: "inherit" });
  const code = await new Promise((resolve) => child.on("close", resolve));
  if (code !== 0) process.exit(code ?? 1);
  if (options.preview) process.exit(0);

  const picture = join(out, "picture.mp4");
  const soundtrack = join(out, "soundtrack.wav");
  // A slice gets its own names, so trying out a few seconds never overwrites the deliverable.
  const slice = full ? "" : `-slice-${options.from}-${options.to}`;
  const master = join(out, `ADCode-MicrosoftStore-${w}x${h}-60fps${slice}.mp4`);
  const copy30 = join(out, `ADCode-MicrosoftStore-${w}x${h}-30fps${slice}.mp4`);

  if (options.video && options.audio) {
    // The soundtrack always starts at 0, so a slice seeks into it.
    ff(["-i", picture, "-ss", String(options.from), "-i", soundtrack, "-map", "0:v", "-map", "1:a", "-c:v", "copy",
      "-af", AUDIO_FILTER, "-c:a", "aac", "-b:a", "256k", "-ar", "48000",
      "-t", String(options.to - options.from), "-movflags", "+faststart", master]);
    ff(["-i", master, "-vf", "fps=30", "-c:v", "libx264", "-preset", "slow", "-crf", "16",
      "-profile:v", "high", "-pix_fmt", "yuv420p", ...BT709, "-c:a", "copy", "-movflags", "+faststart", copy30]);
    // Two frames a second: the whole spot on one page, read back from the encoded file.
    if (full) {
      const cell = format === "square" ? "240:240" : "320:180";
      ff(["-i", master, "-vf", `fps=2,scale=${cell},tile=8x5`, "-frames:v", "1", join(out, `contact-sheet-${w}x${h}.png`)]);
      await rm(picture, { force: true });
    }
  }
}
console.log(`done in ${((Date.now() - started) / 1000).toFixed(0)} s → ${out}`);
