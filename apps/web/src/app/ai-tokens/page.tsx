import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { planCredits } from "@/lib/pricing";
import AiTokens from "./AiTokens";
import "./ai-tokens.css";
import { AiTokensHeading } from "./AiTokensHeading";

export const metadata: Metadata = pageMetadata({
  path: "/ai-tokens",
  title: "AI plans and credits",
  socialTitle: "AI plans and credits for ADCode",
  description: `Get more included AI credits each day: Builder $9, Pro $29, or Max $59 with every hosted model and ${planCredits("max")} daily fair-use credits. One-time credit packs never expire. Includes Tagflow AI and all other included models.`,
});

export default function Page() {
  return (
    <main className="ai-tokens">
      <AiTokensHeading />
      <AiTokens />
    </main>
  );
}
