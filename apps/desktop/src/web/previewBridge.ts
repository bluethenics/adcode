/**
 * The ADCode tab's end of the live preview (2026-11-22): a hidden frame of the preview origin.
 *
 * The preview origin's Service Worker (preview/serviceWorker.ts) answers a preview page's
 * requests by asking that frame (preview/bridge.ts), which posts each question here with the
 * worker's reply port. This hands the port to the browser host, which answers on it directly
 * from the files in memory. The other way, the browser host's "files changed" goes to the frame,
 * which reloads the preview pages.
 *
 * Only messages from that frame, from that origin, are taken. A project's own script runs on
 * the preview origin too and could post here; the most it can ask for is a file of the project
 * being previewed, which is what it was served from already.
 */
import { PREVIEW_BRIDGE_PATH, PREVIEW_BRIDGE_READY, PREVIEW_RELOAD, PREVIEW_REQUEST, previewOriginFor } from "./previewOrigin.ts";

export interface PreviewFileSource {
  /** Ask the browser host for a file; it answers on `port`. */
  preview(path: string, port: MessagePort): void;
  /** The browser host's "the previewed folder changed". */
  onPreviewReload(listener: (root: string) => void): void;
}

export interface PreviewBridge {
  /** True once the Service Worker is installed; false when this browser cannot run one. */
  readonly ready: Promise<boolean>;
}

export function mountPreviewBridge(source: PreviewFileSource, appOrigin: string = location.origin): PreviewBridge {
  const previewOrigin = previewOriginFor(appOrigin);
  const frame = document.createElement("iframe");
  frame.className = "web-preview-bridge";
  frame.title = "Preview helper";
  frame.hidden = true;
  frame.tabIndex = -1;
  frame.setAttribute("aria-hidden", "true");
  frame.src = `${previewOrigin}${PREVIEW_BRIDGE_PATH}`;

  let settle: (ok: boolean) => void = () => undefined;
  const ready = new Promise<boolean>((resolve) => { settle = resolve; });

  window.addEventListener("message", (event: MessageEvent) => {
    if (event.origin !== previewOrigin || event.source !== frame.contentWindow) return;
    const data = event.data as { type?: unknown; path?: unknown; error?: unknown } | null;
    if (data === null || typeof data !== "object") return;
    if (data.type === PREVIEW_BRIDGE_READY) {
      if (typeof data.error === "string") console.warn("[adcode] the preview cannot start in this browser:", data.error);
      settle(data.error === undefined);
      return;
    }
    const port = event.ports[0];
    if (data.type === PREVIEW_REQUEST && typeof data.path === "string" && port !== undefined) source.preview(data.path, port);
  });
  source.onPreviewReload((root) => frame.contentWindow?.postMessage({ type: PREVIEW_RELOAD, root }, previewOrigin));

  document.body.append(frame);
  return { ready };
}
