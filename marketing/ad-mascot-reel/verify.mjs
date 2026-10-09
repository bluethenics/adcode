#!/usr/bin/env node
/** Verify the actual encoded Reels, and save their technical measurements beside them. */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const here = import.meta.dirname;
const out = join(here, "out");
const ffmpeg = join(here, "..", "ad-payback", ".tools", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
const hookAt = process.argv.indexOf("--hook");
const hooks = hookAt === -1 ? [1, 2] : [Number(process.argv[hookAt + 1])];
if (hooks.some((hook) => ![1, 2].includes(hook))) throw new Error("--hook must be 1 or 2");
const results = [], measurements = [];
const check = (name, pass, detail = "") => results.push({ name, pass: Boolean(pass), detail });
function ff(args, permittedStatus = 0) {
  const run = spawnSync(ffmpeg, ["-hide_banner", ...args], { windowsHide: true, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (run.error) throw run.error;
  const log = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  if (run.status !== permittedStatus) throw new Error(`FFmpeg exited ${run.status}: ${log}`);
  return log;
}
function info(file) {
  const log = ff(["-i", file], 1);
  const video = /Video: (\w+) \(([^)]+)\)[^\n]*?, (yuv\w+)(?:\(([^)]*)\))?[^\n]*?, (\d+)x(\d+)[^\n]*?, ([\d.]+) fps/.exec(log);
  const audio = /Audio: (\w+)[^\n]*?, (\d+) Hz, (\w+)/.exec(log);
  const duration = /Duration: (\d+):(\d+):([\d.]+)/.exec(log);
  return {
    codec: video?.[1], profile: video?.[2], pixelFormat: video?.[3], color: video?.[4] ?? "untagged",
    width: Number(video?.[5]), height: Number(video?.[6]), fps: Number(video?.[7]),
    audioCodec: audio?.[1], sampleRate: Number(audio?.[2]), channels: audio?.[3],
    duration: duration ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]) : NaN,
    log,
  };
}
function pngSize(file) {
  const bytes = readFileSync(file);
  if (bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") return {};
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}
function faststart(file) {
  const bytes = readFileSync(file), atoms = [];
  for (let offset = 0; offset + 8 <= bytes.length;) {
    let length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (length === 1) length = Number(bytes.readBigUInt64BE(offset + 8));
    atoms.push(type);
    if (length < 8) break;
    offset += length;
  }
  return atoms.includes("moov") && atoms.includes("mdat") && atoms.indexOf("moov") < atoms.indexOf("mdat");
}
function frame(file, t) {
  const run = spawnSync(ffmpeg, ["-v", "error", "-ss", String(t), "-i", file, "-frames:v", "1", "-vf", "scale=180:320:flags=area,format=rgb24", "-f", "rawvideo", "-"], { windowsHide: true, maxBuffer: 1024 * 1024 });
  if (run.error || run.status !== 0 || run.stdout.length !== 180 * 320 * 3) throw new Error(`Could not decode frame at ${t} s`);
  return run.stdout;
}
function psnr(a, b) {
  let squaredError = 0;
  for (let i = 0; i < a.length; i += 1) squaredError += (a[i] - b[i]) ** 2;
  return squaredError === 0 ? 99 : 10 * Math.log10(255 ** 2 / (squaredError / a.length));
}

check("FFmpeg is available", existsSync(ffmpeg));
for (const hook of hooks) {
  const prefix = `H${hook}`, file = join(out, `ADCode-Mascot-Reel-${prefix}-1080x1920.mp4`);
  check(`${prefix}: final MP4 exists`, existsSync(file), file);
  if (!existsSync(file) || !existsSync(ffmpeg)) continue;
  const metadata = info(file);
  writeFileSync(join(out, `metadata-${prefix}.log`), metadata.log);
  check(`${prefix}: 1080×1920, 30 fps, 20 seconds`, metadata.width === 1080 && metadata.height === 1920 && metadata.fps === 30 && Math.abs(metadata.duration - 20) < 0.04, `${metadata.width}×${metadata.height}; ${metadata.fps} fps; ${metadata.duration} s`);
  check(`${prefix}: H.264 High, yuv420p and BT.709`, metadata.codec === "h264" && metadata.profile === "High" && metadata.pixelFormat === "yuv420p" && metadata.color.includes("bt709"), `${metadata.codec}; ${metadata.profile}; ${metadata.pixelFormat}; ${metadata.color}`);
  check(`${prefix}: AAC stereo at 48 kHz`, metadata.audioCodec === "aac" && metadata.sampleRate === 48000 && metadata.channels === "stereo", `${metadata.audioCodec}; ${metadata.sampleRate} Hz; ${metadata.channels}`);
  check(`${prefix}: fast-start MP4`, faststart(file));

  const decode = ff(["-v", "error", "-stats", "-i", file, "-map", "0:v:0", "-map", "0:a:0", "-f", "null", "-"]);
  writeFileSync(join(out, `decode-${prefix}.log`), decode);
  const frames = Number([...decode.matchAll(/frame=\s*(\d+)/g)].at(-1)?.[1] ?? 0);
  const errors = decode.split(/\r?\n/).filter((line) => /error|corrupt|invalid/i.test(line) && !/frame=/.test(line));
  check(`${prefix}: all 600 frames and audio decode cleanly`, frames === 600 && errors.length === 0, `${frames} frames; ${errors.length} errors`);

  const loudness = ff(["-i", file, "-map", "0:a:0", "-af", "ebur128=framelog=quiet:peak=true", "-f", "null", "-"]);
  writeFileSync(join(out, `loudness-${prefix}.log`), loudness);
  const lufs = Number(/Integrated loudness:\s*\n\s*I:\s*(-?[\d.]+) LUFS/.exec(loudness)?.[1] ?? NaN);
  const peak = Number(/True peak:\s*\n\s*Peak:\s*(-?[\d.]+) dBFS/.exec(loudness)?.[1] ?? NaN);
  check(`${prefix}: −14 ± 1 LUFS and true peak ≤ −1.5 dBTP`, Math.abs(lufs + 14) <= 1 && peak <= -1.5, `${lufs} LUFS; ${peak} dBTP`);

  for (const [name, width, height] of [[`cover-${prefix}.png`, 1080, 1920], [`contact-sheet-${prefix}.png`, 810, 1920]]) {
    const asset = join(out, name), size = existsSync(asset) ? pngSize(asset) : {};
    check(`${prefix}: ${name} is ${width}×${height}`, size.width === width && size.height === height, `${size.width ?? "missing"}×${size.height ?? "missing"}`);
  }
  for (const t of ["4_8", "9", "13", "17_5"]) check(`${prefix}: review still at ${t.replace("_", ".")} s exists`, existsSync(join(out, `review-${prefix}-${t}s.png`)));
  measurements.push({ hook, file, ...metadata, log: undefined, frames, lufs, truePeakDbtp: peak, decodeErrors: errors });
}

if (hooks.length === 2) {
  const first = join(out, "cover-H1.png"), second = join(out, "cover-H2.png");
  if (existsSync(first) && existsSync(second)) check("The two covers have different hooks", !readFileSync(first).equals(readFileSync(second)));
  const videos = [1, 2].map((hook) => join(out, `ADCode-Mascot-Reel-H${hook}-1080x1920.mp4`));
  if (videos.every((video) => existsSync(video))) {
    const opening = psnr(frame(videos[0], 0), frame(videos[1], 0));
    const body = [4.8, 7.4, 10.5, 13, 17.5].map((t) => ({ t, psnr: psnr(frame(videos[0], t), frame(videos[1], t)) }));
    const loop = psnr(frame(videos[0], 19.9), frame(videos[1], 19.9));
    check("Encoded opening hooks differ", opening < 30, `${opening.toFixed(2)} dB PSNR`);
    check("Representative body scenes match across hooks", body.every((sample) => sample.psnr >= 32), body.map(({ t, psnr }) => `${t} s: ${psnr.toFixed(2)} dB`).join("; "));
    check("Each hook returns during the last 0.3 seconds for replay", loop < 35, `${loop.toFixed(2)} dB PSNR at 19.9 s`);
    measurements.push({ comparison: { openingPsnr: opening, representativeBodyPsnr: body, loopReturnPsnr: loop, variantWindows: "0–3 s opening; 19.7–20 s loop return" } });
  }
}
const report = { generatedAt: new Date().toISOString(), results, measurements };
if (existsSync(out)) writeFileSync(join(out, "verification.json"), JSON.stringify(report, null, 2) + "\n");
for (const { name, pass, detail } of results) console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` (${detail})` : ""}`);
const passed = results.filter((result) => result.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exitCode = passed === results.length ? 0 : 1;
