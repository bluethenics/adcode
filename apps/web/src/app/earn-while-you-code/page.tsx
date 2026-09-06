import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LandingArticle } from "@/components/LandingArticle";
import { getLanding, landingMetadata } from "@/lib/landings";

/*
 * The brand line is also a query, which is the rare case where a slogan earns a URL.
 * "Earn while you code" is what people type; the page answers it with arithmetic rather
 * than with the slogan repeated back.
 */
const page = getLanding("earn-while-you-code");

export const metadata: Metadata = page === null ? {} : landingMetadata(page);

export default function EarnWhileYouCodePage() {
  if (page === null) notFound();
  return <LandingArticle page={page} />;
}
