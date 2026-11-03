/**
 * The design system in one object.
 *
 * Commands never hand-write an escape sequence. They ask for a tone, a gradient, a rule
 * or a box, and those answers stay consistent across every screen.
 */
import {
  fitAnsi,
  mixHex,
  sgr,
  sampleGradient,
  stripAnsi,
  truncateAnsi,
  visibleWidth,
  wrapPlain,
  wrapSgr,
  type Align,
} from "./ansi.ts";
import { makeGlyphs, type Glyphs } from "./glyphs.ts";
import { resolveTheme, type Theme } from "./theme.ts";

export interface StyleOptions {
  readonly fg?: string | undefined;
  readonly bg?: string | undefined;
  readonly bold?: boolean | undefined;
  readonly dim?: boolean | undefined;
  readonly italic?: boolean | undefined;
  readonly underline?: boolean | undefined;
}

export interface UI {
  readonly theme: Theme;
  readonly glyphs: Glyphs;
  readonly color: boolean;
  readonly unicode: boolean;
  width: number;
  height: number;
  style(value: string, options?: StyleOptions): string;
  tone(name: string): string;
  paint(value: string, colorName: string, options?: Omit<StyleOptions, "fg">): string;
  gradient(value: string, options?: { stops?: readonly string[]; phase?: number; bold?: boolean }): string;
  verticalGradient(lines: readonly string[], options?: { stops?: readonly string[]; bold?: boolean }): string[];
  solidRow(value: string, width: number, options?: { fg?: string; bg?: string; bold?: boolean }): string;
  gradientBar(width: number, ratio: number, options?: { stops?: readonly string[]; phase?: number }): string;
  rule(width: number, options?: { label?: string; tone?: string; labelTone?: string; gradient?: boolean; phase?: number; boldLabel?: boolean }): string;
  box(options: BoxOptions): string[];
  statusIcon(kind: "pass" | "ok" | "warn" | "fail" | "run" | "idle"): string;
  labelValue(label: string, value: string, options?: { width?: number; labelTone?: string; valueTone?: string; bold?: boolean }): string;
  truncateMiddle(value: string, width: number): string;
  chip(value: string, options?: { tone?: string; background?: string; bold?: boolean }): string;
  wrap(value: string, width: number): string[];
  clip(value: string, width: number): string;
  fit(value: string, width: number, align?: Align): string;
  visibleWidth(value: string): number;
  truncate(value: string, width: number): string;
  bold(value: string): string;
  dim(value: string): string;
  italic(value: string): string;
}

export interface BoxOptions {
  readonly width?: number;
  readonly title?: string;
  readonly borderTone?: string;
  readonly titleTone?: string;
  readonly padding?: number;
  readonly fill?: string;
  readonly lines?: readonly string[];
}

export interface UIOptions {
  readonly theme?: string;
  readonly color?: boolean;
  readonly unicode?: boolean;
  readonly width?: number;
  readonly height?: number;
}

