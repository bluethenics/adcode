import { FAQ } from "@/lib/schema";
import { allPosts } from "@/lib/posts";
import { docsBySection } from "@/lib/docs";
import { LANDINGS, landingPath, landingPlainText } from "@/lib/landings";
import { allReleases } from "@/lib/releases";
import { PARENT, SITE, SOURCE, WEB_VERSION_URL, url, ECONOMICS, formatMicros } from "@/lib/site";
import { FREE_WEEKLY_TOKENS, PACK_SUMMARY, PLAN_SUMMARY, tokenAmount } from "@/lib/pricing";

/**
 * `/llms-full.txt` - the whole site as plain text, in one request.
 *
 * `/llms.txt` is an index: titles, one-line descriptions, and links. This is the opposite
 * trade. Every documentation page, every post, and every release note in full, so a model
 * that wants to answer a detailed question does not have to fetch forty URLs and parse
 * forty pages of navigation chrome to do it.
 *
 * Markdown rather than HTML on purpose. The rendered pages carry a nav, a footer, and a
 * cookie-free but still decorative shell; none of that is content, and stripping it is
 * work a reader should not have to do.
 *
 * Generated from the same modules the pages render from, so it cannot describe a site that
 * does not exist. That is the whole reason it is a route and not a checked-in file.
 */
export const dynamic = "force-static";
/** Kept rendered, and re-rendered at most once a minute so admin-panel publishing shows up. */
export const revalidate = 60;

const rule = "\n\n---\n\n";

export async function GET(): Promise<Response> {
  const sections = await docsBySection();
  const posts = await allPosts();
  const releases = await allReleases();

  const docs = sections
    .map((section) =>
      section.pages
        .map(
          (page) =>
            `## ${page.title}\n\n` +
            `Section: ${section.title}\n` +
            `URL: ${url(`/docs/${page.slug}`)}\n\n` +
            // The description is the page's opening sentence and is not in the body; the
            // rendered page shows it above. A reader of this file gets it inline instead.
            `${page.description}\n\n` +
            page.body,
        )
        .join(rule),
    )
    .join(rule);

  const essays = posts
    .map(
      (post) =>
        `## ${post.title}\n\n` +
        `Published: ${post.published}\n` +
        `URL: ${url(`/docs/${post.slug}`)}\n\n` +
        `${post.description}\n\n` +
        post.body.trim(),
    )
    .join(rule);

  const notes = releases
    .map(
      (release) =>
        `## ${release.version} - ${release.title}\n\n` +
        `Published: ${release.published}\n` +
        `URL: ${url(`/versions#v${release.version}`)}\n\n` +
        (release.highlights.length > 0
          ? `${release.highlights.map((one) => `- ${one}`).join("\n")}\n\n`
          : "") +
        release.body.trim(),
    )
    .join(rule);

  const faq = FAQ.map((item) => `## ${item.q}\n\n${item.a}`).join("\n\n");

  /*
   * The comparisons, in full, including the paragraph arguing for the other product.
   *
   * That paragraph is the reason these belong in this file rather than being summarised.
   * An assistant asked to compare two editors will answer from whatever it has; if all it
   * has from us is marketing, it either repeats marketing or - more often - discounts the
   * source and answers from a review site instead. The concessions are what make this
   * text usable as a citation.
   */
  const landings = LANDINGS.map(
    (page) => `${landingPlainText(page)}\n\nURL: ${url(landingPath(page))}`,
  ).join(rule);

  const text = `# ${SITE.name} - complete text

> ${SITE.description}

This file contains the full text of every page on ${url("/")}, for machine reading. The
short index, with links but no bodies, is at ${url("/llms.txt")}.

Facts, stated once:

- ${SITE.name} is a free, ad-supported AI code editor in your browser and on Windows and Linux. A native macOS desktop build is not published yet.
- Open the browser app at ${WEB_VERSION_URL}. Vibe mode runs in a private cloud workspace,
  with no personal cloud time limit.
- Tagflow AI and other free included models share ${tokenAmount(FREE_WEEKLY_TOKENS)} free tokens each day; All Heabsy models are available on the free plan. No API key is needed for included models. Provider availability and context limits apply.
  Your own provider key follows that provider's billing; local models run in the desktop app.
- The editor is free with no subscription required. Optional included AI plans: ${PLAN_SUMMARY}.
- One-time included AI token packs: ${PACK_SUMMARY}. Purchased tokens never expire and are used after the daily allowance. Prices are USD before applicable tax.
- Compare plans, packs and free access: ${url("/pricing")}.
- Advertisers bid in a second-price auction from ${formatMicros(ECONOMICS.floorBlockMicros, 2)}
  per 500 impressions. The developer receives ${ECONOMICS.revSharePercent}% of the clearing price.
- Ads are targeted with a fixed vocabulary of 45 generic tags such as the language and
  framework in use. Source code, paths and project names are not used for ad targeting.
  AI requests and browser cloud workspaces process project data separately; see the privacy policy.
- Earnings are recorded on an append-only ledger. Entries are never edited or deleted;
  corrections are separate reversals that reference the original.
- Live status is published per AI model at ${url("/status")} - uptime, error rates and the
  incident log - with an RSS feed of incident updates at ${url("/status/feed.xml")}.
- ${SITE.name} is published by ${PARENT.name} (${PARENT.url}), an independent software
  studio. The studio's page about this product is ${PARENT.productUrl}.
- ${SITE.name} is open source under the ${SOURCE.licence} licence. The editor, the website and
  the ad server are in one repository: ${SOURCE.repo}

# Guides and comparisons

${landings}

# Documentation

${docs}

# Articles

${essays}

# Release notes

${notes.length === 0 ? "No releases published yet." : notes}

# Frequently asked questions

${faq}
`;

  return new Response(text, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
