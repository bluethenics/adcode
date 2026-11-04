/**
 * Low-level terminal primitives.
 *
 * Everything here is pure except the cursor constants. No colour is emitted unless the
 * caller asks for it, which is what keeps `--no-color`, pipes and snapshots safe.
 */

export const CSI = "\x1b[";
export const RESET = "\x1b[0m";

export const CURSOR = {
  hide: "\x1b[?25l",
  show: "\x1b[?25h",
  home: "\x1b[H",
  clear: "\x1b[2J",
  clearLine: "\x1b[2K",
  save: "\x1b7",
  restore: "\x1b8",
  up: (n = 1): string => `\x1b[${Math.max(1, n)}A`,
  down: (n = 1): string => `\x1b[${Math.max(1, n)}B`,
  right: (n = 1): string => `\x1b[${Math.max(1, n)}C`,
  left: (n = 1): string => `\x1b[${Math.max(1, n)}D`,
  at: (row: number, column = 1): string => `\x1b[${Math.max(1, row)};${Math.max(1, column)}H`,
};

export const ALT_SCREEN = {
  enter: "\x1b[?1049h",
  exit: "\x1b[?1049l",
};

/** Bracketed paste and focus reporting: both are restored with the alternate screen. */
export const TERMINAL_MODES = {
  focusOn: "\x1b[?1004h",
  focusOff: "\x1b[?1004l",
  pasteOn: "\x1b[?2004h",
  pasteOff: "\x1b[?2004l",
};

const ANSI_PATTERN = /\x1b\[[0-?]*[ -/]*[@-~]/g;

export function stripAnsi(value: string): string {
  return String(value).replace(ANSI_PATTERN, "");
}

/**
 * A deliberately small width table. The CLI uses box drawing, geometric glyphs and block
 * elements; none of them need a full Unicode database. East Asian wide characters are
 * counted as two so paths and names from any locale still line up.
 */
export function charWidth(character: string): number {
  const code = character.codePointAt(0);
  if (code === undefined || code === 0) return 0;
  if (code < 32 || (code >= 0x7f && code < 0xa0)) return 0;
  if (code >= 0x300 && code <= 0x36f) return 0;
  if (
    (code >= 0x1100 && code <= 0x115f) ||
    code === 0x2329 ||
    code === 0x232a ||
    (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe19) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1faff) ||
    (code >= 0x20000 && code <= 0x3fffd)
  ) {
    return 2;
  }
  return 1;
}

export function visibleWidth(value: string): number {
  let width = 0;
  for (const character of stripAnsi(value)) width += charWidth(character);
  return width;
}

/**
 * Truncate without cutting an ANSI sequence or a surrogate pair in half. The caller gets a
 * complete, reset string back so colour never leaks into the rest of the frame.
 */
export function truncateAnsi(value: string, maximum: number): string {
  const text = String(value);
  if (maximum <= 0) return "";
  if (visibleWidth(text) <= maximum) return text;

  let output = "";
  let width = 0;
  let index = 0;

  while (index < text.length) {
    if (text[index] === "\x1b") {
      const match = text.slice(index).match(/^\x1b\[[0-?]*[ -/]*[@-~]/);
      if (match !== null) {
        output += match[0];
        index += match[0].length;
        continue;
      }
    }

    const character = String.fromCodePoint(text.codePointAt(index) ?? 32);
    const characterWidth = charWidth(character);
    if (width + characterWidth > maximum) break;
    output += character;
    width += characterWidth;
    index += character.length;
  }

  return text.includes("\x1b[") ? `${output}${RESET}` : output;
}

export type Align = "left" | "right" | "center";

export function padAnsi(value: string, width: number, align: Align = "left"): string {
  const text = truncateAnsi(value, width);
  const missing = Math.max(0, width - visibleWidth(text));
  if (missing === 0) return text;
  if (align === "right") return `${" ".repeat(missing)}${text}`;
  if (align === "center") {
    const left = Math.floor(missing / 2);
    return `${" ".repeat(left)}${text}${" ".repeat(missing - left)}`;
  }
  return `${text}${" ".repeat(missing)}`;
}

export function fitAnsi(value: string, width: number, align: Align = "left"): string {
  return padAnsi(value, width, align);
}

/** Word wrap for plain text. Styled strings are wrapped after they are built. */
export function wrapPlain(value: string, width: number): string[] {
  const text = String(value).replace(/\r\n/g, "\n");
  if (width <= 1) return [text];
  const output: string[] = [];
  const push = (line: string): void => {
    if (visibleWidth(line) <= width) {
      output.push(line);
      return;
    }
    let chunk = "";
    for (const character of line) {
      if (chunk.length > 0 && visibleWidth(chunk) + charWidth(character) > width) {
        output.push(chunk);
        chunk = character;
      } else {
        chunk += character;
      }
    }
    if (chunk.length > 0) output.push(chunk);
  };

  for (const paragraph of text.split("\n")) {
    if (paragraph.length === 0) {
      output.push("");
      continue;
    }
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      if (word.length === 0) continue;
      if (line.length === 0) {
        line = word;
        continue;
      }
      if (line.length + 1 + word.length <= width) {
        line += ` ${word}`;
      } else {
        push(line);
        line = word;
      }
    }
    if (line.length > 0) push(line);
  }

  return output;
}

