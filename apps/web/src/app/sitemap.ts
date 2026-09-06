import type { MetadataRoute } from "next";
import { allDocs } from "@/lib/docs";
import { COMPARE_PREFIX, LANDINGS, landingPath } from "@/lib/landings";
import { url } from "@/lib/site";

/** Only canonical public pages. Product workspaces are private and secondary routes redirect. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const docs = await allDocs();

  return [
    { url: url("/"), lastModified: now, changeFrequency: "weekly", priority: 1 },
    /*
     * The landing pages sit at 0.9 - above the docs index, below the homepage.
     *
     * Priority is a hint about relative importance within one site and nothing more, but
     * these are the pages written to be entry points, and the ones a crawler reaches only
     * through the footer and each other. Ranking them here says which of the hundred URLs
     * below are the ones worth recrawling.
     */
    ...LANDINGS.map((page) => ({
      url: url(landingPath(page)),
      lastModified: new Date(page.updated),
      changeFrequency: "monthly" as const,
      priority: 0.9,
    })),
    { url: url(COMPARE_PREFIX), lastModified: now, changeFrequency: "monthly", priority: 0.8 },
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
