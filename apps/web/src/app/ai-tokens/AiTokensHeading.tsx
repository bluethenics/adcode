import { FREE_WEEKLY_TOKENS, tokenAmount } from "@/lib/pricing";

/** Rendered on the server, so the heading and the offer are there before anyone signs in. */
export function AiTokensHeading() {
  return (
    <header className="ai-tokens-head">
      <h1>AI tokens</h1>
      <p>
        Free included models in ADCode share {tokenAmount(FREE_WEEKLY_TOKENS)} free tokens every day.
        All Heabsy models are available for free with 5M tokens daily. For more daily usage, Weekly includes 20M tokens each day, Monthly includes 100M, and Pro has unlimited tokens.
      </p>
    </header>
  );
}

