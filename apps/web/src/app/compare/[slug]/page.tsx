import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LandingArticle } from "@/components/LandingArticle";
import { comparisons, getLanding, isComparison, landingMetadata } from "@/lib/landings";

interface Props {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams(): { slug: string }[] {
  return comparisons().map((page) => ({ slug: page.slug }));
}

/*
 * Allow regeneration when the Worker's incremental cache has no prerendered entry.
 * With dynamicParams=false, a cache miss returns 404 even for a known comparison.
 * The getLanding/isComparison guard below still rejects every unknown slug.
 */
export const dynamicParams = true;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const page = getLanding(slug);
  if (page === null || !isComparison(page)) return { title: "Not found" };
  return landingMetadata(page);
}

export default async function ComparisonPage({ params }: Props) {
  const { slug } = await params;
  const page = getLanding(slug);
  if (page === null || !isComparison(page)) notFound();
  return <LandingArticle page={page} />;
}
