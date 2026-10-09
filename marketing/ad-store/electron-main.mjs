/**
 * The Electron half of the renderer: serve the stage, step it frame by frame, capture.
 *
 * Offscreen rendering, as for Payback and The Wait: every capture is `AD.render(t)`, two
 * animation frames, then a CDP screenshot, so what is encoded is exactly what `t` draws.
 *
 * What is new here is the shutter. Each output frame is the average of several captures
 * spread across half a frame's time (a 180° shutter), and more of them when the frame moves
 * fast. That is real motion blur - a whip smears, a still holds sharp - and only then is
 * grain added, per output frame, so the average cannot smooth it away. Options arrive as
 * JSON in AD_OPTIONS from render.mjs.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { app, BrowserWindow, nativeImage } from "electron";

const options = JSON.parse(process.env["AD_OPTIONS"] ?? "{}");
const here = import.meta.dirname;
const STAGE = join(here, "stage");
const SHARED = join(here, "..", "ad-payback", "stage");
const FONTS = join(here, "..", "ad-payback", ".tools", "fonts");
const [WIDTH, HEIGHT] = [options.width ?? 1920, options.height ?? 1080];

app.commandLine.appendSwitch("force-device-scale-factor", "1");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
};

/** Static files for the stage, confined to its three folders. */
function serve() {
  const server = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://stage").pathname;
    const [root, relative] = path.startsWith("/fonts/")
      ? [FONTS, path.slice("/fonts/".length)]
      : path.startsWith("/shared/")
        ? [SHARED, path.slice("/shared/".length)]
        : [STAGE, path === "/" ? "index.html" : path.slice(1)];
    const file = normalize(join(root, decodeURIComponent(relative)));
    if (!file.startsWith(root + sep)) return response.writeHead(403).end();
    try {
      const body = await readFile(file);
      response.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" }).end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

/** The frame as it is now, as PNG bytes, rendered fresh by the compositor for this call. */
async function capture(window) {
  const { data } = await window.webContents.debugger.sendCommand("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
    optimizeForSpeed: true,
    clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT, scale: 1 },
  });
  return Buffer.from(data, "base64");
}

