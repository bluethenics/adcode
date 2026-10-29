"use client";

import { useEffect, useRef, useState } from "react";
import Imprezia, { MonetizedContentWithCards } from "@adimpress/imprezia-sdk";
import { hasCards } from "@adimpress/imprezia-sdk/utils/cardHelpers";
import "./sponsored.css";

/**
 * Sponsored cards under one AI reply - the opt-in `adcode.ads.chatSponsored` setting.
 *
 * The desktop app embeds this page in a sandboxed frame (`renderer/ai/sponsoredReply.ts`) and
 * hands it one exchange by postMessage. Imprezia's SDK runs here, on ADCode's own origin and
 * never in the editor: its measurement scripts load in this page only. The SDK's calls go to
 * this site's `/v1/imprezia` relay, which adds the publisher key the admin saved.
 *
 * Only the desktop window may talk to it: messages from any other origin are ignored, and
 * `frame-ancestors app://adcode` keeps other sites from embedding it at all.
 */
const EMBEDDER = "app://adcode";

type Exchange = { request: string; response: string; sessionId: string; theme: "light" | "dark" };
type Monetized = Awaited<ReturnType<typeof Imprezia.monetize>>;

function readExchange(data: unknown): Exchange | null {
  const value = data as Partial<Exchange> & { type?: unknown } | null;
  if (value?.type !== "adcode-sponsored") return null;
  const { request, response, sessionId, theme } = value;
  if (typeof request !== "string" || typeof response !== "string" || typeof sessionId !== "string") return null;
  if (request.length === 0 || response.length === 0 || sessionId.length === 0 || sessionId.length > 100) return null;
  return { request: request.slice(0, 4_000), response: response.slice(0, 4_000), sessionId, theme: theme === "light" ? "light" : "dark" };
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
  const [result, setResult] = useState<Monetized | null>(null);
  const box = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (exchange === null) return;
    let live = true;
    void Imprezia.monetize({ request: exchange.request, response: exchange.response, sessionId: exchange.sessionId })
      .then((monetized) => {
        if (!live) return;
        if (hasCards(monetized)) setResult(monetized);
        else tell({ type: "adcode-sponsored-empty" });
      }, () => { if (live) tell({ type: "adcode-sponsored-empty" }); });
    return () => { live = false; };
  }, [exchange]);

  // The frame takes this page's height, so a card never scrolls inside the chat.
  useEffect(() => {
    const element = box.current;
    if (element === null || result === null) return;
    const report = (): void => tell({ type: "adcode-sponsored-size", height: element.getBoundingClientRect().height });
    const observer = new ResizeObserver(report);
    observer.observe(element);
    report();
    return () => observer.disconnect();
  }, [result]);

  if (exchange === null || result === null) return null;
  return (
    <div ref={box} className="sponsored-chat" data-theme={exchange.theme}>
      <MonetizedContentWithCards
        response={result}
        theme={exchange.theme}
        // The reply is already in the chat; only the sponsored cards are drawn here.
        hideResponseContainer
      />
    </div>
  );
}
