import { CURSOR, truncateAnsi } from "./ansi.ts";
import type { UI } from "./ui.ts";

export function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, milliseconds));
  });
}

export function easeOutCubic(value: number): number {
  return 1 - (1 - value) ** 3;
}

export function easeInOutCubic(value: number): number {
  return value < 0.5 ? 4 * value ** 3 : 1 - (-2 * value + 2) ** 3 / 2;
}

export interface Motion {
  readonly enabled: boolean;
  readonly speed: number;
  readonly out: NodeJS.WriteStream;
  scale(milliseconds: number): number;
}

export interface MotionOptions {
  readonly enabled?: boolean;
  readonly speed?: number;
  readonly out?: NodeJS.WriteStream;
}

export function createMotion(options: MotionOptions = {}): Motion {
  const out = options.out ?? process.stdout;
  const enabled = Boolean((options.enabled ?? true) && out.isTTY === true);
  const speed = options.speed ?? 1;
  return {
    enabled,
    speed,
    out,
    scale(milliseconds: number): number {
      return Math.max(0, Math.round(milliseconds * speed));
    },
  };
}

export async function revealLines(
  lines: readonly string[],
  motion: Motion,
  options: { delay?: number; out?: NodeJS.WriteStream } = {},
): Promise<void> {
  const out = options.out ?? motion.out;
  if (!motion.enabled) {
    out.write(`${lines.join("\n")}\n`);
    return;
  }
  for (const line of lines) {
    out.write(`${line}\n`);
    await sleep(motion.scale(options.delay ?? 18));
  }
}

/**
 * A spinner for one-line work that happens outside the full-screen renderer: probing
 * Ollama, checking a provider, fetching a balance.
 */
export class Spinner {
  readonly ui: UI;
  readonly motion: Motion;
  readonly out: NodeJS.WriteStream;
  label = "";
  frame = 0;
  timer: NodeJS.Timeout | null = null;
  active = false;

  constructor(ui: UI, motion: Motion, options: { out?: NodeJS.WriteStream } = {}) {
    this.ui = ui;
    this.motion = motion;
    this.out = options.out ?? motion.out;
  }

  #render(): void {
    const frames = this.ui.glyphs.spinner;
    const glyph = frames[this.frame % Math.max(1, frames.length)] ?? "-";
    const line = `  ${this.ui.paint(glyph, "accent", { bold: true })} ${this.ui.paint(this.label, "muted")}`;
    this.out.write(`\r${CURSOR.clearLine}${truncateAnsi(line, this.out.columns ?? 80)}`);
    this.frame += 1;
  }

  start(label: string): this {
    this.label = label;
    if (!this.motion.enabled) return this;
    this.active = true;
    this.out.write(CURSOR.hide);
    this.#render();
    this.timer = setInterval(() => this.#render(), 70);
    this.timer.unref?.();
    return this;
  }

  update(label: string): this {
    this.label = label;
    if (!this.motion.enabled) return this;
    this.#render();
    return this;
  }

  #end(icon: string, text: string): this {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.active = false;
    if (!this.motion.enabled) {
      this.out.write(`  ${icon} ${text}\n`);
      return this;
    }
    this.out.write(`\r${CURSOR.clearLine}  ${icon} ${this.ui.paint(text, "muted")}\n`);
    this.out.write(CURSOR.show);
    return this;
  }

  succeed(text = this.label): this {
    return this.#end(this.ui.statusIcon("pass"), text);
  }

  warn(text = this.label): this {
    return this.#end(this.ui.statusIcon("warn"), text);
  }

  fail(text = this.label): this {
    return this.#end(this.ui.statusIcon("fail"), text);
  }

  stop(): this {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.active = false;
    if (this.motion.enabled) this.out.write(`\r${CURSOR.clearLine}${CURSOR.show}`);
    return this;
  }
}

export function sparkline(values: readonly number[], width: number, ui: UI): string {
  const count = Math.max(1, Math.min(width, values.length));
  const source = values.slice(0, count);
  const maximum = Math.max(...source, 1);
  return source
    .map((value) => {
      const level = Math.max(0, Math.min(ui.glyphs.sparkline.length - 1, Math.round((value / maximum) * (ui.glyphs.sparkline.length - 1))));
      return ui.glyphs.sparkline[level] ?? "-";
    })
    .join("");
}
