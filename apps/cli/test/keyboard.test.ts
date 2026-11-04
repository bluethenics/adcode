import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { startKeyboard, type Key } from "../src/tui/keyboard.ts";

/**
 * stdin can end, and on Windows it does so on ctrl+d before the parser ever sees a key.
 * A screen that only listens for key events would leave the alternate screen and the
 * cursor behind, so the keyboard reports the end exactly once and every screen closes.
 */

class FakeTTY extends EventEmitter {
  isTTY = true;
  isRaw = false;
  columns = 100;
  rows = 30;
  rawModes: boolean[] = [];
  encoding: string | null = null;

  setRawMode(value: boolean): this {
    this.isRaw = value;
    this.rawModes.push(value);
    return this;
  }

  setEncoding(encoding: string): this {
    this.encoding = encoding;
    return this;
  }

  resume(): this {
    return this;
  }
}

function tty(): FakeTTY {
  return new FakeTTY();
}

function start(stdin: FakeTTY, onEnd: () => void, onKey?: (key: Key) => void): () => void {
  return startKeyboard({
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: tty() as unknown as NodeJS.WriteStream,
    onEnd,
    ...(onKey === undefined ? {} : { onKey }),
  });
}

describe("stdin ending is an exit, not silence", () => {
  it("reports the end once when the stream ends", () => {
    const stdin = tty();
    const onEnd = vi.fn();
    start(stdin, onEnd);

    stdin.emit("end");
    stdin.emit("end");

    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("treats a close as the same end", () => {
    const stdin = tty();
    const onEnd = vi.fn();
    start(stdin, onEnd);

    stdin.emit("close");
    stdin.emit("end");

    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("stays quiet after the caller has stopped listening", () => {
    const stdin = tty();
    const onEnd = vi.fn();
    const stop = start(stdin, onEnd);

    stop();
    stdin.emit("end");
    stdin.emit("close");

    expect(onEnd).not.toHaveBeenCalled();
    expect(stdin.listenerCount("data")).toBe(0);
    expect(stdin.listenerCount("end")).toBe(0);
    expect(stdin.listenerCount("close")).toBe(0);
  });
});

describe("ctrl+d is available to the screens", () => {
  it("parses ctrl+d as a control key, which is what ConPTY delivers", () => {
    const stdin = tty();
    const keys: Key[] = [];
    start(stdin, () => undefined, (key) => keys.push(key));

    stdin.emit("data", "\x04");

    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({ name: "d", ctrl: true });
  });
});
