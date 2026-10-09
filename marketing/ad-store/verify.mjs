#!/usr/bin/env node
/**
 * Does the rendered spot meet its delivery spec? Exit 0 only when every check passes.
 *
 *   node marketing/ad-store/verify.mjs
 *
 * Reads both cuts the way a platform will - decodes every frame, measures loudness the way
 * players normalise it (EBU R128) - and checks what the design promised: the copy is the
 * approved copy and each line stays up long enough to read, the offer is readable on frame
 * 0 with the money word in green, the only colour is money until the official badge, the
 * sound opens on a hit, and something moves every second until the end card holds.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CUE, DURATION, FORMATS, LINES } from "./stage/cues.js";

const here = import.meta.dirname;
const ffmpeg = join(here, "..", "ad-payback", ".tools", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
const out = join(here, "out");

/** The copy approved in the design, word for word. */
const APPROVED = [
  "Now on the Microsoft Store",
  "Get paid to code.",
  "You build with AI.",
  "ADCode, build me a habit tracker",
  "An occasional ad keeps it free.",
  "+$0.04",
  "50%",
  "Your share of every ad",
  "Half the ad money is yours.",
  "On a ledger you can audit.",
  "50% yours",
  "Now on the Microsoft Store.",
  "ADCode",
  "Get paid to code.",
  "Free. Half the ad money is yours.",
  "adcode.bluethenics.com",
  "Example amounts. Earnings vary. Sponsored cards are occasional.",
];
/** Things the spot must never say or show, anywhere in its source. */
const FORBIDDEN = /\b(cursor\s+(pro|ai|editor)|copilot|windsurf|devin|chatgpt|claude|openai|gemini|anthropic|vs\s?code|visual studio)\b|\$\d+\s*\/\s*mo|free ai|per month|guaranteed|every prompt/i;

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
  const colour = /Video: [^\n]*?yuv420p\((?:tv|pc)?,?\s*([a-z0-9]+)/.exec(text);
  return {
    codec: video?.[1], profile: video?.[2], pixels: video?.[3],
    width: Number(video?.[4]), height: Number(video?.[5]), fps: Number(video?.[6]),
    audioCodec: audio?.[1], sampleRate: Number(audio?.[2]), channels: audio?.[3],
    seconds: duration ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]) : Number.NaN,
    colour: colour ? colour[1] : "untagged",
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

/** Raw frames, downscaled to a grid of `w × h`, at `fps`, as one buffer. */
function raw(file, pixels, w, h, fps) {
  const run = spawnSync(ffmpeg, ["-v", "error", "-i", file, "-vf", `fps=${fps},scale=${w}:${h}:flags=area,format=${pixels}`, "-f", "rawvideo", "-"], { maxBuffer: 1 << 29 });
  return run.stdout;
}

const isGreen = (r, g, b) => g === Math.max(r, g, b) && g - r > 30 && g - b > 10;
const coloured = (r, g, b) => Math.max(r, g, b) >= 60 && Math.max(r, g, b) - Math.min(r, g, b) > 48;

// ── The copy, before any file exists: it is what the source says. ──
const lines = Object.values(LINES);
const texts = lines.map((line) => line.text);
check("on-screen copy is exactly the approved copy",
  texts.length === APPROVED.length && texts.every((text, i) => text === APPROVED[i]),
  texts.filter((text) => !APPROVED.includes(text)).join(" | ") || `${texts.length} lines`);
const short = lines.filter(({ text, from, to }) => to - from < 0.2 + 0.12 * text.split(/\s+/).length);
check("every line stays up long enough to read (0.2 s + 0.12 s a word)", short.length === 0,
  short.map(({ text, from, to }) => `"${text}" ${(to - from).toFixed(2)} s`).join("; ") || "all readable");
check("the offer is on screen from frame 0", LINES.hook.from === 0 && LINES.kicker.from === 0, `${LINES.hook.from} s`);
check("the small print is on screen for the whole spot", LINES.small.from === 0 && LINES.small.to === DURATION);

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
check("no competitor names, prices, \"free AI\" or promises in the stage", offending.length === 0, offending.join(", ") || `${sources.length} files clean`);
check("the official Get it from Microsoft badge is bundled", existsSync(join(here, "stage", "assets", "ms-badge-dark.svg")));
check("ffmpeg fetched", existsSync(ffmpeg), ffmpeg);

