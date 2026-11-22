/**
 * The web version's main process, in a Web Worker in the person's own tab (2026-11-21).
 *
 * The web used to give each person a cloud computer running adcode-host. It now runs the same
 * main-process code here instead: Node's file system is memory written through to IndexedDB
 * (shims/vfs.ts), Electron is the cloud host's own stand-in (host/electronShim.ts), and the page
 * talks to this worker with exactly the frames it sent the cloud host over a WebSocket. So the
 * chat, models, helpers, plans, usage and the rest are the desktop's own code, and anything that
 * needs a real computer - a terminal, running a command - fails the way a missing program fails.
 *
 * Projects come from GitHub (githubProjects.ts) and changes go back to it as a pull request.
 */
import "./shims/globals.ts";
import { flushFileSystem, loadFileSystem, mkdirSync } from "./shims/vfs.ts";
import { decodeFrame, encodeFrame, type AskKind, type ServerFrame } from "../web/wire.ts";

import { PREVIEW_RELOAD, PREVIEW_REQUEST } from "../web/previewOrigin.ts";

declare const self: { postMessage(message: unknown, transfer?: Transferable[]): void; onmessage: ((event: { data: unknown; ports?: readonly MessagePort[] }) => void) | null };

const ASK_TIMEOUT_MS = 10 * 60_000;
const queued: string[] = [];
let deliver: ((text: string) => void) | null = null;
let filesLoaded: () => void = () => undefined;
const loaded = new Promise<void>((resolve) => { filesLoaded = resolve; });
self.onmessage = (event) => {
  // A file for the live preview, asked by the preview origin's Service Worker through the page
  // (web/previewBridge.ts). The answer goes back on the port it came with, never as a frame.
  const data = event.data as { t?: unknown; path?: unknown } | null;
  const port = event.ports?.[0];
  if (data !== null && typeof data === "object" && data.t === PREVIEW_REQUEST && typeof data.path === "string" && port !== undefined) {
    const path = data.path;
    void loaded
      .then(() => import("./liveServer.ts"))
      .then(({ answerPreviewRequest }) => {
        const reply = answerPreviewRequest(path);
        port.postMessage(reply, [reply.body.buffer as ArrayBuffer]);
      })
      .catch((error: unknown) => port.postMessage({ status: 500, contentType: "text/plain; charset=utf-8", body: new TextEncoder().encode(String(error)), active: true }))
      .finally(() => port.close());
    return;
  }
  if (typeof event.data !== "string") return;
  if (event.data === "__flush") {
    void flushFileSystem();
    return;
  }
  if (deliver === null) queued.push(event.data);
  else deliver(event.data);
};

await loadFileSystem();
for (const folder of ["/home/adcode/.adcode", "/home/adcode/projects", "/tmp"]) mkdirSync(folder, { recursive: true });

filesLoaded();
// The preview's "files changed": to the page, which tells the preview origin's bridge.
(await import("./liveServer.ts")).setPreviewReloadSink((root) => self.postMessage({ t: PREVIEW_RELOAD, root }));

const host = await import("./hostMain.ts");
const { attachConnection, dispatcher } = await import("../host/electronShim.ts");

const send = (frame: ServerFrame): void => self.postMessage(encodeFrame(frame));
const pendingAsks = new Map<number, { resolve: (value: unknown) => void; timer: ReturnType<typeof setTimeout> }>();
let nextAskId = 1;
const connection = {
  id: 1,
  focused: true,
  send,
  ask: (kind: AskKind, payload: unknown) => new Promise<unknown>((resolve) => {
    const askId = nextAskId++;
    const timer = setTimeout(() => {
      pendingAsks.delete(askId);
      resolve(null);
    }, ASK_TIMEOUT_MS);
    pendingAsks.set(askId, { resolve, timer });
    send({ t: "ask", id: askId, kind, payload });
  }),
};
attachConnection(connection);

deliver = (text: string): void => {
  // Each connection the page opens is greeted, as adcode-host greets each WebSocket.
  if (text === "__hello") {
    send({ t: "ready", host: host.hello() });
    return;
  }
  const frame = decodeFrame(text);
  if (frame === null) return;
  switch (frame.t) {
    case "call":
      void dispatcher.call(connection, frame).then(send);
      return;
    case "send":
      dispatcher.deliver(connection, frame);
      return;
    case "answer": {
      const pending = pendingAsks.get(frame.id);
      if (pending === undefined) return;
      pendingAsks.delete(frame.id);
      clearTimeout(pending.timer);
      pending.resolve(frame.ok ? frame.value ?? null : null);
      return;
    }
    case "auth":
      host.account.accept(frame.token);
      return;
    case "focus":
      connection.focused = frame.focused;
      host.onFocusChange(frame.focused);
      send({ t: "evt", ch: "window:focus", args: [frame.focused] });
      return;
    case "op": {
      const operation = Object.hasOwn(host.ops, frame.op) ? host.ops[frame.op] : undefined;
      if (operation === undefined) {
        send({ t: "opRet", id: frame.id, ok: false, error: "Unknown operation" });
        return;
      }
      void operation(...frame.args)
        .then((value) => send({ t: "opRet", id: frame.id, ok: true, value }))
        .catch((error: unknown) => send({ t: "opRet", id: frame.id, ok: false, error: error instanceof Error ? error.message : "Something went wrong" }));
      return;
    }
    case "previewUrl":
      send({ t: "previewUrl", id: frame.id, url: frame.url });
      return;
    default:
      return;
  }
};
for (const text of queued.splice(0)) deliver(text);
