#!/usr/bin/env node
/**
 * Does the rendered ad meet its delivery spec? Exit 0 only when every check passes.
 *
 *   node marketing/ad-payback/verify.mjs
 *
 * Reads the files the way a platform will: decodes every frame, measures loudness the
 * way social players normalise it (EBU R128), and checks the numbers the upload forms ask
 * for. Parses ffmpeg's own report, so it needs nothing beyond the fetched ffmpeg.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const here = import.meta.dirname;
const ffmpeg = join(here, ".tools", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
const out = join(here, "out");
const master = join(out, "ADCode-Payback-1080x1080-60fps.mp4");
const copy30 = join(out, "ADCode-Payback-1080x1080-30fps.mp4");

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail: String(detail) });

function ff(args) {
  const run = spawnSync(ffmpeg, ["-hide_banner", ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  return `${run.stdout ?? ""}${run.stderr ?? ""}`;
}

function describe(file) {
  const text = ff(["-i", file]);
  const video = /Video: (\w+) \((\w+)\)[^\n]*?, (yuv\w+)[^\n]*?, (\d+)x(\d+)[^\n]*?, ([\d.]+) fps/.exec(text);
  const audio = /Audio: (\w+)[^\n]*?, (\d+) Hz, (\w+)/.exec(text);
  const duration = /Duration: (\d+):(\d+):([\d.]+)/.exec(text);
  return {
    codec: video?.[1], profile: video?.[2], pixels: video?.[3],
    width: Number(video?.[4]), height: Number(video?.[5]), fps: Number(video?.[6]),
    audioCodec: audio?.[1], sampleRate: Number(audio?.[2]), channels: audio?.[3],
    seconds: duration ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]) : Number.NaN,
  };
}

/** Decode every video frame; returns the count and any decoder complaints. */
function decode(file) {
  const text = ff(["-v", "error", "-stats", "-i", file, "-map", "0:v:0", "-f", "null", "-"]);
  const frames = [...text.matchAll(/frame=\s*(\d+)/g)].map((m) => Number(m[1])).pop() ?? 0;
  const errors = text.split(/\r?\n/).filter((line) => /error|corrupt|invalid/i.test(line) && !/frame=/.test(line));
  return { frames, errors };
}

function loudness(file) {
  const text = ff(["-i", file, "-map", "0:a:0", "-af", "ebur128=framelog=quiet", "-f", "null", "-"]);
  const integrated = /Integrated loudness:\s*\n\s*I:\s*(-?[\d.]+) LUFS/.exec(text);
  return integrated ? Number(integrated[1]) : Number.NaN;
}

check("ffmpeg fetched", existsSync(ffmpeg), ffmpeg);
check("60 fps master exists", existsSync(master), master);

if (existsSync(ffmpeg) && existsSync(master)) {
  const info = describe(master);
  check("H.264 High", info.codec === "h264" && info.profile === "High", `${info.codec} ${info.profile}`);
  check("yuv420p", info.pixels === "yuv420p", info.pixels);
  check("1080×1080", info.width === 1080 && info.height === 1080, `${info.width}x${info.height}`);
  check("60 fps", info.fps === 60, info.fps);
  check("30.000 s (± one frame)", Math.abs(info.seconds - 30) <= 1 / 60 + 0.005, info.seconds);
  check("AAC 48 kHz stereo", info.audioCodec === "aac" && info.sampleRate === 48000 && info.channels === "stereo",
    `${info.audioCodec} ${info.sampleRate} ${info.channels}`);

  const decoded = decode(master);
  check("1800 frames decode cleanly", decoded.frames === 1800 && decoded.errors.length === 0,
    `${decoded.frames} frames${decoded.errors.length ? `; ${decoded.errors[0]}` : ""}`);

  const lufs = loudness(master);
  check("loudness −14 ± 1.5 LUFS", Math.abs(lufs - -14) <= 1.5, `${lufs} LUFS`);
}

check("30 fps copy exists", existsSync(copy30), copy30);
if (existsSync(ffmpeg) && existsSync(copy30)) {
  const info = describe(copy30);
  const decoded = decode(copy30);
  check("30 fps copy: 1080×1080, 30 fps, 900 frames",
    info.width === 1080 && info.height === 1080 && info.fps === 30 && decoded.frames === 900,
    `${info.width}x${info.height} ${info.fps} fps ${decoded.frames} frames`);
}

for (const name of ["contact-sheet.png", "thumb-hook.png", "thumb-endcard.png"]) {
  check(`${name} exists`, existsSync(join(out, name)));
}

for (const { name, ok, detail } of results) {
  process.stdout.write(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}\n`);
}
const failed = results.filter((one) => !one.ok).length;
process.stdout.write(`\n${results.length - failed}/${results.length} checks passed\n`);
process.exit(failed === 0 ? 0 : 1);
