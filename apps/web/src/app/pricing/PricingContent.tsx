import Link from "@/components/IntentLink";
import { PLANS_ON_SALE, PROJECT_PLANS, agentStepsPerDay, creditAmount, offerEndDate, price, projectPlanBenefits, WALLET_CUSTOM_MAX_CENTS, WALLET_CUSTOM_MIN_CENTS, type PricingOffer } from "@/lib/pricing";
import { Icon } from "@/components/Icon";
import { ArrowUpRight } from "lucide";
import { Buck } from "@/components/buck/Buck";
import { AskBuck } from "@/components/buck/AskBuck";
import { ModelPrices } from "../ai-tokens/ModelPrices";
import { PlanPicker } from "./PlanPicker";
import { PlanFinder } from "./PlanFinder";
import { CustomCredits } from "./CustomCredits";

const WHERE_TO_MANAGE = "Where do I manage my plan, add credits or redeem a code?";
const pro = PLANS_ON_SALE.find((plan) => plan.id === "pro");
/** Whole dollars with a thousands comma: $1,000. */
const usd = (cents: number): string => `$${(cents / 100).toLocaleString("en-US")}`;
const max = PLANS_ON_SALE.find((plan) => plan.id === "max");

/** The questions, once: rendered below and published as FAQPage data by the page. */
export const PRICING_FAQ: readonly { q: string; a: string }[] = [
  { q: "Do I need to pay to use ADCode?", a: "No. The editor is free, and Tagflow AI's sponsored models are free for every signed-in account. A plan or credits are for the other hosted models. Your own provider keys and local models stay free to connect." },
  { q: "Which plan should I choose?", a: `Builder for evenings and side projects, Pro for coding every day, Max for building all day. Most people who code daily are best served by Pro: ${pro === undefined ? "" : `${creditAmount(pro.weeklyTokens)} credits a day for ${price(pro.priceCents)} a month`}. If you only use AI now and then, pay-as-you-go credits may suit you better.` },
  { q: "Is Max unlimited?", a: `Not literally, but close for most people: ${max === undefined ? "" : `${creditAmount(max.weeklyTokens)} credits every day`} on every hosted model, premium included. Credits follow each model's price, so a budget model runs far more agent steps than a premium one. Requests pause at the allowance and continue when it refills; there is never an overage bill.` },
  { q: "Can I cancel?", a: "Yes, any time, in the billing portal linked from AI credits. Your plan keeps working until the end of the period you paid for and does not renew after that." },
  { q: "How does yearly billing work?", a: "Yearly costs ten months' price for twelve months of the same daily credits, paid once a year. Where yearly is offered, the page shows the exact amount charged today before you choose." },
  { q: "Can I pay a custom amount instead?", a: `Yes. Add any whole-dollar amount of USD credits from ${usd(WALLET_CUSTOM_MIN_CENTS)} to ${usd(WALLET_CUSTOM_MAX_CENTS)}, once. Credits never expire, nothing renews, and they pay for any model at its listed price.` },
  { q: "What happens when my daily credits run out?", a: "Requests pause with a message saying so, and Tagflow AI stays free. Your plan refills the next day; USD credits you added keep working in the meantime on plans other than Max. A paused task carries on where it stopped." },
  { q: WHERE_TO_MANAGE, a: "In AI credits, with the same ADCode account you use in the editor: your plan, balance, every charge, the price list and promo codes. Checkout and official invoices are handled by Dodo Payments." },
];

