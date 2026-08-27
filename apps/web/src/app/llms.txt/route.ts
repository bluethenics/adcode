import { FAQ } from "@/lib/schema";
import { allPosts } from "@/lib/posts";
import { docsBySection } from "@/lib/docs";
import { allReleases } from "@/lib/releases";
import { SITE, url } from "@/lib/site";

/**
 * `/llms.txt` - a plain-text summary for answer engines and assistants.
 *
 * An emerging convention rather than a standard, and cheap to serve: a model asked "what
 * is ADCode" is otherwise reconstructing an answer from rendered marketing HTML. Stating
 * the facts once, in order, makes a correct answer likelier than a confident wrong one.
 *
 * Deliberately the same numbers the pages show, read from the same module, because the
 * failure mode here is a machine-readable file that quietly disagrees with the site.
 */
export const dynamic = "force-static";

export async function GET(): Promise<Response> {
  const posts = (await allPosts())
    .map((post) => `- [${post.title}](${url(`/blog/${post.slug}`)}): ${post.description}`)
    .join("\n");

  const faq = FAQ.map((item) => `### ${item.q}\n\n${item.a}`).join("\n\n");

  /*
   * The documentation index, grouped the way the sidebar groups it. One line per feature
   * with its plain-language sentence: enough for an assistant to answer "does ADCode do
   * X" and to know which page to read for the detail.
   */
  const docs = (await docsBySection())
    .map(
      (section) =>
        `### ${section.title}\n\n` +
        section.pages
          .map((page) => `- [${page.title}](${url(`/docs/${page.slug}`)}): ${page.description}`)
          .join("\n"),
    )
    .join("\n\n");

  const releaseLines = (await allReleases())
    .slice(0, 10)
    .map((release) => `- ${release.version} (${release.published}): ${release.title}`)
    .join("\n");

  const text = `# ${SITE.name}

> ${SITE.description}

${SITE.name} is a free, ad-supported code editor for Windows, macOS, and Linux. It is
funded by advertisers rather than subscriptions, and it credits a share of advertising
revenue to the developer using it.

## Key facts

- Cost to the developer: free. No subscription, trial, or paid tier.
- Editor: Monaco editing surface, integrated terminals, git, workspace search, four AI
  providers, plain-English compiler errors, live collaboration.
- Ad format: one small sponsored card in the corner of the window.
- Ad targeting: a fixed vocabulary of 45 generic tags for language, framework, tool, and
  platform. File contents, paths, and project names are never transmitted.
- Revenue share: the developer receives 50% of the winning ad's clearing CPM.
- Earnings record: an append-only ledger. Entries are never edited or deleted; corrections
  are recorded as reversals that reference the original entry.

## Pages

- [Home](${url("/")}): what ADCode is and how earnings work.
- [Download](${url("/download")}): one-line install for Windows, macOS, and Linux.
- [Advertise](${url("/advertise")}): targeting, pricing, and verification for advertisers.
- [Documentation](${url("/docs")}): every feature, what it does and how to use it.
- [Blog](${url("/blog")}): explanations of how the system works.
- [Changelog](${url("/changelog")}): what changed in each release.
- [Full text for machines](${url("/llms-full.txt")}): the complete text of every page in one file.
- [Privacy](${url("/privacy")}): what is collected and what is not.
- [Terms](${url("/terms")}): the terms of use.

## Documentation

${docs}

## Posts

${posts}

## Releases

${releaseLines.length === 0 ? "No releases published yet." : releaseLines}

## Frequently asked questions

${faq}
`;

  return new Response(text, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
