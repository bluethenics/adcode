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
 * Only the slugs listed above exist.
 *
 * Without this, `/compare/anything` renders on demand and returns 200, which is how a site
 * ends up with an unbounded set of thin pages a crawler will happily discover from a
 * mistyped link. A 404 is the correct answer for a comparison that was never written.
 */
export const dynamicParams = false;

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
