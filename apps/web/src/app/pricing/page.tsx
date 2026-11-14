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
  title: "Pricing: free code editor, AI plans and pay-as-you-go credits",
  socialTitle: "ADCode pricing: free editor, three AI plans, or credits in any amount",
  description: "ADCode's editor and Tagflow AI are free. Builder, Pro and Max plans give fresh AI credits every day on every hosted model, or pay as you go with USD credits in any amount from $5.",
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
