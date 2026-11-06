import { WALLET_MARKUP_PERCENT, WALLET_TOPUPS_CENTS } from "@adcode/api/src/modelWallet.ts";

/**
 * Rendered on the server, so the heading and the offer are there before anyone signs in.
 * Since 6 November 2026 there is one way to pay: USD credits, model by model.
 */
export function AiTokensHeading() {
  const tiers = [
    { name: "Tagflow AI", value: "Free", note: "every signed-in account" },
    { name: "Every other model", value: `+${WALLET_MARKUP_PERCENT}%`, note: "on the provider's own price" },
    { name: "Credits", value: `$${WALLET_TOPUPS_CENTS[0] / 100}+`, note: "once, never expire" },
  ];
  return (
    <header className="ai-tokens-head">
      <div className="ai-tokens-hero-copy">
        <h1>AI credits</h1>
        <p className="ai-tokens-lead">Pay only for the models you use.</p>
        <p>One USD balance for every paid model in ADCode, shared across your devices. No subscription; credits never expire, and each request is charged only for what it used.</p>
        <nav className="ai-tokens-jump" aria-label="On this page"><a href="#wallet">Credits and prices</a></nav>
      </div>
      <dl className="ai-tokens-tiers" aria-label="How AI is priced">
        {tiers.map((tier) => <div key={tier.name} data-featured={tier.name === "Every other model"}><dt>{tier.name}</dt><dd><strong>{tier.value}</strong></dd><small>{tier.note}</small></div>)}
      </dl>
    </header>
  );
}
