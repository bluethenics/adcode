"use client";

import { useEffect, useReducer, useRef } from "react";
import { formatMicros, perImpressionMicros } from "@/lib/site";

/**
 * The hero: an editor with a sponsored card in the corner, and a ledger that appends
 * while you read the page.
 *
 * The figure is shown to six decimal places and there is no monthly projection anywhere
 * on this page. Every product in this category rounds up to an aspirational number; the
 * argument here is that the ledger is real, so the number has to look like a ledger
 * entry rather than a promise.
 *
 * Under `prefers-reduced-motion` the ticker does not run at all - it settles on one
 * credit and stays there. A number that moves forever is exactly the kind of thing that
 * setting exists to stop.
 */

const ADVERTISERS = [
  { name: "Fly.io", head: "Run your app close to users", body: "Deploy in 30 regions from one command." },
  { name: "Linear", head: "Issue tracking that keeps up", body: "Built for teams that ship weekly." },
  { name: "Neon", head: "Postgres that branches", body: "A database branch per pull request." },
  { name: "Sentry", head: "See the error before the ticket", body: "Stack traces with the commit that caused them." },
] as const;

interface Row {
  id: number;
  advertiser: string;
  dwellMs: number;
  micros: bigint;
  kind: "impression" | "reversal";
}

interface State {
  rows: Row[];
  totalMicros: bigint;
  next: number;
}

/** Seeded so the server render and the first client render agree; time only moves after mount. */
const INITIAL: State = {
  rows: [
    { id: 2, advertiser: "Linear", dwellMs: 5100, micros: perImpressionMicros, kind: "impression" },
    { id: 1, advertiser: "Fly.io", dwellMs: 4200, micros: perImpressionMicros, kind: "impression" },
  ],
  totalMicros: perImpressionMicros * 2n,
  next: 3,
};

function reduce(state: State): State {
  const advertiser = ADVERTISERS[state.next % ADVERTISERS.length] as (typeof ADVERTISERS)[number];
  const dwellMs = 3200 + ((state.next * 617) % 4200);

  const row: Row = {
    id: state.next,
    advertiser: advertiser.name,
    dwellMs,
    micros: perImpressionMicros,
    kind: "impression",
  };

  return {
    rows: [row, ...state.rows].slice(0, 4),
    totalMicros: state.totalMicros + perImpressionMicros,
    next: state.next + 1,
  };
}

export function LedgerHero() {
  const [state, append] = useReducer(reduce, INITIAL);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduced.matches) return;

    timer.current = setInterval(() => append(), 3400);
    return () => {
      if (timer.current !== null) clearInterval(timer.current);
    };
  }, []);

  const total = formatMicros(state.totalMicros);
  const [whole, frac] = total.split(".") as [string, string];
  const creative = ADVERTISERS[state.next % ADVERTISERS.length] as (typeof ADVERTISERS)[number];

  return (
    <div className="editor">
      <div className="editor-bar">
        <span className="editor-dot" />
        <span className="editor-dot" />
        <span className="editor-dot" />
        <span className="editor-title">ledger.ts</span>
      </div>

      <div className="editor-body">
        <div className="editor-line">
          <span className="tok-dim">42</span>{"  "}
          <span className="tok-key">export function</span> <span className="tok-fn">applyEntry</span>(
        </div>
        <div className="editor-line">
          <span className="tok-dim">43</span>{"    "}balance: Balance,
        </div>
        <div className="editor-line">
          <span className="tok-dim">44</span>{"    "}entry: LedgerEntry,
        </div>
        <div className="editor-line">
          <span className="tok-dim">45</span>{"  "}): Balance {"{"}
        </div>
        <div className="editor-line">
          <span className="tok-dim">46</span>{"    "}
          <span className="tok-key">switch</span> (entry.kind) {"{"}
        </div>
        <div className="editor-line">
          <span className="tok-dim">47</span>{"      "}
          <span className="tok-key">case</span> <span className="tok-str">&quot;impression&quot;</span>:
        </div>
        <div className="editor-line">
          <span className="tok-dim">48</span>{"      "}
          <span className="tok-key">case</span> <span className="tok-str">&quot;reversal&quot;</span>:{"  "}
          <span className="tok-dim">// never an edit</span>
        </div>

        <div className="toast" key={creative.name} aria-hidden="true">
          <span className="toast-tag">Sponsored · {creative.name}</span>
          <span className="toast-head">{creative.head}</span>
          <span className="toast-body">{creative.body}</span>
        </div>
      </div>

      <div className="ledger" aria-live="polite" aria-atomic="false">
        <div className="ledger-head">
          <span>Your ledger</span>
          <span>{formatMicros(state.totalMicros)}</span>
        </div>
        {state.rows.map((row) => (
          <div className="ledger-row" key={row.id} data-kind={row.kind}>
            <span className="ledger-desc">
              Ad from {row.advertiser}, {(row.dwellMs / 1000).toFixed(1)}s
            </span>
            <span className="ledger-amount money">+{formatMicros(row.micros)}</span>
          </div>
        ))}
      </div>

      <span className="sr-only">
        Running total {whole}.{frac} dollars. This is an illustration, not your account.
      </span>
    </div>
  );
}

/** The running figure, shown beside the headline rather than inside the editor. */
export function HeroTotal() {
  const [state, append] = useReducer(reduce, INITIAL);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduced.matches) return;
    const id = setInterval(() => append(), 3400);
    return () => clearInterval(id);
  }, []);

  const [whole, frac] = formatMicros(state.totalMicros).split(".") as [string, string];

  return (
    <div className="hero-figure">
      <span className="hero-amount money">
        {whole}.<span className="hero-amount-frac">{frac}</span>
      </span>
      <span className="hero-figure-label">
        credited in this illustration since the page loaded
      </span>
    </div>
  );
}
