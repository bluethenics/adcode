"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { meetsPublicStatsThreshold, parsePublicStats, type PublicStats } from "@/lib/publicStats";

const REFRESH_MS = 60_000;

/*
 * One poll for the whole page. The hero headline and the stats band both show these
 * figures, and two components each fetching `/v1/stats` could disagree for a minute.
 */
let current: { stats: PublicStats | null; status: "ready" | "offline" } | null = null;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function publish(next: typeof current) {
  current = next;
  for (const listener of listeners) listener();
}

/*
 * One failed refresh - a dropped packet, a tab waking from sleep - used to flip the badge to
 * "Reconnecting" for a whole minute while the figures were fine. A failure now retries after ten
 * seconds and the badge only changes after two failures in a row.
 */
const RETRY_MS = 10_000;
let failures = 0;
let retry: ReturnType<typeof setTimeout> | null = null;

async function refresh() {
  if (document.visibilityState === "hidden") return;
  let stats: PublicStats | null = null;
  try {
    const response = await fetch("/v1/stats", { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    const parsed = response.ok ? parsePublicStats(await response.json()) : null;
    stats = parsed !== null && meetsPublicStatsThreshold(parsed) ? parsed : null;
  } catch {
    stats = null;
  }
  if (stats !== null) {
    failures = 0;
    publish({ stats, status: "ready" });
    return;
  }
  failures += 1;
  // The last good figures stay on screen either way.
  if (failures >= 2) publish({ stats: current?.stats ?? null, status: "offline" });
  if (retry === null && listeners.size > 0) retry = setTimeout(() => { retry = null; void refresh(); }, RETRY_MS);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (timer === null) {
    void refresh();
    timer = setInterval(() => void refresh(), REFRESH_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    if (listeners.size === 0 && retry !== null) {
      clearTimeout(retry);
      retry = null;
    }
  };
}

export function useNetworkStats(initial: PublicStats | null) {
  const live = useSyncExternalStore(subscribe, () => current, () => null);
  return { stats: live?.stats ?? initial, status: live?.status ?? "ready", fresh: live !== null };
}

/** Counts from the previous value to the next, so a refresh reads as movement, not a jump. */
export function Rolling({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    from.current = value;
    if (start === value || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(value);
      return;
    }
    const began = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const progress = Math.min((now - began) / 900, 1);
      setShown(Math.round(start + (value - start) * (1 - Math.pow(1 - progress, 3))));
      if (progress < 1) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <>{shown.toLocaleString("en-US")}</>;
}

/** The hero headline: the live developer count when there is one, the plain promise otherwise. */
export function ReachHeadline({ initial }: { initial: PublicStats | null }) {
  const { stats } = useNetworkStats(initial);
  return (
    <h1 className="adv-hero-title">
      {stats === null ? (
        <>Reach developers while they build.</>
      ) : (
        <>Reach <span className="adv-hero-figure"><Rolling value={stats.developers} /></span> developers while they build.</>
      )}
    </h1>
  );
}

/** The network band under the hero: four live figures and when they were measured. */
export function NetworkBand({ initial }: { initial: PublicStats | null }) {
  const { stats, status, fresh } = useNetworkStats(initial);
  if (stats === null) return null;

  const share = stats.developers === 0 ? 0 : Math.round((stats.developersThisWeek / stats.developers) * 100);
  // Three figures about the audience. The live-campaign count ("The next slot" / "Campaigns
  // live now") was taken out on request: how many advertisers are running is not this page's to say.
  const figures: readonly { label: string; value: number; note: string }[] = [
    { label: "Developers on ADCode", value: stats.developers, note: "Accounts active in the editor, all time" },
    { label: "New in the last 7 days", value: stats.developersThisWeek, note: `${share}% of the network joined this week` },
    { label: "Verified ad views", value: stats.impressions, note: "On screen 4+ seconds in a focused editor" },
  ];

  return (
    <section className="adv-network" aria-labelledby="adv-network-title">
      <header className="adv-network-head">
        <h2 id="adv-network-title">The network, right now</h2>
        <p className="adv-live" role="status" data-state={status}>
          <i aria-hidden="true" />
          {/* The clock time only after the first client refresh: the server's time zone is not the visitor's. */}
          {status === "offline"
            ? "Showing the last figures. Reconnecting"
            : fresh
              ? `Live. Updated ${new Date(stats.asOf).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
              : "Live. Updated every minute"}
        </p>
      </header>
      <dl className="adv-network-figures">
        {figures.map((figure) => (
          <div key={figure.label}>
            <dt>{figure.label}</dt>
            <dd><Rolling value={figure.value} /></dd>
            <dd className="adv-network-note">{figure.note}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
