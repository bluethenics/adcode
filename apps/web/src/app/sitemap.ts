import type { MetadataRoute } from "next";
import { allDocs } from "@/lib/docs";
import { COMPARE_PREFIX, LANDINGS, comparisons, landingPath } from "@/lib/landings";
import { PRIVACY_UPDATED, TERMS_UPDATED } from "@/lib/legal";
import { latestRelease } from "@/lib/releases";
import { SHARE_IMAGE } from "@/lib/seo";
import { url } from "@/lib/site";

/** The newest of some ISO days, or `fallback` when there are none. */
function newest(days: readonly (string | undefined)[], fallback: string): string {
  return days.filter((day): day is string => day !== undefined).reduce(
    (latest, day) => (day > latest ? day : latest),
    fallback,
  );
}

/**
 * Only canonical public pages. Product workspaces are private and secondary routes redirect.
 *
 * ## Dates are real, not "now"
 *
 * Every entry used to carry the time of the request, so every crawl was told every page
 * had just changed. Google's stated rule is that it uses `lastmod` only where it is
 * "consistently and verifiably accurate", and a sitemap in which all 126 pages changed a
 * moment ago is verifiably not - so the site's dates were being ignored wholesale, the
 * genuinely new pages included.
 *
 * Each page now carries the day it last changed. Generated docs ship with the editor, so
 * they change when a release does and carry the latest release's date. When the releases
 * API cannot be reached the fallback is the newest dated page, not today.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [docs, release] = await Promise.all([allDocs(), latestRelease()]);

  const landingDay = newest(LANDINGS.map((page) => page.updated), "2026-08-18");
  const writingDay = newest(docs.map((page) => page.updated ?? page.published), landingDay);
  const releaseDay = release?.published ?? writingDay;
  const siteDay = newest([releaseDay, writingDay, landingDay], landingDay);
  const compareDay = newest(comparisons().map((page) => page.updated), landingDay);

  const at = (day: string): Date => new Date(`${day}T00:00:00Z`);

  return [
    {
      url: url("/"),
      lastModified: at(siteDay),
      changeFrequency: "weekly",
      priority: 1,
      images: [SHARE_IMAGE.url],
    },
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
      lastModified: at(page.updated),
      changeFrequency: "monthly" as const,
      priority: 0.9,
    })),
    { url: url(COMPARE_PREFIX), lastModified: at(compareDay), changeFrequency: "monthly", priority: 0.8 },
    { url: url("/versions"), lastModified: at(releaseDay), changeFrequency: "weekly", priority: 0.8 },
    { url: url("/docs"), lastModified: at(newest([releaseDay, writingDay], writingDay)), changeFrequency: "weekly", priority: 0.8 },
    ...docs.map((page) => ({
      url: url(`/docs/${page.slug}`),
      lastModified: at(page.updated ?? page.published ?? releaseDay),
      changeFrequency: "monthly" as const,
      priority: page.authored ? 0.7 : 0.6,
    })),
    { url: url("/invite"), lastModified: at("2026-10-07"), changeFrequency: "monthly", priority: 0.5 },
    { url: url("/privacy"), lastModified: at(PRIVACY_UPDATED.iso), changeFrequency: "yearly", priority: 0.3 },
    { url: url("/terms"), lastModified: at(TERMS_UPDATED.iso), changeFrequency: "yearly", priority: 0.3 },
  ];
}
