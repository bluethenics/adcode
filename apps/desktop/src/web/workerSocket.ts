/**
 * The browser host (src/browserHost/worker.ts) as the WebSocket the page already speaks to.
 *
 * The page's socket client (socket.ts) was written for adcode-host in a cloud computer. The
 * browser host runs the same main process in a Web Worker in this tab and answers the same
 * frames, so the page needs only something with a WebSocket's shape that posts to the worker.
 * One worker lives for the whole tab: a "reconnect" (the client's own retry after a close)
 * opens a new adapter onto that same worker rather than restarting the main process.
 */
import type { WebSocketLike } from "./socket.ts";
import type { PreviewFileSource } from "./previewBridge.ts";
import { PREVIEW_RELOAD, PREVIEW_REQUEST } from "./previewOrigin.ts";

const OPEN = 1;
const CLOSED = 3;

export interface BrowserHostWorker extends PreviewFileSource {
  /** A WebSocket-shaped connection to the worker. */
  open(): WebSocketLike;
  /** Ask the worker to write its files to IndexedDB now (the tab is going away). */
  flush(): void;
}

export function startBrowserHost(url: string): BrowserHostWorker {
  const worker = new Worker(url, { type: "module", name: "adcode-browser-host" });
  let current: (WebSocketLike & { readyState: number }) | null = null;
  // Frames that arrive before the page has opened a connection (the host's "ready") are kept.
  const early: unknown[] = [];
  const reloadListeners: ((root: string) => void)[] = [];
  worker.addEventListener("message", (event: MessageEvent) => {
    // Frames are strings; the preview's "files changed" is the one object the worker posts.
    const data = event.data as { t?: unknown; root?: unknown } | null;
    if (data !== null && typeof data === "object" && data.t === PREVIEW_RELOAD) {
      for (const listener of reloadListeners) listener(typeof data.root === "string" ? data.root : "");
      return;
    }
    if (current === null || current.readyState !== OPEN) {
      early.push(event.data);
      return;
    }
    current.onmessage?.({ data: event.data });
  });
  worker.addEventListener("error", (event) => {
    console.error("[adcode] the browser host stopped", event.message);
    const closing = current;
    current = null;
    if (closing !== null) {
      closing.readyState = CLOSED;
      closing.onclose?.({ code: 1011 });
    }
  });

  return {
    open(): WebSocketLike {
      const socket = {
        readyState: 0,
        onopen: null as (() => void) | null,
        onmessage: null as ((event: { data: unknown }) => void) | null,
        onclose: null as ((event: { code: number }) => void) | null,
        send(text: string): void {
          if (socket.readyState === OPEN) worker.postMessage(text);
        },
        close(code = 1000): void {
          if (socket.readyState === CLOSED) return;
          socket.readyState = CLOSED;
          if (current === socket) current = null;
          queueMicrotask(() => socket.onclose?.({ code }));
        },
      };
      current = socket;
      queueMicrotask(() => {
        if (socket.readyState === CLOSED) return;
        socket.readyState = OPEN;
        socket.onopen?.();
        for (const data of early.splice(0)) socket.onmessage?.({ data });
        // The worker greets each connection, as adcode-host greets each WebSocket.
        worker.postMessage("__hello");
      });
      return socket;
    },
    flush(): void {
      worker.postMessage("__flush");
    },
    preview(path: string, port: MessagePort): void {
      worker.postMessage({ t: PREVIEW_REQUEST, path }, [port]);
    },
    onPreviewReload(listener: (root: string) => void): void {
      reloadListeners.push(listener);
    },
  };
}
