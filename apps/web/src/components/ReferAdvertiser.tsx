"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { CopyField } from "@/components/CopyField";
import { apiFetch, type ReferralView } from "@/lib/api";

/**
 * Advertisers inviting advertisers. An advertiser's owner is an ADCode account, so it already
 * has an invite code; this is that code, pointed at the advertiser offer. The share lands in
 * the owner's ADCode balance, through the same daily settlement as every other invite.
 */
export function ReferAdvertiser() {
  const { token } = useAuth();
  const [view, setView] = useState<ReferralView | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const found = await apiFetch<ReferralView>({ path: "/referrals", token: await token() });
      if (live && found.ok) setView(found.value);
    })();
    return () => {
      live = false;
    };
  }, [token]);

  // Nothing at all rather than an error: this is an offer, not something the portal needs.
  if (view === null) return null;

  const span = view.rates.windowDays === 365 ? "a year" : `${view.rates.windowDays} days`;
  return (
    <section className="workspace-section" id="refer" aria-labelledby="refer-title">
      <h2 className="workspace-section-title" id="refer-title">Refer another advertiser</h2>
      <div className="ios-card invite-panel">
        <p className="invite-panel-people">
          Know another company that sells to developers? When they advertise through your link, you get{" "}
          <strong>{view.rates.advertiserPercent}% of what they spend</strong> for {span}, paid to your ADCode balance.
        </p>
        <CopyField label="Your advertiser invite link" value={`${view.link}?for=ads&from=portal`} />
      </div>
    </section>
  );
}