export function PricingContent({ offer }: { offer: PricingOffer; now?: number }) {
  const paid = offer.paidModels ?? [];
  const free = offer.freeModels ?? [];
  // An offer only means something beside the prices it changes.
  const deal = paid.length > 0 ? offer.offer ?? null : null;
  const plans = PLANS_ON_SALE;
  const freeSteps = agentStepsPerDay(offer.freeWeeklyTokens);
  return (
    <div className="pricing-page marketplace-wrap">
      <header className="pricing-intro">
        <div>
          <Buck mood="earning" size={72} interactive greet="proud" label="Buck, flipping a coin. Tap him." />
          <p className="pricing-eyebrow">Pricing</p>
          <h1>More AI every day.<br />One price you can plan around.</h1>
          <p>Every plan covers every hosted model, premium ones included, with fresh credits each day. Start free, and pick a plan when your agent starts waiting for tomorrow.</p>
        </div>
        <Link href="/ai-tokens" className="pricing-account">Manage your plan and credits <Icon node={ArrowUpRight} /></Link>
      </header>

      {deal !== null && (
        <section className="pricing-offer" aria-labelledby="pricing-offer-heading">
          <div className="pricing-offer-copy">
            <p className="pricing-eyebrow">{deal.name}</p>
            <h2 id="pricing-offer-heading">{deal.percent}% off every paid model</h2>
            <p>Until {offerEndDate(deal.endsAt)}, every model paid from USD credits costs {deal.percent}% less. It applies to each request you make while the offer runs, from credits you already have or add now. The prices listed already include it.</p>
          </div>
          <div className="pricing-offer-side">
            <p className="pricing-offer-figure"><strong>{deal.percent}%</strong><span>off until {offerEndDate(deal.endsAt)}</span></p>
            <Link href="#models" className="pricing-button" data-primary="true">See the offer prices <Icon node={ArrowUpRight} /></Link>
          </div>
        </section>
      )}

      {offer.available === false && <p className="pricing-notice" role="status">Purchases are temporarily paused. The free editor and Tagflow AI are still available.</p>}

      {plans.length > 0 && <>
        <PlanPicker plans={plans} freeCredits={offer.freeWeeklyTokens} yearly={offer.yearly === true} />
        <p className="pricing-reassure" role="note"><span>Cancel any time, keep access to the end of the period</span><span>No card needed for Free</span><span>No overage bills</span><span>Tax shown before you pay</span></p>
        <PlanFinder freeSteps={freeSteps} plans={plans.map((plan) => ({ id: plan.id, name: plan.name, price: price(plan.priceCents), steps: agentStepsPerDay(plan.weeklyTokens) }))} />
      </>}

      <CustomCredits />

      {plans.length > 0 && (
        <section className="pricing-section" aria-labelledby="pricing-compare-heading">
          <header className="pricing-section-head"><h2 id="pricing-compare-heading">Everything side by side</h2></header>
          <div className="pricing-credit-scroll" role="region" aria-label="Plan comparison" tabIndex={0}>
            <table className="pricing-compare">
              <thead><tr><th>What you get</th><th>Free</th>{plans.map((plan) => <th key={plan.id} data-featured={plan.id === "pro"}>{plan.name}</th>)}<th>Credits only</th></tr></thead>
              <tbody>
                <tr><th scope="row">Price</th><td>$0</td>{plans.map((plan) => <td key={plan.id}>{price(plan.priceCents)}/month</td>)}<td>{usd(WALLET_CUSTOM_MIN_CENTS)} to {usd(WALLET_CUSTOM_MAX_CENTS)} once</td></tr>
                <tr><th scope="row">Daily credits</th><td>{creditAmount(offer.freeWeeklyTokens)}</td>{plans.map((plan) => <td key={plan.id}>{creditAmount(plan.weeklyTokens)}</td>)}<td>Pay per request</td></tr>
                <tr><th scope="row">Agent steps a day</th><td>{freeSteps}+</td>{plans.map((plan) => <td key={plan.id}>{agentStepsPerDay(plan.weeklyTokens).toLocaleString("en-US")}+</td>)}<td>As far as your balance goes</td></tr>
                <tr><th scope="row">Premium models</th><td>With credits</td>{plans.map((plan) => <td key={plan.id}>Included</td>)}<td>At listed prices</td></tr>
                <tr><th scope="row">Queue priority</th><td>{projectPlanBenefits("free").priority}</td>{plans.map((plan) => <td key={plan.id}>{projectPlanBenefits(plan.id).priority}</td>)}<td>{projectPlanBenefits("free").priority}</td></tr>
                <tr><th scope="row">Shared projects</th><td>{PROJECT_PLANS.free.projects}, up to {PROJECT_PLANS.free.members} people</td>{plans.map((plan) => <td key={plan.id}>{PROJECT_PLANS[plan.id].projects}, up to {PROJECT_PLANS[plan.id].members} people</td>)}<td>{PROJECT_PLANS.free.projects}, up to {PROJECT_PLANS.free.members} people</td></tr>
                <tr><th scope="row">Renews</th><td>Never</td>{plans.map((plan) => <td key={plan.id}>{offer.yearly === true ? "Monthly or yearly" : "Monthly"}, until you cancel</td>)}<td>Never</td></tr>
              </tbody>
            </table>
          </div>
          <p className="pricing-small pricing-plan-note">Agent-step counts assume one uncached step of 10,000 input and 2,000 output tokens on DeepSeek; cached prompts usually stretch them about twice as far, premium models less far. They are a floor, not a promise. Daily credits do not roll over. Included AI requires a verified ADCode account. Provider availability, context windows and rate limits still apply.</p>
        </section>
      )}

      <section className="pricing-section pricing-model-list" id="models" aria-labelledby="model-prices-title">
        {paid.length > 0 ? (
          <ModelPrices
            title={`Every model's price on credits (${paid.length})`}
            offerPercent={deal?.percent}
            models={paid.map((model) => ({ id: model.id, name: model.name, provider: model.provider, available: true, inputPrice: model.input, outputPrice: model.output, cacheInputPrice: model.cached }))}
          />
        ) : (
          <p className="pricing-notice" role="status">The live price list could not be loaded just now. Every model&apos;s price is also shown in <Link href="/ai-tokens#wallet">AI credits</Link> and in the editor&apos;s model picker.</p>
        )}
      </section>

      <section className="pricing-free" aria-labelledby="pricing-free-heading">
        <div className="pricing-free-title">
          <p className="pricing-eyebrow">Not ready yet?</p>
          <h2 id="pricing-free-heading">Free editor</h2>
          <p className="pricing-free-price">$0<span>No card, no trial</span></p>
          <Link href="/versions" className="pricing-button">Download ADCode <Icon node={ArrowUpRight} /></Link>
        </div>
        <div className="pricing-free-details">
          <p>Code, run your project and work with agents without paying anything.</p>
          <dl>
            <div><dt>Tagflow AI</dt><dd>{free.length > 0 ? `${free.join(", ")}: free for every signed-in account, sponsored by Tagflow.` : "Tagflow's sponsored models: free for every signed-in account."}</dd></div>
            <div><dt>Free credits</dt><dd>{creditAmount(offer.freeWeeklyTokens)} credits a day on included models, shared across your devices.</dd></div>
            <div><dt>Your own models</dt><dd>Connect a provider key, a coding CLI you already use, or a local model. Your provider sets its own prices.</dd></div>
          </dl>
          <p className="pricing-small">Sponsored cards help fund the editor. Provider availability and model context limits still apply.</p>
        </div>
      </section>

      <section className="pricing-faq" aria-labelledby="pricing-questions-heading">
        <h2 id="pricing-questions-heading">Before you choose</h2>
        <AskBuck questions={["Which plan is right for me?", "Can I pay a custom amount?", "What happens if I cancel?"]} label="Or ask Buck" />
        {PRICING_FAQ.map((item) => <details key={item.q}><summary>{item.q}</summary><p>{item.a}{item.q === WHERE_TO_MANAGE && <> <Link href="/ai-tokens">Open AI credits</Link></>}</p></details>)}
      </section>

      {pro !== undefined && (
        <section className="closing-cta pricing-closing" aria-labelledby="pricing-closing-heading">
          <Buck mood="greeting" size={88} interactive greet="dancing" hoverMood="proud" reactTo=".pricing-closing" label="Buck, cheering you on. Tap him." />
          <h2 id="pricing-closing-heading">Start with Pro. Cancel any time.</h2>
          <p>{creditAmount(pro.weeklyTokens)} credits every day on every hosted model, for {price(pro.priceCents)} a month.</p>
          <div className="pricing-closing-actions">
            <Link href="/ai-tokens?plan=pro&go=1#plans" className="pricing-button" data-primary="true" data-buck="proud">Get Pro <Icon node={ArrowUpRight} /></Link>
            <Link href="/versions" className="pricing-button">Download free</Link>
          </div>
        </section>
      )}
    </div>
  );
}
