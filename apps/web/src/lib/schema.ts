/**
 * JSON-LD, in one place.
 *
 * Structured data is what lets a search engine answer a question with this site instead
 * of linking to it, and what lets an answer engine quote it without guessing. Both need
 * the facts stated as data rather than inferred from prose, which is why the economics
 * here come from `site.ts` rather than being typed twice.
 */
import { SITE, url, formatMicros, ECONOMICS } from "./site";

type Node = Record<string, unknown>;

export function organisation(): Node {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": url("/#organization"),
    name: SITE.name,
    url: url("/"),
    description: SITE.description,
  };
}

export function softwareApplication(): Node {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "@id": url("/#app"),
    name: SITE.name,
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Windows, macOS, Linux",
    description: SITE.description,
    // Free to the developer is the entire proposition, so it is stated as data.
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    featureList: [
      "Monaco editing surface",
      "Multiple integrated terminals",
      "Git: stage, commit, branches, blame, commit browser",
      "Workspace search and replace",
      "Four AI providers",
      "Plain-English compiler errors",
      "Built-in preview server",
      "Live collaboration",
    ],
  };
}

export function breadcrumbs(trail: readonly { name: string; path: string }[]): Node {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((step, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: step.name,
      item: url(step.path),
    })),
  };
}

export function faqPage(items: readonly { q: string; a: string }[]): Node {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };
}

export function blogPosting(post: {
  title: string;
  description: string;
  slug: string;
  published: string;
  updated?: string;
}): Node {
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.description,
    datePublished: post.published,
    dateModified: post.updated ?? post.published,
    mainEntityOfPage: { "@type": "WebPage", "@id": url(`/blog/${post.slug}`) },
    publisher: { "@id": url("/#organization") },
    author: { "@id": url("/#organization") },
  };
}

/**
 * A documentation page, as data.
 *
 * `TechArticle` rather than `BlogPosting`: the distinction is exactly the one the site
 * makes between the two surfaces, and a search engine that knows a page is reference
 * material rather than an essay can answer "how do I turn off format on save" with it.
 */
export function techArticle(page: {
  title: string;
  description: string;
  slug: string;
  section: string;
  updated?: string;
}): Node {
  return {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: page.title,
    description: page.description,
    articleSection: page.section,
    ...(page.updated === undefined ? {} : { dateModified: page.updated }),
    mainEntityOfPage: { "@type": "WebPage", "@id": url(`/docs/${page.slug}`) },
    publisher: { "@id": url("/#organization") },
    author: { "@id": url("/#organization") },
    about: { "@id": url("/#app") },
    isPartOf: {
      "@type": "WebSite",
      "@id": url("/#website"),
      name: `${SITE.name} documentation`,
      url: url("/docs"),
    },
    inLanguage: SITE.locale,
  };
}

/**
 * The changelog, as data.
 *
 * Each note is a `SoftwareApplication` carrying `softwareVersion` and `releaseNotes`,
 * which is the vocabulary search engines already understand for "what changed in version
 * N" - rather than an `Article` per version, which describes the writing instead of the
 * software. Wrapped in an `ItemList` so the order is stated rather than inferred.
 */
export function changelog(
  releases: readonly { version: string; title: string; body: string; published: string }[],
): Node {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `${SITE.name} release notes`,
    itemListOrder: "https://schema.org/ItemListOrderDescending",
    itemListElement: releases.map((release, index) => ({
      "@type": "ListItem",
      position: index + 1,
      item: {
        "@type": "SoftwareApplication",
        name: SITE.name,
        applicationCategory: "DeveloperApplication",
        operatingSystem: "Windows, macOS, Linux",
        softwareVersion: release.version,
        datePublished: release.published,
        releaseNotes: `${release.title}. ${release.body}`.slice(0, 900),
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      },
    })),
  };
}

/**
 * The questions people actually ask, answered in full sentences that stand alone.
 *
 * Written so each answer is quotable without its question - an answer engine lifting one
 * of these in isolation should still say something true and complete.
 */
export const FAQ: readonly { q: string; a: string }[] = [
  {
    q: "What is ADCode?",
    a: "ADCode is a free, ad-supported code editor. It provides Monaco-based editing, integrated terminals, git, workspace search, and AI assistance. Instead of charging a subscription, it shows an occasional sponsored card in the corner of the editor and credits a share of the advertising revenue to the developer using it.",
  },
  {
    q: "How much does ADCode cost?",
    a: "ADCode is free. There is no subscription, no trial, and no paid tier. The editor is funded by advertisers, and a share of what they pay goes to the developer rather than only to the vendor.",
  },
  {
    q: "How much can you earn using ADCode?",
    a: `Advertisers bid in a second-price auction from ${formatMicros(ECONOMICS.floorBlockMicros, 2)} per 500 impressions. The developer receives ${ECONOMICS.revSharePercent}% of the winning ad's clearing price, so earnings vary with live demand. ADCode is a way to use a capable editor for free with some money coming back, not a promise of income.`,
  },
  {
    q: "Does ADCode read my source code?",
    a: "No. Ads are targeted using a fixed list of 45 generic tags such as the programming language and framework in use - for example 'lang:rust' or 'fw:react'. File contents, file paths, and project names never leave the machine. AI features send only what you explicitly ask them to send.",
  },
  {
    q: "When does ADCode show ads?",
    a: "Sponsored cards appear in the corner of the window and never interrupt typing, debugging, or a running terminal command. They are rate limited, they can be reduced or switched off entirely in settings, and the server enforces a cap that the client cannot loosen.",
  },
  {
    q: "How are ADCode earnings tracked?",
    a: "Every credit is a row on an append-only ledger visible in the editor and on the web dashboard. Entries are never edited or deleted; a correction is recorded as a separate reversal that references the original, so the full history stays auditable.",
  },
  {
    q: "What platforms does ADCode run on?",
    a: "ADCode runs on Windows, macOS, and Linux. It can be installed with a single terminal command, and it updates itself automatically when a new version is released.",
  },
];
