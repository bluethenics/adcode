import { ALT_SCREEN, CURSOR, TERMINAL_MODES, truncateAnsi } from "./ansi.ts";

const sessions = new WeakMap<NodeJS.WriteStream, { entered: boolean }>();
const entered = new WeakSet<NodeJS.WriteStream>();
const RESTORE = `${CURSOR.show}${TERMINAL_MODES.pasteOff}${TERMINAL_MODES.focusOff}${ALT_SCREEN.exit}`;

export function restoreScreen(out: NodeJS.WriteStream): void {
  if (!entered.has(out)) return;
  entered.delete(out);
  out.write(RESTORE);
}

/** Keep one console buffer while the home screen hands off to a picker or chat. */
export function holdScreen(out: NodeJS.WriteStream): () => void {
  if (sessions.has(out)) return () => undefined;
  const session = { entered: false };
  sessions.set(out, session);
  return () => {
    if (sessions.get(out) !== session) return;
    sessions.delete(out);
    if (session.entered) restoreScreen(out);
  };
}

/**
 * Alternate-screen renderer with line diffing. Only changed rows are rewritten, so the
 * ambient shimmer does not flash the entire screen.
 */
export class Screen {
  readonly out: NodeJS.WriteStream;
  active = false;
  previous: string[] = [];

  constructor(options: { out?: NodeJS.WriteStream } = {}) {
    this.out = options.out ?? process.stdout;
  }

  enter(): this {
    if (this.active) return this;
    const session = sessions.get(this.out);
    const enter = session?.entered === true ? "" : `${ALT_SCREEN.enter}${TERMINAL_MODES.focusOn}${TERMINAL_MODES.pasteOn}${CURSOR.hide}`;
    this.out.write(`${enter}${CURSOR.clear}${CURSOR.home}`);
    entered.add(this.out);
    if (session !== undefined) session.entered = true;
    this.active = true;
    this.previous = [];
    return this;
  }

  render(lines: readonly string[]): void {
    if (!this.active) return;
    const width = Math.max(20, this.out.columns ?? 80);
    const height = Math.max(10, this.out.rows ?? 30);
    const next = lines.slice(0, height).map((line) => truncateAnsi(line ?? "", width));
    const rows = Math.max(next.length, this.previous.length);
    let buffer = "";

    for (let index = 0; index < rows; index += 1) {
      const line = next[index];
      const before = this.previous[index];
      if (line === before) continue;
      buffer += `${CURSOR.at(index + 1, 1)}${CURSOR.clearLine}${line ?? ""}`;
    }

    if (buffer.length > 0) this.out.write(buffer);
    this.previous = next;
  }

  redraw(): void {
    this.previous = [];
  }

  exit(final = false): this {
    if (!this.active) return this;
    this.active = false;
    const session = sessions.get(this.out);
    if (session === undefined || final) {
      restoreScreen(this.out);
      if (session !== undefined) session.entered = false;
    }
    this.previous = [];
    return this;
  }
}
