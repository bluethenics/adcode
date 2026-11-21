/**
 * Whether this renderer is the web version (web.bluethenics.com) rather than the desktop app.
 *
 * The web entry (`src/web/boot.ts`) marks the page before the renderer loads. The few places
 * that behave differently ask this rather than sniffing for Electron, so the desktop's
 * behaviour is the default and the web's is opt-in.
 */
export function isWebSurface(): boolean {
  return typeof document !== "undefined" && document.documentElement.dataset["surface"] === "web";
}

/**
 * Whether this window wears the web version's frame - the icon rail, the sidebar card and the
 * chat tabs (renderer/workbench/webShell.ts).
 *
 * Two windows do, for the same reason: they show Vibe, and Vibe is one product on both. The web
 * version wears it because it has no other chrome to wear; the desktop app's Vibe window wears
 * it because the desktop look and the web look are the same look, and its title bar and status
 * bar are put away by `styles/webFrame.css`. The Code window keeps the desktop chrome.
 *
 * `main.ts` records the answer on <html> before anything is built, and the frame's stylesheet
 * keys every rule on the same attribute, so the DOM, the CSS and this function cannot disagree
 * about which frame a window is wearing.
 */
export function usesWebFrame(): boolean {
  return typeof document !== "undefined" && document.documentElement.dataset["frame"] === "web";
}

export const OPEN_WEB_ACCOUNT_EVENT = "adcode:open-account";
/** The web's Open from GitHub dialog (web/githubRepoPicker.ts); `detail.open` receives the opened folder. */
export const OPEN_FROM_GITHUB_EVENT = "adcode:open-from-github";
export function openWebAccount(section = "overview"): void {
  document.dispatchEvent(new CustomEvent(OPEN_WEB_ACCOUNT_EVENT, { detail: section }));
}

/** Where "Get the desktop app" goes from the web version. */
export const DESKTOP_DOWNLOAD_URL = "https://adcode.bluethenics.com/#download";
