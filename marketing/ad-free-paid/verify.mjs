#!/usr/bin/env node
/**
 * Does the rendered spot meet its delivery spec? Exit 0 only when every check passes.
 *
 *   node marketing/ad-free-paid/verify.mjs
 *
 * Reads the files the way a platform will - decodes every frame, measures loudness the way
 * players normalise it (EBU R128) - and checks what the design promised: the copy is the
 * approved copy and each line stays up long enough to read, the only colour is money and
 * only once the money arrives, the small print is on every frame, and frame 0 is already
 * the finished hook. Parses ffmpeg's own report, so it needs nothing beyond the fetched
 * ffmpeg.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CUE, DURATION, H, LINES, MONEY_FROM, W } from "./stage/cues.js";

const here = import.meta.dirname;
const ffmpeg = join(here, "..", "ad-payback", ".tools", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
const out = join(here, "out");
const master = join(out, `ADCode-FreeThenPaid-${W}x${H}-60fps.mp4`);
const copy30 = join(out, `ADCode-FreeThenPaid-${W}x${H}-30fps.mp4`);

/** The copy approved in the design, word for word, in the order of LINES. */
const APPROVED = [
  "ADCode",
  "The free AI code editor.",
  "Build me a habit tracker",
  "Your AI is working…",
  "+$0.04",
  "Get paid to wait.",
  "$0.08",
  "This ad paid",
  "You",
  "+$0.04",
  "ADCode",
  "50%",
  "Half the ad money is yours.",
  "Vibe or Code. Earn in both.",
  "Vibe",
  "Code",
  "Earnings",
  "ADCode",
  "Get paid to wait.",
  "Free. Half the ad money is yours.",
  "Windows & Linux",
  "adcode.bluethenics.com",
  "Use your own AI key or a local model.",
  "Example amounts. Earnings vary. Sponsored cards are occasional.",
];
/**
 * Things the spot must never say or show, anywhere in its source. "Free AI" is allowed only
 * as the approved hook, "free AI code editor": the editor is free, the AI is the user's key.
 */
const FORBIDDEN = /\b(cursor\s+(pro|ai|editor)|copilot|windsurf|devin|chatgpt|claude|openai|gemini|anthropic|vs\s?code|visual studio|slack|notion)\b|\$\d+\s*\/\s*mo|free ai(?! code editor)|per month|every prompt/i;

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

