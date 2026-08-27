import { FAQ } from "@/lib/schema";
import { allPosts } from "@/lib/posts";
import { docsBySection } from "@/lib/docs";
import { allReleases } from "@/lib/releases";
import { SITE, url, ECONOMICS, formatMicros } from "@/lib/site";

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

const rule = "\n\n---\n\n";

export async function GET(): Promise<Response> {
  const sections = await docsBySection();
  const posts = await allPosts({ surface: "blog" });
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
        `URL: ${url(`/blog/${post.slug}`)}\n\n` +
        `${post.description}\n\n` +
        post.body.trim(),
    )
    .join(rule);

  const notes = releases
    .map(
      (release) =>
        `## ${release.version} - ${release.title}\n\n` +
        `Published: ${release.published}\n` +
        `URL: ${url(`/changelog#v${release.version}`)}\n\n` +
        (release.highlights.length > 0
          ? `${release.highlights.map((one) => `- ${one}`).join("\n")}\n\n`
          : "") +
        release.body.trim(),
    )
    .join(rule);

  const faq = FAQ.map((item) => `## ${item.q}\n\n${item.a}`).join("\n\n");

  const text = `# ${SITE.name} - complete text

> ${SITE.description}

This file contains the full text of every page on ${url("/")}, for machine reading. The
short index, with links but no bodies, is at ${url("/llms.txt")}.

Facts, stated once:

- ${SITE.name} is a free, ad-supported code editor for Windows, macOS, and Linux.
- It costs the developer nothing. There is no subscription, trial, or paid tier.
- Advertisers bid in a second-price auction from ${formatMicros(ECONOMICS.floorBlockMicros, 2)}
  per 500 impressions. The developer receives ${ECONOMICS.revSharePercent}% of the clearing price.
- Ads are targeted with a fixed vocabulary of 45 generic tags such as the language and
  framework in use. File contents, file paths, and project names never leave the machine.
- Earnings are recorded on an append-only ledger. Entries are never edited or deleted;
  corrections are separate reversals that reference the original.

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
