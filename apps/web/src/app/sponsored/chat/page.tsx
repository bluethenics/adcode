"use client";

import { useEffect, useRef, useState } from "react";
import Imprezia, { MonetizedContentWithCards } from "@adimpress/imprezia-sdk";
import { hasCards } from "@adimpress/imprezia-sdk/utils/cardHelpers";
import { Zeekend, type ZeekendClient, type ZeekendSlot } from "@zeekend/sdk";
import {
  IMPREZIA_BANNER_PLACEMENT, IMPREZIA_BANNER_SIZE, IMPREZIA_IMPRESSION_PATH, impreziaCardId, networksFor, parseNetworks, partnerSessionId,
  reportNetworkImpression, slotPosition, SPONSORED_EMBEDDERS, watchImpreziaImpressions, withDeadline, withoutPrices, ZEEKEND_COLOURS, zeekendTransport,
  type Layout, type SponsoredNetwork,
} from "@/lib/sponsoredNetworks";
import { admitExchange } from "@/lib/sponsoredAsks";
import "./sponsored.css";

/**
 * One partner card: in the ad box above the chat's message box, in a sponsored notification,
 * under an AI reply, or on the phone.
 *
 * The desktop app (`renderer/ai/sponsoredReply.ts`), the web version and Phone link's page
 * embed this page in a sandboxed frame and hand it one exchange by postMessage. The partners'
 * SDKs run here, on ADCode's own origin and never in the editor or the phone page, which hold
 * the person's files and sign-in.
 *
 * Two partners fill the cards (2026-11-25): Zeekend and Imprezia, each slot going to one of
 * them by the shares set in Admin > Ad networks (`/v1/sponsored/networks`). The one picked is
 * asked first; with no card it hands the slot to the next, so a card shows as often as with
 * one partner while the requests are divided between them. Each partner's own SDK draws and
 * measures its card. Zeekend's publisher key is public by design; Imprezia's calls go through
 * this site's `/v1/imprezia` relay, which adds its key.
 *
 * Only the embedders in SPONSORED_EMBEDDERS may talk to it: messages from any other origin are
 * ignored, and the `frame-ancestors` header keeps other sites from embedding it at all.
 */

/** `turn`: which card of the conversation this is, for the split and Zeekend's pacing; 1 when not sent. */
type Exchange = { request: string; response: string; sessionId: string; theme: "light" | "dark"; layout: Layout; turn: number };
/** The card this page found, from whichever partner had one. */
type Found =
  | { network: "zeekend"; slot: ZeekendSlot; client: ZeekendClient }
  | { network: "imprezia"; monetized: Monetized }
  /** Imprezia's 320x50 banner, already drawn by its SDK into `slot`. */
  | { network: "imprezia"; banner: HTMLElement };
type Monetized = Awaited<ReturnType<typeof Imprezia.monetize>>;

/*
 * How long each partner may take. A sponsored notification gives up on a card after 15 s
 * (renderer notifications.ts), so the partner asked first gets most of the time and a backup
 * still gets the rest; an answer that arrives after its time is dropped, never drawn.
 */
const ATTEMPT_MS = 8_000;
const TOTAL_MS = 13_000;

function readExchange(data: unknown): Exchange | null {
  const value = data as Partial<Exchange> & { type?: unknown } | null;
  if (value?.type !== "adcode-sponsored") return null;
  const { request, response, sessionId, theme } = value;
  if (typeof request !== "string" || typeof response !== "string" || typeof sessionId !== "string") return null;
  if (request.length === 0 || response.length === 0 || sessionId.length === 0 || sessionId.length > 100) return null;
  const asked = (data as { layout?: unknown }).layout;
  const layout: Layout = asked === "notification" || asked === "banner" ? asked : "reply";
  const sent = (data as { turn?: unknown }).turn;
  const turn = typeof sent === "number" && Number.isInteger(sent) && sent >= 1 && sent <= 10_000 ? sent : 1;
  return { request: request.slice(0, 4_000), response: response.slice(0, 4_000), sessionId, theme: theme === "light" ? "light" : "dark", layout, turn };
}

/** Which partners to ask, from this site's API; none if the list cannot be read. */
async function loadNetworks(): Promise<SponsoredNetwork[]> {
  try {
    const response = await fetch("/v1/sponsored/networks", { cache: "no-store" });
    return (response.ok ? parseNetworks(await response.json()) : null) ?? [];
  } catch {
    return [];
  }
}

