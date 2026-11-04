"use client";

import { useId, useState, type CSSProperties } from "react";
import Link from "@/components/IntentLink";
import { Icon } from "@/components/Icon";
import { ArrowUpRight } from "lucide";

interface FinderPlan { id: string; name: string; price: string; steps: number }

/** Slider stops: a quick fix, an evening, a working day, a long day of agents. */
const STOPS = [10, 25, 60, 120, 200, 290, 400];

/**
 * "How much do you build?" answered with a plan. People trust a recommendation they arrived at
 * themselves more than a badge, and the slider is honest: it picks the smallest plan whose
 * daily agent steps cover the answer, and says when Free already does.
 */
export function PlanFinder({ freeSteps, plans }: { freeSteps: number; plans: readonly FinderPlan[] }) {
  const id = useId();
  const [stop, setStop] = useState(3);
  const steps = STOPS[stop]!;
  const fit = steps <= freeSteps ? null : plans.find((plan) => plan.steps >= steps) ?? plans[plans.length - 1]!;
  const over = fit !== null && fit.steps < steps;
  return (
    <section className="pricing-finder" aria-labelledby={`${id}-heading`}>
      <div className="pricing-finder-ask">
        <h2 id={`${id}-heading`}>How much do you build on a typical day?</h2>
        <label htmlFor={`${id}-range`} className="pricing-finder-value"><strong>{steps}</strong> agent steps a day</label>
        <input
          id={`${id}-range`}
          className="pricing-finder-range"
          type="range"
          min={0}
          max={STOPS.length - 1}
          step={1}
          value={stop}
          aria-valuetext={`${steps} agent steps a day`}
          onChange={(event) => setStop(Number(event.target.value))}
          style={{ "--fill": `${(stop / (STOPS.length - 1)) * 100}%` } as CSSProperties}
        />
        <div className="pricing-finder-scale" aria-hidden="true"><span>Quick fixes</span><span>Side project</span><span>All day</span></div>
      </div>
      <div className="pricing-finder-answer" aria-live="polite" key={fit?.id ?? "free"}>
        {fit === null ? (
          <>
            <p className="pricing-eyebrow">Your fit</p>
            <p className="pricing-finder-plan">Free</p>
            <p>{freeSteps}+ steps a day covers it. Start free and upgrade the day you need more.</p>
            <Link href="/versions" className="pricing-button">Download ADCode <Icon node={ArrowUpRight} /></Link>
          </>
        ) : (
          <>
            <p className="pricing-eyebrow">Your fit</p>
            <p className="pricing-finder-plan">{fit.name} <span>{fit.price}/month</span></p>
            <p>{over ? `Up to ${fit.steps}+ uncached steps a day. Cached prompts usually stretch that about twice as far.` : `${fit.steps}+ steps a day leaves you room to spare.`}</p>
            <Link href={`/ai-tokens?plan=${fit.id}#plans`} className="pricing-button" data-primary="true">Get {fit.name} <Icon node={ArrowUpRight} /></Link>
          </>
        )}
      </div>
    </section>
  );
}
