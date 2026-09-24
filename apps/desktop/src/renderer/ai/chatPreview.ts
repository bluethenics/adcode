import type { PreviewStatus } from "../../shared/api.ts";

export function localPreviewUrl(value: string | null): string | null {
  if (value === null) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

/** One live card per conversation. URLs come from the preview service, never Markdown. */
export function createChatPreview(host: HTMLElement) {
  const element = document.createElement("section");
  element.className = "chat-live-preview";
  element.setAttribute("aria-label", "Live app preview");
  const header = document.createElement("div");
  header.className = "chat-live-preview-header";
  const title = document.createElement("strong");
  title.textContent = "Live preview";
  const address = document.createElement("span");
  address.className = "chat-live-preview-address";
  const message = document.createElement("p");
  message.className = "chat-live-preview-status";
  message.setAttribute("role", "status");
  const frame = document.createElement("iframe");
  frame.title = "Your running app";
  frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups");
  frame.referrerPolicy = "no-referrer";
  frame.hidden = true;
  const note = document.createElement("p");
  note.className = "chat-live-preview-note";
  note.textContent = "Shows saved files. Apply proposed changes to see them here.";
  let root: string | null = null;
  let generation = 0;
  let visible = false;
  let currentUrl: string | null = null;
  let busy = false;
  function button(label: string, action: () => void) {
    const control = document.createElement("button");
    control.type = "button";
    control.className = "ghost-button";
    control.textContent = label;
    control.addEventListener("click", action);
    return control;
  }
  const reload = button("Reload", () => { if (currentUrl) frame.src = currentUrl; });
  const external = button("Open in browser", () => { void window.adcode.preview.openExternal().catch(showError); });
  const retry = button("Start server", () => { void start(); });
  const stop = button("Stop server", () => { void window.adcode.preview.stop().then(paint).catch(showError); });
  const close = button("Close preview", clear);
  header.append(title, address, reload, external, stop, close);
  element.append(header, message, retry, frame, note);
  function showError(error: unknown) {
    message.textContent = error instanceof Error ? error.message : "Could not open the live preview.";
    message.hidden = false;
  }
  function clear() {
    generation++;
    visible = false;
    busy = false;
    currentUrl = null;
    frame.removeAttribute("src");
    frame.hidden = true;
    element.remove();
  }
  function paint(status: PreviewStatus) {
    currentUrl = status.running ? localPreviewUrl(status.url) : null;
    address.textContent = currentUrl ?? status.label ?? "Local server";
    address.title = address.textContent;
    reload.disabled = external.disabled = currentUrl === null;
    stop.disabled = !status.running && !status.starting;
    retry.hidden = currentUrl !== null || status.starting;
    retry.disabled = busy;
    message.textContent = status.error ?? (status.starting ? "Starting your app…" : status.running && !currentUrl ? "The server did not provide a valid local address." : "The preview server is stopped.");
    message.hidden = currentUrl !== null;
    frame.hidden = currentUrl === null;
    if (currentUrl && frame.getAttribute("src") !== currentUrl) frame.src = currentUrl;
    else if (!currentUrl) frame.removeAttribute("src");
  }
  function show(status: PreviewStatus) {
    root = status.root;
    visible = true;
    if (!element.isConnected) host.append(element);
    paint(status);
  }
  async function start() {
    if (busy) return;
    const version = generation;
    busy = true;
    retry.disabled = true;
    try {
      const existing = await window.adcode.preview.status();
      if (version !== generation) return;
      show(existing);
      if (!existing.running && !existing.starting) {
        message.textContent = "Starting your app…";
        const status = await window.adcode.preview.start();
        if (version === generation) show(status);
      }
    } catch (error) { if (version === generation) showError(error); }
    finally { if (version === generation) { busy = false; retry.disabled = false; } }
  }
  window.adcode.preview.onChange(status => {
    if (!visible || !element.isConnected) return;
    if (root !== null && status.root !== null && status.root !== root) { clear(); return; }
    paint(status);
  });
  return { show, start, clear };
}
