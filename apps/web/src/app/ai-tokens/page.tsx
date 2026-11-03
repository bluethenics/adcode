import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import AiTokens from "./AiTokens";
import "./ai-tokens.css";
import { AiTokensHeading } from "./AiTokensHeading";

export const metadata: Metadata = pageMetadata({
  path: "/ai-tokens",
  title: "AI plans and credits",
  socialTitle: "AI plans and credits for ADCode",
  description: "Get more included AI credits each day: Weekly $3, Monthly $9, or Pro $29, Max $99 with 2,200 daily credits, or Unlimited $299 with all hosted models and 6,700 daily fair-use credits. One-time credit packs never expire. Includes Tagflow AI and all other included models.",
});

export default function Page() {
  return (
    <main className="ai-tokens">
      <AiTokensHeading />
      <AiTokens />
    </main>
  );
}
