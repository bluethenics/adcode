import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import AiTokens from "./AiTokens";
import "./ai-tokens.css";
import { AiTokensHeading } from "./AiTokensHeading";

export const metadata: Metadata = pageMetadata({
  path: "/ai-tokens",
  title: "AI credits: pay only for the models you use",
  socialTitle: "AI credits for ADCode",
  description: "Add USD credits once and use any paid model in ADCode at its provider's price plus 35%. No subscription; credits never expire. Tagflow AI stays free.",
});

export default function Page() {
  return (
    <main className="ai-tokens">
      <AiTokensHeading />
      <AiTokens />
    </main>
  );
}
