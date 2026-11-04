import { FREE_WEEKLY_TOKENS, creditAmount, planCredits } from "@/lib/pricing";

/**
 * Rendered on the server, so the heading and the offer are there before anyone signs in.
 *
 * The numbers people come here for - what they get free, and what each plan adds - sit in one
 * strip instead of a paragraph, with a way straight to each part of the page.
 */
export function AiTokensHeading() {
  const tiers = [
    { name: "Free", credits: creditAmount(FREE_WEEKLY_TOKENS), note: "every day, no card" },
    { name: "Builder", credits: planCredits("monthly"), note: "$9 a month" },
    { name: "Pro", credits: planCredits("pro"), note: "$29 a month" },
    { name: "Max", credits: planCredits("max"), note: "$59 · every model, fair use" },
  ];
  return (
    <header className="ai-tokens-head">
      <div className="ai-tokens-hero-copy">
        <h1>AI credits</h1>
        <p className="ai-tokens-lead">Credits for every model in ADCode.</p>
        <p>One balance for all included models, shared across your devices. It refills each day; cheaper models stretch it further, and top-ups never expire.</p>
        <nav className="ai-tokens-jump" aria-label="On this page"><a href="#plans">Plans</a><a href="#packs">Top-ups</a><a href="#wallet">Paid models</a></nav>
      </div>
      <dl className="ai-tokens-tiers" aria-label="Daily credits by plan">
        {tiers.map((tier) => <div key={tier.name} data-featured={tier.name === "Max"}><dt>{tier.name}</dt><dd><strong>{tier.credits}</strong> a day</dd><small>{tier.note}</small></div>)}
      </dl>
    </header>
  );
}
