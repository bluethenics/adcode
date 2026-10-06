import { describe, expect, it } from "vitest";
import { handleClipboardKey, type ClipboardKeyEvent } from "../src/renderer/terminal/terminalClipboardKeys.ts";

function key(init: Partial<ClipboardKeyEvent> & { key: string }): ClipboardKeyEvent & { defaultPrevented: boolean } {
  const event = {
    type: "keydown",
    ctrlKey: false,
    metaKey: false,
    defaultPrevented: false,
    ...init,
    preventDefault() {
      event.defaultPrevented = true;
    },
  };
  return event;
}

function actions(selection = false) {
  const calls = { paste: 0, copy: 0 };
  return {
    calls,
    isMac: false,
    hasSelection: () => selection,
    paste: () => { calls.paste += 1; },
    copy: () => { calls.copy += 1; },
  };
}

describe("terminal clipboard keys", () => {
  /*
   * Reported by the user: pasting `cp .env.example .env` produced
   * `cp .env.example .envcp .env.example .env`.
   *
   * The handler pasted the clipboard itself and returned false - which stops xterm's own key
   * handling but not the browser's. Ctrl+V's default action then fired a native paste event,
   * xterm pasted that too, and the shell received the text twice.
   */
  it("pastes once on Ctrl+V and cancels the browser's own paste", () => {
    const event = key({ key: "v", ctrlKey: true });
    const host = actions();

    expect(handleClipboardKey(event, host)).toBe(false);
    expect(host.calls.paste).toBe(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("pastes once on Ctrl+Shift+V", () => {
    const event = key({ key: "V", ctrlKey: true });
    const host = actions();

    expect(handleClipboardKey(event, host)).toBe(false);
    expect(host.calls.paste).toBe(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("copies a selection on Ctrl+C without the browser copying too", () => {
    const event = key({ key: "c", ctrlKey: true });
    const host = actions(true);

    expect(handleClipboardKey(event, host)).toBe(false);
    expect(host.calls.copy).toBe(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves Ctrl+C with nothing selected to interrupt the program", () => {
    const event = key({ key: "c", ctrlKey: true });
    const host = actions(false);

    expect(handleClipboardKey(event, host)).toBe(true);
    expect(host.calls.copy).toBe(0);
    expect(event.defaultPrevented).toBe(false);
  });

  it("ignores key-up, so one press is one paste", () => {
    const host = actions();
    expect(handleClipboardKey(key({ key: "v", ctrlKey: true, type: "keyup" }), host)).toBe(true);
    expect(host.calls.paste).toBe(0);
  });

  it("uses Cmd rather than Ctrl on a Mac", () => {
    const mac = { ...actions(), isMac: true };
    expect(handleClipboardKey(key({ key: "v", ctrlKey: true }), mac)).toBe(true);
    expect(handleClipboardKey(key({ key: "v", metaKey: true }), mac)).toBe(false);
    expect(mac.calls.paste).toBe(1);
  });

  it("lets every other key through", () => {
    const host = actions();
    expect(handleClipboardKey(key({ key: "a", ctrlKey: true }), host)).toBe(true);
    expect(handleClipboardKey(key({ key: "v" }), host)).toBe(true);
  });
});
