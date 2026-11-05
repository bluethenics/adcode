/**
 * Sponsored cards under an AI reply - Zeekend, then Imprezia. On by default from 2.5.1; one switch turns it off.
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
  /** `notification`: the page asks the SDK for one card. The card is always drawn as the SDK draws it. */
  readonly layout?: "reply" | "notification";
  /** Which user message of the conversation this reply answers, for the partner's pacing. A number only. */
  readonly turn?: number;
}

/** The message the frame waits for. Clipped here so an enormous reply never crosses whole. */
export function sponsoredMessage(exchange: SponsoredExchange): { type: "adcode-sponsored"; request: string; response: string; sessionId: string; theme: "light" | "dark"; layout?: "notification"; turn?: number } | null {
  const request = exchange.request.trim().slice(0, MAX_CHARS);
  const response = exchange.response.trim().slice(0, MAX_CHARS);
  const sessionId = exchange.sessionId.slice(0, 100);
  if (request === "" || response === "" || sessionId === "") return null;
  const turn = exchange.turn !== undefined && Number.isInteger(exchange.turn) && exchange.turn >= 1 && exchange.turn <= 10_000 ? exchange.turn : undefined;
  return { type: "adcode-sponsored", request, response, sessionId, theme: exchange.theme, ...(exchange.layout === "notification" ? { layout: "notification" as const } : {}), ...(turn === undefined ? {} : { turn }) };
}

/**
 * Keeps a card in view as it arrives, for the frame's `onSize`.
 *
 * The card comes a few seconds after the reply and grows its frame from nothing, and growth
 * below the fold scrolls nothing: someone reading at the bottom of the chat never saw it.
 * Both partners count an impression only for a card that is on screen (Imprezia: half of it
 * for a second), so those cards sent "inserted" and never "viewable". While the chat is
 * pinned to the bottom it follows the card in, as it follows streamed text; scrolled up, it
 * stays where the person put it.
 */
export function followSponsoredCard(
  scroller: Pick<HTMLElement, "scrollTop" | "scrollHeight">,
  pinned: () => boolean,
  after?: () => void,
): (size: { height: number }) => void {
  return (size) => {
    if (size.height <= 0 || !pinned()) return;
    scroller.scrollTop = scroller.scrollHeight;
    after?.();
  };
}

/**
 * The frame for one reply, or null when there is nothing to send. It starts at no height and
 * takes the height the page reports; a page that finds no ad says so and the frame goes.
 * `onOutcome` hears, once, whether a card arrived - the partner notification waits on it.
 * `onSize` hears every size report, with where the card sits when the page says (its left and
 * right edges and its top, measured inside the page), so a notification can line up with it.
 */
export function sponsoredReplyFrame(
  exchange: SponsoredExchange,
  origin = SPONSORED_ORIGIN,
  onOutcome?: (outcome: "shown" | "empty") => void,
  onSize?: (size: { height: number; left: number | null; right: number | null; top: number | null }) => void,
): HTMLIFrameElement | null {
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
  let told = false;
  const tell = (outcome: "shown" | "empty"): void => {
    if (told) return;
    told = true;
    onOutcome?.(outcome);
  };
  const onMessage = (event: MessageEvent): void => {
    if (event.source !== frame.contentWindow || event.origin !== origin) return;
    const data = event.data as { type?: unknown; height?: unknown } | null;
    if (data?.type === "adcode-sponsored-ready") frame.contentWindow?.postMessage(message, origin);
    else if (data?.type === "adcode-sponsored-size" && typeof data.height === "number" && Number.isFinite(data.height)) {
      frame.style.height = `${Math.max(0, Math.min(MAX_HEIGHT, Math.ceil(data.height)))}px`;
      const measured = data as { left?: unknown; right?: unknown; top?: unknown };
      const whole = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
      onSize?.({ height: data.height, left: whole(measured.left), right: whole(measured.right), top: whole(measured.top) });
      if (data.height > 0) tell("shown");
    } else if (data?.type === "adcode-sponsored-empty") {
      window.removeEventListener("message", onMessage);
      frame.remove();
      tell("empty");
    }
  };
  window.addEventListener("message", onMessage);
  return frame;
}
