import { isWebSurface } from "../surface.ts";

/**
 * Sponsored cards from ADCode's ad partners, Zeekend and Imprezia. On by default from 2.5.1; one switch turns it off.
 *
 * The partners' SDKs never run in this window. They measure what they show, and this window
 * holds `window.adcode`, which reads files and runs commands: no ad script may share it. So the
 * cards live on ADCode's own site, `/sponsored/chat`, in a cross-origin frame sandboxed away
 * from this page. This side only hands the frame the one exchange it may see and sizes it.
 * Which partner fills each card is the site's choice, by the shares set in Admin > Ad networks
 * (2026-11-25), so the split changes with no release; no partner key is in the app.
 *
 * What leaves the machine, and only while `adcode.ads.chatSponsored` is on: the person's
 * message and the reply under which the card appears, to the one partner asked, and a one-way
 * code made from the conversation's id, so that partner can pace one conversation. Nothing else
 * from the project.
 */
export const SPONSORED_ORIGIN = "https://adcode.bluethenics.com";

/**
 * Whether this window may claim the pay for a card it shows (2026-11-24).
 *
 * Only while it is on screen, and on the web only in the tab the person is using: every web tab
 * runs its own copy of the app, so ten open tabs used to claim ten cards for one pair of eyes.
 * The card still shows and still counts for Zeekend; it just earns in one place. The server
 * paces each account as well (services/api networkImpressions.ts), so this is the honest
 * client keeping clear of that limit, not the only thing standing in the way.
 */
export function mayClaimCard(doc: Pick<Document, "visibilityState" | "hasFocus"> | undefined = typeof document === "undefined" ? undefined : document, web = isWebSurface()): boolean {
  if (doc === undefined || doc.visibilityState !== "visible") return false;
  return !web || doc.hasFocus();
}
export const SPONSORED_SETTING = "adcode.ads.chatSponsored";

/** Longest exchange handed over; a reply full of code needs no more to be understood. */
const MAX_CHARS = 4_000;
const MAX_HEIGHT = 640;
/** How long a replaced card takes to fade before it is removed (conversation.css, --duration-exit). */
const LEAVE_MS = 200;

export interface SponsoredExchange {
  readonly request: string;
  readonly response: string;
  /** The conversation's own stored id: the same on every turn and retry of one chat. */
  readonly sessionId: string;
  readonly theme: "light" | "dark";
  /**
   * `notification`: one card, drawn by its partner's SDK. `banner`: the one-line ad box above
   * the message box - Zeekend's picture, headline, disclosure, a line of copy and a button,
   * drawn by the page, or Imprezia's 320x50 banner, drawn by its SDK.
   */
  readonly layout?: "reply" | "notification" | "banner";
  /** Which user message of the conversation this reply answers, for the partner's pacing. A number only. */
  readonly turn?: number;
}

/** The message the frame waits for. Clipped here so an enormous reply never crosses whole. */
export function sponsoredMessage(exchange: SponsoredExchange): { type: "adcode-sponsored"; request: string; response: string; sessionId: string; theme: "light" | "dark"; layout?: "notification" | "banner"; turn?: number } | null {
  const request = exchange.request.trim().slice(0, MAX_CHARS);
  const response = exchange.response.trim().slice(0, MAX_CHARS);
  const sessionId = exchange.sessionId.slice(0, 100);
  if (request === "" || response === "" || sessionId === "") return null;
  const turn = exchange.turn !== undefined && Number.isInteger(exchange.turn) && exchange.turn >= 1 && exchange.turn <= 10_000 ? exchange.turn : undefined;
  const layout = exchange.layout === "notification" || exchange.layout === "banner" ? exchange.layout : undefined;
  return { type: "adcode-sponsored", request, response, sessionId, theme: exchange.theme, ...(layout === undefined ? {} : { layout }), ...(turn === undefined ? {} : { turn }) };
}

/** How often the ad box looks for a finished exchange it has not yet asked a partner about. It never repeats one. */
export const SPONSOR_ROTATE_MS = 30_000;

