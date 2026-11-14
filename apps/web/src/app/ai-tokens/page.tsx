import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import AiTokens from "./AiTokens";
import "./ai-tokens.css";
import { AiTokensHeading } from "./AiTokensHeading";

export const metadata: Metadata = pageMetadata({
  path: "/ai-tokens",
  title: "AI credits: pay only for the models you use",
  socialTitle: "AI credits for ADCode",
  description: "Choose a Builder, Pro or Max plan for fresh credits every day on every hosted model, or add USD credits in any amount from $5. Credits never expire. Tagflow AI stays free.",
});

export default function Page() {
  return (
    <main className="ai-tokens">
      <AiTokensHeading />
      <AiTokens />
    </main>
  );
}
