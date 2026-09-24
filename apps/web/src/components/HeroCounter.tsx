"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { meetsPublicStatsThreshold, parsePublicStats, type PublicStats } from "@/lib/publicStats";

function AnimatedNumber({ value }: { value: number | undefined }) {
  const [display, setDisplay] = useState<number | undefined>(value);
  const previous = useRef<number | undefined>(value);
  useEffect(() => {
    if (value === undefined) return;
    const from = previous.current ?? 0;
    previous.current = value;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setDisplay(value); return; }
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min((now - start) / 1000, 1);
      setDisplay(Math.round(from + (value - from) * (1 - Math.pow(1 - progress, 3))));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <span aria-label={value === undefined ? "Unavailable" : value.toLocaleString("en-US")}><span aria-hidden="true">{display === undefined ? "—" : display.toLocaleString("en-US")}</span></span>;
}

export function HeroCounter() {
  const [stats, setStats] = useState<PublicStats | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "offline">("loading");
  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    async function refresh() {
      if (busy || document.visibilityState === "hidden") return;
      busy = true;
      setStatus((current) => current === "offline" ? "loading" : current);
      try {
        const response = await fetch("/v1/stats", { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) });
        const next = response.ok ? parsePublicStats(await response.json()) : null;
        if (controller.signal.aborted) return;
        if (next) { setStats(next); setStatus("ready"); } else setStatus("offline");
      } catch { if (!controller.signal.aborted) setStatus("offline"); }
      finally { busy = false; }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 60_000);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, []);

  // Hidden until traction is real: small early totals (92 impressions, 3 clicks)
  // undermine the story. The gate is 2K verified clicks; before that the section
  // renders nothing, not a loading shimmer and not an "unavailable" apology.
  if (stats !== null && !meetsPublicStatsThreshold(stats)) return null;
  if (stats === null) return null;

  return <section className="network-summary" data-state={status === "offline" ? "populated" : "populated"} aria-label="ADCode network statistics">
    <div className="network-summary-heading"><span>Across the ADCode network</span><small>Verified activity, all time</small></div>
    <dl className="network-summary-values">
      {([
        ["Total impressions", stats.impressions],
        ["Verified clicks", stats.clicks],
        ["Active campaigns", stats.activeCampaigns],
      ] as const).map(([label, value]) => <div key={label}>
        <dt>{label}</dt>
        <dd style={{ "--counter-length": Math.max(7, value.toLocaleString("en-US").length) } as CSSProperties}><AnimatedNumber value={value} /></dd>
      </div>)}
    </dl>
    <span className="network-summary-note" role="status">{status === "offline" ? "Last available totals · reconnecting" : "Updated every minute"}</span>
  </section>;
}
