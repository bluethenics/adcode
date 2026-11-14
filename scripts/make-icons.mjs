/**
 * Draw every app icon from the ADCode logo, `build/logo.webp`.
 *
 * Run with Electron rather than plain Node - `npm run icons` - because the renderer is
 * already here and already decodes and scales images well. Reaching for an image library
 * would add a dependency, and a native one at that, to do something Chromium does anyway.
 *
 * Writes:
 *   build/icon.ico   multi-size, for the Windows installer, the taskbar and Explorer
 *   build/icon.png   512px, electron-builder's fallback and the Linux icon
 *   build/appx/*.png the Microsoft Store package's tiles, and its taskbar images
 *
 * Every icon is the logo's own folded mark on a black rounded tile - the logo's black, so
 * the mark's glow meets the tile without a seam. At 48px and below the mark is drawn larger,
 * because its fine fold does not survive at taskbar size otherwise.
 *
 * **The blue edge in the taskbar (reported 2026-11-13).** The Store package's taskbar icon
 * is `Square44x44Logo`. Without "unplated" versions of it, Windows sets that image on a plate
 * in the person's accent colour - blue by default - which showed round the tile's transparent
 * corners as a blue rim. The `targetsize-N_altform-unplated` files below are what Windows
 * takes for the taskbar instead, drawn on our own black tile; electron-builder copies them
 * and indexes them (resources.pri) because their names carry `.targetsize-`.
 *
 * The .ico embeds PNGs rather than BMPs. That has been valid since Vista, and it is what
 * keeps the 256px entry from costing 256KB of uncompressed bitmap.
 */
import { app, BrowserWindow } from "electron";
import { appendFileSync, writeFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import process from "node:process";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOGO = join(REPO, "build", "logo.webp");
const LOG = join(REPO, "build", "icons.log");

/**
 * Where the mark sits in logo.webp (1254px square), glow included: measured from the image's
 * bright pixels (176-1075 across, 355-865 down) plus room for the glow, not guessed.
 */
const MARK = { x: 152, y: 331, width: 948, height: 558 };
/** How much of the tile's width the mark takes: a little more when the icon is small. */
const markShare = (side) => (side <= 48 ? 0.88 : 0.76);
/** The tile's corner radius, as a share of its shorter side. */
const CORNER = 0.22;

/**
 * Progress goes to a file, not to stdout.
 *
 * Electron on Windows is a GUI-subsystem binary and does not attach to the parent
 * console, so `process.stdout.write` from the main process goes nowhere - which makes
 * a script that hangs indistinguishable from one that is silently working.
 */
const log = (line) => {
  appendFileSync(LOG, `${line}\n`);
  process.stdout.write(`${line}\n`);
};

/**
 * The sizes Windows actually asks for. 16 and 32 are the ones that get used most and scale
 * worst, so each is drawn at its own size rather than downsampled from 256.
 */
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const PNG_SIZE = 512;

/**
 * The tiles the Microsoft Store package needs, at the exact names electron-builder looks
 * for in `build/appx`, then the taskbar's own images (see "The blue edge" above).
 *
 * Generated here rather than drawn by hand because electron-builder silently falls back to
 * its own bundled placeholders when a tile is missing - so a forgotten file does not fail
 * the build, it ships an Electron logo to the Store listing.
 */
const TASKBAR_SIZES = [16, 24, 32, 48, 256];
const APPX_TILES = [
  { file: "StoreLogo.png", width: 50, height: 50 },
  { file: "Square44x44Logo.png", width: 44, height: 44 },
  { file: "Square71x71Logo.png", width: 71, height: 71 },
  { file: "Square150x150Logo.png", width: 150, height: 150 },
  { file: "Square310x310Logo.png", width: 310, height: 310 },
  { file: "Wide310x150Logo.png", width: 310, height: 150 },
  ...TASKBAR_SIZES.flatMap((size) => [
    { file: `Square44x44Logo.targetsize-${size}.png`, width: size, height: size },
    { file: `Square44x44Logo.targetsize-${size}_altform-unplated.png`, width: size, height: size },
  ]),
];

/**
 * One PNG: the black rounded tile, and the mark cut from the logo and centred on it.
 *
 * Drawn on a canvas inside a hidden page - not `capturePage`, which screenshots the
 * compositor and so needs a window that is actually being drawn.
 */
async function render(window, logo, width, height, { corner = CORNER, share = markShare(Math.min(width, height)) } = {}) {
  const side = Math.min(width, height);
  const markWidth = Math.round(side * share);
  const markHeight = Math.round((markWidth * MARK.height) / MARK.width);
  const base64 = await window.webContents.executeJavaScript(`
    new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = ${width};
        canvas.height = ${height};
        const context = canvas.getContext("2d");
        context.clearRect(0, 0, ${width}, ${height});
        context.fillStyle = "#000";
        context.beginPath();
        context.roundRect(0, 0, ${width}, ${height}, ${Math.round(side * corner)});
        context.fill();
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        context.drawImage(image, ${MARK.x}, ${MARK.y}, ${MARK.width}, ${MARK.height}, ${Math.round((width - markWidth) / 2)}, ${Math.round((height - markHeight) / 2)}, ${markWidth}, ${markHeight});
        resolve(canvas.toDataURL("image/png").split(",")[1]);
      };
      image.onerror = () => reject(new Error("the logo did not decode"));
      image.src = ${JSON.stringify(logo)};
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
    const logo = `data:image/webp;base64,${(await readFile(LOGO)).toString("base64")}`;

    const images = [];
    for (const size of ICO_SIZES) {
      images.push({ size, png: await render(window, logo, size, size) });
      log(`  rendered ${size}x${size}`);
    }

    await writeFile(join(REPO, "build", "icon.ico"), buildIco(images));
    await writeFile(join(REPO, "build", "icon.png"), await render(window, logo, PNG_SIZE, PNG_SIZE));
    log(`build/icon.ico  ${ICO_SIZES.join(", ")}`);
    log(`build/icon.png  ${PNG_SIZE}x${PNG_SIZE}`);

    const appx = join(REPO, "build", "appx");
    await mkdir(appx, { recursive: true });
    for (const tile of APPX_TILES) {
      await writeFile(join(appx, tile.file), await render(window, logo, tile.width, tile.height));
      log(`build/appx/${tile.file}  ${tile.width}x${tile.height}`);
    }

    // Phone link's installable page. The maskable icon fills its square - the phone cuts its
    // own shape - with the mark inside the 80% safe zone; the others are the rounded tile.
    const phone = join(REPO, "apps", "desktop", "src", "phone", "public");
    for (const size of [180, 192, 512]) {
      await writeFile(join(phone, `icon-${size}.png`), await render(window, logo, size, size));
      log(`phone/icon-${size}.png`);
    }
    await writeFile(join(phone, "icon-maskable-512.png"), await render(window, logo, 512, 512, { corner: 0, share: 0.62 }));
    log("phone/icon-maskable-512.png");

    log("--- done ---");
    app.exit(0);
  } catch (error) {
    log(`FAILED: ${error instanceof Error ? error.stack : String(error)}`);
    app.exit(1);
  }
});
