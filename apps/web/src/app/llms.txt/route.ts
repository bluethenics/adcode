import { FAQ } from "@/lib/schema";
import { allPosts } from "@/lib/posts";
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
- Revenue share: the developer receives 50% of the advertiser's CPM.
- Earnings record: an append-only ledger. Entries are never edited or deleted; corrections
  are recorded as reversals that reference the original entry.

## Pages

- [Home](${url("/")}): what ADCode is and how earnings work.
- [Download](${url("/download")}): one-line install for Windows, macOS, and Linux.
- [Advertise](${url("/advertise")}): targeting, pricing, and verification for advertisers.
- [Blog](${url("/blog")}): explanations of how the system works.
- [Privacy](${url("/privacy")}): what is collected and what is not.
- [Terms](${url("/terms")}): the terms of use.

## Posts

${posts}

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
