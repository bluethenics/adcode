"use client";

import { useEffect, useRef, useState } from "react";
import Imprezia, { MonetizedContentWithCards } from "@adimpress/imprezia-sdk";
import { hasCards } from "@adimpress/imprezia-sdk/utils/cardHelpers";
import { Zeekend, type ZeekendClient, type ZeekendSlot } from "@zeekend/sdk";
import { networksFor, parseNetworks, withoutPrices, ZEEKEND_COLOURS, zeekendSessionId, zeekendTransport, type SponsoredNetwork } from "@/lib/sponsoredNetworks";
import "./sponsored.css";

/**
 * Sponsored cards under one AI reply - the opt-in `adcode.ads.chatSponsored` setting.
 *
 * The desktop app embeds this page in a sandboxed frame (`renderer/ai/sponsoredReply.ts`) and
 * hands it one exchange by postMessage. The ad partners' SDKs run here, on ADCode's own origin
 * and never in the editor: their measurement scripts load in this page only. Zeekend is asked
 * first and Imprezia fills what it leaves (`/v1/sponsored/networks`), one card per reply, each
 * drawn and measured by its own SDK. Imprezia's calls go through this site's `/v1/imprezia`
 * relay, which adds its key; Zeekend's publisher key is public by design.
 *
 * Only the desktop window may talk to it: messages from any other origin are ignored, and
 * `frame-ancestors app://adcode` keeps other sites from embedding it at all.
 */
const EMBEDDER = "app://adcode";

/**
 * Where the card appears: `reply` under an AI reply, `notification` in a partner notification,
 * which asks for one card. Either way the card is the SDK's, exactly as it draws it: Imprezia
 * asks that it is not restyled, because the SDK handles many formats and edits can break them.
 */
type Layout = "reply" | "notification";
/** `turn`: which user message of the conversation this is, for Zeekend's pacing; 1 when not sent. */
type Exchange = { request: string; response: string; sessionId: string; theme: "light" | "dark"; layout: Layout; turn: number };
/** The card this page found, from whichever partner had one. */
type Found = { network: "imprezia"; monetized: Monetized } | { network: "zeekend"; slot: ZeekendSlot; client: ZeekendClient };
type Monetized = Awaited<ReturnType<typeof Imprezia.monetize>>;

function readExchange(data: unknown): Exchange | null {
  const value = data as Partial<Exchange> & { type?: unknown } | null;
  if (value?.type !== "adcode-sponsored") return null;
  const { request, response, sessionId, theme } = value;
  if (typeof request !== "string" || typeof response !== "string" || typeof sessionId !== "string") return null;
  if (request.length === 0 || response.length === 0 || sessionId.length === 0 || sessionId.length > 100) return null;
  const layout: Layout = (data as { layout?: unknown }).layout === "notification" ? "notification" : "reply";
  const sent = (data as { turn?: unknown }).turn;
  const turn = typeof sent === "number" && Number.isInteger(sent) && sent >= 1 && sent <= 10_000 ? sent : 1;
  return { request: request.slice(0, 4_000), response: response.slice(0, 4_000), sessionId, theme: theme === "light" ? "light" : "dark", layout, turn };
}

/** Which partners to ask, from this site's API; Imprezia alone if the list cannot be read. */
async function loadNetworks(): Promise<SponsoredNetwork[]> {
  try {
    const response = await fetch("/v1/sponsored/networks", { cache: "no-store" });
    return (response.ok ? parseNetworks(await response.json()) : null) ?? [{ id: "imprezia" }];
  } catch {
    return [{ id: "imprezia" }];
  }
}

/** Zeekend's slot for this exchange through its SDK, or null. The answer is complete, so one pass. */
async function askZeekend(network: Extract<SponsoredNetwork, { id: "zeekend" }>, exchange: Exchange): Promise<Found | null> {
  const sessionId = await zeekendSessionId(exchange.sessionId);
  const client = Zeekend.client({ publisherKey: network.publisherKey, sessionId, keepPinned: false, transport: zeekendTransport(exchange.turn) });
  const { slot } = await client.request({
    placementId: network.placementId,
    context: { type: "conversation", question: exchange.request, answer: exchange.response, conversationId: sessionId },
    dimensions: { maxWidth: 640 },
  });
  return slot === null ? null : { network: "zeekend", slot, client };
}

async function askImprezia(exchange: Exchange): Promise<Found | null> {
  const monetized = await Imprezia.monetize({ request: exchange.request, response: exchange.response, sessionId: exchange.sessionId, ...(exchange.layout === "notification" ? { maxCards: 1 } : {}) });
  return hasCards(monetized) ? { network: "imprezia", monetized } : null;
}


/**
 * Outgoing messages say only that the frame is ready, that it found nothing, or how tall
 * the card is: none of the exchange travels this way. So any embedder may hear them, and
 * `*` keeps the page working in an ordinary browser, which cannot parse the editor's
 * `app://` origin as a postMessage target. Incoming messages stay pinned to EMBEDDER.
 */
const tell = (message: Record<string, unknown>): void => window.parent.postMessage(message, "*");

export default function SponsoredChat() {
  const [exchange, setExchange] = useState<Exchange | null>(null);
  const [result, setResult] = useState<Found | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const zeekendMount = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const origin = window.location.origin;
    Imprezia.init({
      apiKey: "proxy", // the real key is added by the relay, never sent to the browser
      endpoint: `${origin}/v1/imprezia`,
      impressionEndpoint: `${origin}/v1/imprezia/v1/events/sdk-impression`,
    });
    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== EMBEDDER || event.source !== window.parent) return;
      const next = readExchange(event.data);
      if (next !== null) setExchange((current) => current ?? next);
    };
    window.addEventListener("message", onMessage);
    tell({ type: "adcode-sponsored-ready" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // One card per reply: ask the partners in order (Zeekend, then Imprezia) and stop at the first.
  useEffect(() => {
    if (exchange === null) return;
    let live = true;
    void (async () => {
      for (const network of networksFor(exchange.layout, await loadNetworks())) {
        if (!live) return;
        let found: Found | null = null;
        try { found = network.id === "zeekend" ? await askZeekend(network, exchange) : await askImprezia(exchange); } catch { found = null; }
        if (found !== null) { if (live) setResult(found); return; }
      }
      if (live) tell({ type: "adcode-sponsored-empty" });
    })();
    return () => { live = false; };
  }, [exchange]);

  // Zeekend's own unit draws the placement and reports its viewable impression and click.
  useEffect(() => {
    const mount = zeekendMount.current;
    if (mount === null || result?.network !== "zeekend" || exchange === null) return;
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
      {result.network === "imprezia" ? (
        <MonetizedContentWithCards
          response={result.monetized}
          theme={exchange.theme}
          // The reply is already in the chat; only the sponsored cards are drawn here.
          hideResponseContainer
        />
      ) : (
        <div ref={zeekendMount} />
      )}
    </div>
  );
}
