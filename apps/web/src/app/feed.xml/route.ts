import { allPosts } from "@/lib/posts";
import { allReleases } from "@/lib/releases";
import { SITE, url } from "@/lib/site";

/**
 * `/feed.xml` - RSS for the blog and the changelog.
 *
 * Both in one feed rather than two. Somebody subscribing to a developer tool wants to know
 * when it changed and when something was written about it; splitting that into two URLs
 * mostly produces one subscription and one missed half.
 *
 * RSS 2.0 rather than Atom because more readers accept it without argument, and because
 * the extra correctness Atom buys does not matter for a feed with two kinds of item in it.
 */
export const dynamic = "force-static";

/** XML has five characters that cannot appear raw, and a title will contain them. */
const escape = (raw: string): string =>
  raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const rfc822 = (iso: string): string => new Date(`${iso}T00:00:00Z`).toUTCString();

export async function GET(): Promise<Response> {
  const posts = (await allPosts({ surface: "blog" })).map((post) => ({
    title: post.title,
    link: url(`/blog/${post.slug}`),
    description: post.description,
    date: post.published,
    category: "Article",
  }));

  const releases = (await allReleases()).map((release) => ({
    title: `${release.version} — ${release.title}`,
    link: url(`/changelog#v${release.version}`),
    description:
      release.highlights.length > 0 ? release.highlights.join(". ") : release.title,
    date: release.published,
    category: "Release",
  }));

  const items = [...posts, ...releases]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 50)
    .map(
      (item) => `    <item>
      <title>${escape(item.title)}</title>
      <link>${escape(item.link)}</link>
      <guid isPermaLink="true">${escape(item.link)}</guid>
      <category>${item.category}</category>
      <pubDate>${rfc822(item.date)}</pubDate>
      <description>${escape(item.description)}</description>
    </item>`,
    )
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escape(SITE.name)}</title>
    <link>${url("/")}</link>
    <atom:link href="${url("/feed.xml")}" rel="self" type="application/rss+xml" />
    <description>${escape(SITE.description)}</description>
    <language>${SITE.locale.replace("_", "-")}</language>
${items}
  </channel>
</rss>
`;

  return new Response(xml, {
    headers: {
      "content-type": "application/rss+xml; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
