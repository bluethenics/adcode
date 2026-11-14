import { WALLET_CUSTOM_MIN_CENTS } from "@adcode/api/src/modelWallet.ts";
import { PLANS_ON_SALE } from "@adcode/api/src/aiPlans.ts";

/**
 * Rendered on the server, so the heading and the offer are there before anyone signs in.
 * Two ways to pay since 13 November 2026: a plan with daily credits, or USD credits model by model.
 */
export function AiTokensHeading() {
  const tiers = [
    { name: "Tagflow AI", value: "Free", note: "every signed-in account" },
    ...(PLANS_ON_SALE.length > 0 ? [{ name: "Plans", value: `$${PLANS_ON_SALE[0]!.priceCents / 100}+`, note: "a month, every hosted model" }] : []),
    { name: "Credits", value: `$${WALLET_CUSTOM_MIN_CENTS / 100}+`, note: "any amount, never expire" },
  ];
  return (
    <header className="ai-tokens-head">
      <div className="ai-tokens-hero-copy">
        <h1>AI credits</h1>
        <p className="ai-tokens-lead">A plan, or pay only for what you use.</p>
        <p>A plan gives you fresh credits every day on every hosted model. Or keep one USD balance for paid models, in any amount from ${WALLET_CUSTOM_MIN_CENTS / 100}: it never expires, and each request is charged only for what it used.</p>
        <nav className="ai-tokens-jump" aria-label="On this page">{PLANS_ON_SALE.length > 0 && <a href="#plans">Plans</a>}<a href="#wallet">Credits and prices</a></nav>
      </div>
      <dl className="ai-tokens-tiers" aria-label="How AI is priced">
        {tiers.map((tier) => <div key={tier.name} data-featured={tier.name === "Plans"}><dt>{tier.name}</dt><dd><strong>{tier.value}</strong></dd><small>{tier.note}</small></div>)}
      </dl>
    </header>
  );
}
