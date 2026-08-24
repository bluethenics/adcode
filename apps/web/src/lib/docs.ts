/**
 * The documentation site.
 *
 * Two sources, merged: the generated seed in `docsSeed.ts` - every feature ADCode has,
 * taken from the same text the editor shows behind each `?` - and pages the admin has
 * written, which arrive through the same `/v1/posts` endpoint as the blog and are marked
 * for the docs surface.
 *
 * An admin page wins over a seeded one with the same slug. That is what "the admin can
 * edit the docs however they like" means in practice: the generated page is a starting
 * point, not a thing that fights you when you try to replace it.
 */
import { allPosts, type Post } from "./posts";
import { DOC_SECTIONS, DOC_SEED } from "./docsSeed";
import { DOC_GUIDES, SECTION_COMPARISONS } from "./docsGuides";

export interface DocPage {
  slug: string;
  title: string;
  section: string;
  description: string;
  /** Markdown. Assembled from the help text for a seeded page. */
  body: string;
  related: string[];
  /** Sort key within a section. */
  order: number;
  /** True when a person wrote it, false when it came out of the generator. */
  authored: boolean;
  /** ISO day, for `dateModified`. Absent on seeded pages, which ship with the build. */
  updated?: string;
}

/**
 * The seed text arrives as prose; a guide wants steps. Sentences become list items, and
 * the leading "On by default" line - true and useful, but not a step - is lifted out and
 * set above the list instead.
 */
function stepsFromHow(how: string): { note: string | null; steps: string[] } {
  const sentences = how
    .split(/(?<=[.!?])\s+(?=[A-Z"`])/)
    .map((one) => one.trim())
    .filter((one) => one.length > 0);

  const first = sentences[0] ?? "";
  const isDefaultNote = /^(on|off) by default\b/i.test(first);
  const rest = isDefaultNote ? sentences.slice(1) : sentences;

  return {
    note: isDefaultNote ? first : null,
    steps: rest.length > 0 ? rest : [first],
  };
}

/**
 * A seeded page's body.
 *
 * Every page reads as a guide, not a stub: what it is for, the concrete benefits, numbered
 * steps, and a straight answer to "why this over what I use now". Steps and comparison
 * copy come from `docsGuides.ts` where a feature has earned its own; everything else
 * derives honest steps from the seed's own text and uses the section-level argument. The
 * description is not repeated here - it renders as the standfirst above the body.
 */
function bodyFromSeed(seed: (typeof DOC_SEED)[number]): string {
  const guide = DOC_GUIDES[seed.slug];
  const parts: string[] = [];

  parts.push("## When you would want it", "", seed.why, "");

  if (guide?.benefits !== undefined && guide.benefits.length > 0) {
    parts.push("## What you get out of it", "");
    for (const benefit of guide.benefits) parts.push(`- ${benefit}`);
    parts.push("");
  }

  parts.push("## How to use it, step by step", "");
  const { note, steps } =
    guide?.steps !== undefined && guide.steps.length > 0
      ? { note: null, steps: [...guide.steps] }
      : stepsFromHow(seed.how);

  if (note !== null) parts.push(`${note}`, "");
  steps.forEach((step, index) => parts.push(`${index + 1}. ${step}`));
  parts.push("");

  const comparison = guide?.betterThan ?? SECTION_COMPARISONS[seed.section];
  if (comparison !== undefined) {
    parts.push("## Why this beats the usual way", "", comparison, "");
  }

  if (seed.shortcut !== undefined) {
    parts.push("## Shortcut", "", `\`${seed.shortcut}\``, "");
  }

  return parts.join("\n").trimEnd();
}

const seeded = (): DocPage[] =>
  DOC_SEED.map((seed, index) => ({
    slug: seed.slug,
    title: seed.title,
    section: seed.section,
    description: seed.description,
    body: bodyFromSeed(seed),
    related: [...seed.related],
    order: index,
    authored: false,
  }));

const fromPost = (post: Post): DocPage => ({
  slug: post.slug,
  title: post.title,
  section: post.section ?? "Guides",
  description: post.description,
  body: post.body,
  related: [...(post.related ?? [])],
  order: post.order ?? 0,
  authored: true,
  ...(post.updated === undefined ? {} : { updated: post.updated }),
});

/** Every documentation page, seeded and authored, with authored pages winning on slug. */
export async function allDocs(): Promise<DocPage[]> {
  const pages = new Map(seeded().map((page) => [page.slug, page]));

  for (const post of await allPosts({ surface: "docs" })) {
    pages.set(post.slug, fromPost(post));
  }

  return [...pages.values()];
}

export async function getDoc(slug: string): Promise<DocPage | null> {
  return (await allDocs()).find((page) => page.slug === slug) ?? null;
}

export interface DocSection {
  title: string;
  pages: DocPage[];
}

/**
 * The sidebar: pages grouped by section, in the generator's order.
 *
 * Sections the admin invents appear after the generated ones, alphabetically. Interleaving
 * them would mean a new page could silently push "Editing" down the sidebar.
 */
export async function docsBySection(): Promise<DocSection[]> {
  const pages = await allDocs();
  const groups = new Map<string, DocPage[]>();

  for (const page of pages) {
    const existing = groups.get(page.section);
    if (existing === undefined) groups.set(page.section, [page]);
    else existing.push(page);
  }

  const known = DOC_SECTIONS.filter((title) => groups.has(title));
  const extra = [...groups.keys()].filter((title) => !DOC_SECTIONS.includes(title)).sort();

  return [...known, ...extra].map((title) => ({
    title,
    pages: (groups.get(title) ?? []).sort(
      (a, b) => a.order - b.order || a.title.localeCompare(b.title),
    ),
  }));
}

/** Resolve a page's related slugs to the pages themselves, dropping any that vanished. */
export async function relatedPages(page: DocPage): Promise<DocPage[]> {
  const all = await allDocs();
  return page.related
    .map((slug) => all.find((one) => one.slug === slug))
    .filter((one): one is DocPage => one !== undefined);
}
