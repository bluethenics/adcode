import { Icon } from "@/components/Icon";
import { ArrowUpRight } from "lucide";
import Link from "next/link";
import { FREE_WEEKLY_TOKENS, PLANS_ON_SALE, price, creditAmount } from "@/lib/pricing";

export function FreePlan() {
  return (
    <section className="free-plan marketplace-wrap" id="free-plan" aria-labelledby="free-plan-heading">
      <header className="free-plan-head">
        <p className="marketplace-eyebrow">FREE TO START</p>
        <h2 id="free-plan-heading">Free editor. More AI when you need it.</h2>
        <p className="free-plan-intro">Start without a subscription or credit card. Tagflow AI and other free included models share a daily credit allowance, with plans and packs for more. All Heabsy models are available on the free plan.</p>
      </header>
      <dl className="free-plan-grid">
        <div>
          <dt>All included models, including Heabsy</dt>
          <dd><strong>{creditAmount(FREE_WEEKLY_TOKENS)}</strong> free credits each day</dd>
        </div>
        <div>
          <dt>AI plans</dt>
          <dd><strong>From {price(PLANS_ON_SALE[0]!.priceCents)}</strong> a month for more included AI usage</dd>
        </div>
        <div>
          <dt>Tagflow AI</dt>
          <dd><strong>Included</strong> in the shared daily credit allowance</dd>
        </div>
      </dl>
      <p className="free-plan-limit">Plans raise the daily included AI allowance: Starter 225 credits a day, Pro 900, and Max 1,900 fair-use credits on every hosted model, premium included. Starter and Pro can use purchased credits after the daily allowance; Max waits for its refill and never charges them. Purchased credits never expire. Provider availability, model context limits and shared capacity still apply.</p>
      <p className="free-plan-foot"><Link href="/pricing" className="home-text-link">Compare plans and credit packs <Icon node={ArrowUpRight} /></Link></p>
      <details className="free-plan-details">
        <summary>How the free plan works</summary>
        <div>
          <p>Your shared included AI allowance refills daily across all signed-in devices.</p>
          <p>Idle cloud workspaces sleep automatically and resume with your work saved. Your own provider key follows that provider’s billing.</p>
          <Link href="/docs/ai-credits">Read about included AI <Icon node={ArrowUpRight} /></Link>
        </div>
      </details>
    </section>
  );
}
