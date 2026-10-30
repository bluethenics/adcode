"use client";

import { useEffect, useRef, useState } from "react";
import Imprezia, { MonetizedContentWithCards } from "@adimpress/imprezia-sdk";
import { hasCards } from "@adimpress/imprezia-sdk/utils/cardHelpers";

type Monetized = Awaited<ReturnType<typeof Imprezia.monetize>>;

/** Uses the SDK's request routing, card renderer and viewability measurement. */
export default function ImpreziaSdkPreview({ endpoint, placementId }: { endpoint: string; placementId: string }) {
  const pending = useRef<Promise<Monetized> | null>(null);
  const [result, setResult] = useState<Monetized | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "empty" | "error">("loading");

  useEffect(() => {
    let active = true;
    if (pending.current === null) {
      const relay = new URL(endpoint, window.location.origin).href;
      Imprezia.init({ apiKey: "proxy", endpoint: relay, impressionEndpoint: `${relay}/v1/events/sdk-impression` });
      // One opaque conversation ID for this preview, preserved through Strict Mode retries.
      pending.current = Imprezia.monetize({
        request: "How can I build a TypeScript and React app?",
        response: "Use TypeScript for typed components and React to build the app's interface.",
        sessionId: crypto.randomUUID(), maxCards: 1,
        ...(placementId ? { placementId } : {}),
      });
    }
    void pending.current.then(value => {
      if (!active) return;
      setResult(value);
      setStatus(hasCards(value) ? "ready" : "empty");
    }, () => { if (active) setStatus("error"); });
    return () => { active = false; };
  }, [endpoint, placementId]);

  return <div className="imprezia-sdk-preview">
    {status === "loading" && <p role="status">Requesting a preview through Imprezia&apos;s SDK…</p>}
    {status === "ready" && result && <><p role="status">Imprezia&apos;s SDK returned a sponsored card.</p><MonetizedContentWithCards response={result} theme="dark" hideResponseContainer /></>}
    {status === "empty" && <p role="status">The SDK returned no ad. Check the saved key or retry when inventory is available.</p>}
    {status === "error" && <p role="alert">The SDK preview could not load. Press Test to try again.</p>}
  </div>;
}
