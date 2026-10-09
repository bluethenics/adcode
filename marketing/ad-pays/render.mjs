#!/usr/bin/env node
/**
 * Render "Pays You": the 10-second 1:1 direct-response ad, in three hooks.
 *
 *   node marketing/ad-pays/render.mjs                       # all three hooks, the deliverable
 *   node marketing/ad-pays/render.mjs --hook 2              # just H2
 *   node marketing/ad-pays/render.mjs --hook 1 --stills 0,3.5,8   # frames as PNG
 *   node marketing/ad-pays/render.mjs --hook 1 --from 1.4 --to 4.8 --no-audio --blur 1
 *   node marketing/ad-pays/render.mjs --hook 3 --preview    # watch it loop in a window
 *
 * Options: --hook 1|2|3 (default: all three for a full render, 1 otherwise), --fps 60,
 * --blur 4 (shutter samples per frame; 1 = no motion blur), --grain 5, --url, --stills a,b,c,
 * --no-video, --no-audio, --from, --to.
 *
 * Borrows ffmpeg and fonts from ad-payback (`node marketing/ad-payback/fetch-tools.mjs`
 * once) and the frame engine and drawing kit from ad-payback/stage. Electron comes from the
 * repo. A slice gets its own file names, so trying a few seconds never touches a deliverable.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { DURATION, H, HOOKS, W } from "./stage/cues.js";

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
const hookFlag = flag("hook", null);
const hooks = hookFlag === null ? (full ? HOOKS.map((_, i) => i + 1) : [1]) : [Number(hookFlag)];
if (hooks.some((n) => !(n >= 1 && n <= HOOKS.length))) {
  console.error(`--hook must be 1 to ${HOOKS.length}`);
  process.exit(1);
}

if (!existsSync(ffmpeg) || !existsSync(join(tools, "fonts", "fonts.css"))) {
  console.error("Missing tools. Run: node marketing/ad-payback/fetch-tools.mjs");
  process.exit(1);
}

function ff(args) {
  const run = spawnSync(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", ...args], { stdio: "inherit" });
  if (run.status !== 0) throw new Error(`ffmpeg ${args.join(" ")} failed`);
}

// Loudness to -14 LUFS, then a limiter under -3.3 dBFS: AAC adds inter-sample peaks of its
// own, and loudnorm alone lets them through.
const AUDIO_FILTER = "loudnorm=I=-14:TP=-2:LRA=11,alimiter=limit=0.68:attack=1:release=50:level=false";
const BT709 = ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv"];
// Electron's package export is the path to the executable; it must not run as plain Node.
const electron = createRequire(join(repo, "package.json"))("electron");
const started = Date.now();

for (const hook of hooks) {
  const name = `ADCode-PaysYou-H${hook}-${W}x${H}`;
  const options = {
    out,
    ffmpeg,
    hook,
    width: W,
    height: H,
    fps: Number(flag("fps", 60)),
    blur: Number(flag("blur", 4)),
    grain: Number(flag("grain", 5)),
    from: Number(flag("from", 0)),
    to: Number(flag("to", DURATION)),
    url: String(flag("url", "adcode.bluethenics.com")),
    preview: flag("preview", false) === true,
    // Frame 0 is the poster X shows before the video plays: it is the thumbnail.
    stills: stills === null ? (full ? [0, 8.5] : []) : String(stills).split(",").map(Number),
    stillNames: stills === null && full ? [`thumb-H${hook}.png`, "thumb-endcard.png"] : String(stills ?? "").split(",").map((t) => `still-H${hook}-${t.replace(".", "_")}.png`),
    video: stills === null && !process.argv.includes("--no-video"),
    audio: stills === null && !process.argv.includes("--no-audio"),
  };

  const env = { ...process.env, AD_OPTIONS: JSON.stringify(options) };
  delete env["ELECTRON_RUN_AS_NODE"];
  const child = spawn(electron, [join(here, "electron-main.mjs")], { env, stdio: "inherit" });
  const code = await new Promise((resolve) => child.on("close", resolve));
  if (code !== 0) process.exit(code ?? 1);
  if (options.preview) process.exit(0);

  const picture = join(out, "picture.mp4");
  const soundtrack = join(out, "soundtrack.wav");
  const slice = full ? "" : `-slice-${options.from}-${options.to}`;
  const master = join(out, `${name}-60fps${slice}.mp4`);
  if (options.video && options.audio) {
    // The soundtrack always starts at 0, so a slice seeks into it.
    ff(["-i", picture, "-ss", String(options.from), "-i", soundtrack, "-map", "0:v", "-map", "1:a", "-c:v", "copy",
      "-af", AUDIO_FILTER, "-c:a", "aac", "-b:a", "256k", "-ar", "48000",
      "-t", String(options.to - options.from), "-movflags", "+faststart", master]);
    if (full) {
      ff(["-i", master, "-vf", "fps=30", "-c:v", "libx264", "-preset", "slow", "-crf", "16",
        "-profile:v", "high", "-pix_fmt", "yuv420p", ...BT709, "-c:a", "copy", "-movflags", "+faststart", join(out, `${name}-30fps.mp4`)]);
      // Two frames a second, 6 × 4: the whole ad on one page, read back from the encoded file.
      ff(["-i", master, "-vf", "fps=2,scale=270:270,tile=6x4", "-frames:v", "1", join(out, `contact-sheet-H${hook}.png`)]);
      await rm(picture, { force: true });
    }
  }
}
console.log(`done in ${((Date.now() - started) / 1000).toFixed(0)} s → ${out}`);
