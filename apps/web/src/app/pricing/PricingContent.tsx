import Link from "@/components/IntentLink";
import { PLAN_BENEFITS, PLANS_ON_SALE, planCredits, PROJECT_PLANS, projectPlanBenefits, price, creditAmount, topUpName, agentStepsPerDay, pricePerDay, isNewModel, monthlyPackValueCents, creditsPerDollar, CREDITS_PER_AGENT_STEP, type IncludedModelRate, type PricingOffer } from "@/lib/pricing";
import { Icon } from "@/components/Icon";
import { ArrowUpRight, Check, Minus } from "lucide";
import { HEABSY_PRICES } from "@adcode/api/src/aiEconomics.ts";
import type { CSSProperties } from "react";
import type { PlanSpec } from "@adcode/api/src/aiPlans.ts";
import { PlanFinder } from "./PlanFinder";

const WHERE_TO_MANAGE = "Where do I manage billing or redeem a code?";
/** The questions, once: rendered below and published as FAQPage data by the page. */
export const PRICING_FAQ: readonly { q: string; a: string }[] = [
  { q: "Do I need to buy a plan to use ADCode?", a: "No. The editor is free, and free included AI has a daily allowance. Heabsy and other partner models use paid credits: a USD wallet charged at the provider's price plus 35%, or included in Max. Your own provider connections remain available." },
  { q: "Is Max really unlimited?", a: `Close to it, but not literally. Max covers every ADCode-hosted model, premium ones included, inside ${planCredits("max")} fair-use credits a day. Credits follow each model's price, so a budget model runs hundreds of agent steps a day and a premium model fewer. Usage pauses at the allowance, refills 24 hours after your first request, and never charges a wallet or an overage bill.` },
  { q: "When does my allowance refill?", a: `The shared allowance day starts with your first included AI request. Every plan refills daily: Builder ${planCredits("monthly")} credits, Pro ${planCredits("pro")} and Max ${planCredits("max")} fair-use credits. It is shared across signed-in devices and does not roll over. Purchased credits are separate and never expire.` },
  { q: "What happens when I use the daily allowance?", a: "On Free, Builder and Pro, included models use your purchased credits next. Max pauses at its daily fair-use allowance without charging purchased balances. If no credits remain, you can add a pack, upgrade for more daily credits or use your own connected model. A paused task carries on by itself when your allowance refills or you add credits. A bigger plan does not remove a provider's temporary rate limits." },
  { q: "Can I switch plans later?", a: "Yes. Manage or cancel in your Dodo billing portal at any time; cancellation keeps access until the paid period ends. A plan raises the allowance for the day, so credits already used today still count." },
  { q: WHERE_TO_MANAGE, a: "Use AI plans and credits with the same ADCode account you use in the editor. Review your balance, manage a subscription, or redeem a promo or invite code there. Checkout and official invoices are handled by Dodo Payments." },
];

/** Offline, the catalogue's prices stand in for the live list, without New marks. */
const CATALOGUE_RATES: readonly IncludedModelRate[] = HEABSY_PRICES.map(([name, input, cached, output]) => ({ name, input, cached, output }));

/** Credits one uncached agent step (10,000 in, 2,000 out) costs on a model. */
const stepCredits = (model: IncludedModelRate): number => 10 * model.input + 2 * model.output;

/**
 * What each card says beyond the numbers. A row the plan lacks is drawn too, struck and muted:
 * seeing what the next plan adds is what makes the step up legible.
 */
function features(plan: PlanSpec): { text: string; included: boolean }[] {
  const projects = projectPlanBenefits(plan.id);
  return [
    { text: "Every included model", included: true },
    { text: "Premium models, no wallet", included: plan.allModels === true },
    { text: projects.priority, included: true },
    { text: projects.summary, included: true },
    plan.allModels === true
      ? { text: "The largest daily allowance", included: true }
      : { text: plan.invites > 0 ? `${plan.invites} friend invites with bonus credits` : "Friend invites with bonus credits", included: plan.invites > 0 },
    { text: plan.allModels === true ? "Never charges purchased credits" : "Purchased credits after the allowance", included: true },
  ];
}

