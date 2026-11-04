import type { UI } from "./ui.ts";
import { centerLine } from "./components.ts";
import { WORDMARK } from "./wordmark.ts";

/** The product's dollar-and-brackets mark beside a wordmark on a consistent grid. */
const EMBLEM = ["       │       ", "  ╱  ╭─┼─╮  ╲  ", " ❮   ╰─┼─╮   ❯ ", "  ╲  ╰─┼─╯  ╱  ", "       │       "];

export function brandLines(ui: UI, width: number, height: number, phase = 0.24): string[] {
  const large = ui.unicode && width >= 48 && height >= 20;
  if (!large) return [centerLine(`${ui.gradient("<$>", { phase, bold: true })}  ${ui.paint("ADCODE", "ink", { bold: true })}`, width)];
  const emblem = width >= 76;
  return WORDMARK.map((line, row) => {
    const mark = emblem ? `${ui.gradient(EMBLEM[row] ?? "", { phase, stops: [ui.theme.muted, ui.theme.ink, ui.theme.muted], bold: true })}    ` : "";
    return centerLine(`${mark}${ui.paint(line, "ink", { bold: true })}`, width);
  });
}