const exited = (child) => new Promise((resolve, reject) => {
  child.on("error", reject);
  child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`))));
});

/**
 * The times one output frame is made of: `count` samples across a 180° shutter that opens
 * at the frame's own time. Opening forward, not centred, is what keeps a hard cut clean -
 * every cut sits on a frame boundary, so no frame's shutter ever straddles one.
 */
function shutter(frame, fps, count, duration) {
  if (count <= 1) return [frame / fps];
  return Array.from({ length: count }, (_, j) => Math.min(duration - 1e-4, (frame + ((j + 0.5) / count) * 0.5) / fps));
}

/** Mean absolute difference of two BGRA bitmaps, sampled sparsely: how far the frame moved. */
function moved(a, b) {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < a.length; i += 389) { sum += Math.abs(a[i] - b[i]); n += 1; }
  return sum / n;
}

async function main() {
  await app.whenReady();
  const server = await serve();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const query = new URLSearchParams({ url: options.url, format: options.format ?? "wide" }).toString();

  if (options.preview) {
    const window = new BrowserWindow({ width: WIDTH / 2, height: HEIGHT / 2, useContentSize: true, title: "ADCode — Now on the Microsoft Store (preview)" });
    await window.loadURL(`${origin}/index.html?play&fit&${query}`);
    window.on("closed", () => { server.close(); app.quit(); });
    return;
  }

  const window = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    useContentSize: true,
    show: false,
    webPreferences: { offscreen: true, backgroundThrottling: false },
  });
  window.webContents.setFrameRate(60);
  window.webContents.debugger.attach("1.3");
  window.webContents.on("console-message", (_event, level, message) => {
    if (level >= 2) console.error(`[stage] ${message}`);
  });
  await window.loadURL(`${origin}/index.html?${query}`);
  const { duration } = await window.webContents.executeJavaScript("AD.ready()");
  await mkdir(options.out, { recursive: true });

  for (const [index, t] of (options.stills ?? []).entries()) {
    await window.webContents.executeJavaScript(`AD.render(${Number(t)})`);
    const name = options.stillNames?.[index] ?? `still-${String(t).replace(".", "_")}.png`;
    await writeFile(join(options.out, name), await capture(window));
    console.log(`still ${t}s → ${name}`);
  }

  if (options.video) {
    // Each frame starts from `blur` samples. If its first and last differ by more than a
    // little - a whip, a slam - it is shot again with up to MAX samples, so fast motion
    // smears smoothly instead of strobing into copies. Samples are averaged here, as raw
    // pixels, and only the finished frame goes to ffmpeg.
    const blur = Math.max(1, Math.round(options.blur));
    const MAX = 32;
    const first = Math.round(options.from * options.fps);
    const last = Math.round(options.to * options.fps);
    const sample = async (t) => {
      await window.webContents.executeJavaScript(`AD.render(${t.toFixed(6)})`);
      return nativeImage.createFromBuffer(await capture(window)).toBitmap();
    };
    const filters = [
      // RGB to BT.709 YUV, the matrix HD players decode with; the default (BT.601) shifts
      // the money green.
      "scale=out_color_matrix=bt709:out_range=tv",
      "format=yuv420p",
      // Grain on luma only: film texture without a colour cast.
      ...(options.grain > 0 ? [`noise=c0s=${options.grain}:c0f=t`] : []),
    ].join(",");
    const encoder = spawn(options.ffmpeg, [
      "-y", "-hide_banner", "-loglevel", "error",
      "-f", "rawvideo", "-pix_fmt", "bgra", "-s", `${WIDTH}x${HEIGHT}`, "-framerate", String(options.fps), "-i", "-",
      "-vf", filters,
      "-c:v", "libx264", "-preset", "slow", "-crf", "15",
      "-profile:v", "high", "-pix_fmt", "yuv420p",
      "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
      "-movflags", "+faststart",
      join(options.out, "picture.mp4"),
    ], { stdio: ["pipe", "inherit", "inherit"] });
    const done = exited(encoder);
    const started = Date.now();
    const sum = new Uint32Array(WIDTH * HEIGHT * 4);
    const frameBytes = Buffer.alloc(WIDTH * HEIGHT * 4);
    let samples = 0;
    for (let frame = first; frame < last; frame += 1) {
      let shots = [];
      for (const t of shutter(frame, options.fps, blur, duration)) shots.push(await sample(t));
      if (blur > 1) {
        const spread = moved(shots[0], shots.at(-1));
        const count = spread > 2.5 ? Math.min(MAX, Math.max(blur * 2, Math.round(blur + spread * 2))) : blur;
        if (count > blur) {
          shots = [];
          for (const t of shutter(frame, options.fps, count, duration)) shots.push(await sample(t));
        }
      }
      sum.fill(0);
      for (const shot of shots) for (let i = 0; i < shot.length; i += 1) sum[i] += shot[i];
      const n = shots.length;
      for (let i = 0; i < frameBytes.length; i += 1) frameBytes[i] = (sum[i] + (n >> 1)) / n;
      samples += n;
      if (!encoder.stdin.write(frameBytes)) await new Promise((resolve) => encoder.stdin.once("drain", resolve));
      if ((frame - first) % options.fps === 0) {
        const rate = (frame - first + 1) / ((Date.now() - started) / 1000);
        console.log(`frame ${frame}/${last} (${rate.toFixed(1)} fps, ${(samples / (frame - first + 1)).toFixed(1)} samples a frame)`);
      }
    }
    encoder.stdin.end();
    await done;
    console.log(`picture: ${last - first} frames, ${samples} samples`);
  }

  if (options.audio) {
    const base64 = await window.webContents.executeJavaScript("AD.soundtrack()");
    await writeFile(join(options.out, "soundtrack.wav"), Buffer.from(base64, "base64"));
    console.log("soundtrack.wav written");
  }

  server.close();
  app.quit();
}

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
