import { FREE_WEEKLY_TOKENS, creditAmount } from "@/lib/pricing";

/** Rendered on the server, so the heading and the offer are there before anyone signs in. */
export function AiTokensHeading() {
  return (
    <header className="ai-tokens-head">
      <h1>AI credits</h1>
      <p>
        Free included models in ADCode share {creditAmount(FREE_WEEKLY_TOKENS)} free credits every day.
        Try included models without a credit card. Weekly includes 280 credits a day and Monthly 200; Pro includes 650, Max 2,200, and Unlimited 6,700 daily fair-use credits with access to every hosted model. Cheaper models stretch your credits further.
      </p>
    </header>
  );
}

