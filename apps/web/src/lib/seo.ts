/**
 * The `<head>` every public page shares, built in one place.
 *
 * Next merges metadata shallowly: a page that sets `openGraph` replaces the layout's
 * `openGraph` wholesale, image included, and a page that sets nothing inherits the
 * homepage's `og:url` and `og:title`. Both happened. Every docs, landing and comparison
 * page shipped with no `og:image` and no `twitter:image` - a bare link wherever it was
 * shared - while `/versions`, `/privacy` and `/terms` told every unfurler they were the
 * homepage. Building the whole block here means a page cannot set half of it.
 */
import type { Metadata } from "next";
import { SITE, url } from "./site";

/**
 * The share image, stated rather than inherited.
 *
 * It is the file-convention image at the app root, which Next serves at this path. Naming
 * it explicitly with its size is what lets an unfurler lay out the card before it has
 * downloaded the picture, and what survives a page overriding `openGraph`.
 */
export const SHARE_IMAGE = {
  url: url("/opengraph-image.png"),
  width: 1200,
  height: 630,
  alt: `${SITE.name} - a free AI code editor that pays you to use it`,
  type: "image/png",
} as const;

/**
 * The machine-readable copies of the site, advertised from every page.
 *
 * These lived only on the layout's `alternates`, and `alternates` is replaced wholesale by
 * any page that sets its own canonical - which is every page. So in practice they were
 * advertised from nowhere.
 */
export const ALTERNATE_TYPES = {
  "text/plain": [{ url: url("/llms.txt"), title: `${SITE.name} for language models` }],
  "application/rss+xml": [{ url: url("/feed.xml"), title: `${SITE.name} updates` }],
};

/** What a result shows before it cuts a snippet off. */
export const DESCRIPTION_LIMIT = 160;

/** A `<title>` longer than this is truncated in a result. */
export const TITLE_LIMIT = 60;

/**
 * A description that fits a result snippet, cut at a sentence where one fits.
 *
 * Whole sentences first, because a snippet that ends on a full stop reads as an answer and
 * one that ends on an ellipsis reads as an advertisement. Only when the first sentence is
 * itself too long does this fall back to a word boundary. Markdown backticks are dropped:
 * a snippet renders them literally.
 */
export function metaDescription(text: string, limit = DESCRIPTION_LIMIT): string {
  const clean = text.replace(/`/g, "").replace(/\s+/g, " ").trim();
  if (clean.length <= limit) return clean;

  const sentences = clean.split(/(?<=[.!?])\s+/);
  let kept = "";
  for (const sentence of sentences) {
    const next = kept === "" ? sentence : `${kept} ${sentence}`;
    if (next.length > limit) break;
    kept = next;
  }
  if (kept !== "") return kept;

  const cut = clean.slice(0, limit - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > limit / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:–-]+$/, "")}…`;
}

interface PageMeta {
  /** Path on this site, e.g. `/docs/git-blame`. Becomes the canonical and `og:url`. */
  path: string;
  /**
   * The `<title>`. A plain string goes through the layout's "%s - ADCode" template;
   * `{ absolute }` is used as written.
   */
  title: string | { absolute: string };
  /** The title on a share card, where no template applies. Defaults to the `<title>`. */
  socialTitle?: string;
  description: string;
  type?: "website" | "article";
  publishedTime?: string;
  modifiedTime?: string;
  /** Section name, for `article:section`. */
  section?: string;
}

export function pageMetadata(page: PageMeta): Metadata {
  const description = metaDescription(page.description);
  const shownTitle =
    typeof page.title === "string" ? `${page.title} - ${SITE.name}` : page.title.absolute;
  const socialTitle = page.socialTitle ?? shownTitle;
  const canonical = url(page.path);
  const type = page.type ?? "website";

  return {
    title: page.title,
    description,
    alternates: { canonical, types: ALTERNATE_TYPES },
    openGraph: {
      type,
      siteName: SITE.name,
      locale: SITE.locale,
      url: canonical,
      title: socialTitle,
      description,
      images: [SHARE_IMAGE],
      ...(type === "article"
        ? {
            ...(page.publishedTime === undefined ? {} : { publishedTime: page.publishedTime }),
            ...(page.modifiedTime === undefined ? {} : { modifiedTime: page.modifiedTime }),
            ...(page.section === undefined ? {} : { section: page.section }),
          }
        : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: socialTitle,
      description,
      images: [{ url: SHARE_IMAGE.url, alt: SHARE_IMAGE.alt }],
    },
  };
}

/**
 * The `<title>` for a generated documentation page.
 *
 * Seeded pages are named after the control - "Run", "Changes panel", "Race mode" - which
 * is right on the page and useless in a result: "Run - ADCode" matches no query anyone
 * types, and the brand in it is one nobody has heard of yet. The category is what a
 * searcher types, so it goes in wherever the result has room for it. Authored articles
 * already have titles written as sentences and are left alone.
 */
export function docTitle(page: { title: string; authored: boolean }): { absolute: string } {
  const plain = `${page.title} - ${SITE.name}`;
  if (page.authored) return { absolute: plain };

  for (const candidate of [
    `${page.title} - ${SITE.name}, the free AI code editor`,
    `${page.title} - ${SITE.name} AI code editor`,
  ]) {
    if (candidate.length <= TITLE_LIMIT) return { absolute: candidate };
  }
  return { absolute: plain };
}

/**
 * A documentation page's description, long enough to be worth a snippet.
 *
 * Some seeded descriptions are a single short clause - "Which company's AI you want to
 * use." - written for a tooltip, where brevity is right. As a snippet that is a line of
 * text with no product in it, so short ones say where the feature lives.
 */
export function docDescription(description: string): string {
  const clean = description.replace(/\s+/g, " ").trim();
  if (clean.length >= 90) return metaDescription(clean);
  return metaDescription(`${clean} A feature of ${SITE.name}, the free AI code editor that pays you to use it.`);
}
