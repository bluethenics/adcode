#!/usr/bin/env node
/**
 * Does the rendered Reel meet its delivery spec? Exit 0 only when every check passes.
 *
 *   node marketing/ad-blip/verify.mjs            # both hooks
 *   node marketing/ad-blip/verify.mjs --hook 1   # one
 *
 * Reads the files the way Instagram will - decodes every frame, measures loudness as players
 * normalise it (EBU R128) - and reads the layout dump the renderer wrote from the frames it
 * drew, so the copy checks are about what was on screen, not what the source meant:
 *   - the approved copy, word for word, each line up long enough to read;
 *   - critical copy inside the Reels safe zone, clear of the button rail;
 *   - the hook readable in frame 0 and inside the profile grid's 3:4 crop;
 *   - every money claim on screen together with its small print;
 *   - the last frame matches the first, so a replay is seamless;
 *   - the beat before the "!" is silent;
 *   - no competitor names or promises the product cannot keep, anywhere in the source.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CAST, CUE, DURATION, FPS, GRID_CROP, H, HOOKS, RAIL, SAFE, W } from "./stage/cues.js";

const here = import.meta.dirname;
const out = join(here, "out");
const ffmpeg = join(here, "..", "ad-payback", ".tools", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
const at = process.argv.indexOf("--hook");
const hooks = at === -1 ? [1, 2] : [Number(process.argv[at + 1])];

/** The approved copy, and the least time (s) each line must be fully on screen. */
const COPY = new Map([
  ["POV: your AI is", 1.9], ["still thinking…", 1.9], ["Your AI is slow.", 1.9], ["Make it pay you.", 1.9],
  ["Thinking…", 2], ["99%", 2],
  ["Every.", 1.5], ["Single.", 0.9], ["Prompt.", 0.4], ["(it's trying its best)", 0.9],
  ["REAL AI FACT", 2.4], ["Developers using", 2.4], ["AI agents", 2.4], ["31%", 2.0], ["59%", 1.2], ["nearly 2×", 1.0],
  ["2025", 2.0], ["April 2026", 2.0],
  ["Source: Stack Overflow Developer Survey 2025", 2.4], ["and its April 2026 pulse survey.", 2.4],
  ["That's a lot of waiting.", 0.9],
  ["What if the wait…", 1.0], ["paid you?", 0.6],
  ["Sponsored", 0.4], ["Acme Cloud", 0.4], ["Deploy in one click.", 0.4],
  ["+$0.04 · you", 1.7], ["+$0.04 · ADCode", 1.7],
  ["Get paid", 1.6], ["to wait.", 1.5], ["Half the ad money is yours.", 1.2],
  ["Occasional sponsored card. Example amount. Earnings vary.", 2.5],
  ["Build with AI.", 3.5],
  ...Object.values(CAST).flatMap((c) => [[c.name, 0.3], [c.role, 0.25]]),
  ["Hello, world.", 1.8], ["It works!", 1.2],
  ["NEW IN ADCODE", 4.0], ["Open source", 1.1], ["Apache-2.0. Read every line.", 1.0],
  ["Run 3 agents at once", 1.1], ["Your crew works in parallel.", 1.0],
  ["Race mode", 1.1], ["One task. 3 agents. Keep the best.", 1.0],
  ["Done", 1.5], ["100%", 1.5], ["Thanks for", 1.2], ["waiting.", 0.9],
  ["ADCode", 2.2], ["Get paid to wait.", 1.9], ["Free & open source · Windows & Linux", 1.8], ["Link in bio", 1.8],
  ["Bring your own AI key or local model.", 1.8], ["Occasional sponsored cards. Earnings vary.", 1.8],
]);
/** A claim about money may only be on screen with the small print that qualifies it. */
const CLAIMS = ["Get paid", "+$0.04 · you", "+$0.04 · ADCode", "Half the ad money is yours.", "Get paid to wait."];
const DISCLOSURES = ["Occasional sponsored card. Example amount. Earnings vary.", "Occasional sponsored cards. Earnings vary."];
/** Things the film must never say, anywhere in its source. */
const FORBIDDEN = /\b(cursor\s+(pro|ai|editor)|copilot|windsurf|devin|chatgpt|claude|openai|gemini|anthropic|vs\s?code|visual studio|replit|lovable|bolt\.new)\b|free ai|guarantee|every prompt pays|per prompt|get rich|passive income/i;
/** Cuts and transitions: copy is still landing for a moment after each. */
const CUTS = [CUE.mug, CUE.clock, CUE.phone, CUE.best, CUE.fact, CUE.badge, CUE.build, CUE.work, CUE.works, CUE.news, ...CUE.cards, CUE.close, CUE.end];

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail: String(detail) });

