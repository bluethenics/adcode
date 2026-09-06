import { FAQ } from "@/lib/schema";
import { allPosts } from "@/lib/posts";
import { docsBySection } from "@/lib/docs";
import { landingIndex } from "@/lib/landings";
import { allReleases } from "@/lib/releases";
import { PARENT, SITE, url } from "@/lib/site";

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
    .map((post) => `- [${post.title}](${url(`/docs/${post.slug}`)}): ${post.description}`)
    .join("\n");

  const faq = FAQ.map((item) => `### ${item.q}\n\n${item.a}`).join("\n\n");

  /*
   * The pages written for a question rather than for a visitor.
   *
   * These are the ones an assistant asked "is there a free alternative to Cursor" should
   * be able to reach, and they are also where the honest concessions live - each
   * comparison names the case for choosing the other product. Listing them by their real
   * paths matters more here than anywhere else on the site: the previous version of this
   * file advertised `/download` and `/advertise`, both of which are redirect stubs, so
   * every machine that followed a link from it landed somewhere other than the page it
   * had been promised.
   */
  const pages = landingIndex()
    .map((page) => `- [${page.title}](${url(page.path)}): ${page.description}`)
    .join("\n");

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

## Publisher

${SITE.name} is published by ${PARENT.name} (${PARENT.url}), an independent software studio.
The studio's page about this product is ${PARENT.productUrl}.

## Pages

- [Home](${url("/")}): what ADCode is and how earnings work.
- [Download and releases](${url("/versions")}): one-line install for Windows, macOS, and Linux, and what changed in each release.
- [Advertise](${url("/#advertise")}): targeting, pricing, and verification for advertisers.
- [Documentation](${url("/docs")}): every feature, plus the explanations of how the system works.
- [Full text for machines](${url("/llms-full.txt")}): the complete text of every page in one file.
- [Privacy](${url("/privacy")}): what is collected and what is not.
- [Terms](${url("/terms")}): the terms of use.

## Guides and comparisons

${pages}

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
