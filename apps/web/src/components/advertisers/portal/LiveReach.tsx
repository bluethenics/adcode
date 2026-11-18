"use client";

import { Globe, Monitor } from "lucide";
import { Icon } from "@/components/Icon";
import { Rolling, useNetworkStats } from "@/components/advertisers/NetworkStats";
import { previewNetworkStats } from "@/lib/portalPreview";
import { useEffect, useState } from "react";

/**
 * The live developer count from `/v1/stats`, large, with where the ads show.
 *
 * Shares the advertiser page's one-poll store, so two of these on a page never disagree.
 * Below the homepage's traction gate, or while the API is unreachable, it says where ads
 * show and states no number: an audience size that is not measured is not shown.
 */
export function LiveReach() {
  const live = useNetworkStats(null);
  const [preview, setPreview] = useState<ReturnType<typeof previewNetworkStats>>(null);
  useEffect(() => setPreview(previewNetworkStats()), []);
  const stats = live.stats ?? preview;
  const status = preview !== null && live.stats === null ? "ready" : live.status;

  return (
    <div className="ap-reach">
      {stats === null ? (
        // No figure yet - first visit while the API is unreachable. The headline never announces
        // a connection problem to somebody deciding whether to advertise; it says what is true.
        <p className="ap-reach-quiet">Developers writing code in ADCode, every day.</p>
      ) : (
        <>
          <strong className="ap-reach-figure"><Rolling value={stats.developers} /></strong>
          <span className="ap-reach-label">
            Developers
            <span className="ap-live" data-state={status}>{status === "offline" ? "Reconnecting" : "Live"}</span>
          </span>
        </>
      )}
      <ul className="ap-chips" aria-label="Where your ads show">
        <li><Icon node={Monitor} />Desktop app</li>
        <li><Icon node={Globe} />Browser editor</li>
      </ul>
    </div>
  );
}