function ff(args) {
  const run = spawnSync(ffmpeg, ["-hide_banner", ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  return `${run.stdout ?? ""}${run.stderr ?? ""}`;
}
function describe(file) {
  const s = ff(["-i", file]);
  const v = /Video: (\w+) \((\w+)\)[^\n]*?, (yuv\w+)[^\n]*?, (\d+)x(\d+)[^\n]*?, ([\d.]+) fps/.exec(s);
  const a = /Audio: (\w+)[^\n]*?, (\d+) Hz, (\w+)/.exec(s);
  const d = /Duration: (\d+):(\d+):([\d.]+)/.exec(s);
  return {
    codec: v?.[1], profile: v?.[2], pixels: v?.[3], width: Number(v?.[4]), height: Number(v?.[5]), fps: Number(v?.[6]),
    audio: a?.[1], rate: Number(a?.[2]), channels: a?.[3],
    seconds: d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : NaN,
  };
}
function decode(file) {
  const s = ff(["-v", "error", "-stats", "-i", file, "-map", "0:v:0", "-f", "null", "-"]);
  const frames = [...s.matchAll(/frame=\s*(\d+)/g)].map((m) => Number(m[1])).pop() ?? 0;
  const errors = s.split(/\r?\n/).filter((l) => /error|corrupt|invalid/i.test(l) && !/frame=/.test(l));
  return { frames, errors };
}
function loudness(file) {
  const s = ff(["-i", file, "-map", "0:a:0", "-af", "ebur128=framelog=quiet:peak=true", "-f", "null", "-"]);
  const i = /Integrated loudness:\s*\n\s*I:\s*(-?[\d.]+) LUFS/.exec(s);
  const p = /True peak:\s*\n\s*Peak:\s*(-?[\d.]+|-inf) dBFS/.exec(s);
  return { lufs: i ? Number(i[1]) : NaN, peak: p ? Number(p[1]) : NaN };
}
function peakDb(file, start, seconds) {
  const s = ff(["-i", file, "-map", "0:a:0", "-af", `atrim=start=${start}:duration=${seconds},astats=metadata=0:reset=0`, "-f", "null", "-"]);
  const m = [...s.matchAll(/Peak level dB:\s*(-?[\d.]+|-inf)/g)].map((x) => (x[1] === "-inf" ? -Infinity : Number(x[1])));
  return m.length ? Math.max(...m) : NaN;
}
/** PSNR between two images (or a video frame and an image), in dB. */
function psnr(a, b, extra = []) {
  const s = ff([...extra, "-i", a, "-i", b, "-lavfi", "[0:v]format=yuv420p[x];[1:v]format=yuv420p[y];[x][y]psnr", "-frames:v", "1", "-f", "null", "-"]);
  const m = /average:([\d.]+|inf)/.exec(s);
  return m ? (m[1] === "inf" ? Infinity : Number(m[1])) : NaN;
}
const inside = (b, r, pad = 0) => b.x0 >= r.x0 - pad && b.x1 <= r.x1 + pad && b.y0 >= r.y0 - pad && b.y1 <= r.y1 + pad;
const settledAt = (t) => !CUTS.some((c) => t >= c - 1e-6 && t < c + 0.4) && t < CUE.scroll;

// ── The source says nothing it must not ──
const sources = readdirSync(join(here, "stage")).filter((f) => f.endsWith(".js")).map((f) => [f, readFileSync(join(here, "stage", f), "utf8")]);
const banned = sources.flatMap(([f, s]) => (FORBIDDEN.exec(s) ? [`${f}: ${FORBIDDEN.exec(s)[0]}`] : []));
check("no competitor names or impossible promises in the source", banned.length === 0, banned.join("; "));
check("hooks differ", HOOKS[1].join() !== HOOKS[2].join());

for (const hook of hooks) {
  const master = join(out, `ADCode-Blip-H${hook}-${W}x${H}.mp4`);
  const tag = `H${hook}`;
  if (!existsSync(master)) { check(`${tag}: deliverable exists`, false, master); continue; }
  check(`${tag}: deliverable exists`, true, `${(statSync(master).size / 1e6).toFixed(1)} MB`);

  const d = describe(master);
  check(`${tag}: H.264 High, yuv420p`, d.codec === "h264" && d.profile === "High" && d.pixels === "yuv420p", `${d.codec} ${d.profile} ${d.pixels}`);
  check(`${tag}: 1080×1920 at 30 fps (9:16)`, d.width === W && d.height === H && d.fps === FPS, `${d.width}×${d.height} ${d.fps} fps`);
  check(`${tag}: AAC 48 kHz stereo`, d.audio === "aac" && d.rate === 48000 && d.channels === "stereo", `${d.audio} ${d.rate} ${d.channels}`);
  check(`${tag}: ${DURATION} s long`, Math.abs(d.seconds - DURATION) < 0.06, d.seconds.toFixed(3));
  const dec = decode(master);
  check(`${tag}: every frame decodes`, dec.frames === Math.round(DURATION * FPS) && dec.errors.length === 0, `${dec.frames} frames${dec.errors.length ? `; ${dec.errors[0]}` : ""}`);
  const loud = loudness(master);
  check(`${tag}: loudness −14 LUFS ±1`, Math.abs(loud.lufs + 14) <= 1, `${loud.lufs} LUFS`);
  check(`${tag}: true peak ≤ −1 dBTP`, loud.peak <= -1, `${loud.peak} dBTP`);
  const gate = peakDb(master, CUE.gate + 0.03, CUE.badge - CUE.gate - 0.06);
  check(`${tag}: silent beat before the "!"`, gate < -40, `${gate.toFixed(1)} dBFS`);

  // The loop: the last frame should be the first frame again.
  const first = join(out, `.verify-${tag}-first.png`);
  const last = join(out, `.verify-${tag}-last.png`);
  ff(["-y", "-i", master, "-vf", "select=eq(n\\,0)", "-frames:v", "1", first]);
  ff(["-y", "-sseof", "-0.2", "-i", master, "-update", "1", "-frames:v", "99", last]);
  const loop = psnr(first, last);
  check(`${tag}: last frame matches the first (seamless loop)`, loop >= 28, `${loop.toFixed(1)} dB PSNR`);
  const cover = join(out, `cover-${tag}.png`);
  check(`${tag}: cover is frame 0`, existsSync(cover) && psnr(cover, first) >= 30, existsSync(cover) ? `${psnr(cover, first).toFixed(1)} dB` : "missing");
  check(`${tag}: contact sheet`, existsSync(join(out, `contact-sheet-${tag}.png`)));

  // ── What the frames showed ──
  const layoutFile = join(out, `layout-${tag}.json`);
  if (!existsSync(layoutFile)) { check(`${tag}: layout dump`, false, "missing - render a full hook"); continue; }
  const samples = JSON.parse(readFileSync(layoutFile, "utf8"));
  const step = samples[1].t - samples[0].t;

  const zero = samples[0].boxes;
  const hookBoxes = HOOKS[hook].map((line) => zero.find((b) => b.text === line));
  check(`${tag}: hook readable in frame 0`, hookBoxes.every(Boolean), HOOKS[hook].join(" / "));
  check(`${tag}: hook inside the profile grid's 3:4 crop`, hookBoxes.every((b) => b && b.y0 >= GRID_CROP.y0 && b.y1 <= GRID_CROP.y1), hookBoxes.map((b) => b && `${b.y0}–${b.y1}`).join(", "));

  const unknown = new Set();
  const outside = [];
  const shown = new Map();
  const undisclosed = [];
  for (const { t, boxes } of samples) {
    const texts = new Set(boxes.map((b) => b.text));
    for (const b of boxes) {
      const known = COPY.has(b.text) || /^\d{1,3}%$/.test(b.text);
      if (!known) unknown.add(b.text);
      shown.set(b.text, (shown.get(b.text) ?? 0) + step);
      if (settledAt(t) && Math.abs(b.scale - 1) < 0.015) {
        const inRail = b.x1 > RAIL.x0 && b.y1 > RAIL.y0;
        if (!inside(b, SAFE, 2) || inRail) outside.push(`${t.toFixed(1)}s "${b.text}" ${b.x0},${b.y0}–${b.x1},${b.y1}`);
      }
    }
    if (CLAIMS.some((c) => texts.has(c)) && !DISCLOSURES.some((c) => texts.has(c))) undisclosed.push(`${t.toFixed(1)}s`);
  }
  check(`${tag}: only approved copy on screen`, unknown.size === 0, [...unknown].join(" | "));
  check(`${tag}: critical copy inside the Reels safe zone`, outside.length === 0, outside.slice(0, 6).join("; "));
  check(`${tag}: every money claim carries its small print`, undisclosed.length === 0, undisclosed.slice(0, 8).join(", "));
  const short = [...COPY].filter(([text]) => !HOOKS[3 - hook]?.includes(text)).filter(([text, min]) => (shown.get(text) ?? 0) + 1e-6 < min);
  check(`${tag}: each line up long enough to read`, short.length === 0, short.map(([text, min]) => `"${text}" ${(shown.get(text) ?? 0).toFixed(1)}/${min}s`).join("; "));
}

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? `  — ${r.detail}` : ""}`);
writeFileSync(join(out, "verification.json"), JSON.stringify({ checked: new Date().toISOString(), passed: results.length - failed.length, failed: failed.length, results }, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
