"use client";

import { useEffect, useState } from "react";
import { parsePublicStats } from "@/lib/publicStats";

/**
 * Hero developer total, read from `/v1/stats`.
 *
 * The real count of ADCode accounts, and how many of them joined in the last seven days.
 * At this stage the weekly figure is the one that persuades: a total says how big
 * something is, a week of sign-ups says it is moving. Both come from the same endpoint the
 * network section reads, so the page cannot quote two different numbers.
 *
 * The figures are set as type, not as odometer slots: zero-padding a three-digit total into
 * six boxes made it look smaller than it is. They count up once when they arrive - the one
 * piece of motion in the hero - and land on the exact value.
 *
 * Before the answer arrives the figures are blank rather than guessed; if it never arrives
 * the card stays out of the way instead of showing an apology in the hero.
 */

export type CounterState = { status: "loading" } | { status: "ready"; developers: number; thisWeek: number } | { status: "offline" };

const COUNT_UP_MS = 1100;

/** Eased progress for the count-up: fast at first, settling onto the real value. */
export function countUpValue(target: number, progress: number): number {
  const clamped = Math.min(Math.max(progress, 0), 1);
  return Math.round(target * (1 - Math.pow(1 - clamped, 3)));
}

function CountUp({ value, prefix = "" }: { value: number; prefix?: string }) {
  // On the server, and for anyone who asked for less motion, the number is simply there.
  const [shown, setShown] = useState(() =>
    typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches ? value : 0,
  );
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setShown(value); return; }
    const start = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const progress = (now - start) / COUNT_UP_MS;
      setShown(countUpValue(value, progress));
      if (progress < 1) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <>{prefix}{shown.toLocaleString("en-US")}</>;
}

export function DeveloperCounterView({ state }: { state: CounterState }) {
  if (state.status === "offline") return null;
  const ready = state.status === "ready";
  return (
    <div
      className="hero-dev-counter"
      aria-busy={!ready}
      aria-label={ready ? `${state.developers.toLocaleString("en-US")} developers on ADCode, ${state.thisWeek.toLocaleString("en-US")} joined this week` : "Loading the developer count"}
    >
      <span className="hero-dev-counter-live" aria-hidden="true"><i /> Live from the ADCode network</span>
      <dl className="hero-dev-counter-stats" aria-hidden="true">
        <div>
          <dt>developers on ADCode</dt>
          <dd>{ready ? <CountUp value={state.developers} /> : <span className="hero-dev-counter-blank" />}</dd>
        </div>
        {(!ready || state.thisWeek > 0) && (
          <div data-growing="true">
            <dt>joined this week</dt>
            <dd>{ready ? <CountUp value={state.thisWeek} prefix="+" /> : <span className="hero-dev-counter-blank" />}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

export function DeveloperCounter() {
  const [state, setState] = useState<CounterState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/v1/stats", { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) });
        const stats = response.ok ? parsePublicStats(await response.json()) : null;
        if (controller.signal.aborted) return;
        setState(stats === null ? { status: "offline" } : { status: "ready", developers: stats.developers, thisWeek: stats.developersThisWeek });
      } catch {
        if (!controller.signal.aborted) setState({ status: "offline" });
      }
    })();
    return () => controller.abort();
  }, []);

  return <DeveloperCounterView state={state} />;
}
