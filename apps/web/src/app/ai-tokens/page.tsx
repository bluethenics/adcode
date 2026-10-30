import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import AiTokens from "./AiTokens";
import "./ai-tokens.css";
import { AiTokensHeading } from "./AiTokensHeading";

export const metadata: Metadata = pageMetadata({
  path: "/ai-tokens",
  title: "AI plans and tokens",
  socialTitle: "AI plans and tokens for ADCode",
  description: "Get more included AI tokens each day: Weekly $3, Monthly $9, or Pro $29 with unlimited tokens and two invites. One-time token packs never expire. Includes Tagflow AI and all other included models.",
});

export default function Page() {
  return (
    <main className="ai-tokens">
      <AiTokensHeading />
      <AiTokens />
    </main>
  );
}
