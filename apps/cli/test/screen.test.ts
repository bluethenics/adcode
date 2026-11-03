import { describe, expect, it } from "vitest";
import { Screen, holdScreen } from "../src/tui/screen.ts";

/**
 * The alternate screen is invisible to a test that only reads the rendered lines, but it is
 * the difference between leaving somebody's terminal as they found it and leaving it in a
 * 256-colour wasteland. These assert the exact sequences, in the exact order, because the
 * order is what restores the terminal: show the cursor, stop the modes, then leave the
 * screen.
 */

interface FakeStream {
  readonly stream: NodeJS.WriteStream;
  readonly written: string[];
  columns: number;
  rows: number;
}

function fakeStream(columns = 80, rows = 30): FakeStream {
  const written: string[] = [];
  const state = {
    written,
    columns,
    rows,
    stream: {
      write: (chunk: string) => {
        written.push(String(chunk));
        return true;
      },
      columns,
      rows,
    } as unknown as NodeJS.WriteStream,
  };
  return state;
}

function output(fake: FakeStream): string {
  return fake.written.join("");
}

describe("Screen - leave the terminal exactly as it was found", () => {
  it("enters the alternate screen, hides the cursor and turns the modes on", () => {
    const fake = fakeStream();
    new Screen({ out: fake.stream }).enter();

    const text = output(fake);
    expect(text).toContain("\x1b[?1049h");
    expect(text).toContain("\x1b[?1004h");
    expect(text).toContain("\x1b[?2004h");
    expect(text).toContain("\x1b[?25l");
    expect(text).toContain("\x1b[2J");
    expect(text).toContain("\x1b[H");
  });

  it("restores the cursor, both modes and the original screen on exit", () => {
    const fake = fakeStream();
    const screen = new Screen({ out: fake.stream }).enter();
    fake.written.length = 0;
    screen.exit();

    // Order matters: the cursor has to be visible before the alternate screen is left, or
    // the shell underneath inherits a hidden one.
    expect(output(fake)).toBe("\x1b[?25h\x1b[?2004l\x1b[?1004l\x1b[?1049l");
    expect(screen.active).toBe(false);
  });

  it("is idempotent in both directions", () => {
    const fake = fakeStream();
    const screen = new Screen({ out: fake.stream });
    screen.enter();
    const entered = output(fake);
    screen.enter();
    expect(output(fake)).toBe(entered);

    screen.exit();
    fake.written.length = 0;
    screen.exit();
    expect(output(fake)).toBe("");
  });

  it("does not touch the terminal for a render it never entered", () => {
    const fake = fakeStream();
    new Screen({ out: fake.stream }).render(["hello"]);
    expect(output(fake)).toBe("");
  });
});

describe("Screen - only the rows that changed are written", () => {
  it("keeps the same console buffer when switching between app screens", () => {
    const fake = fakeStream();
    const release = holdScreen(fake.stream);
    new Screen({ out: fake.stream }).enter().exit();
    new Screen({ out: fake.stream }).enter().exit();
    expect(output(fake).split("\x1b[?1049h")).toHaveLength(2);
    expect(output(fake)).not.toContain("\x1b[?1049l");
    release();
    expect(output(fake).split("\x1b[?1049l")).toHaveLength(2);
    const restored = output(fake);
    release();
    expect(output(fake)).toBe(restored);
  });

  it("repaints one changed line and leaves the rest alone", () => {
    const fake = fakeStream();
    const screen = new Screen({ out: fake.stream }).enter();
    fake.written.length = 0;

    screen.render(["one", "two", "three"]);
    expect(output(fake)).toContain("one");
    expect(output(fake)).toContain("two");
    expect(output(fake)).toContain("three");

    fake.written.length = 0;
    screen.render(["one", "TWO", "three"]);
    const text = output(fake);
    expect(text).not.toContain("one");
    expect(text).not.toContain("three");
    expect(text).toContain("TWO");
    // Row two, column one.
    expect(text).toContain("\x1b[2;1H");
  });

  it("writes nothing when a frame is identical", () => {
    const fake = fakeStream();
    const screen = new Screen({ out: fake.stream }).enter();
    screen.render(["same"]);
    fake.written.length = 0;
    screen.render(["same"]);
    expect(output(fake)).toBe("");
  });

  it("repaints every row after a resize redraw", () => {
    const fake = fakeStream();
    const screen = new Screen({ out: fake.stream }).enter();
    screen.render(["same"]);
    screen.redraw();
    fake.written.length = 0;
    screen.render(["same"]);
    expect(output(fake)).toContain("same");
  });

  it("clips rows to the terminal width and frame count to its height", () => {
    const fake = fakeStream(24, 10);
    const screen = new Screen({ out: fake.stream }).enter();
    screen.render(["x".repeat(100), "visible", "third", "fourth"]);

    const rows = output(fake).split(/\x1b\[\d+;\d+H/).filter((part) => part.includes("\x1b[2K"));
    expect(rows.length).toBe(4);
    for (const row of rows) {
      expect(row.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").length).toBeLessThanOrEqual(24);
    }
  });
});
