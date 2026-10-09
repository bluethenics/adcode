/**
 * The Electron half of the renderer: serve the stage, step it frame by frame, capture.
 *
 * Offscreen, as for the other ADCode ads. Each output frame is `AD.frame(n)` - the page
 * draws and averages its own motion-blur samples - then the canvas's own pixels as PNG,
 * decoded here and piped to ffmpeg as raw BGRA. Options arrive as JSON in AD_OPTIONS from render.mjs.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { app, BrowserWindow, nativeImage } from "electron";

const options = JSON.parse(process.env["AD_OPTIONS"] ?? "{}");
const here = import.meta.dirname;
const STAGE = join(here, "stage");
const FONTS = join(here, "..", "ad-payback", ".tools", "fonts");
const [WIDTH, HEIGHT] = [1080, 1920];

app.commandLine.appendSwitch("force-device-scale-factor", "1");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
};

/** Static files for the stage and the shared fonts, confined to those two folders. */
function serve() {
  const server = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://stage").pathname;
    const [root, relative] = path.startsWith("/fonts/") ? [FONTS, path.slice("/fonts/".length)] : [STAGE, path === "/" ? "index.html" : path.slice(1)];
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

/** The canvas's own pixels. A screenshot would be clamped to the screen's height on Windows. */
async function capture(window) {
  return Buffer.from(await window.webContents.executeJavaScript("AD.png()"), "base64");
}

const exited = (child) => new Promise((resolve, reject) => {
  child.on("error", reject);
  child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`))));
});

async function main() {
  await app.whenReady();
  const server = await serve();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const query = `hook=${options.hook ?? 1}`;

  if (options.preview) {
    const window = new BrowserWindow({ width: WIDTH / 2.4, height: HEIGHT / 2.4, useContentSize: true, title: "ADCode — Blip (preview)" });
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
  window.webContents.on("console-message", (event, level, message) => {
    const lvl = event.level ?? level;
    if (lvl === "error" || lvl === "warning" || lvl >= 2) console.error(`[stage] ${event.message ?? message}`);
  });
  await window.loadURL(`${origin}/index.html?${query}`);
  const { duration, fps } = await window.webContents.executeJavaScript("AD.ready()");
  await mkdir(options.out, { recursive: true });

  if (options.layout) {
    const samples = await window.webContents.executeJavaScript("AD.layout(0.1)");
    await writeFile(join(options.out, `layout-H${options.hook}.json`), JSON.stringify(samples));
    console.log(`layout: ${samples.length} samples`);
  }

  for (const [index, t] of (options.stills ?? []).entries()) {
    await window.webContents.executeJavaScript(`AD.still(${Number(t)})`);
    const name = options.stillNames?.[index] ?? `still-H${options.hook}-${String(t).replace(".", "_")}.png`;
    await writeFile(join(options.out, name), await capture(window));
    console.log(`still ${t}s → ${name}`);
  }

  if (options.video) {
    const first = Math.round(options.from * fps);
    const last = Math.round(options.to * fps);
    const encoder = spawn(options.ffmpeg, [
      "-y", "-hide_banner", "-loglevel", "error",
      "-f", "rawvideo", "-pix_fmt", "bgra", "-s", `${WIDTH}x${HEIGHT}`, "-framerate", String(fps), "-i", "-",
      // RGB to BT.709 YUV, the matrix HD players decode with.
      "-vf", "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p",
      "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-profile:v", "high", "-pix_fmt", "yuv420p",
      "-g", String(fps), "-bf", "2",
      "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
      "-movflags", "+faststart",
      join(options.out, `picture-H${options.hook}.mp4`),
    ], { stdio: ["pipe", "inherit", "inherit"] });
    const done = exited(encoder);
    const started = Date.now();
    let samples = 0;
    for (let n = first; n < last; n += 1) {
      samples += await window.webContents.executeJavaScript(`AD.frame(${n}, ${options.blur}, ${options.maxBlur})`);
      const bgra = nativeImage.createFromBuffer(await capture(window)).toBitmap();
      if (!encoder.stdin.write(bgra)) await new Promise((resolve) => encoder.stdin.once("drain", resolve));
      if ((n - first) % fps === 0) {
        const rate = (n - first + 1) / ((Date.now() - started) / 1000);
        console.log(`H${options.hook} frame ${n}/${last} (${rate.toFixed(1)} fps, ${(samples / (n - first + 1)).toFixed(1)} samples a frame)`);
      }
    }
    encoder.stdin.end();
    await done;
    console.log(`picture: ${last - first} frames, ${samples} samples, ${duration}s film`);
  }

  if (options.audio) {
    const b64 = await window.webContents.executeJavaScript("AD.soundtrack()");
    await writeFile(join(options.out, "soundtrack.wav"), Buffer.from(b64, "base64"));
    console.log("soundtrack.wav written");
  }

  server.close();
  app.quit();
}

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
