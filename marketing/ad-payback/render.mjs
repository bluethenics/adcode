#!/usr/bin/env node
/**
 * Render the Payback ad.
 *
 *   node marketing/ad-payback/render.mjs                    # the whole deliverable
 *   node marketing/ad-payback/render.mjs --stills 0,3,17    # just those frames, as PNG
 *   node marketing/ad-payback/render.mjs --from 4 --to 8 --no-audio   # a slice
 *   node marketing/ad-payback/render.mjs --preview          # watch it loop in a window
 *
 * Options: --fps 60, --version 2.1.1 (the end card's "Update to"), --url
 * adcode.bluethenics.com, --stills a,b,c, --no-video, --no-audio, --from, --to.
 *
 * Needs `node marketing/ad-payback/fetch-tools.mjs` once. Electron comes from the repo.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

const here = import.meta.dirname;
const repo = join(here, "..", "..");
const out = join(here, "out");
const ffmpeg = join(here, ".tools", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
const DURATION = 30;

function flag(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  if (at === -1) return fallback;
  const value = process.argv[at + 1];
  return value === undefined || value.startsWith("--") ? true : value;
}

const stills = flag("stills", null);
const full = stills === null && !process.argv.includes("--no-video") && !process.argv.includes("--no-audio")
  && flag("from", null) === null && flag("to", null) === null;
const options = {
  out,
  ffmpeg,
  fps: Number(flag("fps", 60)),
  from: Number(flag("from", 0)),
  to: Number(flag("to", DURATION)),
  version: String(flag("version", "2.1.1")),
  url: String(flag("url", "adcode.bluethenics.com")),
  preview: flag("preview", false) === true,
  stills: stills === null ? (full ? [0, 27] : []) : String(stills).split(",").map(Number),
  stillNames: full ? ["thumb-hook.png", "thumb-endcard.png"] : undefined,
  video: stills === null && !process.argv.includes("--no-video"),
  audio: stills === null && !process.argv.includes("--no-audio"),
};

if (!existsSync(ffmpeg) || !existsSync(join(here, ".tools", "fonts", "fonts.css"))) {
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

const picture = join(out, "picture.mp4");
const soundtrack = join(out, "soundtrack.wav");
const master = join(out, "ADCode-Payback-1080x1080-60fps.mp4");
const copy30 = join(out, "ADCode-Payback-1080x1080-30fps.mp4");

if (options.video && options.audio) {
  // Social players normalise to about -14 LUFS; arriving there means nothing gets squashed.
  ff(["-i", picture, "-i", soundtrack, "-map", "0:v", "-map", "1:a", "-c:v", "copy",
    "-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
    "-t", String(options.to - options.from), "-movflags", "+faststart", master]);
  ff(["-i", master, "-vf", "fps=30", "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-tune", "animation",
    "-profile:v", "high", "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", copy30]);
  // One frame per second, 6 × 5: the whole film on one page, read back from the encoded file.
  ff(["-i", master, "-vf", "fps=1,scale=270:270,tile=6x5", "-frames:v", "1", join(out, "contact-sheet.png")]);
  if (full) await rm(picture, { force: true });
}
console.log(`done in ${((Date.now() - started) / 1000).toFixed(0)} s → ${out}`);
