import Link from "@/components/IntentLink";
import { PLAN_BENEFITS, PLANS, price, tokenAmount, topUpName, type PricingOffer } from "@/lib/pricing";
import { Icon } from "@/components/Icon";
import { ArrowUpRight } from "lucide";

const WHERE_TO_MANAGE = "Where do I manage billing or redeem a code?";
/** The questions, once: rendered below and published as FAQPage data by the page. */
export const PRICING_FAQ: readonly { q: string; a: string }[] = [
  { q: "Do I need to buy a plan to use ADCode?", a: "No. The editor is free, and free included AI has a daily allowance. All Heabsy models are available on the free plan. Your own provider connections remain available." },
  { q: "When does my allowance refill?", a: "The shared allowance day starts with your first included AI request. Finite allowances refill each day, including with a monthly plan. Pro has no daily token cap. It is shared across signed-in devices and does not roll over. Purchased tokens are separate and never expire." },
  { q: "What happens when I use the daily allowance?", a: "Heabsy models use your purchased tokens next. If none remain, you can add a pack, choose a plan or use your own connected model. A paused task carries on by itself when your allowance refills or you add tokens. A bigger plan does not remove a provider’s temporary rate limits." },
  { q: WHERE_TO_MANAGE, a: "Use AI plans and tokens with the same ADCode account you use in the editor. Review your balance, manage a subscription, or redeem a promo or invite code there. Checkout and official invoices are handled by Dodo Payments." },
];

export function PricingContent({ offer }: { offer: PricingOffer }) {
  return (
    <div className="pricing-page marketplace-wrap">
      <header className="pricing-intro">
        <div>
          <p className="pricing-eyebrow">Pricing</p>
          <h1>Start free.<br />Add more AI when you need it.</h1>
          <p>The editor stays free. Choose extra Heabsy usage for regular work, or add tokens for a busy week.</p>
        </div>
        <Link href="/ai-tokens" className="pricing-account">Manage your plan and tokens <Icon node={ArrowUpRight} /></Link>
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
            <div><dt>All included models, including Heabsy</dt><dd>{tokenAmount(offer.freeWeeklyTokens)} free tokens each day, shared across your devices.</dd></div>
            <div><dt>Heabsy models</dt><dd><strong>Requires an active Weekly, Monthly or Pro plan</strong>, shared across your devices.</dd></div>
            <div><dt>Your own models</dt><dd>Connect a provider key or a local model. Your provider sets its own prices.</dd></div>
          </dl>
          <p className="pricing-small">Included AI requires a verified ADCode account. Sponsored cards help fund the editor. Provider availability, shared capacity and model context limits still apply.</p>
        </div>
      </section>

      <section className="pricing-section" aria-labelledby="pricing-plans-heading">
        <header className="pricing-section-head"><h2 id="pricing-plans-heading">More room for your week.</h2><p>All Heabsy models are included for free. Weekly and Monthly refill each day; Pro has unlimited tokens.</p></header>
        {offer.available === false && <p className="pricing-notice" role="status">Plan and token sales are temporarily paused. The free editor is still available.</p>}
        <div className="pricing-plan-labels" aria-hidden="true"><span>Plan</span><span>Billing</span><span>Made for</span><span /></div>
        <ul className="pricing-plans" aria-label="Heabsy AI plans">
          {PLANS.map(plan => (
            <li key={plan.id} className="pricing-plan" data-pro={plan.id === "pro"}>
              <div><h3>{plan.name}</h3>{plan.invites > 0 && <span className="pricing-plan-extra">Includes {plan.invites} friend invites</span>}</div>
              <p className="pricing-plan-price"><strong>{price(plan.priceCents)}</strong><span>/{plan.interval}</span></p>
              <p className="pricing-plan-fit"><strong>{PLAN_BENEFITS[plan.id].audience}</strong><span>{PLAN_BENEFITS[plan.id].allowance}</span></p>
              <Link href={`/ai-tokens?plan=${plan.id}#plans`} className="pricing-button" aria-label={`View ${plan.name} plan`}>View {plan.name} <Icon node={ArrowUpRight} /></Link>
            </li>
          ))}
        </ul>
        <p className="pricing-small pricing-plan-note">Plans renew at the billing interval shown. Manage or cancel in your Dodo portal; cancellation keeps access until the paid period ends. A plan raises the allowance for the day, so tokens already used today still count.</p>
      </section>

      <section className="pricing-section pricing-packs-section" aria-labelledby="pricing-packs-heading">
        <header className="pricing-section-head"><h2 id="pricing-packs-heading">Extra tokens for your plan.</h2><p>One-time packs extend a finite plan after its daily allowance. Purchased tokens never expire; Heabsy models are available on the free plan.</p></header>
        <ul className="pricing-packs" aria-label="One-time Heabsy token packs">
          {offer.packs.map(pack => <li key={pack.id}><div><strong>{topUpName(pack.id)}<span>{tokenAmount(pack.tokens)} tokens</span></strong><p>{price(pack.priceCents)} once</p></div><Link href="/ai-tokens#packs" aria-label={`View ${topUpName(pack.id)} top-up`}>View top-up <Icon node={ArrowUpRight} /></Link></li>)}
        </ul>
        <p className="pricing-small">Prices are in USD. Dodo calculates applicable tax and shows the final amount before you pay. {offer.available === null && "The standard catalogue is shown while live availability is unavailable. "}Review the current offer in your account before checkout.</p>
      </section>

      <section className="pricing-invites" aria-labelledby="pricing-invites-heading">
        <div><p className="pricing-eyebrow">Build with a friend</p><h2 id="pricing-invites-heading">Pro comes with two invitations.</h2></div>
        <div><p>Each friend signs in and redeems your code before starting a paid plan. When their first subscription becomes active while your Pro plan is active, you both receive <strong>4.4M extra tokens</strong>.</p><p className="pricing-small">Each friend can earn the reward once. Promo codes for extra AI usage or plan days can be redeemed on the same account page.</p><Link href="/docs/ai-plans" className="pricing-text-link">How plans and invites work <Icon node={ArrowUpRight} /></Link></div>
      </section>

      <section className="pricing-faq" aria-labelledby="pricing-questions-heading">
        <h2 id="pricing-questions-heading">Before you choose.</h2>
        {PRICING_FAQ.map((item) => <details key={item.q}><summary>{item.q}</summary><p>{item.a}{item.q === WHERE_TO_MANAGE && <> <Link href="/ai-tokens">Open AI plans and tokens</Link></>}</p></details>)}
      </section>
    </div>
  );
}
