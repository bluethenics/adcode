import { describe, expect, it } from "vitest";
import { encodeQr, formatBits, qrSvg, type QrCode } from "../src/shared/qrCode.ts";

/*
 * An independent reader for what the encoder writes: format bits, unmasking, the zigzag
 * read-out, de-interleaving, a Reed-Solomon syndrome check and the byte-mode payload. If the
 * symbol were misplaced, mis-masked or carried a wrong error-correction code, one of these
 * steps would fail - which is the closest a test gets to a phone camera.
 */
const EXP: number[] = [];
const LOG: number[] = new Array(256).fill(0);
for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
const mul = (a: number, b: number): number => (a === 0 || b === 0 ? 0 : EXP[(LOG[a]! + LOG[b]!) % 255]!);

const BLOCKS = [0, 1, 1, 1, 2, 2, 4];
const ECC = [0, 10, 16, 26, 18, 24, 16];
const ALIGN: number[][] = [[], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34]];

function reserved(version: number): boolean[][] {
  const size = version * 4 + 17;
  const map = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const mark = (x: number, y: number): void => { if (x >= 0 && y >= 0 && x < size && y < size) map[y]![x] = true; };
  for (const [ox, oy] of [[0, 0], [size - 8, 0], [0, size - 8]]) for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) mark(ox! + x, oy! + y);
  for (let i = 0; i < size; i++) { mark(6, i); mark(i, 6); }
  for (let i = 0; i < 9; i++) { mark(8, i); mark(i, 8); }
  for (let i = 0; i < 8; i++) { mark(size - 1 - i, 8); mark(8, size - 1 - i); }
  const centres = ALIGN[version]!;
  for (const ax of centres) for (const ay of centres) {
    if ((ax === 6 && ay === 6) || (ax === 6 && ay === size - 7) || (ax === size - 7 && ay === 6)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) mark(ax + dx, ay + dy);
  }
  return map;
}

function maskAt(mask: number, x: number, y: number): boolean {
  return [
    (x + y) % 2 === 0, y % 2 === 0, x % 3 === 0, (x + y) % 3 === 0,
    (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, ((x * y) % 2) + ((x * y) % 3) === 0,
    (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ][mask]!;
}

function decode(code: QrCode): string {
  const { size, version, modules } = code;
  // Format bits, first copy: around the top-left finder.
  let format = 0;
  const positions: [number, number][] = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
  positions.forEach(([x, y], i) => { if (modules[y]![x]) format |= 1 << i; });
  const raw = format ^ 0x5412;
  expect(formatBits(raw >> 10 & 7)).toBe(format);
  expect(raw >> 13).toBe(0); // level M
  const mask = (raw >> 10) & 7;

  const fixed = reserved(version);
  const bits: number[] = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < size; v++) for (let j = 0; j < 2; j++) {
      const x = right - j;
      const y = ((right + 1) & 2) === 0 ? size - 1 - v : v;
      if (fixed[y]![x]) continue;
      bits.push(modules[y]![x] !== maskAt(mask, x, y) ? 1 : 0);
    }
  }
  const total = Math.floor(bits.length / 8);
  const words = Array.from({ length: total }, (_, i) => bits.slice(i * 8, i * 8 + 8).reduce((a, b) => (a << 1) | b, 0));

  const blocks = BLOCKS[version]!;
  const eccLength = ECC[version]!;
  const shortLength = Math.floor(total / blocks);
  const shortBlocks = blocks - (total % blocks);
  const dataLengths = Array.from({ length: blocks }, (_, i) => shortLength - eccLength + (i < shortBlocks ? 0 : 1));
  const split: number[][] = dataLengths.map(() => []);
  let k = 0;
  for (let i = 0; i < Math.max(...dataLengths); i++) for (let b = 0; b < blocks; b++) if (i < dataLengths[b]!) split[b]!.push(words[k++]!);
  for (let i = 0; i < eccLength; i++) for (let b = 0; b < blocks; b++) split[b]!.push(words[k++]!);

  const data: number[] = [];
  split.forEach((block, b) => {
    // A valid codeword evaluates to zero at every generator root α^0 … α^(ecc-1).
    for (let r = 0; r < eccLength; r++) {
      let value = 0;
      for (const byte of block) value = mul(value, EXP[r]!) ^ byte;
      expect(value).toBe(0);
    }
    data.push(...block.slice(0, dataLengths[b]));
  });

  const stream = data.flatMap((byte) => Array.from({ length: 8 }, (_, i) => (byte >> (7 - i)) & 1));
  const read = (from: number, length: number): number => stream.slice(from, from + length).reduce((a, b) => (a << 1) | b, 0);
  expect(read(0, 4)).toBe(0b0100);
  const count = read(4, 8);
  const bytes = Array.from({ length: count }, (_, i) => read(12 + i * 8, 8));
  return new TextDecoder().decode(new Uint8Array(bytes));
}

describe("QR code", () => {
  it.each([
    "https://web.bluethenics.com/phone/",
    "A",
    "https://web.bluethenics.com/phone/?source=desktop&device=0123456789abcdef",
    "x".repeat(106),
  ])("round-trips %s", (text) => {
    const code = encodeQr(text);
    expect(code).not.toBeNull();
    expect(code!.size).toBe(code!.version * 4 + 17);
    expect(decode(code!)).toBe(text);
  });

  it("draws the three finder patterns and the dark module", () => {
    const code = encodeQr("https://web.bluethenics.com/phone/")!;
    const { size, modules } = code;
    for (const [x, y] of [[0, 0], [size - 7, 0], [0, size - 7]] as const) {
      expect(modules[y]![x]).toBe(true);
      expect(modules[y + 1]![x + 1]).toBe(false);
      expect(modules[y + 3]![x + 3]).toBe(true);
    }
    expect(modules[size - 8]![8]).toBe(true);
  });

  it("refuses text past version 6, and draws an SVG with a quiet zone", () => {
    expect(encodeQr("x".repeat(107))).toBeNull();
    const svg = qrSvg(encodeQr("hi")!, { label: "Scan <me>" });
    expect(svg).toContain('viewBox="0 0 29 29"');
    expect(svg).toContain('aria-label="Scan me"');
  });
});