/**
 * Outgoing messages say only that the frame is ready, that it found nothing, how tall the card
 * is, or which card a partner counted: none of the exchange travels this way. So any embedder
 * may hear them, and `*` keeps the page working in an ordinary browser, which cannot parse the
 * editor's `app://` origin as a postMessage target. Incoming messages stay pinned to the embedders.
 */
const tell = (message: Record<string, unknown>): void => window.parent.postMessage(message, "*");

/** A partner counted this card on screen: count it for the admin, and tell the app, which claims the person's pay with its own sign-in. */
function counted(network: "zeekend" | "imprezia", slotId: string, layout: Layout, conversationId?: string): void {
  reportNetworkImpression(slotId, layout, fetch, "", network);
  // The one-way partner session id, never the chat's own id: the server counts a conversation's cards by it.
  const conversation = conversationId !== undefined && /^[A-Za-z0-9_.:-]{1,128}$/.test(conversationId) ? { conversationId } : {};
  tell({ type: "adcode-sponsored-impression", slotId, network, ...conversation });
}

/** Imprezia's hashed session id for this page's exchange; its impressions are heard before the SDK is asked, so it is read here when they arrive. */
let impreziaSession: string | undefined;

/** Zeekend's slot for this exchange through its SDK, or null. The answer is complete, so one pass. */
async function askZeekend(network: Extract<SponsoredNetwork, { id: "zeekend" }>, exchange: Exchange): Promise<Found | null> {
  const sessionId = await partnerSessionId("zeekend", exchange.sessionId);
  const client = Zeekend.client({ publisherKey: network.publisherKey, sessionId, keepPinned: false, transport: zeekendTransport(exchange.turn, fetch, undefined, (slotId) => counted("zeekend", slotId, exchange.layout, sessionId)) });
  const { slot } = await client.request({
    placementId: network.placementId,
    context: { type: "conversation", question: exchange.request, answer: exchange.response, conversationId: sessionId },
    dimensions: { maxWidth: 640 },
  });
  return slot === null ? null : { network: "zeekend", slot, client };
}

/** Imprezia's SDK, set up once per page, pointed at this site's relay, with its billed impressions heard. */
let impreziaReady = false;
function startImprezia(layout: Layout): void {
  if (impreziaReady) return;
  impreziaReady = true;
  const origin = window.location.origin;
  // Heard before the SDK can send anything, so no impression goes by unclaimed.
  watchImpreziaImpressions(window, `${origin}${IMPREZIA_IMPRESSION_PATH}`, (uuid) => {
    const slotId = impreziaCardId(uuid);
    if (slotId !== null) counted("imprezia", slotId, layout, impreziaSession);
  });
  Imprezia.init({
    apiKey: "proxy", // the real key is added by the relay, never sent to the browser
    endpoint: `${origin}/v1/imprezia`,
    impressionEndpoint: `${origin}${IMPREZIA_IMPRESSION_PATH}`,
  });
}

/**
 * Imprezia's card for this exchange, or null. In the ad box, its 320x50 banner - the unit
 * Imprezia makes for a slot above a chat - drawn by its SDK into a holder of its own, which is
 * thrown away if the banner comes too late or not at all, so a late banner never appears beside
 * another partner's card and never counts. With no banner, or anywhere else, one chat card for
 * the exchange.
 */
async function askImprezia(network: Extract<SponsoredNetwork, { id: "imprezia" }>, exchange: Exchange, holder: HTMLElement | null, ms: number): Promise<Found | null> {
  startImprezia(exchange.layout);
  const sessionId = await partnerSessionId("imprezia", exchange.sessionId);
  impreziaSession = sessionId;
  const started = Date.now();
  if (exchange.layout === "banner" && holder !== null) {
    const slot = document.createElement("div");
    slot.id = `imprezia-banner-${exchange.turn}-${Date.now().toString(36)}`;
    slot.className = "sponsored-imprezia-banner";
    holder.append(slot);
    // Reported as the ad box, apart from the chat card's placement label, so Imprezia's reports keep the two units separate.
    const shown = await withDeadline(Imprezia.display(slot.id, { banner_slot_size: IMPREZIA_BANNER_SIZE, placement: IMPREZIA_BANNER_PLACEMENT, sessionId }), Math.min(IMPREZIA_BANNER_MS, Math.floor(ms / 2)));
    if (shown === true) return { network: "imprezia", banner: slot };
    slot.remove();
  }
  /*
   * A chat card for the same reply: the card under a reply, or - when the banner had no ad
   * (2026-11-25: Imprezia's 320x50 unit filled none of the first live asks) - in the ad box,
   * taller than the banner. Still one slot and one finished reply, never a second one.
   */
  const left = ms - (Date.now() - started);
  if (left < 1_000) return null;
  const monetized = await withDeadline(Imprezia.monetize({ request: exchange.request, response: exchange.response, sessionId, maxCards: 1, ...(network.placementId ? { placementId: network.placementId } : {}) }), left);
  return monetized !== null && hasCards(monetized) ? { network: "imprezia", monetized } : null;
}

