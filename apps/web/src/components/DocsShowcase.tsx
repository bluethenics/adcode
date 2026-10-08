import Link from "next/link";
import { DOC_SEED } from "@/lib/docsSeed";
import "./docsShowcase.css";

/**
 * The docs, last on the homepage.
 *
 * Someone who has read this far is deciding whether ADCode will hold up; the honest answer is
 * that every feature has a manual page. Six of them, picked for a first week - the rest are a
 * click away. Titles and summaries come from the same seed as `/docs`, so a card never says
 * something its page does not.
 */
export const FEATURED_DOCS: readonly string[] = [
  "ai-free-key",
  "ai-live-agents",
  "ai-team",
  "ai-memory-editor",
  "workbench-modes",
  "account-earnings",
];

export function DocsShowcase() {
  const guides = FEATURED_DOCS.flatMap((slug) => DOC_SEED.filter((doc) => doc.slug === slug));
  return (
    <section className="docs-showcase marketplace-wrap" id="docs" aria-labelledby="docs-heading">
      <header className="docs-showcase-head">
        <p className="marketplace-eyebrow"><span /> The manual</p>
        <h2 id="docs-heading">Everything is documented.</h2>
        <p>Every feature has a plain-English guide: what it does, why it helps, and how to use it, step by step.</p>
        <Link className="docs-showcase-all" href="/docs">Browse every guide <span aria-hidden="true">→</span></Link>
      </header>
      <ul className="docs-showcase-grid">
        {guides.map((guide) => (
          <li key={guide.slug}>
            <Link href={`/docs/${guide.slug}`}>
              <span className="docs-showcase-section">{guide.section}</span>
              <strong>{guide.title}</strong>
              <span className="docs-showcase-text">{guide.description}</span>
              <span className="docs-showcase-read" aria-hidden="true">Read the guide →</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
