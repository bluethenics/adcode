import type { MetadataRoute } from "next";
import { allDocs } from "@/lib/docs";
import { url } from "@/lib/site";

/** Only canonical public pages. Product workspaces are private and secondary routes redirect. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const docs = await allDocs();

  return [
    { url: url("/"), lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: url("/versions"), lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: url("/docs"), lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    ...docs.map((page) => ({
      url: url(`/docs/${page.slug}`),
      lastModified: page.updated === undefined ? now : new Date(page.updated),
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
    { url: url("/privacy"), lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: url("/terms"), lastModified: now, changeFrequency: "yearly", priority: 0.3 },
  ];
}