/**
 * Which exchanges a partner has already been asked about, so that a partner hears each message a
 * person actually sent once, and the turn it reports is the person's own (2026-11-25).
 *
 * Until 2.6.5 the ad box re-asked every 30 seconds about the last exchange - or, before there was
 * one, about a sentence ADCode wrote itself - and counted each ask as a turn. Zeekend's REST
 * documentation defines the turn as the user turn, counting from 1, and a person had sent
 * nothing new. Now a partner is asked only about a finished exchange it has not heard, the turn
 * is how many different exchanges the conversation has had, and nothing is ever asked in a
 * person's name that the person did not write.
 */
export function createSponsorAsks(maxConversations = 50): { claim(sessionId: string, exchange: { readonly request: string; readonly response: string } | null): number | null } {
  const asked = new Map<string, Set<string>>();
  return {
    /** The conversation's user turn for this exchange the first time it is asked about; null for nothing, or a repeat. */
    claim(sessionId, exchange) {
      if (exchange === null || exchange.request.trim() === "" || exchange.response.trim() === "") return null;
      const heard = asked.get(sessionId) ?? new Set<string>();
      const key = `${exchange.request}\u0000${exchange.response}`;
      if (heard.has(key)) return null;
      heard.add(key);
      asked.delete(sessionId);
      asked.set(sessionId, heard);
      const oldest = asked.keys().next().value;
      if (asked.size > maxConversations && oldest !== undefined) asked.delete(oldest);
      return Math.min(10_000, heard.size);
    },
  };
}

/**
 * Keeps a card in view as it arrives, for the frame's `onSize`.
 *
 * The card comes a few seconds after the reply and grows its frame from nothing, and growth
 * below the fold scrolls nothing: someone reading at the bottom of the chat never saw it.
 * Zeekend counts an impression only for a card that is on screen, so those cards were
 * inserted and never seen. While the chat is
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
  let connected = false;
  const onMessage = (event: MessageEvent): void => {
    // A frame the strip has replaced stops listening at the next message from any card, so a
    // box that changes card every half minute does not collect listeners for hours.
    if (frame.isConnected) connected = true;
    else if (connected) { window.removeEventListener("message", onMessage); return; }
    if (event.source !== frame.contentWindow || event.origin !== origin) return;
    const data = event.data as { type?: unknown; height?: unknown } | null;
    if (data?.type === "adcode-sponsored-ready") frame.contentWindow?.postMessage(message, origin);
    else if (data?.type === "adcode-sponsored-size" && typeof data.height === "number" && Number.isFinite(data.height)) {
      frame.style.height = `${Math.max(0, Math.min(MAX_HEIGHT, Math.ceil(data.height)))}px`;
      const measured = data as { left?: unknown; right?: unknown; top?: unknown };
      const whole = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
      onSize?.({ height: data.height, left: whole(measured.left), right: whole(measured.right), top: whole(measured.top) });
      if (data.height > 0) tell("shown");
    } else if (data?.type === "adcode-sponsored-impression") {
      // A partner counted this card on screen: the app claims the person's pay for it. Only the
      // card's id crosses - Zeekend's slot id, or `slot_imp_` and Imprezia's impression uuid -
      // and the phone page has no `window.adcode`, so there it does nothing.
      const slotId = (data as { slotId?: unknown }).slotId;
      if (typeof slotId === "string" && /^slot_[A-Za-z0-9_-]{4,64}$/.test(slotId) && mayClaimCard()) {
        // The page's one-way hashed session id, when it sends one (older pages do not): the server's per-conversation guards read it.
        const sent = (data as { conversationId?: unknown }).conversationId;
        const conversationId = typeof sent === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(sent) ? sent : undefined;
        (globalThis as { adcode?: { ads?: { partnerImpression?: (slot: string, conversationId?: string) => void } } }).adcode?.ads?.partnerImpression?.(slotId, conversationId);
      }
    } else if (data?.type === "adcode-sponsored-empty") {
      window.removeEventListener("message", onMessage);
      frame.remove();
      tell("empty");
    }
  };
  window.addEventListener("message", onMessage);
  return frame;
}

/**
 * The sponsor strip: one card, kept above the composer for as long as the conversation runs.
 *
 * Cards used to sit under each reply and scroll away with it. The strip stays where the
 * person is looking, and it never blinks empty: after each reply a new card is asked for in a
 * frame that takes no room, and only when that card has arrived does the one on show step
 * aside. A reply with no card leaves the last one where it is. So there is a card from the
 * first one onward, and never a gap between two.
 *
 * A waiting frame has no height, so neither partner can count it as seen before it is.
 */
