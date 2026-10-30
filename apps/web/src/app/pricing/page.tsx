import type { Metadata } from "next";
import { pricingOffer } from "@/lib/pricingOffer";
import { pageMetadata } from "@/lib/seo";
import { JsonLd } from "@/components/JsonLd";
import { breadcrumbs, faqPage, pricingOffers } from "@/lib/schema";
import { PRICING_FAQ, PricingContent } from "./PricingContent";
import "./pricing.css";

export const metadata: Metadata = pageMetadata({
  path: "/pricing",
  title: "Pricing: free code editor, AI plans from $3 a week",
  socialTitle: "ADCode pricing: free editor, optional AI plans",
  description: "Start with ADCode's free editor, included AI and 3 online projects. Compare Weekly $3, Monthly $9 and Pro $29 plans, or buy token packs that never expire.",
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
