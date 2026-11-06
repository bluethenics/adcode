import type { Metadata } from "next";
import { pricingOffer } from "@/lib/pricingOffer";
import { pageMetadata } from "@/lib/seo";
import { JsonLd } from "@/components/JsonLd";
import { breadcrumbs, faqPage } from "@/lib/schema";
import { PRICING_FAQ, PricingContent } from "./PricingContent";
import "../ai-tokens/ai-tokens.css";
import "./pricing.css";

export const metadata: Metadata = pageMetadata({
  path: "/pricing",
  title: "Pricing: free code editor, pay-as-you-go AI models",
  socialTitle: "ADCode pricing: free editor, pay only for the models you use",
  description: "ADCode's editor and Tagflow AI are free. Every other AI model is paid from USD credits at its provider's price plus 35%, listed model by model. No subscription; credits never expire.",
});

export const revalidate = 60;


export default async function PricingPage() {
  const offer = await pricingOffer();
  return <>
    <JsonLd data={breadcrumbs([{ name: "Home", path: "/" }, { name: "Pricing", path: "/pricing" }])} />
    <JsonLd data={faqPage(PRICING_FAQ)} />
    <PricingContent offer={offer} />
  </>;
}
