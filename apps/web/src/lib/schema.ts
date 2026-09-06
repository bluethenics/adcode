/**
 * JSON-LD, in one place.
 *
 * Structured data is what lets a search engine answer a question with this site instead
 * of linking to it, and what lets an answer engine quote it without guessing. Both need
 * the facts stated as data rather than inferred from prose, which is why the economics
 * here come from `site.ts` rather than being typed twice.
 */
import {
  APP_VERSION,
  GITHUB_REPO,
  PARENT,
  SAME_AS,
  SITE,
  url,
  formatMicros,
  ECONOMICS,
} from "./site";

type Node = Record<string, unknown>;

export function organisation(): Node {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": url("/#organization"),
    name: SITE.name,
    /*
     * The spellings a person actually types.
     *
     * "ADCode" is one word to us and two to nearly everybody else, and it collides head-on
     * with "ad code" in the advertising sense - which is a far older, far better-linked
     * meaning of those characters. `alternateName` is how an entity says "these all denote
     * me" rather than leaving a search engine to decide the query meant the other thing.
     */
    alternateName: ["AdCode", "Ad Code Editor", "ADCode IDE", "ADCode Editor"],
    url: url("/"),
    description: SITE.description,
    slogan: SITE.tagline,
    /*
     * A logo and the profiles that corroborate it.
     *
     * These are the properties a knowledge panel is assembled from: without a logo there
     * is no mark to show beside the name, and without `sameAs` there is nothing
     * independent tying this name to the thing it claims to be. Everything cited is public
     * and checkable - see `SAME_AS` for why nothing aspirational belongs in it.
     */
    logo: url("/icon.svg"),
    sameAs: [...SAME_AS],
    /*
     * The edge that makes a subdomain legible.
     *
     * `bluethenics.com` emits the matching `subOrganization` pointing back at this `@id`.
     * A crawler that fetches both sees the same relationship asserted from both ends,
     * which is the difference between a knowledge-graph edge and a hyperlink.
     */
    parentOrganization: {
      "@type": "Organization",
      "@id": PARENT.id,
      name: PARENT.name,
      url: PARENT.url,
    },
  };
}

/**
 * The site as an entity, distinct from the organisation that publishes it.
 *
 * What this buys is the site name in a result - Google reads `WebSite.name` to label the
 * breadcrumb line rather than guessing from the domain, which matters more than usual
 * while the domain is a shared `.workers.dev` subdomain that says nothing about the brand.
 *
 * The `potentialAction` is now honest and so it is declared. A SearchAction has to point at
 * a URL that really performs a search, and `/docs?q=` does: the docs index reads the
 * parameter on the server and hands it to the search field as its initial query, so the
 * URL a crawler constructs from this template returns filtered results without JavaScript
 * having to run first. That is the whole test Google applies before it will show a
 * sitelinks searchbox, and it is why this was absent until the search existed.
 */
export function webSite(): Node {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": url("/#website"),
    name: SITE.name,
    alternateName: ["AdCode", "ADCode Editor"],
    url: url("/"),
    description: SITE.description,
    inLanguage: "en",
    publisher: { "@id": url("/#organization") },
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${url("/docs")}?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
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
    /*
     * The properties that make this an application rather than a page about one.
     *
     * A version and a download URL are what let a result carry "1.0.0" and a direct
     * install route; `softwareRequirements` answers the question every download page is
     * really asked. There is deliberately no `aggregateRating`: there is no review corpus
     * to average, and inventing one is how a software page earns a manual action.
     */
    softwareVersion: APP_VERSION,
    downloadUrl: url("/versions"),
    installUrl: url("/versions"),
    screenshot: url("/opengraph-image.png"),
    softwareRequirements: "Windows 10 or later, macOS 11 or later, or a 64-bit Linux desktop",
    publisher: { "@id": url("/#organization") },
    isAccessibleForFree: true,
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

/**
 * A landing page, as data.
 *
 * Two nodes rather than one, because the page is two things and a search engine treats
 * them differently. The `Article` is the writing - what gets a `dateModified` and an
 * author. The `WebPage` is the address, and it is the node `breadcrumb` and `isPartOf`
 * hang off. Emitting only the article leaves the URL itself undescribed; emitting only
 * the page leaves the writing undated, which is what makes a comparison look stale.
 *
 * Comparison pages carry `about` for both products. Naming the competitor as an entity is
 * not a courtesy - it is what lets "Cursor alternative" resolve to this page rather than
 * to whatever else mentions the word, and an answer engine asked to compare the two has
 * the pair stated rather than inferred from prose.
 */
export function landingArticle(page: {
  slug: string;
  title: string;
  description: string;
  heading: string;
  lede: string;
  updated: string;
  comparison?: { subject: string };
}): Node {
  const path =
    page.comparison === undefined ? `/${page.slug}` : `/compare/${page.slug}`;

  const about: Node[] = [{ "@id": url("/#app") }];
  if (page.comparison !== undefined) {
    about.push({
      "@type": "SoftwareApplication",
      name: page.comparison.subject,
      applicationCategory: "DeveloperApplication",
    });
  }

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        "@id": url(`${path}#article`),
        headline: page.title,
        description: page.description,
        alternativeHeadline: page.heading,
        abstract: page.lede,
        dateModified: page.updated,
        datePublished: page.updated,
        inLanguage: SITE.locale,
        mainEntityOfPage: { "@id": url(path) },
        publisher: { "@id": url("/#organization") },
        author: { "@id": url("/#organization") },
        about,
      },
      {
        "@type": "WebPage",
        "@id": url(path),
        url: url(path),
        name: page.title,
        description: page.description,
        isPartOf: { "@id": url("/#website") },
        primaryImageOfPage: { "@type": "ImageObject", url: url("/opengraph-image.png") },
      },
    ],
  };
}

/**
 * Installing the editor, as steps.
 *
 * `HowTo` is the vocabulary for "how do I install X", which is a query the download page
 * answers in prose and could not previously be quoted from. Each step names the command
 * rather than describing it, because a step whose text is "run the installer" is one an
 * answer engine cannot turn into anything useful.
 */
export function installHowTo(
  steps: readonly { name: string; text: string }[],
): Node {
  return {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: `How to install ${SITE.name}`,
    description: `Install ${SITE.name} on Windows, macOS, or Linux with a single terminal command.`,
    totalTime: "PT2M",
    supply: [],
    tool: [{ "@type": "HowToTool", name: "A terminal" }],
    step: steps.map((step, index) => ({
      "@type": "HowToStep",
      position: index + 1,
      name: step.name,
      text: step.text,
      url: `${url("/versions")}#step-${String(index + 1)}`,
    })),
  };
}
