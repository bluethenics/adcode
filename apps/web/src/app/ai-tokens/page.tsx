import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import AiTokens from "./AiTokens";
import "./ai-tokens.css";

export const metadata: Metadata = pageMetadata({
  path: "/ai-tokens",
  title: "AI plans and tokens",
  socialTitle: "AI plans and tokens for ADCode",
  description: "Get more Heabsy tokens each week: Weekly $3, Monthly $9, or Pro $19 with 150M tokens a week and two invites. One-time token packs never expire. Tagflow AI stays free.",
});

/** Rendered on the server, so the heading and the offer are there before anyone signs in. */
export function AiTokensHeading() {
  return (
    <header className="ai-tokens-head">
      <h1>AI tokens</h1>
      <p>
        Heabsy&apos;s models in ADCode - GLM 5.3 Flash, Qwen 3.8 and Mimo - include 10M free tokens every week.
        Choose a plan for a bigger weekly allowance, or buy extra tokens for a heavy week. Tagflow AI stays free with no weekly limit.
      </p>
    </header>
  );
}

export default function Page() {
  return (
    <main className="ai-tokens">
      <AiTokensHeading />
      <AiTokens />
    </main>
  );
}
