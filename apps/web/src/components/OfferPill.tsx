"use client";

import Link from "@/components/IntentLink";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { offerEndDate, parsePriceOffer, type PriceOffer } from "@/lib/pricing";

/**
 * A running price offer, on every page: "15% off AI models" in the header, linking to the prices.
 *
 * It lives inside the header's fixed height, so it never pushes the page down when it arrives.
 * A bar above the header would appear a beat after the page settled, the movement this site
 * avoids. One read of the public config per page load, shared by the header and the phone
 * menu; on any failure it simply stays absent.
 */
let pending: Promise<PriceOffer | null> | null = null;
function readOffer(): Promise<PriceOffer | null> {
  pending ??= fetch("/v1/ai/tagflow/config", { headers: { accept: "application/json" } })
    .then(async (response) => response.ok ? parsePriceOffer(((await response.json()) as { offer?: unknown }).offer) : null)
    .catch(() => null);
  return pending;
}

export function OfferPill({ variant = "header" }: { variant?: "header" | "sheet" }) {
  const pathname = usePathname();
  const [offer, setOffer] = useState<PriceOffer | null>(null);
  useEffect(() => {
    let active = true;
    void readOffer().then((found) => { if (active) setOffer(found); });
    return () => { active = false; };
  }, []);
  // The pricing page says it in full; the admin is not a shop window.
  if (offer === null || offer.endsAt <= Date.now() || pathname === "/pricing" || pathname.startsWith("/admin")) return null;
  const title = `${offer.name}: ${offer.percent}% off every paid AI model until ${offerEndDate(offer.endsAt)}`;
  return variant === "sheet"
    ? <Link href="/pricing#models" className="glass-nav-link offer-sheet-link">{offer.percent}% off every paid model until {offerEndDate(offer.endsAt)}</Link>
    : <Link href="/pricing#models" className="offer-pill" title={title} aria-label={title}>
        <strong>{offer.percent}% off</strong><span className="offer-pill-label">AI models</span>
      </Link>;
}