export function createSponsorStrip(origin = SPONSORED_ORIGIN, now: () => number = Date.now): { readonly element: HTMLElement; show(exchange: SponsoredExchange): void; keepFilled(next: () => SponsoredExchange | null, everyMs?: number, onScreen?: () => boolean): () => void; yieldTo(ms: number): void; clear(): void } {
  const element = document.createElement("aside");
  element.className = "chat-sponsor-strip";
  element.setAttribute("aria-label", "Sponsored");
  element.hidden = true;
  let current: HTMLIFrameElement | null = null;
  let waiting: HTMLIFrameElement | null = null;
  /** Until when a direct ADCode card has the floor. */
  let yieldingUntil = 0;
  let yieldTimer: ReturnType<typeof setTimeout> | null = null;
  // The transcript leaves this much room at its foot (conversation.css), so the strip covers nothing.
  if (typeof ResizeObserver === "function") {
    new ResizeObserver(() => {
      element.parentElement?.style.setProperty("--sponsor-strip-height", `${String(element.hidden ? 0 : element.offsetHeight)}px`);
    }).observe(element);
  }
  const strip = {
    element,
    /**
     * Keep a card in the box for as long as it is on screen, a fresh one every `everyMs`:
     * Zeekend is asked at once and then on that beat, not only after a reply, so the box is
     * never empty and never stale. `next` says what to ask for each time (null skips a beat),
     * and nothing is asked while the window is hidden or minimised - an impression only counts
     * for a card somebody can see. Returns the stop.
     */
    keepFilled(next: () => SponsoredExchange | null, everyMs = SPONSOR_ROTATE_MS, onScreen: () => boolean = () => document.visibilityState === "visible") {
      const ask = (): void => {
        if (!onScreen()) return;
        const exchange = next();
        if (exchange !== null) strip.show(exchange);
      };
      ask();
      const timer = setInterval(ask, Math.max(5_000, everyMs));
      const onVisible = (): void => { if (onScreen() && current === null) ask(); };
      document.addEventListener("visibilitychange", onVisible);
      return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
    },
    /**
     * A direct ADCode advertiser's card is on screen: it comes first. The partner's strip
     * steps out of sight for as long as that card shows, and no partner card is asked for in
     * that time - an ADCode advertiser never shares the moment with a partner's ad.
     */
    yieldTo(ms: number) {
      const span = Math.max(0, Math.min(ms, 120_000));
      yieldingUntil = Math.max(yieldingUntil, now() + span);
      element.dataset["yielding"] = "true";
      if (yieldTimer !== null) clearTimeout(yieldTimer);
      yieldTimer = setTimeout(() => { yieldTimer = null; delete element.dataset["yielding"]; }, Math.max(0, yieldingUntil - now()));
    },
    show(exchange: SponsoredExchange) {
      if (now() < yieldingUntil) return;
      // A newer reply replaces a card that was still on its way; the one on show is untouched.
      waiting?.remove();
      const next = sponsoredReplyFrame(exchange, origin, (outcome) => {
        if (waiting !== next) return;
        waiting = null;
        if (outcome !== "shown" || next === null) return;
        // A cross-fade in one place, not a swap: the new card rises in over the old one, which
        // fades and then leaves, so the strip never jumps or blinks between two cards.
        const leaving = current;
        current = next;
        next.dataset["state"] = "in";
        if (leaving !== null) {
          leaving.dataset["state"] = "out";
          setTimeout(() => leaving.remove(), LEAVE_MS);
        }
        element.dataset["filled"] = "true";
      });
      waiting = next;
      if (next === null) return;
      // Eager: a lazy frame at no height, above the fold or not, may never be fetched.
      next.loading = "eager";
      element.hidden = false;
      element.append(next);
    },
    clear() {
      current?.remove();
      waiting?.remove();
      current = null;
      waiting = null;
      element.hidden = true;
      delete element.dataset["filled"];
    },
  };
  return strip;
}
