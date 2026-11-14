"use client";

import { useEffect, useRef, useState } from "react";
import { Zeekend, type ZeekendClient, type ZeekendSlot } from "@zeekend/sdk";
import { networksFor, parseNetworks, reportNetworkImpression, SPONSORED_EMBEDDERS, withoutPrices, ZEEKEND_COLOURS, zeekendSessionId, zeekendTransport, type SponsoredNetwork } from "@/lib/sponsoredNetworks";
import "./sponsored.css";

/**
 * One Zeekend card: under an AI reply, in a sponsored notification, or under a reply on the
 * phone.
 *
 * The desktop app (`renderer/ai/sponsoredReply.ts`) and Phone link's page embed this page in a
 * sandboxed frame and hand it one exchange by postMessage. Zeekend's SDK runs here, on ADCode's
 * own origin and never in the editor or the phone page, which hold the person's files and
 * sign-in. Zeekend is ADCode's only ad partner; its publisher key is public by design and comes
 * from `/v1/sponsored/networks`.
 *
 * Only the embedders in SPONSORED_EMBEDDERS may talk to it: messages from any other origin are
 * ignored, and the `frame-ancestors` header keeps other sites from embedding it at all.
 */

/**
 * Where the card appears: `reply` under an AI reply, `notification` in a sponsored
 * notification - both Zeekend's own unit, drawn by its SDK - or `banner`, the one-line ad box
 * above the message box, drawn here (see ZeekendBanner).
 */
type Layout = "reply" | "notification" | "banner";
/** `turn`: which user message of the conversation this is, for Zeekend's pacing; 1 when not sent. */
type Exchange = { request: string; response: string; sessionId: string; theme: "light" | "dark"; layout: Layout; turn: number };
/** The card this page found. */
type Found = { slot: ZeekendSlot; client: ZeekendClient };

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

/** Which Zeekend connection to ask, from this site's API; none if the list cannot be read. */
async function loadNetworks(): Promise<SponsoredNetwork[]> {
  try {
    const response = await fetch("/v1/sponsored/networks", { cache: "no-store" });
    return (response.ok ? parseNetworks(await response.json()) : null) ?? [];
  } catch {
    return [];
  }
}

/** Zeekend's slot for this exchange through its SDK, or null. The answer is complete, so one pass. */
async function askZeekend(network: SponsoredNetwork, exchange: Exchange): Promise<Found | null> {
  const sessionId = await zeekendSessionId(exchange.sessionId);
  const client = Zeekend.client({ publisherKey: network.publisherKey, sessionId, keepPinned: false, transport: zeekendTransport(exchange.turn, fetch, undefined, (slotId) => {
    // Counted for the admin here, and told to the app, which claims the person's payout with its own sign-in.
    reportNetworkImpression(slotId, exchange.layout);
    tell({ type: "adcode-sponsored-impression", slotId });
  }) });
  const { slot } = await client.request({
    placementId: network.placementId,
    context: { type: "conversation", question: exchange.request, answer: exchange.response, conversationId: sessionId },
    dimensions: { maxWidth: 640 },
  });
  return slot === null ? null : { slot, client };
}

/**
 * Outgoing messages say only that the frame is ready, that it found nothing, or how tall
 * the card is: none of the exchange travels this way. So any embedder may hear them, and
 * `*` keeps the page working in an ordinary browser, which cannot parse the editor's
 * `app://` origin as a postMessage target. Incoming messages stay pinned to the embedders.
 */
const tell = (message: Record<string, unknown>): void => window.parent.postMessage(message, "*");

export default function SponsoredChat() {
  const [exchange, setExchange] = useState<Exchange | null>(null);
  const [result, setResult] = useState<Found | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const zeekendMount = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      if (!SPONSORED_EMBEDDERS.includes(event.origin) || event.source !== window.parent) return;
      const next = readExchange(event.data);
      if (next !== null) setExchange((current) => current ?? next);
    };
    window.addEventListener("message", onMessage);
    tell({ type: "adcode-sponsored-ready" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // One card each time: the first Zeekend connection with a card wins.
  useEffect(() => {
    if (exchange === null) return;
    let live = true;
    void (async () => {
      for (const network of networksFor(exchange.layout, await loadNetworks())) {
        if (!live) return;
        let found: Found | null = null;
        try { found = await askZeekend(network, exchange); } catch { found = null; }
        if (found !== null) { if (live) setResult(found); return; }
      }
      if (live) tell({ type: "adcode-sponsored-empty" });
    })();
    return () => { live = false; };
  }, [exchange]);

  // Zeekend's own unit draws the placement and reports its viewable impression and click.
  useEffect(() => {
    const mount = zeekendMount.current;
    if (mount === null || result === null || exchange === null || exchange.layout === "banner") return;
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

  if (exchange === null || result === null) return null;
  return (
    <div ref={box} className="sponsored-chat" data-theme={exchange.theme}>
      {exchange.layout === "banner" ? <ZeekendBanner found={result} /> : <div ref={zeekendMount} />}
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
function ZeekendBanner({ found }: { found: Found }) {
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
