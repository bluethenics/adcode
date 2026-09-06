import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LandingArticle } from "@/components/LandingArticle";
import { getLanding, landingMetadata } from "@/lib/landings";

/*
 * A root-level slug rather than something under a prefix.
 *
 * The whole page exists to match "free AI code editor", and a URL is one of the few
 * signals that names a query verbatim. Putting it at `/guides/free-ai-code-editor` would
 * spend the first and strongest segment of the path on a word nobody searches for.
 */
const page = getLanding("free-ai-code-editor");

export const metadata: Metadata = page === null ? {} : landingMetadata(page);

export default function FreeAiCodeEditorPage() {
  if (page === null) notFound();
  return <LandingArticle page={page} />;
}
