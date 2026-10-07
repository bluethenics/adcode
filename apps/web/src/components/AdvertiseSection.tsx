import type { ReactNode } from "react";
import { LandingBidBuilder } from "@/components/LandingBidBuilder";

/**
 * The advertiser offer and the campaign builder, as the homepage shows them, for pages
 * that lead with it: `/advertise` and an invite sent to a company (`/i/<code>?for=ads`).
 *
 * Only published facts. Advertisers buy on numbers, and an invented reach figure here would
 * be a lie with money attached - the live counts are on the homepage, from `/v1/stats`.
 */
export function AdvertiseSection({ eyebrow }: { eyebrow: ReactNode }) {
  return (
    <section className="marketplace-bid" id="advertise">
      <div className="marketplace-wrap marketplace-bid-grid">
        <header className="marketplace-section-intro">
          <p className="marketplace-eyebrow" data-testid="advertise-eyebrow"><span /> {eyebrow}</p>
          <h1>Reach developers<br />while they build.</h1>
          <p>Bid from <strong>$1 per 500 verified impressions</strong>. Live demand sets the price, and a winning campaign can pay less than its maximum bid.</p>
          <dl>
            <div><dt>50%</dt><dd>paid to developers</dd></div>
            <div><dt>$1</dt><dd>minimum block bid</dd></div>
            <div><dt>0</dt><dd>personal code collected</dd></div>
          </dl>
        </header>
        <LandingBidBuilder />
      </div>
    </section>
  );
}
