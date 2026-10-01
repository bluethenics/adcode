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
 * Before the answer arrives the boxes are empty rather than guessed; if it never arrives
 * the card stays out of the way instead of showing an apology in the hero.
 */

/** Minimum digit boxes, padded with leading zeros like an odometer (000632). */
export const DEVELOPER_COUNT_DIGITS = 6;

/**
 * Zero-padded digit boxes, e.g. 632 -> ["0", "0", "0", "6", "3", "2"].
 * Totals that outgrow the width keep every digit rather than truncating.
 */
export function splitPaddedDigits(value: number, width: number = DEVELOPER_COUNT_DIGITS): string[] {
  const normalized = String(Math.max(0, Math.floor(value)));
  return (normalized.length >= width ? normalized : normalized.padStart(width, "0")).split("");
}

/** "+214 joined this week", or the quieter line when the week was empty. */
export function weeklyLine(joined: number): string {
  return joined > 0 ? `+${joined.toLocaleString("en-US")} joined this week` : "on ADCode";
}

export type CounterState = { status: "loading" } | { status: "ready"; developers: number; thisWeek: number } | { status: "offline" };

export function DeveloperCounterView({ state }: { state: CounterState }) {
  if (state.status === "offline") return null;
  const ready = state.status === "ready";
  const digits = ready ? splitPaddedDigits(state.developers) : Array.from({ length: DEVELOPER_COUNT_DIGITS }, () => "");
  return (
    <div
      className="hero-dev-counter"
      aria-busy={!ready}
      aria-label={ready ? `${state.developers.toLocaleString("en-US")} developers on ADCode, ${state.thisWeek.toLocaleString("en-US")} joined this week` : "Loading the developer count"}
    >
      <div className="hero-dev-counter-brand">
        <span className="hero-dev-counter-icon" aria-hidden="true">{"<$>"}</span>
        <span className="hero-dev-counter-text" aria-hidden="true">
          <strong>Developers</strong>
          <small data-growing={ready && state.thisWeek > 0}>{ready ? weeklyLine(state.thisWeek) : "on ADCode"}</small>
        </span>
      </div>
      <span className="hero-dev-counter-divider" aria-hidden="true" />
      <ol className="hero-dev-counter-digits" aria-hidden="true">
        {digits.map((digit, index) => (
          // Fixed length while loading, and only grows, so index keys are stable.
          // eslint-disable-next-line react/no-array-index-key
          <li key={index} className="hero-dev-counter-digit">{digit}</li>
        ))}
      </ol>
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
