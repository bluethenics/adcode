"use client";

import { useEffect, useState } from "react";
import { fetchDemand, type DemandView } from "@/lib/demand";
import { blockMicrosToCpmMicros, cpmMicrosToBlockMicros } from "@/lib/site";

const LEVEL: Record<DemandView["demandLevel"], string> = {
  low: "Demand is low. A bid at the floor wins most slots right now.",
  medium: "Demand is steady. Bidding a little over the clearing price keeps you in rotation.",
  high: "Demand is high. Raise your maximum bid to win more slots.",
};

const usd = (micros: bigint) => `$${(Number(micros / 10_000n) / 100).toFixed(2)}`;

/**
 * What a 500-view block is actually clearing at, from `/v1/demand`. Nothing renders until
 * the API answers: a price shown here is one an advertiser could pay this minute.
 */
export function ClearingPrice() {
  const [demand, setDemand] = useState<DemandView | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const load = () => void fetchDemand(controller.signal).then((next) => { if (next !== null) setDemand(next); });
    load();
    const timer = setInterval(load, 60_000);
    return () => { controller.abort(); clearInterval(timer); };
  }, []);

  if (demand === null) return null;
  const block = cpmMicrosToBlockMicros(BigInt(demand.clearingCpmMicros));
  const cpm = blockMicrosToCpmMicros(block);

  return (
    <div className="adv-clearing" role="status">
      <span className="adv-clearing-label"><i aria-hidden="true" />Clearing price now</span>
      <strong className="money">{usd(block)}<small> per 500 views</small></strong>
      <span className="adv-clearing-cpm">{usd(cpm)} CPM</span>
      <p>{LEVEL[demand.demandLevel]}</p>
    </div>
  );
}
