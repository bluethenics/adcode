/**
 * Sponsored cards under an AI reply - Imprezia's chat SDK, opt in only.
 *
 * The SDK never runs in this window. It needs advertisers' measurement scripts, and this
 * window holds `window.adcode`, which reads files and runs commands: no ad script may share
 * it. So the cards live on ADCode's own site, `/sponsored/chat`, in a cross-origin frame
 * sandboxed away from this page. This side only hands the frame the one exchange it may see
 * and sizes it; the site's `/v1/imprezia` relay adds the key, so no key is in the app.
 *
 * What leaves the machine, and only while `adcode.ads.chatSponsored` is on: the person's
 * message and the reply under which the card appears, and the conversation's id, so Imprezia
 * can keep one conversation together. Nothing else from the project.
 */
export const SPONSORED_ORIGIN = "https://adcode.bluethenics.com";
export const SPONSORED_SETTING = "adcode.ads.chatSponsored";

/** Longest exchange handed over; a reply full of code needs no more to be understood. */
const MAX_CHARS = 4_000;
const MAX_HEIGHT = 640;

export interface SponsoredExchange {
  readonly request: string;
  readonly response: string;
  /** The conversation's own stored id: the same on every turn and retry of one chat. */
  readonly sessionId: string;
  readonly theme: "light" | "dark";
}

/** The message the frame waits for. Clipped here so an enormous reply never crosses whole. */
export function sponsoredMessage(exchange: SponsoredExchange): { type: "adcode-sponsored"; request: string; response: string; sessionId: string; theme: "light" | "dark" } | null {
  const request = exchange.request.trim().slice(0, MAX_CHARS);
  const response = exchange.response.trim().slice(0, MAX_CHARS);
  const sessionId = exchange.sessionId.slice(0, 100);
  if (request === "" || response === "" || sessionId === "") return null;
  return { type: "adcode-sponsored", request, response, sessionId, theme: exchange.theme };
}

/**
 * The frame for one reply, or null when there is nothing to send. It starts at no height and
 * takes the height the page reports; a page that finds no ad says so and the frame goes.
 */
export function sponsoredReplyFrame(exchange: SponsoredExchange, origin = SPONSORED_ORIGIN): HTMLIFrameElement | null {
  const message = sponsoredMessage(exchange);
  if (message === null) return null;
  const frame = document.createElement("iframe");
  frame.className = "chat-sponsored-frame";
  frame.title = "Sponsored";
  frame.src = `${origin}/sponsored/chat`;
  // Scripts for the SDK, its own origin for its relay, pop-ups so a card opens in the browser.
  // Not top navigation, not forms, not the parent: the frame cannot reach this window.
  frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox");
  frame.referrerPolicy = "no-referrer";
  frame.loading = "lazy";
  frame.style.height = "0px";
  const onMessage = (event: MessageEvent): void => {
    if (event.source !== frame.contentWindow || event.origin !== origin) return;
    const data = event.data as { type?: unknown; height?: unknown } | null;
    if (data?.type === "adcode-sponsored-ready") frame.contentWindow?.postMessage(message, origin);
    else if (data?.type === "adcode-sponsored-size" && typeof data.height === "number" && Number.isFinite(data.height)) {
      frame.style.height = `${Math.max(0, Math.min(MAX_HEIGHT, Math.ceil(data.height)))}px`;
    } else if (data?.type === "adcode-sponsored-empty") {
      window.removeEventListener("message", onMessage);
      frame.remove();
    }
  };
  window.addEventListener("message", onMessage);
  return frame;
}