/** How long Imprezia's banner may take before its chat card is asked for instead. */
const IMPREZIA_BANNER_MS = 4_000;

export default function SponsoredChat() {
  const [exchange, setExchange] = useState<Exchange | null>(null);
  const [result, setResult] = useState<Found | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const zeekendMount = useRef<HTMLDivElement>(null);
  const impreziaHolder = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      if (!SPONSORED_EMBEDDERS.includes(event.origin) || event.source !== window.parent) return;
      const next = readExchange(event.data);
      if (next === null || handled) return;
      handled = true;
      // A partner hears a message a person sent, once (lib/sponsoredAsks.ts). Installed versions
      // 2.6.1 to 2.6.5 resend one every 30 s, and one sends sentences ADCode wrote; neither goes on.
      const turn = admitExchange(next.sessionId, next.request, next.response);
      if (turn === null) { tell({ type: "adcode-sponsored-empty" }); return; }
      setExchange((current) => current ?? { ...next, turn });
    };
    let handled = false;
    window.addEventListener("message", onMessage);
    tell({ type: "adcode-sponsored-ready" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // One card each time: the partner this slot went to first, then the others until one has a card.
  useEffect(() => {
    if (exchange === null) return;
    let live = true;
    void (async () => {
      const started = Date.now();
      const order = networksFor(exchange.layout, await loadNetworks(), slotPosition(exchange.sessionId, exchange.turn));
      for (const network of order) {
        const left = TOTAL_MS - (Date.now() - started);
        if (!live || left <= 0) break;
        const ms = Math.min(ATTEMPT_MS, left);
        const found = network.id === "zeekend"
          ? await withDeadline(askZeekend(network, exchange), ms)
          : await askImprezia(network, exchange, impreziaHolder.current, ms).catch(() => null);
        if (found !== null) { if (live) setResult(found); return; }
      }
      if (live) tell({ type: "adcode-sponsored-empty" });
    })();
    return () => { live = false; };
  }, [exchange]);

  // Zeekend's own unit draws the placement and reports its viewable impression and click.
  useEffect(() => {
    const mount = zeekendMount.current;
    if (mount === null || result?.network !== "zeekend" || exchange === null || exchange.layout === "banner") return;
    // Drawn by Zeekend's own unit, minus the price (see withoutPrices): the card names the product, the page it opens prices it.
    const unit = result.client.render(withoutPrices(result.slot), mount, { theme: { ...ZEEKEND_COLOURS[exchange.theme] } });
    return () => { unit?.remove(); };
  }, [result, exchange]);

  // The frame takes this page's height, so a card never scrolls inside the chat.
  useEffect(() => {
    const element = box.current;
    if (element === null || result === null) return;
    // Also where the SDK's card sits in this page - measured, never changed - so a notification
    // can fit itself to the card instead of drawing a box around it.
    const report = (): void => {
      const page = element.getBoundingClientRect();
      let left = Number.POSITIVE_INFINITY;
      let right = 0;
      let top = Number.POSITIVE_INFINITY;
      for (const node of element.querySelectorAll("*")) {
        const rect = node.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        left = Math.min(left, rect.left - page.left);
        right = Math.max(right, rect.right - page.left);
        top = Math.min(top, rect.top - page.top);
      }
      const edge = (value: number): number => (Number.isFinite(value) ? Math.round(value) : 0);
      tell({ type: "adcode-sponsored-size", height: page.height, left: edge(left), right: edge(right), top: edge(top) });
    };
    const observer = new ResizeObserver(report);
    observer.observe(element);
    report();
    return () => observer.disconnect();
  }, [result]);

  if (exchange === null) return null;
  // Before a card is found the page is empty and its frame has no height: nothing can be seen,
  // so nothing can be counted. Imprezia's banner holder is there from the start because its SDK
  // draws into an element that must already be on the page.
  return (
    <div ref={box} className="sponsored-chat" data-theme={exchange.theme} data-layout={exchange.layout} data-network={result?.network}>
      {exchange.layout === "banner" && <div ref={impreziaHolder} className="sponsored-imprezia-holder" />}
      {result?.network === "zeekend" && (exchange.layout === "banner" ? <ZeekendBanner found={result} /> : <div ref={zeekendMount} />)}
      {result?.network === "imprezia" && "monetized" in result && (
        <MonetizedContentWithCards
          response={result.monetized}
          theme={exchange.theme}
          // The reply is already in the chat; only the sponsored card is drawn here.
          hideResponseContainer
        />
      )}
    </div>
  );
}

/**
 * The ad box above the message box: the product's picture, its headline with Zeekend's own
 * disclosure beside it, one line of copy and a button, in one tinted box.
 *
 * Zeekend allows custom rendering on two conditions, both kept: the link is the slot's
 * `clickUrl` (never `url`), and `slot.disclosure` stays visible. Its measurement is kept too:
 * an impression only once half the box has been on screen for a second - the frame's
 * visibility in the editor's window, which an observer here sees - and a click as it opens.
 * No price, as everywhere else (see withoutPrices).
 */
function ZeekendBanner({ found }: { found: Extract<Found, { network: "zeekend" }> }) {
  const slot = withoutPrices(found.slot) as BannerSlot;
  const link = useRef<HTMLAnchorElement>(null);
  const [imageOk, setImageOk] = useState(true);

  useEffect(() => {
    const element = link.current;
    if (element === null || typeof IntersectionObserver !== "function") return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const observer = new IntersectionObserver((entries) => {
      const seen = entries.some((entry) => entry.intersectionRatio >= 0.5);
      if (seen && timer === null) timer = setTimeout(() => { void found.client.impression(found.slot); observer.disconnect(); }, 1_000);
      if (!seen && timer !== null) { clearTimeout(timer); timer = null; }
    }, { threshold: [0, 0.5, 1] });
    observer.observe(element);
    return () => { observer.disconnect(); if (timer !== null) clearTimeout(timer); };
  }, [found]);

  const href = typeof slot.clickUrl === "string" && slot.clickUrl.startsWith("https://") ? slot.clickUrl : null;
  if (href === null) return null;
  const image = typeof slot.image === "string" && slot.image.startsWith("https://") && imageOk ? slot.image : null;
  const headline = typeof slot.headline === "string" ? slot.headline : typeof slot.advertiser === "string" ? slot.advertiser : "";
  const body = typeof slot.body === "string" ? slot.body : "";
  const cta = typeof slot.cta === "string" && slot.cta.trim() !== "" ? slot.cta.trim() : "Shop";
  const disclosure = typeof slot.disclosure === "string" && slot.disclosure.trim() !== "" ? slot.disclosure.trim() : "Sponsored";

  return (
    <a
      ref={link}
      className="sponsored-banner"
      href={href}
      target="_blank"
      rel="noopener noreferrer sponsored"
      onClick={() => { void found.client.click(found.slot); }}
    >
      {image !== null && (
        // eslint-disable-next-line @next/next/no-img-element -- an advertiser's https image, shown as sent
        <img className="sponsored-banner-image" src={image} alt="" referrerPolicy="no-referrer" onError={() => setImageOk(false)} />
      )}
      <span className="sponsored-banner-text">
        <span className="sponsored-banner-title">
          <span className="sponsored-banner-headline">{headline}</span>
          <span className="sponsored-banner-disclosure">{disclosure}</span>
        </span>
        {body !== "" && <span className="sponsored-banner-body">{body}</span>}
      </span>
      <span className="sponsored-banner-cta">{cta}</span>
    </a>
  );
}

type BannerSlot = ZeekendSlot & { headline?: unknown; body?: unknown; image?: unknown; cta?: unknown; clickUrl?: unknown; advertiser?: unknown };
