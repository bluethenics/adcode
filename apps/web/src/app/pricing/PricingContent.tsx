import Link from "@/components/IntentLink";
import { PLAN_BENEFITS, PLANS, PROJECT_PLANS, projectPlanBenefits, price, creditAmount, topUpName, agentStepsPerDay, pricePerDay, isNewModel, type IncludedModelRate, type PricingOffer } from "@/lib/pricing";
import { Icon } from "@/components/Icon";
import { ArrowUpRight } from "lucide";
import { HEABSY_PRICES } from "@adcode/api/src/aiEconomics.ts";

const WHERE_TO_MANAGE = "Where do I manage billing or redeem a code?";
/** The questions, once: rendered below and published as FAQPage data by the page. */
export const PRICING_FAQ: readonly { q: string; a: string }[] = [
  { q: "Do I need to buy a plan to use ADCode?", a: "No. The editor is free, and free included AI has a daily allowance. All included Heabsy models are available on the free plan. Premium models use a separate USD wallet unless you choose Unlimited. Your own provider connections remain available." },
  { q: "When does my allowance refill?", a: "The shared allowance day starts with your first included AI request. Finite allowances refill each day, including with a monthly plan. Pro includes 900 credits, Max 3,000, and Unlimited 7,500 fair-use credits daily. It is shared across signed-in devices and does not roll over. Purchased credits are separate and never expire." },
  { q: "What happens when I use the daily allowance?", a: "On Free, Weekly, Monthly, Pro and Max, included models use your purchased credits next. Unlimited pauses at its daily fair-use allowance without charging purchased balances. If no credits remain, you can add a pack, upgrade for more daily credits or use your own connected model. A paused task carries on by itself when your allowance refills or you add credits. A bigger plan does not remove a provider’s temporary rate limits." },
  { q: "Does Unlimited mean unlimited tokens?", a: "Unlimited means access to all ADCode-hosted models, including premium models, within 7,500 daily fair-use credits. It does not promise unlimited tokens or requests. Usage pauses at the allowance, refills after 24 hours, and never charges a separate wallet automatically. Only enabled models with an available provider can answer." },
  { q: WHERE_TO_MANAGE, a: "Use AI plans and credits with the same ADCode account you use in the editor. Review your balance, manage a subscription, or redeem a promo or invite code there. Checkout and official invoices are handled by Dodo Payments." },
];

/** Offline, the catalogue's prices stand in for the live list, without New marks. */
const CATALOGUE_RATES: readonly IncludedModelRate[] = HEABSY_PRICES.map(([name, input, cached, output]) => ({ name, input, cached, output }));

