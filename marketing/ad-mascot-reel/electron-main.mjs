/** Deterministic, hidden Electron frame capture for the ADCode mascot Reel. */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize, relative, sep } from "node:path";
import { app, BrowserWindow, nativeImage } from "electron";

const options = JSON.parse(process.env.AD_OPTIONS ?? "{}");
const here = import.meta.dirname;
const STAGE = join(here, "stage");
const SHARED = join(here, "..", "ad-payback", "stage");
const FONTS = join(here, "..", "ad-payback", ".tools", "fonts");
const WIDTH = options.width ?? 1080, HEIGHT = options.height ?? 1920, FPS = 30;
app.commandLine.appendSwitch("force-device-scale-factor", "1");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg" };
function serve() {
  const server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url ?? "/", "http://stage").pathname;
      const [root, asset] = path.startsWith("/fonts/") ? [FONTS, path.slice(7)]
        : path.startsWith("/shared/") ? [SHARED, path.slice(8)]
          : [STAGE, path === "/" ? "index.html" : path.slice(1)];
      const file = normalize(join(root, decodeURIComponent(asset)));
      const confined = relative(root, file);
      if (confined.startsWith(`..${sep}`) || confined === ".." || confined.startsWith(sep)) return response.writeHead(403).end();
      const body = await readFile(file);
      response.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" }).end(body);
    } catch { response.writeHead(404).end(); }
  });
  return new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => resolve(server)); });
}
function exited(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`FFmpeg exited with ${code}`)));
  });
}

async function main() {
  await app.whenReady();
  const server = await serve();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const query = new URLSearchParams({ url: options.url, hook: String(options.hook ?? 1) });
  const window = new BrowserWindow({
    width: WIDTH, height: HEIGHT, useContentSize: true, show: false,
    webPreferences: { offscreen: true, backgroundThrottling: false },
  });
  window.webContents.setFrameRate(FPS);
  window.webContents.on("console-message", ({ level, message }) => { if (level === "error") console.error(`[stage] ${message}`); });
  await window.loadURL(`${origin}/index.html?${query}`);
  const { duration } = await window.webContents.executeJavaScript("AD.ready()");
  if (duration !== 20) throw new Error(`Stage has ${duration} seconds; delivery requires 20`);
  await mkdir(options.out, { recursive: true });
  const capture = async (t) => {
    // Capture the actual full-resolution Canvas. A hidden native window on Windows can
    // clamp to the monitor height; Canvas pixels are independent of that viewport.
    const encoded = await window.webContents.executeJavaScript(`(async () => {
      await AD.render(${Number(t).toFixed(6)});
      return document.getElementById("stage").toDataURL("image/png").split(",")[1];
    })()`);
    const shot = nativeImage.createFromBuffer(Buffer.from(encoded, "base64"));
    const size = shot.getSize();
    if (size.width !== WIDTH || size.height !== HEIGHT) throw new Error(`Unexpected capture size ${size.width}×${size.height}`);
    return shot;
  };
  for (const [index, t] of (options.stills ?? []).entries()) {
    const name = options.stillNames?.[index] ?? `review-${String(t).replace(".", "_")}s.png`;
    await writeFile(join(options.out, name), (await capture(t)).toPNG());
    console.log(`still ${t}s → ${name}`);
  }

  if (options.video) {
    const encoder = spawn(options.ffmpeg, [
      "-y", "-hide_banner", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "bgra", "-s", `${WIDTH}x${HEIGHT}`, "-framerate", String(FPS), "-i", "-",
      "-vf", "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p",
      "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-profile:v", "high", "-pix_fmt", "yuv420p",
      "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv", "-movflags", "+faststart",
      join(options.out, `picture-H${options.hook ?? 1}.mp4`),
    ], { windowsHide: true, stdio: ["pipe", "inherit", "inherit"] });
    const done = exited(encoder);
    // Attach rejection handling immediately, including when capture fails mid-render.
    done.catch(() => {});
    const first = Math.round(options.from * FPS), last = Math.round(options.to * FPS);
    const started = Date.now();
    try {
      for (let frame = first; frame < last; frame += 1) {
        const bitmap = (await capture(frame / FPS)).toBitmap();
        if (!encoder.stdin.write(bitmap)) await new Promise((resolve, reject) => {
          const drain = () => { encoder.stdin.removeListener("error", error); resolve(); };
          const error = (failure) => { encoder.stdin.removeListener("drain", drain); reject(failure); };
          encoder.stdin.once("drain", drain); encoder.stdin.once("error", error);
        });
        if ((frame - first) % FPS === 0) console.log(`H${options.hook}: frame ${frame}/${last} (${((frame - first + 1) / ((Date.now() - started) / 1000)).toFixed(1)} fps)`);
      }
      encoder.stdin.end();
      await done;
    } catch (error) { encoder.kill(); throw error; }
    console.log(`picture: ${last - first} frames at ${FPS} fps`);
  }
  if (options.audio) {
    const base64 = await window.webContents.executeJavaScript("AD.soundtrack()");
    await writeFile(join(options.out, `soundtrack-H${options.hook ?? 1}.wav`), Buffer.from(base64, "base64"));
    console.log("soundtrack written");
  }
  server.close();
  window.destroy();
  app.quit();
}
main().catch((error) => { console.error(error); app.exit(1); });
