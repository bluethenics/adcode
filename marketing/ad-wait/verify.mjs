#!/usr/bin/env node
/**
 * Does the rendered ad meet its delivery spec? Exit 0 only when every check passes.
 *
 *   node marketing/ad-wait/verify.mjs
 *
 * Reads the files the way a platform will: decodes every frame, measures loudness the
 * way social players normalise it (EBU R128), and checks the numbers the upload forms ask
 * for. Parses ffmpeg's own report, so it needs nothing beyond the fetched ffmpeg.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const here = import.meta.dirname;
const ffmpeg = join(here, "..", "ad-payback", ".tools", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
const out = join(here, "out");
const master = join(out, "ADCode-Wait-1080x1080-60fps.mp4");
const copy30 = join(out, "ADCode-Wait-1080x1080-30fps.mp4");

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
  check("8.000 s (± one frame)", Math.abs(info.seconds - 8) <= 1 / 60 + 0.005, info.seconds);
  check("AAC 48 kHz stereo", info.audioCodec === "aac" && info.sampleRate === 48000 && info.channels === "stereo",
    `${info.audioCodec} ${info.sampleRate} ${info.channels}`);

  const decoded = decode(master);
  check("480 frames decode cleanly", decoded.frames === 480 && decoded.errors.length === 0,
    `${decoded.frames} frames${decoded.errors.length ? `; ${decoded.errors[0]}` : ""}`);

  const lufs = loudness(master);
  check("loudness −14 ± 1.5 LUFS", Math.abs(lufs - -14) <= 1.5, `${lufs} LUFS`);
}

/** Raw frames from a file: a 96 × 96 grid of 8-bit pixels, gray or RGB, one buffer. */
function raw(file, pixels, fps = null) {
  const filters = [...(fps ? [`fps=${fps}`] : []), "scale=96:96", `format=${pixels}`].join(",");
  const run = spawnSync(ffmpeg, ["-v", "error", "-i", file, "-vf", filters, "-f", "rawvideo", "-"], { maxBuffer: 1 << 28 });
  return run.stdout;
}

/** Peak level, in dB, of a slice of the soundtrack. */
function peak(file, start, seconds) {
  const text = ff(["-ss", String(start), "-t", String(seconds), "-i", file, "-map", "0:a:0", "-af", "volumedetect", "-f", "null", "-"]);
  const match = /max_volume: (-?[\d.]+|-inf) dB/.exec(text);
  // No match is a failure to read the file, not silence: NaN fails every comparison.
  if (!match) return Number.NaN;
  return match[1] === "-inf" ? Number.NEGATIVE_INFINITY : Number(match[1]);
}

check("30 fps copy exists", existsSync(copy30), copy30);
if (existsSync(ffmpeg) && existsSync(copy30)) {
  const info = describe(copy30);
  const decoded = decode(copy30);
  check("30 fps copy: 1080×1080, 30 fps, 240 frames",
    info.width === 1080 && info.height === 1080 && info.fps === 30 && decoded.frames === 240,
    `${info.width}x${info.height} ${info.fps} fps ${decoded.frames} frames`);
}

// What the retention plan promised, read back from the encoded file.
if (existsSync(ffmpeg) && existsSync(master)) {
  const rgb = raw(master, "rgb24", 30);
  const cells = 96 * 96;
  const frame = (i) => rgb.subarray(i * cells * 3, (i + 1) * cells * 3);
  let green = 0;
  for (let p = 0; p < cells; p += 1) {
    const [red, grn, blue] = [frame(0)[p * 3], frame(0)[p * 3 + 1], frame(0)[p * 3 + 2]];
    if (grn > 150 && red < 110 && blue < 140) green += 1;
  }
  check("frame 0 shows the money (green ≥ 3% of the frame)", green / cells >= 0.03, `${((100 * green) / cells).toFixed(1)}%`);

  const gray = raw(master, "gray", 30);
  const count = gray.length / cells;
  const change = [];
  for (let i = 1; i < count; i += 1) {
    let sum = 0;
    for (let p = 0; p < cells; p += 1) sum += Math.abs(gray[i * cells + p] - gray[(i - 1) * cells + p]);
    change.push(sum / cells);
  }
  const still = [];
  for (let second = 0; second < 8; second += 1) {
    const peakChange = Math.max(...change.slice(second * 30 - (second ? 1 : 0), (second + 1) * 30 - 1));
    if (peakChange < 1) still.push(second);
  }
  check("something changes in every second", still.length === 0, still.length ? `still in second(s) ${still.join(", ")}` : "all 8 seconds move");
  const hard = change.map((value, i) => ({ value, at: (i + 1) / 30 })).filter(({ value }) => value > 12);
  const early = hard.filter(({ at }) => at < 4.1).length;
  check("at least 10 hard cuts in the first 4 s (half the film)", early >= 10, `${early} cuts`);
  const white = change.filter((value) => value > 100).length;
  check("black-and-white slams present (≥ 4 flips)", white >= 4, `${white} flips`);

  check("the gate is silent (4.02–4.24 s below −50 dB)", peak(master, 4.02, 0.22) < -50, `${peak(master, 4.02, 0.22)} dB`);
  check("the hit is loud (4.25–4.45 s above −12 dB)", peak(master, 4.25, 0.2) > -12, `${peak(master, 4.25, 0.2)} dB`);
  check("the loop seam is clean (last 10 ms below −20 dB)", peak(master, 7.99, 0.01) < -20, `${peak(master, 7.99, 0.01)} dB`);
}

for (const name of ["contact-sheet.png", "thumb-hook.png", "thumb-hit.png", "thumb-endcard.png"]) {
  check(`${name} exists`, existsSync(join(out, name)));
}

for (const { name, ok, detail } of results) {
  process.stdout.write(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}\n`);
}
const failed = results.filter((one) => !one.ok).length;
process.stdout.write(`\n${results.length - failed}/${results.length} checks passed\n`);
process.exit(failed === 0 ? 0 : 1);
