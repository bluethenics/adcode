#!/usr/bin/env node
/**
 * Do the three rendered ads meet their delivery spec? Exit 0 only when every check passes.
 *
 *   node marketing/ad-pays/verify.mjs
 *
 * Reads the files the way X will - decodes every frame, measures loudness the way players
 * normalise it - and checks what the design promised for a feed where people decide in the
 * first second: frame 0 is the finished hook with money green in it, the three files differ
 * only in their opening, the copy is the approved copy and stays up long enough to read, the
 * only colour is money, the call to action holds.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CUE, DURATION, H, HOOK_WINDOW, HOOKS, LINES, W } from "./stage/cues.js";

const here = import.meta.dirname;
const ffmpeg = join(here, "..", "ad-payback", ".tools", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
const out = join(here, "out");
const master = (hook) => join(out, `ADCode-PaysYou-${hook.id}-${W}x${H}-60fps.mp4`);

/** The copy approved in the design, word for word. */
const APPROVED_HOOKS = ["This code editor pays you.", "Get paid to code.", "Your IDE shows ads. You keep half."];
const APPROVED = [
  "AI writes your code.", "Half the ad money is yours.", "Agents", "Terminal", "Git", "Preview",
  "ADCode", "Free · Open source · Windows & Linux", "adcode.bluethenics.com", "Example amounts. Earnings vary.",
];
const FORBIDDEN = /\b(cursor\s+(pro|ai|editor)|copilot|windsurf|devin|chatgpt|claude|openai|gemini|anthropic|vs\s?code|visual studio)\b|\$\d+\s*\/\s*mo|free ai|per month/i;

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail: String(detail) });
const words = (text) => text.split(/\s+/).filter((word) => /\w/.test(word)).length;
const readable = (text, from, to) => to - from >= 0.2 + 0.12 * words(text);

function ff(args) {
  const run = spawnSync(ffmpeg, ["-hide_banner", ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  return `${run.stdout ?? ""}${run.stderr ?? ""}`;
}
function describe(file) {
  const text = ff(["-i", file]);
  const video = /Video: (\w+) \((\w+)\)[^\n]*?, (yuv\w+)(?:\((?:tv|pc)?,?\s*([a-z0-9]+)?[^)]*\))?[^\n]*?, (\d+)x(\d+)[^\n]*?, ([\d.]+) fps/.exec(text);
  const audio = /Audio: (\w+)[^\n]*?, (\d+) Hz, (\w+)/.exec(text);
  const duration = /Duration: (\d+):(\d+):([\d.]+)/.exec(text);
  return {
    codec: video?.[1], profile: video?.[2], pixels: video?.[3], matrix: video?.[4] ?? "untagged",
    width: Number(video?.[5]), height: Number(video?.[6]), fps: Number(video?.[7]),
    audioCodec: audio?.[1], sampleRate: Number(audio?.[2]), channels: audio?.[3],
    seconds: duration ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]) : Number.NaN,
  };
}
function decode(file) {
  const text = ff(["-v", "error", "-stats", "-i", file, "-map", "0:v:0", "-f", "null", "-"]);
  const frames = [...text.matchAll(/frame=\s*(\d+)/g)].map((m) => Number(m[1])).pop() ?? 0;
  const errors = text.split(/\r?\n/).filter((line) => /error|corrupt|invalid/i.test(line) && !/frame=/.test(line));
  return { frames, errors };
}
function loudness(file) {
  const text = ff(["-i", file, "-map", "0:a:0", "-af", "ebur128=framelog=quiet:peak=true", "-f", "null", "-"]);
  const integrated = /Integrated loudness:\s*\n\s*I:\s*(-?[\d.]+) LUFS/.exec(text);
  const truePeak = /True peak:\s*\n\s*Peak:\s*(-?[\d.]+|-inf) dBFS/.exec(text);
  return { lufs: integrated ? Number(integrated[1]) : Number.NaN, peak: truePeak ? Number(truePeak[1]) : Number.NaN };
}
function peak(file, start, seconds) {
  const text = ff(["-ss", String(start), "-t", String(seconds), "-i", file, "-map", "0:a:0", "-af", "volumedetect", "-f", "null", "-"]);
  const match = /max_volume: (-?[\d.]+|-inf) dB/.exec(text);
  if (!match) return Number.NaN;
  return match[1] === "-inf" ? Number.NEGATIVE_INFINITY : Number(match[1]);
}
/** One frame at time t, as RGB on a `size × size` grid. */
function frameAt(file, t, size = 108) {
  const run = spawnSync(ffmpeg, ["-v", "error", "-ss", String(t), "-i", file, "-frames:v", "1", "-vf", `scale=${size}:${size}:flags=area,format=rgb24`, "-f", "rawvideo", "-"], { maxBuffer: 1 << 26 });
  return run.stdout;
}
function raw(file, pixels, size, fps) {
  const run = spawnSync(ffmpeg, ["-v", "error", "-i", file, "-vf", `fps=${fps},scale=${size}:${size}:flags=area,format=${pixels}`, "-f", "rawvideo", "-"], { maxBuffer: 1 << 29 });
  return run.stdout;
}
/** PSNR between two RGB buffers of equal size. */
function psnr(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += (a[i] - b[i]) ** 2;
  const mse = sum / a.length;
  return mse === 0 ? 99 : 10 * Math.log10((255 * 255) / mse);
}
const isGreen = (r, g, b) => g > 120 && g - r > 40 && g - b > 25;

