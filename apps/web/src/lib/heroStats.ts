/**
 * How many people are running ADCode, for the hero.
 *
 * Counted from the download totals GitHub publishes against each release asset, which is
 * the only install figure that exists today: there is no public endpoint for it, and
 * `/v1/admin/users` is admin-only and would be the wrong number anyway - an account is not
 * an install, and most people never make one.
 *
 * **Every figure this returns is one somebody else can check.** The release page shows the
 * same per-asset counts, so a number here that did not match would be visibly wrong to the
 * first advertiser who looked - and an advertiser deciding what to bid is doing it on the
 * size of the audience. That is the whole reason this reads from a source neither the site
 * nor its author controls.
 *
 * The urgency comes from the goal rather than from the number. "14 of the first 1,000" is
 * a true sentence that gives somebody a reason to move now; a large invented number is a
 * different kind of sentence entirely.
 */

/** The milestone the hero counts towards. A round number, and a real ambition. */
export const LAUNCH_GOAL = 1_000;

/**
 * Read from the visitor's own browser rather than on the server.
 *
 * The server would be the better place - one cached read shared by everybody, and a real
 * figure in the first paint - but it would make the home page an async component, and
 * `marketplaceLanding.test.tsx` renders that page with `renderToStaticMarkup`, which
 * cannot render a promise. Fetching here keeps the page synchronous and costs one request
 * per visitor against a limit of sixty an hour per address, which no single visitor can
 * approach. `HeroCounter` holds the space so nothing moves when the answer arrives.
 */
const RELEASES_URL = "https://api.github.com/repos/bluethenics/adcode/releases";

/**
 * The asset kinds a person actually installs.
 *
 * `.blockmap` and `latest*.yml` sit beside them for the auto-updater and are fetched by
 * machines, so counting those would inflate the figure with traffic that is not a person.
 */
const INSTALLER = /\.(exe|dmg|deb|AppImage)$/;

interface ApiAsset {
  name?: unknown;
  download_count?: unknown;
}

interface ApiRelease {
  assets?: unknown;
}

export interface HeroStats {
  /** Installer downloads across every published release. */
  readonly installs: number;
  /** Progress towards `LAUNCH_GOAL`, between 0 and 1. */
  readonly progress: number;
}

/** Sum the installer downloads, ignoring anything a machine fetched. */
export function installsFrom(releases: readonly ApiRelease[]): number {
  let total = 0;

  for (const release of releases) {
    if (!Array.isArray(release.assets)) continue;

    for (const asset of release.assets as ApiAsset[]) {
      if (typeof asset.name !== "string" || !INSTALLER.test(asset.name)) continue;
      if (typeof asset.download_count !== "number" || !Number.isFinite(asset.download_count)) {
        continue;
      }
      total += Math.max(0, Math.trunc(asset.download_count));
    }
  }

  return total;
}

/** Clamped, so passing the goal fills the bar rather than overflowing it. */
export function goalProgress(installs: number, goal: number = LAUNCH_GOAL): number {
  if (!Number.isFinite(installs) || installs <= 0 || goal <= 0) return 0;
  return Math.min(1, installs / goal);
}

/** Grouped with the separator the visitor's own locale uses. */
export function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.max(0, Math.trunc(value)));
}

/**
 * The real figure, or null when it cannot be read.
 *
 * Null rather than zero, and the hero renders nothing rather than a placeholder: "0
 * developers" is a worse claim than making no claim, and a number invented to fill the gap
 * would be the worst of the three.
 */
export async function heroStats(): Promise<HeroStats | null> {
  try {
    const response = await fetch(RELEASES_URL, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) return null;

    const body: unknown = await response.json();
    if (!Array.isArray(body)) return null;

    const installs = installsFrom(body as ApiRelease[]);
    if (installs <= 0) return null;

    return { installs, progress: goalProgress(installs) };
  } catch {
    // Unreachable, rate-limited, or shaped differently than expected. The hero simply
    // does not make a claim it cannot support.
    return null;
  }
}