export function PricingContent({ offer, now = Date.now() }: { offer: PricingOffer; now?: number }) {
  const rates = offer.models ?? CATALOGUE_RATES;
  const plans = PLANS_ON_SALE;
  const max = plans.find((plan) => plan.allModels === true);
  const freeSteps = agentStepsPerDay(offer.freeWeeklyTokens);
  const byStep = [...rates].filter((model) => stepCredits(model) > 0).sort((a, b) => stepCredits(a) - stepCredits(b));
  const fairUseExamples = byStep.length <= 3 ? byStep : [byStep[0]!, byStep[Math.floor(byStep.length / 2)]!, byStep[byStep.length - 1]!];
  return (
    <div className="pricing-page marketplace-wrap">
      <header className="pricing-intro">
        <div>
          <p className="pricing-eyebrow">Pricing</p>
          <h1>Free to start.<br />Three plans when you outgrow it.</h1>
          <p>The editor and {creditAmount(offer.freeWeeklyTokens)} AI credits a day cost nothing. Upgrade when your agent starts waiting for tomorrow&apos;s refill.</p>
        </div>
        <Link href="/ai-tokens" className="pricing-account">Manage your plan and credits <Icon node={ArrowUpRight} /></Link>
      </header>

      {offer.available === false && <p className="pricing-notice" role="status">Plan and token sales are temporarily paused. The free editor is still available.</p>}

      <ul className="pricing-plans" aria-label="AI plans">
        {plans.map((plan, index) => {
          const featured = plan.allModels === true;
          const value = monthlyPackValueCents(plan.weeklyTokens, offer.packs);
          return (
            <li key={plan.id} className="pricing-plan" data-featured={featured} data-plan={plan.id} style={{ "--i": index } as CSSProperties}>
              <div className="pricing-card-title">
                <h3>{plan.name}</h3>
                {featured ? <span className="pricing-flag">Best value</span> : plan.id === "pro" ? <span className="pricing-flag pricing-flag-quiet">3× Builder</span> : null}
              </div>
              <p className="pricing-audience">{PLAN_BENEFITS[plan.id].audience}</p>
              <p className="pricing-plan-price"><strong>{price(plan.priceCents)}</strong><span>/{plan.interval}</span></p>
              <p className="pricing-per-day">{pricePerDay(plan.priceCents, plan.interval)} a day, billed monthly</p>
              <div className="pricing-capacity">
                <p><strong>{creditAmount(plan.weeklyTokens)}</strong> credits a day{featured ? " · fair use" : ""}</p>
                <p className="pricing-steps"><strong>{agentStepsPerDay(plan.weeklyTokens).toLocaleString("en-US")}+</strong> agent steps a day, vs {freeSteps} on Free</p>
                {value > plan.priceCents && <p className="pricing-anchor">Up to <strong>{price(value)}</strong> of top-up credits a month</p>}
              </div>
              <ul className="pricing-card-features">
                {features(plan).map((feature) => (
                  <li key={feature.text} data-included={feature.included}>
                    {feature.included ? <Icon node={Check} /> : <Icon node={Minus} label="Not included:" />}
                    <span>{feature.text}</span>
                  </li>
                ))}
              </ul>
              <Link href={`/ai-tokens?plan=${plan.id}&go=1#plans`} className="pricing-button" aria-label={`Get ${plan.name}, ${price(plan.priceCents)} a ${plan.interval}`}>Get {plan.name} <Icon node={ArrowUpRight} /></Link>
              <p className="pricing-cancel">{creditsPerDollar(plan).toLocaleString("en-US")} credits per dollar · cancel any time</p>
            </li>
          );
        })}
      </ul>
      <p className="pricing-reassure" role="note"><span>Cancel any time, keep access until the period ends</span><span>No card to start on Free</span><span>No overage bills, ever</span><span>Purchased credits never expire</span></p>

      <PlanFinder freeSteps={freeSteps} plans={plans.map((plan) => ({ id: plan.id, name: plan.name, price: price(plan.priceCents), steps: agentStepsPerDay(plan.weeklyTokens) }))} />

      {max !== undefined && (
        <section className="pricing-fairuse" aria-labelledby="pricing-fairuse-heading">
          <div>
            <p className="pricing-eyebrow">How Max&apos;s fair use works</p>
            <h2 id="pricing-fairuse-heading">Practically unlimited.<br />Priced by what each model costs.</h2>
            <p>Max gives you {creditAmount(max.weeklyTokens)} credits a day on every hosted model, premium included. A credit is a tenth of a cent of the model&apos;s list price, so cheap, fast models barely touch the allowance and the most expensive ones use it faster. You never get a bill for going over: requests pause and the allowance refills 24 hours after your first one.</p>
          </div>
          {fairUseExamples.length > 0 && (
            <div className="pricing-fairuse-table" role="region" aria-label="Agent steps a day on Max, by model" tabIndex={0}>
              <table>
                <thead><tr><th>Model</th><th>Credits per step</th><th>Steps a day on Max</th></tr></thead>
                <tbody>{fairUseExamples.map((model) => (
                  <tr key={model.name}><th scope="row">{model.name}</th><td>{stepCredits(model).toFixed(1)}</td><td>{Math.floor(max.weeklyTokens / 11_000 / stepCredits(model)).toLocaleString("en-US")}</td></tr>
                ))}</tbody>
              </table>
              <p className="pricing-small">One uncached step of 10,000 input and 2,000 output tokens. Cached prompts, which agents reuse most of the time, usually stretch these about twice as far. Premium models cost more per step at their published rates.</p>
            </div>
          )}
        </section>
      )}

      <section className="pricing-section" aria-labelledby="pricing-compare-heading">
        <header className="pricing-section-head"><h2 id="pricing-compare-heading">Everything side by side</h2></header>
        <div className="pricing-credit-scroll" role="region" aria-label="Plan comparison" tabIndex={0}>
          <table className="pricing-compare">
            <thead><tr><th>What you get</th><th>Free</th>{plans.map((plan) => <th key={plan.id} data-featured={plan.allModels === true}>{plan.name}</th>)}</tr></thead>
            <tbody>
              <tr><th scope="row">Price</th><td>$0</td>{plans.map((plan) => <td key={plan.id}>{price(plan.priceCents)}/{plan.interval}</td>)}</tr>
              <tr><th scope="row">Daily credits</th><td>{creditAmount(offer.freeWeeklyTokens)}</td>{plans.map((plan) => <td key={plan.id}>{creditAmount(plan.weeklyTokens)}{plan.allModels === true ? " · fair use" : ""}</td>)}</tr>
              <tr><th scope="row">Agent steps a day</th><td>{freeSteps}+</td>{plans.map((plan) => <td key={plan.id}>{agentStepsPerDay(plan.weeklyTokens)}+</td>)}</tr>
              <tr><th scope="row">Premium models</th><td>Separate USD wallet</td>{plans.map((plan) => <td key={plan.id}>{plan.allModels === true ? "Included" : "Separate USD wallet"}</td>)}</tr>
              <tr><th scope="row">Queue priority</th><td>{projectPlanBenefits("free").priority}</td>{plans.map((plan) => <td key={plan.id}>{projectPlanBenefits(plan.id).priority}</td>)}</tr>
              <tr><th scope="row">Shared projects</th><td>{PROJECT_PLANS.free.projects} · {PROJECT_PLANS.free.members} people</td>{plans.map((plan) => <td key={plan.id}>{PROJECT_PLANS[plan.id].projects} · {PROJECT_PLANS[plan.id].members} people</td>)}</tr>
              <tr><th scope="row">Editor and own API keys</th>{[0, ...plans].map((_, i) => <td key={i}>Included</td>)}</tr>
            </tbody>
          </table>
        </div>
        <details className="pricing-credit-rates"><summary>See how far your credits go</summary><p className="pricing-small">Credits per 1,000 tokens{offer.models === undefined ? ". Only models enabled in the model picker are available" : ", for every included model offered now"}. Rates follow the current provider price list; cached input is what an agent&apos;s repeated history usually costs. A 10,000-input / 2,000-output DeepSeek step uses about {CREDITS_PER_AGENT_STEP} credits.</p><div className="pricing-credit-scroll"><table><thead><tr><th>Model</th><th>Input</th><th>Cached input</th><th>Output</th></tr></thead><tbody>{rates.map(model => <tr key={model.name}><th scope="row">{model.name}{isNewModel(model, now) && <span className="pricing-new">New</span>}</th><td>{model.input}</td><td>{model.cached}</td><td>{model.output}</td></tr>)}</tbody></table></div></details>
        <p className="pricing-small pricing-plan-note">Agent-step counts assume one uncached DeepSeek step; they are a floor, not a promise. Credits are usage units, not cash. Plans renew monthly; manage or cancel in your Dodo portal. Top-up values compare a month of daily credits with the cheapest pack per credit; daily credits do not roll over. Included AI requires a verified ADCode account. Provider availability, context windows and rate limits still apply.</p>
      </section>

      <section className="pricing-free" aria-labelledby="pricing-free-heading">
        <div className="pricing-free-title">
          <p className="pricing-eyebrow">Not ready yet?</p>
          <h2 id="pricing-free-heading">Free editor</h2>
          <p className="pricing-free-price">$0<span>No subscription required</span></p>
          <Link href="/versions" className="pricing-button">Download ADCode <Icon node={ArrowUpRight} /></Link>
        </div>
        <div className="pricing-free-details">
          <p>Code, run your project and work with agents without buying a plan.</p>
          <dl>
            <div><dt>Included models</dt><dd>{creditAmount(offer.freeWeeklyTokens)} free credits each day, shared across your devices; Tagflow AI is free. Heabsy and other partner models use paid credits, or come with Max.</dd></div>
            <div><dt>Your own models</dt><dd>Connect a provider key or a local model. Your provider sets its own prices.</dd></div>
          </dl>
          <p className="pricing-small">Sponsored cards help fund the editor. Provider availability, shared capacity and model context limits still apply.</p>
        </div>
      </section>

      <section className="pricing-section pricing-packs-section" aria-labelledby="pricing-packs-heading">
        <header className="pricing-section-head"><h2 id="pricing-packs-heading">Or top up once</h2><p>One-time credits work after the daily allowance on Free, Builder and Pro. Max waits for its daily refill. Purchased credits never expire.</p></header>
        <ul className="pricing-packs" aria-label="One-time credit packs">
          {offer.packs.map(pack => <li key={pack.id}><div><strong>{topUpName(pack.id)}<span>{creditAmount(pack.tokens)} credits</span></strong><p>{price(pack.priceCents)} once</p></div><Link href={`/ai-tokens?pack=${pack.id}&go=1#packs`} aria-label={`Buy ${topUpName(pack.id)} top-up, ${price(pack.priceCents)}`}>Buy <Icon node={ArrowUpRight} /></Link></li>)}
        </ul>
        <p className="pricing-small">Prices are in USD. Dodo calculates applicable tax and shows the final amount before you pay. {offer.available === null && "The standard catalogue is shown while live availability is unavailable. "}Review the current offer in your account before checkout.</p>
      </section>

      <section className="pricing-invites" aria-labelledby="pricing-invites-heading">
        <div><p className="pricing-eyebrow">Build with a friend</p><h2 id="pricing-invites-heading">Pro comes with two invitations</h2></div>
        <div><p>Each friend signs in and redeems your code before starting a paid plan. When their first subscription becomes active while your Pro plan is active, you both receive <strong>100 extra credits</strong>.</p><p className="pricing-small">Each friend can earn the reward once. Promo codes for extra AI usage or plan days can be redeemed on the same account page.</p><Link href="/docs/ai-plans" className="pricing-text-link">How plans and invites work <Icon node={ArrowUpRight} /></Link></div>
      </section>

      <section className="pricing-faq" aria-labelledby="pricing-questions-heading">
        <h2 id="pricing-questions-heading">Before you choose</h2>
        {PRICING_FAQ.map((item) => <details key={item.q}><summary>{item.q}</summary><p>{item.a}{item.q === WHERE_TO_MANAGE && <> <Link href="/ai-tokens">Open AI plans and tokens</Link></>}</p></details>)}
      </section>
    </div>
  );
}
