#!/usr/bin/env node
/**
 * Render "Free, then Paid": the 16.5-second square spot, 1080 × 1080.
 *
 *   node marketing/ad-free-paid/render.mjs                     # the whole deliverable
 *   node marketing/ad-free-paid/render.mjs --stills 0,5.9,15  # just those frames, as PNG
 *   node marketing/ad-free-paid/render.mjs --from 4 --to 8 --no-audio --blur 1   # a quick slice
 *   node marketing/ad-free-paid/render.mjs --preview          # watch it loop in a window
 *
 * Options: --fps 60, --blur 4 (shutter samples per frame; 1 = no motion blur), --grain 6
 * (luma grain strength; 0 = none), --url adcode.bluethenics.com, --stills a,b,c,
 * --no-video, --no-audio, --from, --to.
 *
 * Borrows ffmpeg, fonts and the frame engine from ad-payback: run
 * `node marketing/ad-payback/fetch-tools.mjs` once. Electron comes from the repo.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { DURATION, H, W } from "./stage/cues.js";

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

const stills = flag("stills", null);
const full = stills === null && !process.argv.includes("--no-video") && !process.argv.includes("--no-audio")
  && flag("from", null) === null && flag("to", null) === null;
const THUMBS = [[0, "thumb-hook.png"], [6.4, "thumb-paid.png"], [9, "thumb-split.png"], [16, "thumb-endcard.png"]];
const options = {
  out,
  ffmpeg,
  fps: Number(flag("fps", 60)),
  blur: Number(flag("blur", 4)),
  grain: Number(flag("grain", 6)),
  from: Number(flag("from", 0)),
  to: Number(flag("to", DURATION)),
  url: String(flag("url", "adcode.bluethenics.com")),
  preview: flag("preview", false) === true,
  stills: stills === null ? (full ? THUMBS.map(([t]) => t) : []) : String(stills).split(",").map(Number),
  stillNames: full ? THUMBS.map(([, name]) => name) : undefined,
  video: stills === null && !process.argv.includes("--no-video"),
  audio: stills === null && !process.argv.includes("--no-audio"),
};

if (!existsSync(ffmpeg) || !existsSync(join(tools, "fonts", "fonts.css"))) {
  console.error("Missing tools. Run: node marketing/ad-payback/fetch-tools.mjs");
  process.exit(1);
}

function ff(args) {
  const run = spawnSync(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", ...args], { stdio: "inherit" });
  if (run.status !== 0) throw new Error(`ffmpeg ${args.join(" ")} failed`);
}

// Electron's package export is the path to the executable; it must not run as plain Node.
const electron = createRequire(join(repo, "package.json"))("electron");
const env = { ...process.env, AD_OPTIONS: JSON.stringify(options) };
delete env["ELECTRON_RUN_AS_NODE"];
const started = Date.now();
const child = spawn(electron, [join(here, "electron-main.mjs")], { env, stdio: "inherit" });
const code = await new Promise((resolve) => child.on("close", resolve));
if (code !== 0) process.exit(code ?? 1);
if (options.preview) process.exit(0);

// Loudness to -14 LUFS, then a limiter under -3.3 dBFS: AAC adds inter-sample peaks of its
// own, and loudnorm alone let them reach -0.5 dBTP.
const AUDIO_FILTER = "loudnorm=I=-14:TP=-2:LRA=11,alimiter=limit=0.68:attack=1:release=50:level=false";
const picture = join(out, "picture.mp4");
const soundtrack = join(out, "soundtrack.wav");
// A slice gets its own names, so trying out a few seconds never overwrites the deliverable.
const slice = full ? "" : `-slice-${options.from}-${options.to}`;
const master = join(out, `ADCode-FreeThenPaid-${W}x${H}-60fps${slice}.mp4`);
const copy30 = join(out, `ADCode-FreeThenPaid-${W}x${H}-30fps${slice}.mp4`);
const BT709 = ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv"];

if (options.video && options.audio) {
  // Players normalise to about -14 LUFS; arriving there means nothing gets squashed.
  // The soundtrack always starts at 0, so a slice seeks into it.
  ff(["-i", picture, "-ss", String(options.from), "-i", soundtrack, "-map", "0:v", "-map", "1:a", "-c:v", "copy",
    "-af", AUDIO_FILTER, "-c:a", "aac", "-b:a", "256k", "-ar", "48000",
    "-t", String(options.to - options.from), "-movflags", "+faststart", master]);
  ff(["-i", master, "-vf", "fps=30", "-c:v", "libx264", "-preset", "slow", "-crf", "16",
    "-profile:v", "high", "-pix_fmt", "yuv420p", ...BT709, "-c:a", "copy", "-movflags", "+faststart", copy30]);
  // Two frames a second, 6 × 8: the whole film on one page, read back from the encoded file.
  if (full) ff(["-i", master, "-vf", "fps=2,scale=240:240,tile=6x6", "-frames:v", "1", join(out, "contact-sheet.png")]);
  if (full) await rm(picture, { force: true });
}
console.log(`done in ${((Date.now() - started) / 1000).toFixed(0)} s → ${out}`);
