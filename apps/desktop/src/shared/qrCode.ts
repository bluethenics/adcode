/**
 * A QR code for a short link, so a phone's camera can open the Phone link page.
 *
 * Small on purpose: byte mode, error correction level M, versions 1 to 6 - up to 106 bytes,
 * which every link this app shows fits in many times over. That range needs no version-info
 * blocks. The construction follows the QR standard (ISO/IEC 18004) step by step: data bits,
 * Reed-Solomon over GF(256), block interleaving, function patterns, zigzag placement, masking
 * and the format bits, with the mask chosen by the standard's penalty rules.
 *
 * Pure: no DOM. `qrSvg` turns the matrix into markup.
 */

const DATA_CODEWORDS = [0, 16, 28, 44, 64, 86, 108] as const;
const ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16] as const;
const BLOCKS = [0, 1, 1, 1, 2, 2, 4] as const;
const ALIGNMENT = [[], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34]] as const;
/** Level M's two format bits. */
const LEVEL_M = 0;

export interface QrCode {
  readonly version: number;
  readonly size: number;
  readonly mask: number;
  /** `modules[y][x]`, true for dark. */
  readonly modules: readonly (readonly boolean[])[];
}

function rawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    result -= (25 * align - 10) * align - 55;
  }
  return result;
}

function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree: number): number[] {
  const result: number[] = new Array<number>(degree - 1).fill(0);
  result.push(1);
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMultiply(result[j]!, root);
      if (j + 1 < result.length) result[j]! ^= result[j + 1]!;
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function rsRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const result = divisor.map(() => 0);
  for (const byte of data) {
    const factor = byte ^ result.shift()!;
    result.push(0);
    divisor.forEach((coefficient, i) => { result[i]! ^= gfMultiply(coefficient, factor); });
  }
  return result;
}

/** The data codewords for `bytes` in byte mode, padded to the version's capacity. */
export function dataCodewords(bytes: readonly number[], version: number): number[] {
  const capacity = DATA_CODEWORDS[version]! * 8;
  const bits: number[] = [];
  const push = (value: number, length: number): void => { for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
  push(0b0100, 4);
  push(bytes.length, 8);
  for (const byte of bytes) push(byte, 8);
  push(0, Math.min(4, capacity - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0));
  return out;
}

/** Splits into blocks, adds each block's error correction, and interleaves them. */
export function withErrorCorrection(data: readonly number[], version: number): number[] {
  const blocks = BLOCKS[version]!;
  const eccLength = ECC_PER_BLOCK[version]!;
  const raw = Math.floor(rawDataModules(version) / 8);
  const shortBlocks = blocks - (raw % blocks);
  const shortLength = Math.floor(raw / blocks);
  const divisor = rsDivisor(eccLength);
  const all: number[][] = [];
  for (let i = 0, k = 0; i < blocks; i++) {
    const block = data.slice(k, k + shortLength - eccLength + (i < shortBlocks ? 0 : 1));
    k += block.length;
    const ecc = rsRemainder(block, divisor);
    if (i < shortBlocks) block.push(0);
    all.push([...block, ...ecc]);
  }
  const result: number[] = [];
  for (let i = 0; i < all[0]!.length; i++) {
    all.forEach((block, j) => {
      if (i !== shortLength - eccLength || j >= shortBlocks) result.push(block[i]!);
    });
  }
  return result;
}

/** The 15 format bits for level M and `mask`, with their BCH code and the standard's XOR. */
export function formatBits(mask: number): number {
  const data = (LEVEL_M << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

const bit = (value: number, i: number): boolean => ((value >>> i) & 1) !== 0;

function masked(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

function build(codewords: readonly number[], version: number, mask: number): QrCode {
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const fixed = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (x: number, y: number, dark: boolean): void => { modules[y]![x] = dark; fixed[y]![x] = true; };

  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]] as const) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx; const y = cy + dy;
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const distance = Math.max(Math.abs(dx), Math.abs(dy));
      set(x, y, distance !== 2 && distance !== 4);
    }
  }
  const positions = ALIGNMENT[version]!;
  const last = positions.length - 1;
  positions.forEach((ax, i) => positions.forEach((ay, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));

  const format = formatBits(mask);
  for (let i = 0; i <= 5; i++) set(8, i, bit(format, i));
  set(8, 7, bit(format, 6));
  set(8, 8, bit(format, 7));
  set(7, 8, bit(format, 8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(format, i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(format, i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(format, i));
  set(8, size - 8, true);

  let index = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vertical = 0; vertical < size; vertical++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vertical : vertical;
        if (fixed[y]![x] || index >= codewords.length * 8) continue;
        modules[y]![x] = bit(codewords[index >>> 3]!, 7 - (index & 7));
        index++;
      }
    }
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fixed[y]![x] && masked(mask, x, y)) modules[y]![x] = !modules[y]![x];
  return { version, size, mask, modules };
}

/** The standard's penalty: runs, 2x2 blocks, finder-like patterns, and dark/light balance. */
export function penalty(code: QrCode): number {
  const { size, modules } = code;
  let score = 0;
  const lines = (horizontal: boolean): boolean[][] =>
    Array.from({ length: size }, (_, a) => Array.from({ length: size }, (_, b) => (horizontal ? modules[a]![b]! : modules[b]![a]!)));
  for (const line of [...lines(true), ...lines(false)]) {
    let run = 1;
    for (let i = 1; i <= size; i++) {
      if (i < size && line[i] === line[i - 1]) { run++; continue; }
      if (run >= 5) score += run - 2;
      run = 1;
    }
    const text = line.map((dark) => (dark ? "1" : "0")).join("");
    for (const pattern of ["10111010000", "00001011101"]) for (let at = text.indexOf(pattern); at !== -1; at = text.indexOf(pattern, at + 1)) score += 40;
  }
  for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
    const c = modules[y]![x];
    if (c === modules[y]![x + 1] && c === modules[y + 1]![x] && c === modules[y + 1]![x + 1]) score += 3;
  }
  const dark = modules.reduce((sum, row) => sum + row.filter(Boolean).length, 0);
  score += Math.floor(Math.abs((dark * 20) - (size * size * 10)) / (size * size)) * 10;
  return score;
}

/** Null for text too long for version 6 at level M (106 bytes). */
export function encodeQr(text: string): QrCode | null {
  const bytes = [...new TextEncoder().encode(text)];
  let version = 1;
  while (version <= 6 && 4 + 8 + bytes.length * 8 > DATA_CODEWORDS[version]! * 8) version++;
  if (version > 6) return null;
  const codewords = withErrorCorrection(dataCodewords(bytes, version), version);
  let best: QrCode | null = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const code = build(codewords, version, mask);
    const score = penalty(code);
    if (score < bestScore) { best = code; bestScore = score; }
  }
  return best;
}

/** The code as one SVG path, with the four-module quiet zone the standard asks for. */
export function qrSvg(code: QrCode, options: { readonly dark?: string; readonly light?: string; readonly label?: string } = {}): string {
  const border = 4;
  const full = code.size + border * 2;
  let path = "";
  code.modules.forEach((row, y) => row.forEach((dark, x) => { if (dark) path += `M${x + border},${y + border}h1v1h-1z`; }));
  const label = (options.label ?? "QR code").replace(/[<>&"]/g, "");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${full} ${full}" role="img" aria-label="${label}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="${options.light ?? "#fff"}"/><path d="${path}" fill="${options.dark ?? "#000"}"/></svg>`;
}
