import type { Metadata } from "next";
import { pricingOffer } from "@/lib/pricingOffer";
import { pageMetadata } from "@/lib/seo";
import { JsonLd } from "@/components/JsonLd";
import { breadcrumbs, faqPage, pricingOffers } from "@/lib/schema";
import { PRICING_FAQ, PricingContent } from "./PricingContent";
import "./pricing.css";

export const metadata: Metadata = pageMetadata({
  path: "/pricing",
  title: "Pricing: free code editor, AI plans from $9 a month",
  socialTitle: "ADCode pricing: free editor, optional AI plans",
  description: "Start with ADCode's free editor and included AI. Compare Starter $9, Pro $29 and Max $59, which covers every hosted model under fair use, or buy one-time credit packs that never expire.",
});

export const revalidate = 60;


export default async function PricingPage() {
  const offer = await pricingOffer();
  return <>
    <JsonLd data={breadcrumbs([{ name: "Home", path: "/" }, { name: "Pricing", path: "/pricing" }])} />
    <JsonLd data={pricingOffers(offer.packs)} />
    <JsonLd data={faqPage(PRICING_FAQ)} />
    <PricingContent offer={offer} />
  </>;
}
