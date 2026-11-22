/*
 * adcode-host's stand-in for Electron.
 *
 * The main process was written for Electron: handlers registered with `ipcMain`, broadcasts
 * through `BrowserWindow.getAllWindows()`, dialogs, the clipboard, `safeStorage`. On the web
 * the same code runs in plain Node, and every one of those calls lands here instead. These
 * tests pin the translation: a handler's answer becomes a `ret` frame, a broadcast becomes an
 * `evt` frame on each connected tab, and a dialog becomes a question for the browser.
 */
import { afterEach, describe, expect, it } from "vitest";
import { CHANNELS } from "../src/shared/api.ts";
import { Dispatcher, type HostConnection } from "../src/host/dispatcher.ts";
import { BrowserWindow, app, attachConnection, detachConnection, dialog, dispatcher, ipcMain, safeStorage } from "../src/host/electronShim.ts";
import { sealString, unsealString } from "../src/browserHost/seal.ts";
import type { AskKind, ServerFrame } from "../src/web/wire.ts";

let nextId = 100;

function fakeConnection(answers: Partial<Record<AskKind, unknown>> = {}): HostConnection & { frames: ServerFrame[]; asked: [AskKind, unknown][] } {
  const frames: ServerFrame[] = [];
  const asked: [AskKind, unknown][] = [];
  return {
    id: nextId++,
    focused: false,
    frames,
    asked,
    send: (frame) => frames.push(frame),
    ask: async (kind, payload) => {
      asked.push([kind, payload]);
      return answers[kind] ?? null;
    },
  };
}

const attached: number[] = [];
function attach(connection: HostConnection): void {
  attachConnection(connection);
  attached.push(connection.id);
}

afterEach(() => {
  for (const id of attached.splice(0)) detachConnection(id);
});

describe("dispatcher", () => {
  it("refuses a channel the desktop does not have", async () => {
    const local = new Dispatcher();
    const connection = fakeConnection();
    const frame = await local.call(connection, { t: "call", id: 1, ch: "secret:shell", args: [] });
    expect(frame).toEqual({ t: "ret", id: 1, ok: false, error: "Unknown channel" });
  });

  it("answers a call with what the handler returned", async () => {
    const local = new Dispatcher();
    local.handle(CHANNELS.appInfo, (_event, ...args) => ({ echoed: args }));
    const frame = await local.call(fakeConnection(), { t: "call", id: 2, ch: CHANNELS.appInfo, args: [1, "two"] });
    expect(frame).toEqual({ t: "ret", id: 2, ok: true, value: { echoed: [1, "two"] } });
  });

  it("reports a throwing handler by its message only", async () => {
    const local = new Dispatcher();
    local.handle(CHANNELS.appInfo, () => {
      throw new Error("disk full");
    });
    const frame = await local.call(fakeConnection(), { t: "call", id: 3, ch: CHANNELS.appInfo, args: [] });
    expect(frame).toEqual({ t: "ret", id: 3, ok: false, error: "disk full" });
  });

  it("says when nothing handles a known channel", async () => {
    const local = new Dispatcher();
    const frame = await local.call(fakeConnection(), { t: "call", id: 4, ch: CHANNELS.appInfo, args: [] });
    expect(frame).toMatchObject({ t: "ret", id: 4, ok: false });
  });

  it("delivers fire-and-forget sends to `on` listeners with the sender attached", () => {
    const local = new Dispatcher();
    const seen: unknown[] = [];
    local.on(CHANNELS.milestoneRecord, (event, name) => seen.push([event.sender.id, name]));
    const connection = fakeConnection();
    local.deliver(connection, { t: "send", ch: CHANNELS.milestoneRecord, args: ["first-build"] });
    expect(seen).toEqual([[connection.id, "first-build"]]);
  });

  it("counts calls still running, by channel", async () => {
    const local = new Dispatcher();
    let finish: () => void = () => undefined;
    local.handle(CHANNELS.aiSend, () => new Promise<void>((resolve) => { finish = resolve; }));
    local.handle(CHANNELS.appInfo, () => "quick");
    const turn = local.call(fakeConnection(), { t: "call", id: 5, ch: CHANNELS.aiSend, args: ["build"] });
    await local.call(fakeConnection(), { t: "call", id: 6, ch: CHANNELS.appInfo, args: [] });
    expect(local.inFlight(new Set([CHANNELS.aiSend]))).toBe(1);
    expect(local.inFlight(new Set([CHANNELS.appInfo]))).toBe(0);
    finish();
    await turn;
    expect(local.inFlight(new Set([CHANNELS.aiSend]))).toBe(0);
  });

  it("drops sends on unknown channels without throwing", () => {
    const local = new Dispatcher();
    expect(() => local.deliver(fakeConnection(), { t: "send", ch: "nope", args: [] })).not.toThrow();
  });
});

