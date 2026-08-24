/**
 * Release notes, for the public changelog.
 *
 * Same shape as `posts.ts` and for the same reason: read from the API so publishing from
 * the admin panel appears without a deploy, revalidated rather than cached forever, and
 * failing to an empty list rather than to an error. A changelog that 500s because a
 * backend is unreachable is worse than one that is briefly short a row.
 *
 * There is no bundled fallback here, unlike the blog. A blog post is evergreen and worth
 * showing slightly stale; a release note baked into the build would claim a version
 * shipped that this deployment may not have, which is worse than saying nothing.
 */
import { API_ORIGIN } from "./site";

export interface ReleaseNote {
  version: string;
  title: string;
  body: string;
  highlights: string[];
  critical: boolean;
  /** ISO day, for the URL-free `<time>` on the page. */
  published: string;
  publishedAt: number;
}

interface ApiRelease {
  version: string;
  title: string;
  body: string;
  highlights?: unknown;
  critical?: unknown;
  publishedAt: number | null;
  updatedAt: number;
}

const REVALIDATE_SECONDS = 60;

const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

function fromApi(release: ApiRelease): ReleaseNote {
  const at = release.publishedAt ?? release.updatedAt;

  return {
    version: release.version,
    title: release.title,
    body: typeof release.body === "string" ? release.body : "",
    highlights: Array.isArray(release.highlights)
      ? release.highlights.filter((one): one is string => typeof one === "string")
      : [],
    critical: release.critical === true,
    published: isoDay(at),
    publishedAt: at,
  };
}

/** Newest first. Empty when the API cannot be reached. */
export async function allReleases(): Promise<ReleaseNote[]> {
  try {
    const response = await fetch(`${API_ORIGIN}/v1/releases`, {
      next: { revalidate: REVALIDATE_SECONDS },
    });
    if (!response.ok) return [];

    const body = (await response.json()) as { releases?: ApiRelease[] };
    if (!Array.isArray(body.releases)) return [];

    return body.releases.map(fromApi).sort((a, b) => b.publishedAt - a.publishedAt);
  } catch {
    return [];
  }
}

/** The one to mention in the bar at the top of the site, if any is worth mentioning. */
export async function latestRelease(): Promise<ReleaseNote | null> {
  const all = await allReleases();
  return all[0] ?? null;
}
