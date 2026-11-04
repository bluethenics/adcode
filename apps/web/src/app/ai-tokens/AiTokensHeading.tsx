import { FREE_WEEKLY_TOKENS, creditAmount } from "@/lib/pricing";

/** Rendered on the server, so the heading and the offer are there before anyone signs in. */
export function AiTokensHeading() {
  return (
    <header className="ai-tokens-head">
      <h1>AI credits</h1>
      <p>
        Free included models in ADCode share {creditAmount(FREE_WEEKLY_TOKENS)} free credits every day.
        Try included models without a credit card. Builder includes 225 credits a day and Pro 900. Max includes 1,330 daily fair-use credits with access to every hosted model, premium ones included. Cheaper models stretch your credits further.
      </p>
    </header>
  );
}