function describeColour(file) {
  const text = ff(["-i", file]);
  const match = /Video: [^\n]*?yuv420p\((?:tv|pc)?,?\s*([a-z0-9]+)/.exec(text);
  return match ? match[1] : "untagged";
}

/** One frame of a file, scaled to w × h, as grey bytes. */
function frameGray(file, n, w, h) {
  const run = spawnSync(ffmpeg, ["-v", "error", "-i", file, "-vf", `select='eq(n\\,${n})',scale=${w}:${h}:flags=area,format=gray`, "-frames:v", "1", "-f", "rawvideo", "-"], { maxBuffer: 1 << 24 });
  return run.stdout;
}

/** PSNR between frame a and frame b of a file. */
function psnr(file, a, b) {
  const text = ff(["-i", file, "-i", file, "-lavfi",
    `[0:v]select='eq(n\\,${a})',setpts=N[a];[1:v]select='eq(n\\,${b})',setpts=N[b];[a][b]psnr`, "-f", "null", "-"]);
  const match = /average:([\d.]+|inf)/.exec(text);
  return match ? (match[1] === "inf" ? 99 : Number(match[1])) : Number.NaN;
}

/** Raw frames, scaled to `w × h` (optionally cropped first), at `fps`, as one buffer. */
function raw(file, pixels, w, h, fps, crop = "") {
  const filter = `fps=${fps},${crop ? `crop=${crop},` : ""}scale=${w}:${h}:flags=area,format=${pixels}`;
  const run = spawnSync(ffmpeg, ["-v", "error", "-i", file, "-vf", filter, "-f", "rawvideo", "-"], { maxBuffer: 1 << 29 });
  return run.stdout;
}

// ── The copy, before any file exists: it is what the source says. ──
const lines = Object.values(LINES);
const texts = lines.map((line) => line.text);
check("on-screen copy is exactly the approved copy",
  texts.length === APPROVED.length && texts.every((text, i) => text === APPROVED[i]),
  texts.filter((text) => !APPROVED.includes(text)).join(" | ") || `${texts.length} lines`);
const short = lines.filter(({ text, from, to }) => to - from < 0.2 + 0.12 * text.split(/\s+/).length);
check("every line stays up long enough to read (0.2 s + 0.12 s a word)", short.length === 0,
  short.map(({ text, from, to }) => `"${text}" ${(to - from).toFixed(2)} s`).join("; ") || "all readable");
check("the hook is readable from frame 0", LINES.hook.from === 0 && LINES.kicker.from === 0, `${LINES.hook.from} s`);
check("the small print covers the whole spot", LINES.small.from === 0 && LINES.small.to === DURATION, `${LINES.small.from}–${LINES.small.to} s`);
check("the end card holds at least 1.5 s", DURATION - CUE.end >= 1.5, `${(DURATION - CUE.end).toFixed(2)} s`);

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
check("no competitor names, prices, \"every prompt\" or loose \"free AI\" in the stage", offending.length === 0, offending.join(", ") || `${sources.length} files clean`);

// ── The files. ──
check("ffmpeg fetched", existsSync(ffmpeg), ffmpeg);
check("60 fps master exists", existsSync(master), master);

const frames60 = Math.round(DURATION * 60);
if (existsSync(ffmpeg) && existsSync(master)) {
  const info = describe(master);
  check("H.264 High, yuv420p", info.codec === "h264" && info.profile === "High" && info.pixels === "yuv420p", `${info.codec} ${info.profile} ${info.pixels}`);
  check(`${W}×${H}`, info.width === W && info.height === H, `${info.width}x${info.height}`);
  check("60 fps", info.fps === 60, info.fps);
  check(`${DURATION.toFixed(3)} s (± one frame)`, Math.abs(info.seconds - DURATION) <= 1 / 60 + 0.01, info.seconds);
  check("AAC 48 kHz stereo", info.audioCodec === "aac" && info.sampleRate === 48000 && info.channels === "stereo",
    `${info.audioCodec} ${info.sampleRate} ${info.channels}`);

  const decoded = decode(master);
  check(`${frames60} frames decode cleanly`, decoded.frames === frames60 && decoded.errors.length === 0,
    `${decoded.frames} frames${decoded.errors.length ? `; ${decoded.errors[0]}` : ""}`);

  const { lufs, peak: truePeak } = loudness(master);
  check("loudness −14 ± 1.5 LUFS", Math.abs(lufs - -14) <= 1.5, `${lufs} LUFS`);
  check("true peak ≤ −1.5 dBTP", truePeak <= -1.5, `${truePeak} dBTP`);

  check("sound from the first frame (0–0.25 s above −20 dB)", peak(master, 0, 0.25) > -20, `${peak(master, 0, 0.25)} dB`);
  check("the money hits (+$0.04, above −16 dB)", peak(master, CUE.earn, 0.2) > -16, `${peak(master, CUE.earn, 0.2)} dB`);
  check("the split hits (above −12 dB)", peak(master, CUE.split, 0.3) > -12, `${peak(master, CUE.split, 0.3)} dB`);
  check("the ending is clean (last 10 ms below −30 dB)", peak(master, DURATION - 0.012, 0.01) < -30, `${peak(master, DURATION - 0.012, 0.01)} dB`);

  const tags = describeColour(master);
  check("colour tagged BT.709", tags === "bt709", tags);

  // Frame 0 is the finished hook: as much bright type as a quarter second later, before the
  // underline. (The camera drifts in by design, so this counts ink, not pixels in place.)
  const ink = (n) => { const g = frameGray(master, n, 270, 270); let k = 0; for (const v of g) if (v > 170) k += 1; return k / g.length; };
  const [first, settled] = [ink(0), ink(15)];
  check("frame 0 is already the finished hook (type at frame 0 ≥ 90% of 0.25 s)", first >= 0.9 * settled && first > 0.03,
    `${(first * 100).toFixed(1)}% vs ${(settled * 100).toFixed(1)}% of the frame`);
  // The dive's hand-off into the mark should be seamless.
  const at = Math.round(CUE.mark * 60);
  const seam = psnr(master, at - 1, at);
  check(`the hand-off at ${CUE.mark} s is seamless (PSNR ≥ 24 dB)`, seam >= 24, `${seam.toFixed(1)} dB`);

  // Colour: sampled ten times a second on a 72 × 72 grid. A pixel counts as coloured when its
  // channels spread by more than 48 and it is not dark. Before the money, none may be; after
  // it, only green may be.
  const [gw, gh, rate] = [72, 72, 10];
  const rgb = raw(master, "rgb24", gw, gh, rate);
  const cells = gw * gh;
  const count = Math.floor(rgb.length / (cells * 3));
  const early = [];
  const offHue = [];
  for (let i = 0; i < count; i += 1) {
    const time = i / rate;
    let colour = 0;
    let notGreen = 0;
    for (let p = 0; p < cells; p += 1) {
      const o = (i * cells + p) * 3;
      const [r, g, b] = [rgb[o], rgb[o + 1], rgb[o + 2]];
      const max = Math.max(r, g, b);
      if (max < 60 || max - Math.min(r, g, b) <= 48) continue;
      colour += 1;
      if (!(g === max && g - r > 30 && g - b > 10)) notGreen += 1;
    }
    if (time < MONEY_FROM && colour / cells > 0.002) early.push(time.toFixed(1));
    if (notGreen / cells > 0.002) offHue.push(time.toFixed(1));
  }
  check("no colour before the money", early.length === 0, early.length ? `colour at ${early.slice(0, 8).join(", ")} s` : `${count} frames sampled`);
  check("the only colour is money green", offHue.length === 0, offHue.length ? `other hues at ${offHue.slice(0, 8).join(", ")} s` : "green only");

  // The small print: its strip at the bottom carries bright text in every sampled frame.
  const strip = raw(master, "gray", 270, 6, 10, `${W * 0.62}:24:${W * 0.19}:${H - 54}`);
  const stripCells = 270 * 6;
  const stripFrames = Math.floor(strip.length / stripCells);
  const bare = [];
  for (let i = 0; i < stripFrames; i += 1) {
    let bright = 0;
    for (let p = 0; p < stripCells; p += 1) if (strip[i * stripCells + p] > 110) bright += 1;
    if (bright / stripCells < 0.04) bare.push((i / 10).toFixed(1));
  }
  check("the small print is on every frame", bare.length === 0 && stripFrames > 0, bare.length ? `missing at ${bare.slice(0, 8).join(", ")} s` : `${stripFrames} frames sampled`);

  // Motion: something changes in every second up to the end card.
  const [mw, mh] = [96, 96];
  const mcells = mw * mh;
  const gray = raw(master, "gray", mw, mh, 30);
  const frames = Math.floor(gray.length / mcells);
  const change = [0];
  for (let i = 1; i < frames; i += 1) {
    let sum = 0;
    for (let p = 0; p < mcells; p += 1) sum += Math.abs(gray[i * mcells + p] - gray[(i - 1) * mcells + p]);
    change.push(sum / mcells);
  }
  const still = [];
  for (let second = 0; second < Math.floor(CUE.end); second += 1) {
    if (Math.max(...change.slice(second * 30 + 1, (second + 1) * 30)) < 0.4) still.push(second);
  }
  check("something moves in every second before the end card", still.length === 0, still.length ? `still in second(s) ${still.join(", ")}` : "all moving");
  let run = 0;
  let longest = 0;
  for (let i = 0; i < frames; i += 1) {
    let sum = 0;
    for (let p = 0; p < mcells; p += 1) sum += gray[i * mcells + p];
    run = sum / mcells < 3 ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  check("no black stretch longer than 0.3 s", longest / 30 <= 0.3, `${(longest / 30).toFixed(2)} s`);
}

check("30 fps copy exists", existsSync(copy30), copy30);
if (existsSync(ffmpeg) && existsSync(copy30)) {
  const info = describe(copy30);
  const decoded = decode(copy30);
  const frames30 = Math.round(DURATION * 30);
  check(`30 fps copy: ${W}×${H}, 30 fps, ${frames30} frames`,
    info.width === W && info.height === H && info.fps === 30 && decoded.frames === frames30,
    `${info.width}x${info.height} ${info.fps} fps ${decoded.frames} frames`);
}

for (const name of ["contact-sheet.png", "thumb-hook.png", "thumb-paid.png", "thumb-split.png", "thumb-endcard.png"]) {
  check(`${name} exists`, existsSync(join(out, name)));
}

for (const { name, ok, detail } of results) {
  process.stdout.write(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}\n`);
}
const failed = results.filter((one) => !one.ok).length;
process.stdout.write(`\n${results.length - failed}/${results.length} checks passed\n`);
process.exit(failed === 0 ? 0 : 1);