/** Split a styled string at the first space that fits. Used for hint rows. */
export function splitAtWord(value: string, width: number): [string, string] {
  const text = String(value);
  if (visibleWidth(text) <= width) return [text, ""];
  const characters = [...text];
  let taken = "";
  let index = 0;
  while (index < characters.length) {
    const character = characters[index] ?? "";
    if (visibleWidth(taken + character) > width) break;
    taken += character;
    index += 1;
  }
  const rest = characters.slice(index).join("").trim();
  return [taken.trimEnd(), rest];
}

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export function hexToRgb(hex: string): Rgb {
  let value = String(hex).replace("#", "").trim();
  if (value.length === 3) value = value.split("").map((character) => character + character).join("");
  if (!/^[0-9a-f]{6}$/i.test(value)) return { r: 255, g: 255, b: 255 };
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const component = (value: number): string =>
    Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, "0");
  return `#${component(r)}${component(g)}${component(b)}`;
}

export function mixHex(from: string, to: string, amount: number): string {
  const t = Math.min(1, Math.max(0, amount));
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  return rgbToHex({
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  });
}

export function sampleGradient(stops: readonly string[], position: number): string {
  if (stops.length === 0) return "#ffffff";
  const first = stops[0] ?? "#ffffff";
  if (stops.length === 1) return first;
  const t = ((position % 1) + 1) % 1;
  const scaled = t * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(scaled));
  const from = stops[index] ?? first;
  const to = stops[index + 1] ?? from;
  return mixHex(from, to, scaled - index);
}

export interface SgrOptions {
  readonly fg?: string | undefined;
  readonly bg?: string | undefined;
  readonly bold?: boolean | undefined;
  readonly dim?: boolean | undefined;
  readonly italic?: boolean | undefined;
  readonly underline?: boolean | undefined;
  readonly inverse?: boolean | undefined;
}

export function sgr(options: SgrOptions): string[] {
  const params: string[] = [];
  if (options.bold === true) params.push("1");
  if (options.dim === true) params.push("2");
  if (options.italic === true) params.push("3");
  if (options.underline === true) params.push("4");
  if (options.inverse === true) params.push("7");
  if (options.fg !== undefined) {
    const { r, g, b } = hexToRgb(options.fg);
    params.push(`38;2;${r};${g};${b}`);
  }
  if (options.bg !== undefined) {
    const { r, g, b } = hexToRgb(options.bg);
    params.push(`48;2;${r};${g};${b}`);
  }
  return params;
}

export function wrapSgr(params: readonly string[], value: string): string {
  if (params.length === 0) return String(value);
  return `${CSI}${params.join(";")}m${value}${RESET}`;
}

export function fg(hex: string, value: string): string {
  return wrapSgr(sgr({ fg: hex }), value);
}

export function bg(hex: string, value: string): string {
  return wrapSgr(sgr({ bg: hex }), value);
}

export function terminalSize(stream: NodeJS.WriteStream = process.stdout): { width: number; height: number } {
  return {
    width: Math.max(20, stream.columns ?? 80),
    height: Math.max(10, stream.rows ?? 30),
  };
}

export function isInteractive(stdin: NodeJS.ReadStream = process.stdin, stdout: NodeJS.WriteStream = process.stdout): boolean {
  return Boolean(stdin.isTTY === true && stdout.isTTY === true);
}