// ── The copy, before any file exists: it is what the source says. ──
const hookTexts = HOOKS.map((hook) => hook.lines.join(" "));
check("hooks are exactly the approved hooks", hookTexts.every((text, i) => text === APPROVED_HOOKS[i]) && hookTexts.length === 3, hookTexts.join(" | "));
const texts = Object.values(LINES).map((line) => line.text);
check("on-screen copy is exactly the approved copy", texts.length === APPROVED.length && texts.every((text, i) => text === APPROVED[i]),
  texts.filter((text) => !APPROVED.includes(text)).join(" | ") || `${texts.length} lines`);
const short = [
  ...Object.values(LINES).filter((line) => line !== LINES.smallPrint && !readable(line.text, line.from, line.to)).map((line) => line.text),
  ...hookTexts.filter((text) => !readable(text, HOOK_WINDOW.from, HOOK_WINDOW.to)),
];
check("every line stays up long enough to read (0.2 s + 0.12 s a word)", short.length === 0, short.join("; ") || "all readable");
// The small print is drawn by a scene that spans the whole ad, so no frame with an amount
// can be without it.
const printer = readFileSync(join(here, "stage", "scenes", "end.js"), "utf8");
const overlay = /export const overlay = \{[\s\S]*?from: 0,[\s\S]*?to: DURATION,[\s\S]*?LINES\.smallPrint\.text/.test(printer);
const last = /SCENES = \[[^\]]*\boverlay\]/.test(readFileSync(join(here, "stage", "scenes", "index.js"), "utf8"));
check("the small print is drawn over the whole ad, on top", overlay && last, `${overlay ? "overlay spans 0 → DURATION" : "no overlay scene"}, ${last ? "drawn last" : "not drawn last"}`);
// The call to action counts from the moment all of it is readable, not from the cut.
const ctaFrom = Math.max(LINES.brand.from, LINES.claims.from, LINES.url.from);
check("the whole call to action holds at least 3 s", DURATION - ctaFrom >= 3, `${(DURATION - ctaFrom).toFixed(2)} s from ${ctaFrom} s`);

const sources = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (/\.(js|css|html)$/.test(entry.name)) sources.push(path);
  }
};
walk(join(here, "stage"));
const offending = sources.filter((path) => FORBIDDEN.test(readFileSync(path, "utf8")));
check("no competitor names, prices or \"free AI\" in the stage", offending.length === 0, offending.join(", ") || `${sources.length} files clean`);

