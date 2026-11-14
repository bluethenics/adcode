"use client";

import { useState, type CSSProperties } from "react";
import Link from "@/components/IntentLink";
import { Icon } from "@/components/Icon";
import { ArrowUpRight, Check } from "lucide";
import { Buck } from "@/components/buck/Buck";
import type { PlanSpec } from "@adcode/api/src/aiPlans.ts";
import { PLAN_BENEFITS, agentStepsPerDay, creditAmount, price, pricePerDay, projectPlanBenefits, yearlyPerMonth, yearlySavingsCents } from "@/lib/pricing";

type Billing = "month" | "year";
/** Whole dollars with a thousands comma, cents when there are any: $1,490, $32.50. */
const usd = (cents: number): string => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;

/**
 * The three plans, with a monthly or yearly switch when yearly can actually be bought.
 *
 * Pro is the recommendation and says so; Max sits beside it as the biggest allowance, so Pro's
 * price reads against Max's rather than against nothing. Every figure comes from the plan table:
 * the price, what it costs a day, the daily credits and how many agent steps they cover. Yearly
 * shows the monthly equivalent and the exact saving; it never hides the amount charged today.
 */
export function PlanPicker({ plans, freeCredits, yearly }: { plans: readonly PlanSpec[]; freeCredits: number; yearly: boolean }) {
  const [billing, setBilling] = useState<Billing>("month");
  const shown: Billing = yearly ? billing : "month";
  const freeSteps = agentStepsPerDay(freeCredits);
  return (
    <section className="pricing-plans-section" aria-labelledby="pricing-plans-heading">
      <div className="pricing-plans-head">
        <h2 id="pricing-plans-heading">Plans</h2>
        {yearly && (
          <div className="pricing-billing" role="radiogroup" aria-label="Billing">
            {(["month", "year"] as const).map((one) => (
              <button key={one} type="button" role="radio" aria-checked={shown === one} data-active={shown === one} onClick={() => setBilling(one)}>
                {one === "month" ? "Monthly" : <>Yearly <span>2 months free</span></>}
              </button>
            ))}
          </div>
        )}
      </div>
      <ul className="pricing-plans" aria-label="AI plans">
        {plans.map((plan, index) => {
          const featured = plan.id === "pro";
          const anchor = plan.id === "max";
          const charge = shown === "year" && plan.yearlyCents !== undefined ? plan.yearlyCents : plan.priceCents;
          const multiple = Math.round(plan.weeklyTokens / Math.max(1, freeCredits));
          return (
            <li key={plan.id} className="pricing-plan" data-featured={featured} data-anchor={anchor} data-plan={plan.id} style={{ "--i": index } as CSSProperties}>
              {featured && <Buck className="pricing-plan-buck" mood="idle" size={52} hoverMood="proud" reactTo=".pricing-plan" greet="wink" />}
              <div className="pricing-card-title">
                <h3>{plan.name}</h3>
                {featured ? <span className="pricing-flag">Recommended</span> : anchor ? <span className="pricing-flag pricing-flag-quiet">Biggest allowance</span> : null}
              </div>
              <p className="pricing-audience">{PLAN_BENEFITS[plan.id].audience}</p>
              <div className="pricing-price-block" key={shown}>
                {shown === "year" && plan.yearlyCents !== undefined ? (
                  <>
                    <p className="pricing-plan-price"><strong>{yearlyPerMonth(plan.yearlyCents)}</strong><span>/month</span></p>
                    <p className="pricing-per-day">{usd(plan.yearlyCents)} billed once a year. You save {usd(yearlySavingsCents(plan))}.</p>
                  </>
                ) : (
                  <>
                    <p className="pricing-plan-price"><strong>{price(plan.priceCents)}</strong><span>/month</span></p>
                    <p className="pricing-per-day">{pricePerDay(plan.priceCents, "month")} a day, billed monthly</p>
                  </>
                )}
              </div>
              <div className="pricing-capacity">
                <p><strong>{creditAmount(plan.weeklyTokens)}</strong> credits every day</p>
                <p className="pricing-steps"><strong>{agentStepsPerDay(plan.weeklyTokens).toLocaleString("en-US")}+</strong> agent steps a day, vs {freeSteps} on Free</p>
                <p className="pricing-anchor"><strong>{multiple}×</strong> the free daily allowance</p>
              </div>
              <ul className="pricing-card-features">
                <li><Icon node={Check} /><span>Every hosted model, premium ones included</span></li>
                <li><Icon node={Check} /><span>Fresh credits every day, no overage bill</span></li>
                <li><Icon node={Check} /><span>{projectPlanBenefits(plan.id).priority} when busy</span></li>
                <li><Icon node={Check} /><span>{projectPlanBenefits(plan.id).summary}</span></li>
                {plan.invites > 0 && <li><Icon node={Check} /><span>Invite {plan.invites} friends; you both get bonus credits</span></li>}
              </ul>
              <Link
                href={`/ai-tokens?plan=${plan.id}${shown === "year" ? "&billing=year" : ""}&go=1#plans`}
                className="pricing-button"
                data-buck={featured ? "proud" : "earning"}
                aria-label={`Get ${plan.name}, ${usd(charge)} a ${shown}`}
              >
                Get {plan.name} <Icon node={ArrowUpRight} />
              </Link>
              <p className="pricing-cancel">{shown === "year" ? `${usd(charge)} today, renews yearly` : "Cancel any time"}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
