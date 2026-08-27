"use client";

import { useEffect, useState } from "react";
import { MarketPriceChart } from "./MarketPriceChart";
import { fetchDemand, type DemandView } from "@/lib/demand";

const FALLBACK: DemandView = {
  clearingCpmMicros: "2000000",
  floorCpmMicros: "2000000",
  activeCampaigns: 0,
  demandLevel: "low",
  asOf: 0,
  history: [],
};

export function MarketDemand() {
  const [market, setMarket] = useState<DemandView | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const refresh = async () => {
      const next = await fetchDemand(controller.signal);
      if (next !== null) setMarket(next);
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 60_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, []);

  const view = market ?? FALLBACK;

  return (
    <div className="market-panel">
      <MarketPriceChart
        currentCpmMicros={view.clearingCpmMicros}
        floorCpmMicros={view.floorCpmMicros}
        asOf={view.asOf}
        history={view.history}
      />
      <div className="market-meta">
        <span><small>Demand</small><strong>{market === null ? "Connecting" : view.demandLevel}</strong></span>
        <span><small>Funded campaigns</small><strong>{market === null ? "—" : view.activeCampaigns}</strong></span>
        <span><small>Refresh</small><strong>60 sec</strong></span>
      </div>
    </div>
  );
}
