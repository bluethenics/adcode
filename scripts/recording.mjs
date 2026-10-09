/**
 * Turning a CDP screencast of the real app into the website's videos.
 *
 * Shared by the recorders (`smoke-live-agents.mjs --record`, `record-hero.mjs`): frames arrive
 * as JPEGs with their own timestamps, at whatever rate the page paints, so they are written
 * out with their real durations and handed to ffmpeg's concat demuxer - the video plays at
 * the speed the app really ran. One H.264 MP4 (every browser), one VP9 WebM (smaller), and a
 * WebP poster of a chosen frame.
 *
 * ffmpeg comes from `node marketing/ad-payback/fetch-tools.mjs`; sharp from node_modules.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

/** The ffmpeg the marketing renders use, looked for here and in the main checkout of a worktree. */
export function findFfmpeg(root) {
  const name = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  return [resolve(root, "marketing/ad-payback/.tools", name), resolve(root, "../../../marketing/ad-payback/.tools", name)].find((path) => existsSync(path)) ?? null;
}

const even = (value) => Math.max(0, Math.round(value / 2) * 2);
/** Sizes round down: rounding up can reach a pixel past the frame's edge, which sharp refuses. */
const evenDown = (value) => Math.max(2, Math.floor(value / 2) * 2);

/**
 * @param {object} options
 * @param {{ data: string, at: number }[]} options.frames  base64 JPEGs with timestamps in seconds
 * @param {string} options.ffmpeg
 * @param {any} options.sharp
 * @param {{ left: number, top: number, width: number, height: number } | null} options.crop  in page (CSS) pixels
 * @param {number} [options.viewportWidth]  the page's width in CSS pixels, to scale `crop` to the frames
 * @param {number} options.width  output width; height follows the crop's ratio
 * @param {{ mp4: string, webm: string, poster: string }} options.out
 * @param {number} [options.posterFrame]  index of the poster frame; default the last
 */
export async function encodeScreencast({ frames, ffmpeg, sharp, crop, viewportWidth, width, out, posterFrame }) {
  if (frames.length < 10) throw new Error(`Only ${frames.length} frames were captured`);
  const dir = await mkdtemp(join(tmpdir(), "adcode-frames-"));
  try {
    const names = frames.map((_, index) => `f${String(index).padStart(5, "0")}.jpg`);
    for (const [index, frame] of frames.entries()) await writeFile(join(dir, names[index]), Buffer.from(frame.data, "base64"));
    const list = [];
    frames.forEach((frame, index) => {
      const next = frames[index + 1];
      list.push(`file '${names[index]}'`, `duration ${(next === undefined ? 0.6 : Math.max(0.001, next.at - frame.at)).toFixed(4)}`);
    });
    list.push(`file '${names.at(-1)}'`);
    await writeFile(join(dir, "list.txt"), list.join("\n"));

    const first = await sharp(join(dir, names[0])).metadata();
    // Screencast frames are not reliably at device-pixel size; measure, don't assume.
    const scale = crop === null ? 1 : first.width / (viewportWidth ?? first.width);
    const left = crop === null ? 0 : even(crop.left * scale);
    const top = crop === null ? 0 : even(crop.top * scale);
    const box = crop === null
      ? { left, top, width: evenDown(first.width), height: evenDown(first.height) }
      : { left, top, width: evenDown(Math.min(crop.width * scale, first.width - left)), height: evenDown(Math.min(crop.height * scale, first.height - top)) };
    const height = even((box.height * width) / box.width);
    const filter = `crop=${box.width}:${box.height}:${box.left}:${box.top},scale=${width}:${height}:flags=lanczos,fps=30,format=yuv420p`;
    for (const file of Object.values(out)) await mkdir(dirname(file), { recursive: true });
    const encode = (args) => {
      const run = spawnSync(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", join(dir, "list.txt"), "-vf", filter, "-an", ...args], { stdio: "inherit" });
      if (run.status !== 0) throw new Error(`ffmpeg failed writing ${args.at(-1)}`);
    };
    encode(["-c:v", "libx264", "-preset", "slow", "-crf", "24", "-movflags", "+faststart", out.mp4]);
    encode(["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "36", "-row-mt", "1", out.webm]);
    const poster = names[posterFrame ?? names.length - 1] ?? names.at(-1);
    await sharp(join(dir, poster)).extract(box).resize(width, height).webp({ quality: 82 }).toFile(out.poster);

    const size = async (file) => Math.round((await readFile(file)).length / 1024);
    return {
      frames: frames.length,
      seconds: Math.round((frames.at(-1).at - frames[0].at) * 10) / 10,
      width,
      height,
      mp4KB: await size(out.mp4),
      webmKB: await size(out.webm),
      posterKB: await size(out.poster),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
