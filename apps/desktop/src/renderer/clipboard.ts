/**
 * The clipboard, through Electron first.
 *
 * `navigator.clipboard` needs a secure context the app's custom protocol does not
 * reliably provide (see `shared/api.ts`), so every renderer copy/paste goes through
 * `window.adcode.clipboard` and only falls back to the web clipboard - then to a
 * hidden textarea - before reporting failure. A copy button that silently fails is
 * a button that trains people not to press buttons.
 */

interface BridgeClipboard {
  writeText?: (value: string) => Promise<void>;
  readText?: () => Promise<string>;
}

function bridge(): BridgeClipboard | null {
  try {
    const adcode = (window as unknown as { adcode?: { clipboard?: BridgeClipboard } }).adcode;
    return adcode?.clipboard ?? null;
  } catch {
    return null;
  }
}

/** Copy text. Resolves true on success, false when every path failed. */
export function copyText(text: string): Promise<boolean> {
  const via = bridge();
  if (via?.writeText) return via.writeText(text).then(() => true, () => webCopy(text));
  return webCopy(text);
}

function webCopy(text: string): Promise<boolean> {
  try {
    const clipboard = navigator.clipboard;
    if (clipboard) return clipboard.writeText(text).then(() => true, () => legacyCopy(text));
  } catch {
    // Fall through to the textarea path below.
  }
  return Promise.resolve(legacyCopy(text));
}

function legacyCopy(text: string): boolean {
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/**
 * Read the clipboard. Resolves the text, or an empty string when unreadable.
 *
 * Reading is gated behind a permission prompt the custom protocol does not
 * satisfy, so the bridge is the only path that works - the web clipboard is a
 * fallback, not a promise.
 */
export function pasteText(): Promise<string> {
  const via = bridge();
  if (via?.readText) return via.readText().then((text) => text, () => webPaste());
  return webPaste();
}

function webPaste(): Promise<string> {
  try {
    const clipboard = navigator.clipboard;
    if (clipboard?.readText) return clipboard.readText().then((text) => text, () => "");
  } catch {
    // Unreadable here; the caller treats "" as "nothing pasted".
  }
  return Promise.resolve("");
}