describe("windows", () => {
  it("broadcasts reach every connected tab as events, and only those", () => {
    const one = fakeConnection();
    const two = fakeConnection();
    attach(one);
    attach(two);
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send(CHANNELS.settingsChanged, { a: 1 });
    expect(one.frames).toEqual([{ t: "evt", ch: CHANNELS.settingsChanged, args: [{ a: 1 }] }]);
    expect(two.frames).toEqual([{ t: "evt", ch: CHANNELS.settingsChanged, args: [{ a: 1 }] }]);
    detachConnection(two.id);
    expect(BrowserWindow.getAllWindows().map((window) => window.id)).toEqual([one.id]);
  });

  it("the focused window is the tab that last reported focus", () => {
    const one = fakeConnection();
    const two = fakeConnection();
    attach(one);
    attach(two);
    expect(BrowserWindow.getFocusedWindow()).toBeNull();
    two.focused = true;
    expect(BrowserWindow.getFocusedWindow()?.id).toBe(two.id);
  });

  it("finds a tab's window from the sender of its message", async () => {
    const connection = fakeConnection();
    attach(connection);
    let found: number | undefined;
    ipcMain.handle(CHANNELS.windowOpenVibe, (event) => {
      found = BrowserWindow.fromWebContents(event.sender)?.id;
      return null;
    });
    await dispatcher.call(connection, { t: "call", id: 9, ch: CHANNELS.windowOpenVibe, args: [] });
    ipcMain.removeHandler(CHANNELS.windowOpenVibe);
    expect(found).toBe(connection.id);
  });
});

describe("dialogs", () => {
  it("an open-folder dialog asks the browser to pick a project", async () => {
    const connection = fakeConnection({ pickFolder: { path: "/home/adcode/projects/snake" } });
    attach(connection);
    const result = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"], title: "Open Folder" });
    expect(connection.asked[0]?.[0]).toBe("pickFolder");
    expect(result).toEqual({ canceled: false, filePaths: ["/home/adcode/projects/snake"] });
  });

  it("a dismissed picker is a cancelled dialog", async () => {
    const connection = fakeConnection({ pickFolder: null });
    attach(connection);
    expect(await dialog.showOpenDialog({ properties: ["openDirectory"] })).toEqual({ canceled: true, filePaths: [] });
  });

  it("with no tab connected, a dialog is cancelled rather than left hanging", async () => {
    expect(await dialog.showOpenDialog({ properties: ["openFile"] })).toEqual({ canceled: true, filePaths: [] });
  });
});

describe("paths and storage", () => {
  it("user data sits under the sandbox home", () => {
    const before = { home: process.env["ADCODE_HOME"], data: process.env["ADCODE_USER_DATA_DIR"] };
    process.env["ADCODE_HOME"] = "/home/adcode";
    delete process.env["ADCODE_USER_DATA_DIR"];
    try {
      expect(app.getPath("userData").replaceAll("\\", "/")).toBe("/home/adcode/.adcode");
      expect(app.getPath("documents").replaceAll("\\", "/")).toBe("/home/adcode");
    } finally {
      if (before.home === undefined) delete process.env["ADCODE_HOME"];
      else process.env["ADCODE_HOME"] = before.home;
      if (before.data !== undefined) process.env["ADCODE_USER_DATA_DIR"] = before.data;
    }
  });

  // The browser host keeps a person's own keys in this browser's storage (browserHost/seal.ts).
  it("sealing round-trips and refuses a value it did not write", () => {
    expect(unsealString(sealString("sk-test-123", "browser"), "browser")).toBe("sk-test-123");
    expect(() => unsealString(Buffer.from("sk-test-123"), "browser")).toThrow();
  });

  it("safeStorage is available only with a seal key, and uses it", () => {
    const before = process.env["ADCODE_SEAL_KEY"];
    delete process.env["ADCODE_SEAL_KEY"];
    expect(safeStorage.isEncryptionAvailable()).toBe(false);
    process.env["ADCODE_SEAL_KEY"] = Buffer.alloc(32, 3).toString("base64");
    try {
      expect(safeStorage.isEncryptionAvailable()).toBe(true);
      expect(safeStorage.decryptString(safeStorage.encryptString("hello"))).toBe("hello");
    } finally {
      if (before === undefined) delete process.env["ADCODE_SEAL_KEY"];
      else process.env["ADCODE_SEAL_KEY"] = before;
    }
  });
});