export function PricingContent({ offer, now = Date.now() }: { offer: PricingOffer; now?: number }) {
  const rates = offer.models ?? CATALOGUE_RATES;
  return (
    <div className="pricing-page marketplace-wrap">
      <header className="pricing-intro">
        <div>
          <p className="pricing-eyebrow">Pricing</p>
          <h1>Your next idea.<br />A plan to build it.</h1>
          <p>Start with a free editor and daily AI credits. Choose more room when your projects grow.</p>
        </div>
        <Link href="/ai-tokens" className="pricing-account">Manage your plan and credits <Icon node={ArrowUpRight} /></Link>
      </header>

      <section className="pricing-free" aria-labelledby="pricing-free-heading">
        <div className="pricing-free-title">
          <p className="pricing-eyebrow">Always a place to start</p>
          <h2 id="pricing-free-heading">Free editor</h2>
          <p className="pricing-free-price">$0<span>No subscription required</span></p>
          <Link href="/versions" className="pricing-button">Download ADCode <Icon node={ArrowUpRight} /></Link>
        </div>
        <div className="pricing-free-details">
          <p>Code, run your project and work with agents without buying a plan.</p>
          <dl>
            <div><dt>All included models, including Heabsy</dt><dd>{creditAmount(offer.freeWeeklyTokens)} free credits each day - at least {agentStepsPerDay(offer.freeWeeklyTokens)} agent steps on DeepSeek - shared across your devices.</dd></div>
            <div><dt>More building, fewer interruptions</dt><dd>Upgrade for 15× or 60× the free daily credits. No card needed to start.</dd></div>
            <div><dt>Your own models</dt><dd>Connect a provider key or a local model. Your provider sets its own prices.</dd></div>
          </dl>
          <p className="pricing-small">Included AI requires a verified ADCode account. Sponsored cards help fund the editor. Provider availability, shared capacity and model context limits still apply.</p>
        </div>
      </section>

      <section className="pricing-section" aria-labelledby="pricing-plans-heading">
        <header className="pricing-section-head"><h2 id="pricing-plans-heading">Choose your building pace.</h2><p>A simple step up: Monthly for everyday tasks, Pro for daily coding, Max for larger projects. Every plan refills daily.</p></header>
        {offer.available === false && <p className="pricing-notice" role="status">Plan and token sales are temporarily paused. The free editor is still available.</p>}

        <ul className="pricing-plans" aria-label="Heabsy AI plans">
          {PLANS.filter(plan => ["monthly", "pro", "max"].includes(plan.id)).map(plan => (
            <li key={plan.id} className="pricing-plan" data-pro={plan.id === "pro"}>
              <div className="pricing-card-title"><h3>{plan.name}</h3>{plan.id === "pro" && <span className="pricing-recommendation">Recommended for daily coding</span>}{plan.id === "max" && <span className="pricing-value">4× Pro’s daily credits</span>}</div>
              <p className="pricing-plan-price"><strong>{price(plan.priceCents)}</strong><span>/{plan.interval}</span><span className="pricing-per-day">{pricePerDay(plan.priceCents, plan.interval)} a day</span></p>
              <p className="pricing-steps"><strong>{agentStepsPerDay(plan.weeklyTokens).toLocaleString("en-US")}+</strong> agent steps a day <span>vs {agentStepsPerDay(offer.freeWeeklyTokens)} on Free</span></p>
              <p className="pricing-plan-fit"><strong>{PLAN_BENEFITS[plan.id].audience}</strong><span>{PLAN_BENEFITS[plan.id].allowance}</span></p>
              <p className="pricing-card-description">{PLAN_BENEFITS[plan.id].description}</p><ul className="pricing-card-features"><li>All included models</li><li>One account across devices</li><li>{plan.id === "max" ? "3,000 credits, every day" : plan.id === "pro" ? "Includes 2 friend invites" : "15× the free daily credits"}</li></ul><Link href={`/ai-tokens?plan=${plan.id}#plans`} className="pricing-button" aria-label={`View ${plan.name} plan`}>View {plan.name} <Icon node={ArrowUpRight} /></Link>
            </li>
          ))}
        </ul>
        <p className="pricing-reassure" role="note"><span>Cancel any time - access stays until the period ends.</span><span>No card to start.</span><span>Purchased credits never expire.</span></p>
        <aside className="pricing-weekly"><div><strong>Just need a week?</strong><p>Weekly gives 225 credits a day for $3/week. For regular work, Monthly keeps the same daily allowance at $9/month.</p></div><Link href="/ai-tokens?plan=weekly#plans" className="pricing-button">View Weekly <Icon node={ArrowUpRight} /></Link></aside>
        <p className="pricing-small">Agent-step counts assume one uncached DeepSeek step of 10,000 input and 2,000 output tokens; cached prompts usually stretch credits about twice as far. Credits follow model cost: input, output and cached input have different rates. A 10,000-input / 2,000-output DeepSeek request uses about 6.8 credits; shorter conversations and cached prompts use less. Credits are usage units, not cash. Separate USD-wallet models are billed separately on Free, Weekly, Monthly, Pro and Max. Unlimited covers those models within its daily fair-use allowance.</p>
        <details className="pricing-credit-rates"><summary>See how far your credits go</summary><p className="pricing-small">Credits per 1,000 tokens{offer.models === undefined ? ". Only models enabled in the model picker are available" : ", for every included model offered now"}. Rates follow the current provider price list; cached input is what an agent's repeated history usually costs.</p><div className="pricing-credit-scroll"><table><thead><tr><th>Model</th><th>Input</th><th>Cached input</th><th>Output</th></tr></thead><tbody>{rates.map(model => <tr key={model.name}><th scope="row">{model.name}{isNewModel(model, now) && <span className="pricing-new">New</span>}</th><td>{model.input}</td><td>{model.cached}</td><td>{model.output}</td></tr>)}</tbody></table></div></details>
        <p className="pricing-small pricing-plan-note">Plans renew at the billing interval shown. Manage or cancel in your Dodo portal; cancellation keeps access until the paid period ends. A plan raises the allowance for the day, so credits already used today still count.</p>
      </section>

      <section className="pricing-unlimited" aria-labelledby="pricing-unlimited-heading">
        <div><p className="pricing-eyebrow">One plan. Every hosted model.</p><h2 id="pricing-unlimited-heading">Unlimited model access.</h2><p>Move between included and premium models without managing a separate USD wallet.</p><p className="pricing-unlimited-allowance"><strong>7,500 daily credits</strong> · fair-use allowance</p><p className="pricing-small">Usage is finite: requests pause when the daily allowance cannot cover them. Credits refill 24 hours after first use. No automatic wallet charges or overage bills. Provider availability, context windows and rate limits still apply.</p></div>
        <div className="pricing-unlimited-action"><p className="pricing-plan-price"><strong>$299</strong><span>/month</span></p><Link href="/ai-tokens?plan=unlimited#plans" className="pricing-button">View Unlimited <Icon node={ArrowUpRight} /></Link><p className="pricing-small">For individuals using several models every day.</p></div>
      </section>
      <section className="pricing-section" aria-labelledby="pricing-compare-heading"><header className="pricing-section-head"><h2 id="pricing-compare-heading">Find your fit at a glance.</h2><p>Start where you are. Move up when you need the capacity.</p></header><div className="pricing-credit-scroll" role="region" aria-label="Plan comparison" tabIndex={0}><table><thead><tr><th>What you get</th><th>Free</th>{PLANS.filter(p => p.id !== "weekly").map(p => <th key={p.id}>{p.name}</th>)}</tr></thead><tbody><tr><th scope="row">Daily credits</th><td>{creditAmount(offer.freeWeeklyTokens)}</td>{PLANS.filter(p => p.id !== "weekly").map(p => <td key={p.id}>{creditAmount(p.weeklyTokens)}{p.id === "unlimited" ? " · fair use" : ""}</td>)}</tr><tr><th scope="row">Included model access</th>{[0,1,2,3,4].map(i => <td key={i}>Included</td>)}</tr><tr><th scope="row">Separate USD-wallet routes</th>{[0,1,2,3].map(i => <td key={i}>Separate USD wallet</td>)}<td>Daily credits cover usage</td></tr><tr><th scope="row">Editor and own API keys</th>{[0,1,2,3,4].map(i => <td key={i}>Included</td>)}</tr></tbody></table></div></section>
      <section className="pricing-section" aria-labelledby="pricing-projects-heading">
        <header className="pricing-section-head"><h2 id="pricing-projects-heading">Build together. Keep the whole conversation.</h2><p>Shared projects include persistent membership and project chat sessions. Any member can start a conversation; everyone in the project can follow it.</p></header>
        <div className="pricing-credit-scroll" role="region" aria-label="Shared project and request priority limits" tabIndex={0}><table>
          <thead><tr><th>Plan</th><th>Owned projects</th><th>People per project</th><th>When requests queue</th></tr></thead>
          <tbody>{(Object.keys(PROJECT_PLANS) as (keyof typeof PROJECT_PLANS)[]).map(plan=><tr key={plan}><th scope="row">{plan === "free" ? "Free" : PLANS.find(p=>p.id===plan)?.name}</th><td>{PROJECT_PLANS[plan].projects}</td><td>{PROJECT_PLANS[plan].members}</td><td>{projectPlanBenefits(plan).priority}</td></tr>)}</tbody>
        </table></div>
        <p className="pricing-small">People counts include the owner. Invited projects do not use an ownership slot. Existing projects and chats remain accessible after a downgrade; adding projects or members beyond the new limits requires an upgrade. Priority applies to ADCode's hosted-model queue, with fair access for Free. Model and provider generation speeds still vary.</p>
      </section>
      <section className="pricing-section pricing-packs-section" aria-labelledby="pricing-packs-heading">
        <header className="pricing-section-head"><h2 id="pricing-packs-heading">Keep building with a top-up.</h2><p>One-time credits work after the daily allowance on Free, Weekly, Monthly, Pro and Max. Unlimited waits for its daily refill. Purchased credits never expire; Heabsy models are available on the free plan.</p></header>
        <ul className="pricing-packs" aria-label="One-time Heabsy token packs">
          {offer.packs.map(pack => <li key={pack.id}><div><strong>{topUpName(pack.id)}<span>{creditAmount(pack.tokens)} credits</span></strong><p>{price(pack.priceCents)} once</p></div><Link href="/ai-tokens#packs" aria-label={`View ${topUpName(pack.id)} top-up`}>View top-up <Icon node={ArrowUpRight} /></Link></li>)}
        </ul>
        <p className="pricing-small">Prices are in USD. Dodo calculates applicable tax and shows the final amount before you pay. {offer.available === null && "The standard catalogue is shown while live availability is unavailable. "}Review the current offer in your account before checkout.</p>
      </section>

      <section className="pricing-invites" aria-labelledby="pricing-invites-heading">
        <div><p className="pricing-eyebrow">Build with a friend</p><h2 id="pricing-invites-heading">Pro comes with two invitations.</h2></div>
        <div><p>Each friend signs in and redeems your code before starting a paid plan. When their first subscription becomes active while your Pro plan is active, you both receive <strong>100 extra credits</strong>.</p><p className="pricing-small">Each friend can earn the reward once. Promo codes for extra AI usage or plan days can be redeemed on the same account page.</p><Link href="/docs/ai-plans" className="pricing-text-link">How plans and invites work <Icon node={ArrowUpRight} /></Link></div>
      </section>

      <section className="pricing-faq" aria-labelledby="pricing-questions-heading">
        <h2 id="pricing-questions-heading">Before you choose.</h2>
        {PRICING_FAQ.map((item) => <details key={item.q}><summary>{item.q}</summary><p>{item.a}{item.q === WHERE_TO_MANAGE && <> <Link href="/ai-tokens">Open AI plans and tokens</Link></>}</p></details>)}
      </section>
    </div>
  );
}
