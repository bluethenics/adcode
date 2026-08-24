import type { MetadataRoute } from "next";
import { url } from "@/lib/site";
import { allPosts } from "@/lib/posts";
import { allReleases } from "@/lib/releases";
import { allDocs } from "@/lib/docs";

/**
 * The sitemap.
 *
 * Only pages worth indexing. The portal, dashboard, and admin areas are behind sign-in
 * and are excluded here as well as disallowed in robots.txt - a URL that always redirects
 * to a login screen spends crawl budget and ranks for nothing.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const fixed: MetadataRoute.Sitemap = [
    { url: url("/"), lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: url("/download"), lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: url("/advertise"), lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: url("/docs"), lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    { url: url("/blog"), lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: url("/changelog"), lastModified: now, changeFrequency: "weekly", priority: 0.6 },
    { url: url("/privacy"), lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: url("/terms"), lastModified: now, changeFrequency: "yearly", priority: 0.3 },
  ];

  /*
   * Documentation ranks above the blog: these are the pages that answer "how do I do X in
   * ADCode", which is the question this site most wants to be the result for.
   */
  const docs: MetadataRoute.Sitemap = (await allDocs()).map((page) => ({
    url: url(`/docs/${page.slug}`),
    ...(page.updated === undefined ? { lastModified: now } : { lastModified: new Date(page.updated) }),
    changeFrequency: "monthly" as const,
    priority: 0.7,
  }));

  const posts: MetadataRoute.Sitemap = (await allPosts({ surface: "blog" })).map((post) => ({
    url: url(`/blog/${post.slug}`),
    lastModified: new Date(post.updated ?? post.published),
    changeFrequency: "yearly",
    priority: 0.6,
  }));

  /*
   * The changelog is one URL, not one per version, so what a release contributes is a
   * fresher `lastModified` rather than another row. Telling a crawler the page changed
   * when a version shipped is the whole point.
   */
  const releases = await allReleases();
  const changed = releases[0];

  if (changed !== undefined) {
    const at = new Date(changed.publishedAt);
    return [
      ...fixed.map((entry) =>
        entry.url === url("/changelog") ? { ...entry, lastModified: at } : entry,
      ),
      ...docs,
      ...posts,
    ];
  }

  return [...fixed, ...docs, ...posts];
}