export function createUI(options: UIOptions = {}): UI {
  const theme = resolveTheme(options.theme ?? "midnight");
  const glyphs = makeGlyphs(options.unicode ?? true);
  const color = options.color ?? true;
  let width = options.width ?? 80;
  let height = options.height ?? 30;

  function tone(name: string): string {
    if (name.startsWith("#")) return name;
    if (Object.hasOwn(theme, name)) return (theme as unknown as Record<string, string>)[name] ?? theme.ink;
    return theme.ink;
  }

  function style(value: string, styleOptions: StyleOptions = {}): string {
    if (!color) return String(value);
    const params = sgr({
      fg: styleOptions.fg === undefined ? undefined : tone(styleOptions.fg),
      bg: styleOptions.bg === undefined ? undefined : tone(styleOptions.bg),
      bold: styleOptions.bold,
      dim: styleOptions.dim,
      italic: styleOptions.italic,
      underline: styleOptions.underline,
    });
    return wrapSgr(params, String(value));
  }

  function paint(value: string, colorName: string, paintOptions: Omit<StyleOptions, "fg"> = {}): string {
    return style(value, { ...paintOptions, fg: colorName });
  }

  function gradient(value: string, gradientOptions: { stops?: readonly string[]; phase?: number; bold?: boolean } = {}): string {
    const text = String(value);
    if (!color) return text;
    const stops = gradientOptions.stops ?? theme.gradient;
    const phase = gradientOptions.phase ?? 0;
    const denominator = Math.max(1, [...text].length - 1);
    let output = "";
    let index = 0;
    for (const character of text) {
      const position = index / denominator + phase;
      const hex = sampleGradient(stops, position);
      output += wrapSgr(sgr({ fg: hex, bold: gradientOptions.bold }), character);
      index += 1;
    }
    return output;
  }

  function verticalGradient(lines: readonly string[], gradientOptions: { stops?: readonly string[]; bold?: boolean } = {}): string[] {
    const stops = gradientOptions.stops ?? theme.gradient;
    const count = Math.max(1, lines.length);
    return lines.map((line, index) => {
      const hex = sampleGradient(stops, count === 1 ? 0 : index / (count - 1));
      return style(String(line), { fg: hex, bold: gradientOptions.bold });
    });
  }

  function solidRow(value: string, rowWidth: number, rowOptions: { fg?: string; bg?: string; bold?: boolean } = {}): string {
    const width = Math.max(0, Math.floor(rowWidth));
    if (width === 0) return "";
    const plain = fitAnsi(stripAnsi(String(value)), width);
    return style(plain, {
      fg: rowOptions.fg ?? "ink",
      bg: rowOptions.bg ?? "panelSoft",
      bold: rowOptions.bold,
    });
  }

  function gradientBar(barWidth: number, ratio: number, barOptions: { stops?: readonly string[]; phase?: number } = {}): string {
    const total = Math.max(1, Math.floor(barWidth));
    const filled = Math.min(total, Math.max(0, Math.round(total * ratio)));
    const empty = total - filled;
    if (!color) return `${glyphs.barFull.repeat(filled)}${glyphs.barEmpty.repeat(empty)}`;
    const stops = barOptions.stops ?? theme.gradient;
    const phase = barOptions.phase ?? 0;
    let output = "";
    for (let index = 0; index < filled; index += 1) {
      const hex = sampleGradient(stops, index / Math.max(1, total - 1) + phase);
      output += wrapSgr(sgr({ fg: hex }), glyphs.barFull);
    }
    if (empty > 0) output += paint(glyphs.barEmpty.repeat(empty), "borderSoft");
    return output;
  }

  function rule(ruleWidth: number, ruleOptions: { label?: string; tone?: string; labelTone?: string; gradient?: boolean; phase?: number; boldLabel?: boolean } = {}): string {
    const total = Math.max(1, Math.floor(ruleWidth));
    const label = ruleOptions.label === undefined ? "" : String(ruleOptions.label);
    if (label.length === 0) {
      if (ruleOptions.gradient === true) {
        return gradient(glyphs.horizontal.repeat(total), {
          phase: ruleOptions.phase ?? 0,
          ...(ruleOptions.tone === undefined ? {} : { stops: [ruleOptions.tone, ruleOptions.tone] }),
        });
      }
      return paint(glyphs.horizontal.repeat(total), ruleOptions.tone ?? "borderSoft");
    }
    const labelText = truncateAnsi(label, Math.max(1, total - 5));
    const labelWidth = visibleWidth(labelText);
    const fill = Math.max(0, total - labelWidth - 3);
    return (
      paint(glyphs.horizontal.repeat(2), ruleOptions.tone ?? "borderSoft") +
      ` ${paint(labelText, ruleOptions.labelTone ?? "faint", { bold: ruleOptions.boldLabel })} ` +
      paint(glyphs.horizontal.repeat(fill), ruleOptions.tone ?? "borderSoft")
    );
  }

  function box(boxOptions: BoxOptions): string[] {
    const boxWidth = Math.max(16, Math.floor(boxOptions.width ?? Math.min(118, width)));
    const borderTone = boxOptions.borderTone ?? "border";
    const titleTone = boxOptions.titleTone ?? "muted";
    const padding = Math.max(0, Math.min(3, boxOptions.padding ?? 1));
    const title = boxOptions.title === undefined ? "" : String(boxOptions.title);
    const safeTitle = truncateAnsi(title, Math.max(1, boxWidth - 9));
    const innerWidth = boxWidth - 2;
    const textWidth = Math.max(1, innerWidth - padding * 2);
    const fill = boxOptions.fill;

    let top: string;
    if (safeTitle.length > 0) {
      const titleWidth = visibleWidth(safeTitle);
      const fillWidth = Math.max(0, boxWidth - 5 - titleWidth);
      top =
        paint(glyphs.topLeft + glyphs.horizontal, borderTone) +
        ` ${paint(safeTitle, titleTone, { bold: true })} ` +
        paint(glyphs.horizontal.repeat(fillWidth) + glyphs.topRight, borderTone);
    } else {
      top = paint(glyphs.topLeft + glyphs.horizontal.repeat(innerWidth) + glyphs.topRight, borderTone);
    }

    const body = (boxOptions.lines ?? []).map((line) => {
      const source = String(line ?? "");
      const truncated = truncateAnsi(source, textWidth);
      const missing = Math.max(0, textWidth - visibleWidth(truncated));
      const tail = fill === undefined ? " ".repeat(missing) : style(" ".repeat(missing), { bg: fill });
      const leftPadding = fill === undefined ? " ".repeat(padding) : style(" ".repeat(padding), { bg: fill });
      const rightPadding = fill === undefined ? " ".repeat(padding) : style(" ".repeat(padding), { bg: fill });
      return (
        paint(glyphs.vertical, borderTone) +
        leftPadding +
        truncated +
        tail +
        rightPadding +
        paint(glyphs.vertical, borderTone)
      );
    });

    const bottom = paint(
      glyphs.bottomLeft + glyphs.horizontal.repeat(innerWidth) + glyphs.bottomRight,
      borderTone,
    );

    return [top, ...body, bottom];
  }

  function statusIcon(kind: "pass" | "ok" | "warn" | "fail" | "run" | "idle"): string {
    if (kind === "pass" || kind === "ok") return paint(glyphs.check, "success", { bold: true });
    if (kind === "warn") return paint(glyphs.warning, "warning", { bold: true });
    if (kind === "fail") return paint(glyphs.cross, "danger", { bold: true });
    if (kind === "run") return paint(glyphs.bullet, "accent");
    return paint(glyphs.circle, "faint");
  }

  function labelValue(label: string, value: string, valueOptions: { width?: number; labelTone?: string; valueTone?: string; bold?: boolean } = {}): string {
    const labelWidth = valueOptions.width ?? 11;
    const labelText = truncateAnsi(String(label), labelWidth);
    return (
      paint(labelText, valueOptions.labelTone ?? "muted") +
      " ".repeat(Math.max(1, labelWidth - visibleWidth(labelText))) +
      paint(String(value), valueOptions.valueTone ?? "ink", { bold: valueOptions.bold })
    );
  }

  function truncateMiddle(value: string, middleWidth: number): string {
    const text = String(value);
    if (visibleWidth(text) <= middleWidth) return text;
    if (middleWidth <= 3) return glyphs.ellipsis.slice(0, middleWidth);
    const left = Math.ceil((middleWidth - 1) / 2);
    const right = Math.floor((middleWidth - 1) / 2);
    return text.slice(0, left) + glyphs.ellipsis + text.slice(text.length - right);
  }

  function chip(value: string, chipOptions: { tone?: string; background?: string; bold?: boolean } = {}): string {
    const text = String(value);
    if (!color) return `[${text}]`;
    return style(` ${text} `, {
      fg: chipOptions.tone ?? "muted",
      bg: chipOptions.background ?? "panelSoft",
      bold: chipOptions.bold,
    });
  }

  function wrap(value: string, wrapWidth: number): string[] {
    return wrapPlain(value, wrapWidth);
  }

  function clip(value: string, clipWidth: number): string {
    const text = String(value);
    if (clipWidth <= 0) return "";
    if (visibleWidth(text) <= clipWidth) return text;
    const suffix = glyphs.ellipsis;
    const suffixWidth = visibleWidth(suffix);
    if (clipWidth <= suffixWidth) return truncateAnsi(suffix, clipWidth);
    return `${truncateAnsi(text, clipWidth - suffixWidth)}${suffix}`;
  }

  return {
    get theme() {
      return theme;
    },
    glyphs,
    color,
    unicode: options.unicode ?? true,
    get width() {
      return width;
    },
    set width(value: number) {
      width = Math.max(20, value);
    },
    get height() {
      return height;
    },
    set height(value: number) {
      height = Math.max(10, value);
    },
    style,
    tone,
    paint,
    gradient,
    verticalGradient,
    solidRow,
    gradientBar,
    rule,
    box,
    statusIcon,
    labelValue,
    truncateMiddle,
    chip,
    wrap,
    clip,
    fit: fitAnsi,
    visibleWidth,
    truncate: truncateAnsi,
    bold: (value: string) => (color ? style(value, { bold: true }) : String(value)),
    dim: (value: string) => (color ? style(value, { dim: true }) : String(value)),
    italic: (value: string) => (color ? style(value, { italic: true }) : String(value)),
  };
}