// ── Each cut. ──
for (const [format, { w: W, h: H }] of Object.entries(FORMATS)) {
  const master = join(out, `ADCode-MicrosoftStore-${W}x${H}-60fps.mp4`);
  const copy30 = join(out, `ADCode-MicrosoftStore-${W}x${H}-30fps.mp4`);
  const tag = `[${format}]`;
  check(`${tag} 60 fps master exists`, existsSync(master), master);
  if (!existsSync(ffmpeg) || !existsSync(master)) continue;

  const info = describe(master);
  check(`${tag} H.264 High, yuv420p, BT.709`, info.codec === "h264" && info.profile === "High" && info.pixels === "yuv420p" && info.colour === "bt709",
    `${info.codec} ${info.profile} ${info.pixels} ${info.colour}`);
  check(`${tag} ${W}×${H} at 60 fps`, info.width === W && info.height === H && info.fps === 60, `${info.width}x${info.height} ${info.fps}`);
  check(`${tag} ${DURATION.toFixed(3)} s (± one frame)`, Math.abs(info.seconds - DURATION) <= 1 / 60 + 0.01, info.seconds);
  check(`${tag} AAC 48 kHz stereo`, info.audioCodec === "aac" && info.sampleRate === 48000 && info.channels === "stereo",
    `${info.audioCodec} ${info.sampleRate} ${info.channels}`);
  const frames60 = Math.round(DURATION * 60);
  const decoded = decode(master);
  check(`${tag} ${frames60} frames decode cleanly`, decoded.frames === frames60 && decoded.errors.length === 0,
    `${decoded.frames} frames${decoded.errors.length ? `; ${decoded.errors[0]}` : ""}`);

  const { lufs, peak: truePeak } = loudness(master);
  check(`${tag} loudness −14 ± 1.5 LUFS`, Math.abs(lufs - -14) <= 1.5, `${lufs} LUFS`);
  check(`${tag} true peak ≤ −1.5 dBTP`, truePeak <= -1.5, `${truePeak} dBTP`);
  check(`${tag} it opens on a hit (0–0.3 s above −14 dB)`, peak(master, 0, 0.3) > -14, `${peak(master, 0, 0.3)} dB`);
  check(`${tag} the stamp lands (above −12 dB)`, peak(master, CUE.stamp, 0.25) > -12, `${peak(master, CUE.stamp, 0.25)} dB`);
  check(`${tag} the ending is clean (last 10 ms below −30 dB)`, peak(master, DURATION - 0.012, 0.01) < -30, `${peak(master, DURATION - 0.012, 0.01)} dB`);

  // Frame 0, as a feed shows it: bright type on the dark, and the money word in green.
  const [gw, gh] = [W / 20, H / 20];
  const cells = gw * gh;
  const rgb = raw(master, "rgb24", gw, gh, 10);
  const count = Math.floor(rgb.length / (cells * 3));
  let bright = 0;
  let green0 = 0;
  for (let p = 0; p < cells; p += 1) {
    const [r, g, b] = [rgb[p * 3], rgb[p * 3 + 1], rgb[p * 3 + 2]];
    if (r > 150 && g > 150 && b > 150) bright += 1;
    if (coloured(r, g, b) && isGreen(r, g, b)) green0 += 1;
  }
  check(`${tag} frame 0 carries the offer (type and green on screen)`, bright / cells > 0.03 && green0 / cells > 0.01,
    `${((bright / cells) * 100).toFixed(1)}% bright, ${((green0 / cells) * 100).toFixed(1)}% green`);

  // The only colour is money, until the official badge arrives with its own logo.
  const offHue = [];
  for (let i = 0; i < count; i += 1) {
    const at = i / 10;
    if (at >= CUE.end) break;
    let other = 0;
    for (let p = 0; p < cells; p += 1) {
      const o = (i * cells + p) * 3;
      const [r, g, b] = [rgb[o], rgb[o + 1], rgb[o + 2]];
      if (coloured(r, g, b) && !isGreen(r, g, b)) other += 1;
    }
    if (other / cells > 0.002) offHue.push(at.toFixed(1));
  }
  check(`${tag} the only colour is money green (before the badge)`, offHue.length === 0, offHue.length ? `other hues at ${offHue.slice(0, 8).join(", ")} s` : "green only");

  // Motion: something changes in every second before the end card holds.
  const gray = raw(master, "gray", gw, gh, 30);
  const frames = Math.floor(gray.length / cells);
  const change = [0];
  for (let i = 1; i < frames; i += 1) {
    let sum = 0;
    for (let p = 0; p < cells; p += 1) sum += Math.abs(gray[i * cells + p] - gray[(i - 1) * cells + p]);
    change.push(sum / cells);
  }
  const still = [];
  for (let second = 0; second < Math.floor(CUE.end); second += 1) {
    if (Math.max(...change.slice(second * 30 + 1, (second + 1) * 30)) < 0.4) still.push(second);
  }
  check(`${tag} something moves in every second before the end card`, still.length === 0, still.length ? `still in second(s) ${still.join(", ")}` : "all moving");

  check(`${tag} 30 fps copy exists`, existsSync(copy30), copy30);
  if (existsSync(copy30)) {
    const info30 = describe(copy30);
    const decoded30 = decode(copy30);
    const frames30 = Math.round(DURATION * 30);
    check(`${tag} 30 fps copy: ${W}×${H}, ${frames30} frames`,
      info30.width === W && info30.height === H && info30.fps === 30 && decoded30.frames === frames30,
      `${info30.width}x${info30.height} ${info30.fps} fps ${decoded30.frames} frames`);
  }
  for (const name of [`contact-sheet-${W}x${H}.png`, `thumb-hook-${W}x${H}.png`, `thumb-fifty-${W}x${H}.png`, `thumb-endcard-${W}x${H}.png`]) {
    check(`${tag} ${name} exists`, existsSync(join(out, name)));
  }
}

for (const { name, ok, detail } of results) {
  process.stdout.write(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}\n`);
}
const failed = results.filter((one) => !one.ok).length;
process.stdout.write(`\n${results.length - failed}/${results.length} checks passed\n`);
process.exit(failed === 0 ? 0 : 1);