// ── The files. ──
check("ffmpeg fetched", existsSync(ffmpeg), ffmpeg);
const frames60 = Math.round(DURATION * 60);
const firstFrames = [];
const bodyFrames = [];
for (const hook of HOOKS) {
  const file = master(hook);
  check(`${hook.id}: master exists`, existsSync(file), file);
  if (!existsSync(ffmpeg) || !existsSync(file)) continue;
  const info = describe(file);
  check(`${hook.id}: H.264 High, yuv420p, BT.709`, info.codec === "h264" && info.profile === "High" && info.pixels === "yuv420p" && info.matrix === "bt709",
    `${info.codec} ${info.profile} ${info.pixels} ${info.matrix}`);
  check(`${hook.id}: ${W}×${H} at 60 fps, ${DURATION} s`, info.width === W && info.height === H && info.fps === 60 && Math.abs(info.seconds - DURATION) <= 1 / 60 + 0.01,
    `${info.width}x${info.height} ${info.fps} fps ${info.seconds} s`);
  check(`${hook.id}: AAC 48 kHz stereo`, info.audioCodec === "aac" && info.sampleRate === 48000 && info.channels === "stereo", `${info.audioCodec} ${info.sampleRate} ${info.channels}`);
  const decoded = decode(file);
  check(`${hook.id}: ${frames60} frames decode cleanly`, decoded.frames === frames60 && decoded.errors.length === 0, `${decoded.frames} frames`);
  const { lufs, peak: truePeak } = loudness(file);
  check(`${hook.id}: loudness −14 ± 1.5 LUFS, true peak ≤ −1.5 dBTP`, Math.abs(lufs + 14) <= 1.5 && truePeak <= -1.5, `${lufs} LUFS, ${truePeak} dBTP`);
  check(`${hook.id}: sound from the first frame (0–0.15 s above −14 dB)`, peak(file, 0, 0.15) > -14, `${peak(file, 0, 0.15)} dB`);
  check(`${hook.id}: a clean end for the loop (last 10 ms below −30 dB)`, peak(file, DURATION - 0.012, 0.01) < -30, `${peak(file, DURATION - 0.012, 0.01)} dB`);

  // Frame 0 is the poster: big white words and money green, both there before anything moves.
  const first = frameAt(file, 0);
  firstFrames.push(first);
  let white = 0;
  let green = 0;
  const cells = first.length / 3;
  for (let p = 0; p < cells; p += 1) {
    const [r, g, b] = [first[p * 3], first[p * 3 + 1], first[p * 3 + 2]];
    // The hook's words are warm white or, on the money line, money green.
    if ((r > 200 && g > 200 && b > 200) || isGreen(r, g, b)) white += 1;
    if (isGreen(r, g, b)) green += 1;
  }
  check(`${hook.id}: frame 0 is the finished hook (≥ 4% of it bright text)`, white / cells >= 0.04, `${((100 * white) / cells).toFixed(1)}%`);
  check(`${hook.id}: frame 0 shows money green (≥ 0.5%)`, green / cells >= 0.005, `${((100 * green) / cells).toFixed(2)}%`);
  bodyFrames.push([2.5, 4.0, 5.2, 8.0].map((t) => frameAt(file, t)));

  // Colour: ten times a second, a coloured pixel must be money green.
  const rgb = raw(file, "rgb24", 96, 10);
  const grid = 96 * 96;
  const count = Math.floor(rgb.length / (grid * 3));
  const offHue = [];
  for (let i = 0; i < count; i += 1) {
    let bad = 0;
    for (let p = 0; p < grid; p += 1) {
      const o = (i * grid + p) * 3;
      const [r, g, b] = [rgb[o], rgb[o + 1], rgb[o + 2]];
      const max = Math.max(r, g, b);
      if (max < 60 || max - Math.min(r, g, b) <= 48) continue;
      if (!(g === max && g - r > 30 && g - b > 10)) bad += 1;
    }
    if (bad / grid > 0.002) offHue.push((i / 10).toFixed(1));
  }
  check(`${hook.id}: the only colour is money green`, offHue.length === 0, offHue.length ? `other hues at ${offHue.slice(0, 8).join(", ")} s` : `${count} frames sampled`);

  // Motion: something changes in every second before the end card.
  const gray = raw(file, "gray", 96, 30);
  const frames = Math.floor(gray.length / grid);
  const change = [0];
  for (let i = 1; i < frames; i += 1) {
    let sum = 0;
    for (let p = 0; p < grid; p += 1) sum += Math.abs(gray[i * grid + p] - gray[(i - 1) * grid + p]);
    change.push(sum / grid);
  }
  const still = [];
  for (let second = 0; second < Math.floor(CUE.end); second += 1) {
    if (Math.max(...change.slice(second * 30 + 1, (second + 1) * 30)) < 0.4) still.push(second);
  }
  check(`${hook.id}: something moves in every second before the end card`, still.length === 0, still.length ? `still in second(s) ${still.join(", ")}` : "all moving");
  for (const name of [`thumb-${hook.id}.png`, `contact-sheet-${hook.id}.png`]) check(`${hook.id}: ${name} exists`, existsSync(join(out, name)));
}

// The three files are one ad with three openings: different at frame 0, the same after.
if (firstFrames.length === 3) {
  const opening = Math.max(psnr(firstFrames[0], firstFrames[1]), psnr(firstFrames[0], firstFrames[2]), psnr(firstFrames[1], firstFrames[2]));
  check("the three openings differ (frame 0 PSNR < 30 dB between hooks)", opening < 30, `${opening.toFixed(1)} dB at most`);
  const body = Math.min(...bodyFrames[0].map((frame, i) => Math.min(psnr(frame, bodyFrames[1][i]), psnr(frame, bodyFrames[2][i]))));
  check("after the hook, the three are the same ad (PSNR ≥ 32 dB)", body >= 32, `${body.toFixed(1)} dB at least`);
}

for (const { name, ok, detail } of results) {
  process.stdout.write(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}\n`);
}
const failed = results.filter((one) => !one.ok).length;
process.stdout.write(`\n${results.length - failed}/${results.length} checks passed\n`);
process.exit(failed === 0 ? 0 : 1);
