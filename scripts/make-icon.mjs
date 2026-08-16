/**
 * Draw the ADCode app icon.
 *
 * Generated rather than committed as an opaque blob, so the mark can be adjusted by
 * editing numbers instead of by opening a design tool - and so a reviewer can see what
 * the icon *is* rather than trusting a checksum.
 *
 * Rendered by evaluating signed-distance fields per pixel at 4x and box-filtering down.
 * That is what gives clean edges with no drawing library: anti-aliasing falls out of
 * sampling a continuous function rather than being bolted onto a rasteriser.
 *
 *   node scripts/make-icon.mjs
 */
import { deflateSync } from "node:zlib";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";

const SIZE = 1024;
const SUPERSAMPLE = 4;

/* ── Geometry, in a 0..1 space so the numbers survive a size change ─────── */

/** Signed distance to a rounded rectangle centred on `cx, cy`. Negative inside. */
function roundedRect(x, y, cx, cy, halfWidth, halfHeight, radius) {
  const dx = Math.abs(x - cx) - (halfWidth - radius);
  const dy = Math.abs(y - cy) - (halfHeight - radius);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outside + Math.min(Math.max(dx, dy), 0) - radius;
}

/** Signed distance to a thick line segment - the building block of both chevrons. */
function segment(x, y, ax, ay, bx, by, halfThickness) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = x - ax;
  const wy = y - ay;

  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / (vx * vx + vy * vy)));
  return Math.hypot(wx - vx * t, wy - vy * t) - halfThickness;
}

const union = (a, b) => Math.min(a, b);

/**
 * The mark: `< >` with a slash through it, which reads as "code" at 16px and still has
 * something to look at at 512.
 */
function glyph(x, y) {
  const stroke = 0.035;

  // `<` - apex on the left, both arms opening to the right.
  const left = union(
    segment(x, y, 0.245, 0.5, 0.365, 0.375, stroke),
    segment(x, y, 0.245, 0.5, 0.365, 0.625, stroke),
  );

  // `>` - the mirror of it.
  const right = union(
    segment(x, y, 0.755, 0.5, 0.635, 0.375, stroke),
    segment(x, y, 0.755, 0.5, 0.635, 0.625, stroke),
  );

  // The slash between them, leaning the way a `/` does.
  const slash = segment(x, y, 0.44, 0.665, 0.56, 0.335, stroke);

  return union(left, union(right, slash));
}

/* ── Colour ─────────────────────────────────────────────────────────────── */

const BACKGROUND_TOP = [0x1c, 0x1c, 0x1e];
const BACKGROUND_BOTTOM = [0x2c, 0x2c, 0x2e];
const ACCENT_TOP = [0x0a, 0x84, 0xff];
const ACCENT_BOTTOM = [0x30, 0xd1, 0x58];

const mix = (a, b, t) => a.map((channel, i) => channel + (b[i] - channel) * t);

/** Coverage from a signed distance, over roughly one supersampled pixel. */
const coverage = (distance) => {
  const edge = 0.5 / (SIZE * SUPERSAMPLE);
  return Math.max(0, Math.min(1, 0.5 - distance / (2 * edge)));
};

/** Colour and alpha at one point in the 0..1 square. */
function sample(x, y) {
  // The tile itself. macOS and Windows both round the corners further; this radius reads
  // as deliberate under either.
  const tile = roundedRect(x, y, 0.5, 0.5, 0.44, 0.44, 0.115);
  const tileAlpha = coverage(tile);
  if (tileAlpha === 0) return [0, 0, 0, 0];

  const background = mix(BACKGROUND_TOP, BACKGROUND_BOTTOM, y);

  const markAlpha = coverage(glyph(x, y));
  const accent = mix(ACCENT_TOP, ACCENT_BOTTOM, (y - 0.34) / 0.32);

  const colour = mix(background, accent, markAlpha);
  return [...colour, tileAlpha * 255];
}

/* ── Render ─────────────────────────────────────────────────────────────── */

/** RGBA pixels for one square size, supersampled and box-filtered. */
function render(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const step = 1 / (size * SUPERSAMPLE);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const x = (px * SUPERSAMPLE + sx + 0.5) * step;
          const y = (py * SUPERSAMPLE + sy + 0.5) * step;
          const [sr, sg, sb, sa] = sample(x, y);

          // Premultiplied, so a transparent corner does not drag colour into its
          // neighbours when the samples are averaged.
          const weight = sa / 255;
          r += sr * weight;
          g += sg * weight;
          b += sb * weight;
          a += sa;
        }
      }

      const samples = SUPERSAMPLE * SUPERSAMPLE;
      const alpha = a / samples;
      const unpremultiply = alpha === 0 ? 0 : samples / (a / 255);

      const at = (py * size + px) * 4;
      pixels[at] = Math.round(Math.min(255, (r / samples) * unpremultiply));
      pixels[at + 1] = Math.round(Math.min(255, (g / samples) * unpremultiply));
      pixels[at + 2] = Math.round(Math.min(255, (b / samples) * unpremultiply));
      pixels[at + 3] = Math.round(alpha);
    }
  }

  return pixels;
}

/* ── PNG encoding ───────────────────────────────────────────────────────── */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);

  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));

  return Buffer.concat([length, body, crc]);
}

function encodePng(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  // 10..12 are compression, filter, and interlace - all zero.

  // Filter byte 0 (none) per scanline. The image is a smooth gradient, so a smarter
  // filter would buy little and cost clarity here.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ── ICO, which is what Windows actually wants ──────────────────────────── */

/** A .ico wrapping PNG-compressed images at several sizes. */
function encodeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  const entries = [];
  let offset = 6 + images.length * 16;

  for (const { size, png } of images) {
    const entry = Buffer.alloc(16);
    // 256 is stored as 0 - the field is one byte.
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry[2] = 0; // palette size
    entry[3] = 0; // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32BE(0, 8);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);

    entries.push(entry);
    offset += png.length;
  }

  return Buffer.concat([header, ...entries, ...images.map((image) => image.png)]);
}

/* ── Write ──────────────────────────────────────────────────────────────── */

const outputDirectory = join(process.cwd(), "build");
await mkdir(outputDirectory, { recursive: true });

// electron-builder takes a 512+ PNG for macOS and Linux, and an ICO for Windows.
const main = render(SIZE);
await writeFile(join(outputDirectory, "icon.png"), encodePng(SIZE, main));

const icoSizes = [16, 24, 32, 48, 64, 128, 256];
await writeFile(
  join(outputDirectory, "icon.ico"),
  encodeIco(icoSizes.map((size) => ({ size, png: encodePng(size, render(size)) }))),
);

process.stdout.write(`Wrote build/icon.png (${SIZE}px) and build/icon.ico (${icoSizes.join(", ")})\n`);
