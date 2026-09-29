/**
 * The Electron half of the renderer: serve the stage, step it frame by frame, capture.
 *
 * Offscreen rendering, because a hidden normal window is not painted and a visible one
 * would put 30 seconds of flicker on the screen. Every frame is `AD.render(t)` followed by
 * two animation frames in the page, then a capture - so what is encoded is exactly what
 * that `t` draws, with no dependence on how fast this machine is. Options arrive as JSON in
 * AD_OPTIONS from render.mjs.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { app, BrowserWindow } from "electron";

const options = JSON.parse(process.env["AD_OPTIONS"] ?? "{}");
const here = import.meta.dirname;
const STAGE = join(here, "stage");
const FONTS = join(here, ".tools", "fonts");
const SIZE = 1080;

app.commandLine.appendSwitch("force-device-scale-factor", "1");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

/** Static files for the stage, confined to its two folders. */
function serve() {
  const server = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://stage").pathname;
    const [root, relative] = path.startsWith("/fonts/")
      ? [FONTS, path.slice("/fonts/".length)]
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

async function capture(window) {
  const image = await window.webContents.capturePage();
  const { width, height } = image.getSize();
  return width === SIZE && height === SIZE ? image : image.resize({ width: SIZE, height: SIZE, quality: "best" });
}

const exited = (child) => new Promise((resolve, reject) => {
  child.on("error", reject);
  child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`))));
});

async function main() {
  await app.whenReady();
  const server = await serve();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const query = new URLSearchParams({ version: options.version, url: options.url }).toString();

  if (options.preview) {
    const window = new BrowserWindow({ width: SIZE, height: SIZE, useContentSize: true, title: "ADCode — Payback (preview)" });
    await window.loadURL(`${origin}/index.html?play&${query}`);
    window.on("closed", () => { server.close(); app.quit(); });
    return;
  }

  const window = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    useContentSize: true,
    show: false,
    webPreferences: { offscreen: true, backgroundThrottling: false },
  });
  window.webContents.setFrameRate(60);
  window.webContents.on("console-message", (_event, level, message) => {
    if (level >= 2) console.error(`[stage] ${message}`);
  });
  await window.loadURL(`${origin}/index.html?${query}`);
  await window.webContents.executeJavaScript("AD.ready()");
  await mkdir(options.out, { recursive: true });

  for (const [index, t] of (options.stills ?? []).entries()) {
    await window.webContents.executeJavaScript(`AD.render(${Number(t)})`);
    const name = options.stillNames?.[index] ?? `still-${String(t).replace(".", "_")}.png`;
    await writeFile(join(options.out, name), (await capture(window)).toPNG());
    console.log(`still ${t}s → ${name}`);
  }

  if (options.video) {
    const first = Math.round(options.from * options.fps);
    const last = Math.round(options.to * options.fps);
    const encoder = spawn(options.ffmpeg, [
      "-y", "-hide_banner", "-loglevel", "error",
      "-f", "rawvideo", "-pix_fmt", "bgra", "-s", `${SIZE}x${SIZE}`, "-r", String(options.fps), "-i", "-",
      "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-tune", "animation",
      "-profile:v", "high", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
      join(options.out, "picture.mp4"),
    ], { stdio: ["pipe", "inherit", "inherit"] });
    const done = exited(encoder);
    const started = Date.now();
    for (let frame = first; frame < last; frame += 1) {
      await window.webContents.executeJavaScript(`AD.render(${(frame / options.fps).toFixed(6)})`);
      const bitmap = (await capture(window)).toBitmap();
      if (!encoder.stdin.write(bitmap)) await new Promise((resolve) => encoder.stdin.once("drain", resolve));
      if ((frame - first) % options.fps === 0) {
        const rate = (frame - first + 1) / ((Date.now() - started) / 1000);
        console.log(`frame ${frame}/${last} (${rate.toFixed(1)} fps)`);
      }
    }
    encoder.stdin.end();
    await done;
    console.log(`picture: ${last - first} frames`);
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
