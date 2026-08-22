import type { MetadataRoute } from "next";
import { url } from "@/lib/site";
import { allPosts } from "@/lib/posts";

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
    { url: url("/blog"), lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: url("/privacy"), lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: url("/terms"), lastModified: now, changeFrequency: "yearly", priority: 0.3 },
  ];

  const posts: MetadataRoute.Sitemap = (await allPosts()).map((post) => ({
    url: url(`/blog/${post.slug}`),
    lastModified: new Date(post.updated ?? post.published),
    changeFrequency: "yearly",
    priority: 0.6,
  }));

  return [...fixed, ...posts];
}
