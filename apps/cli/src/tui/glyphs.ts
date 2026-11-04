import { WORDMARK } from "./wordmark.ts";

/**
 * One glyph table, two personalities.
 *
 * Every symbol that participates in layout has an ASCII fallback with the same job, so
 * `--ascii` changes the texture without moving the furniture.
 */

export interface Glyphs {
  readonly mark: string;
  readonly logo: readonly string[];
  readonly topLeft: string;
  readonly topRight: string;
  readonly bottomLeft: string;
  readonly bottomRight: string;
  readonly horizontal: string;
  readonly vertical: string;
  readonly dot: string;
  readonly times: string;
  readonly bullet: string;
  readonly circle: string;
  readonly solidCircle: string;
  readonly selected: string;
  readonly arrow: string;
  readonly play: string;
  readonly plus: string;
  readonly check: string;
  readonly cross: string;
  readonly warning: string;
  readonly spark: string;
  readonly search: string;
  readonly ellipsis: string;
  readonly barFull: string;
  readonly barEmpty: string;
  readonly barThin: string;
  readonly spinner: readonly string[];
  readonly sparkline: readonly string[];
  readonly caret: string;
  readonly refresh: string;
  readonly quote: string;
}

const UNICODE: Glyphs = {
  mark: "▌",
  logo: WORDMARK,
  topLeft: "╭",
  topRight: "╮",
  bottomLeft: "╰",
  bottomRight: "╯",
  horizontal: "─",
  vertical: "│",
  dot: "·",
  times: "×",
  bullet: "•",
  circle: "○",
  solidCircle: "●",
  selected: "›",
  arrow: "→",
  play: "▸",
  plus: "+",
  check: "✓",
  cross: "✕",
  warning: "!",
  spark: "✦",
  search: "⌕",
  ellipsis: "…",
  barFull: "█",
  barEmpty: "░",
  barThin: "─",
  spinner: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
  sparkline: ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"],
  caret: "▌",
  refresh: "↻",
  quote: "“",
};

const ASCII: Glyphs = {
  mark: ">",
  logo: ["ADCODE"],
  topLeft: "+",
  topRight: "+",
  bottomLeft: "+",
  bottomRight: "+",
  horizontal: "-",
  vertical: "|",
  dot: ".",
  times: "x",
  bullet: "*",
  circle: "o",
  solidCircle: "*",
  selected: ">",
  arrow: ">",
  play: ">",
  plus: "+",
  check: "+",
  cross: "x",
  warning: "!",
  spark: "*",
  search: "?",
  ellipsis: "...",
  barFull: "#",
  barEmpty: ".",
  barThin: "-",
  spinner: ["|", "/", "-", "\\"],
  sparkline: ["_", ".", "-", "=", "+", "*", "#", "@"],
  caret: "_",
  refresh: "R",
  quote: "\"",
};

export function makeGlyphs(unicode = true): Glyphs {
  return unicode ? UNICODE : ASCII;
}
