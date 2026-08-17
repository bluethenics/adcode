/**
 * Rasterise `build/icon.svg` into the icons the installer and the app need.
 *
 * Run with Electron rather than plain Node - `npm run icons` - because the renderer is
 * already here and already rasterises SVG correctly. Reaching for an image library would
 * add a dependency, and a native one at that, to do something Chromium does anyway.
 *
 * Writes:
 *   build/icon.ico   multi-size, for the Windows installer, the taskbar and Explorer
 *   build/icon.png   512px, electron-builder's fallback and the Linux icon
 *
 * The .ico embeds PNGs rather than BMPs. That has been valid since Vista, and it is what
 * keeps the 256px entry from costing 256KB of uncompressed bitmap.
 */
import { app, BrowserWindow } from "electron";
import { appendFileSync, writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import process from "node:process";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(REPO, "build", "icon.svg");
const LOG = join(REPO, "build", "icons.log");

/**
 * Progress goes to a file, not to stdout.
 *
 * Electron on Windows is a GUI-subsystem binary and does not attach to the parent
 * console, so `process.stdout.write` from the main process goes nowhere - which makes
 * a script that hangs indistinguishable from one that is silently working.
 */
const log = (line) => {
  appendFileSync(LOG, `${line}
`);
  process.stdout.write(`${line}
`);
};

/**
 * The sizes Windows actually asks for.
 *
 * 16 and 32 are the ones that get used most and scale worst, so they are rendered at
 * their own size rather than downsampled from 256 - Chromium's own layout at 16px keeps
 * the strokes on pixel boundaries in a way a resize cannot.
 */
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const PNG_SIZE = 512;

/**
 * One PNG of the mark, drawn onto a canvas inside the page.
 *
 * Not `capturePage`. That screenshots the *compositor*, so it needs a window that is
 * actually being drawn: hidden and offscreen windows hang waiting for a frame, and a
 * window parked at negative coordinates throws `UnknownVizError` because nothing composites
 * there either. A canvas needs none of that - it rasterises in the renderer regardless of
 * whether a pixel ever reaches a screen - and it yields exact dimensions and real alpha
 * rather than whatever the display's scale factor happened to produce.
 */
async function render(window, svg, size) {
  // The SVG carries only a viewBox; an `<img>` with no intrinsic size can decode to
  // nothing, so the requested size is stamped on before it is handed over.
  const sized = svg.replace("<svg ", `<svg width="${size}" height="${size}" `);
  const source = `data:image/svg+xml;base64,${Buffer.from(sized).toString("base64")}`;

  const base64 = await window.webContents.executeJavaScript(`
    new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = ${size};
        canvas.height = ${size};
        const context = canvas.getContext("2d");
        context.clearRect(0, 0, ${size}, ${size});
        context.drawImage(image, 0, 0, ${size}, ${size});
        resolve(canvas.toDataURL("image/png").split(",")[1]);
      };
      image.onerror = () => reject(new Error("the SVG did not decode"));
      image.src = ${JSON.stringify(source)};
    })
  `);

  return Buffer.from(base64, "base64");
}

/**
 * Pack PNGs into an .ico.
 *
 * ICONDIR is 6 bytes, then one 16-byte ICONDIRENTRY per image, then the image data. A
 * dimension of 256 is stored as 0, which is the format's way of saying "not 1-255".
 */
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(images.length, 4);

  const directory = Buffer.alloc(16 * images.length);
  let offset = header.length + directory.length;

  images.forEach(({ size, png }, index) => {
    const at = index * 16;
    directory.writeUInt8(size >= 256 ? 0 : size, at);
    directory.writeUInt8(size >= 256 ? 0 : size, at + 1);
    directory.writeUInt8(0, at + 2); // palette colours
    directory.writeUInt8(0, at + 3); // reserved
    directory.writeUInt16LE(1, at + 4); // colour planes
    directory.writeUInt16LE(32, at + 6); // bits per pixel
    directory.writeUInt32LE(png.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });

  return Buffer.concat([header, directory, ...images.map((image) => image.png)]);
}

/*
 * Deliberately `.then`, and no top-level `await` above it.
 *
 * Electron does not emit `ready` until the ESM main module has finished evaluating, so
 * `await app.whenReady()` at the top level waits for an event that is waiting for it -
 * the process starts, prints nothing, and hangs for ever. Registering a callback lets the
 * module finish, which is what allows `ready` to fire at all.
 */
writeFileSync(LOG, "");
log("--- start ---");

void app.whenReady().then(async () => {
  log("app ready");

  // One hidden window for every size: the canvas does the work, so it never has to paint.
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });

  try {
    await window.loadURL("data:text/html,<!doctype html><html><body></body></html>");
    const svg = await readFile(SOURCE, "utf8");

    const images = [];
    for (const size of ICO_SIZES) {
      images.push({ size, png: await render(window, svg, size) });
      log(`  rendered ${size}x${size}`);
    }

    await writeFile(join(REPO, "build", "icon.ico"), buildIco(images));
    await writeFile(join(REPO, "build", "icon.png"), await render(window, svg, PNG_SIZE));

    log(`build/icon.ico  ${ICO_SIZES.join(", ")}`);
    log(`build/icon.png  ${PNG_SIZE}x${PNG_SIZE}`);
    log("--- done ---");
    app.exit(0);
  } catch (error) {
    log(`FAILED: ${error instanceof Error ? error.stack : String(error)}`);
    app.exit(1);
  }
});
