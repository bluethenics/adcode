/**
 * Do the built installers have the names the website will ask for?
 *
 * `apps/web/src/app/dl/[platform]/route.ts` streams `releases/latest/download/<asset>` for
 * five fixed asset names. `electron-builder.yml` produces those names through
 * `artifactName` templates whose `${arch}` token resolves differently per target - `x64`
 * for an `.exe`, `x86_64` for an AppImage, `amd64` for a `.deb`. The two files agree only
 * because whoever wrote them knew that, and nothing checked it.
 *
 * The failure that causes is the quiet kind: the build succeeds, the release publishes,
 * every download button returns 404, and the first person to notice is a user.
 *
 * Pure - no filesystem, no process. `scripts/check-release-assets.mjs` reads the directory
 * and `apps/web/src/lib/downloads.ts` and hands the strings here, the same arrangement
 * `releaseDirectory.ts` already has with `scripts/release-directory.mjs`.
 */

/** One download the site offers, as parsed out of `apps/web/src/lib/downloads.ts`. */
export interface ParsedTarget {
  readonly id: string;
  readonly asset: string;
  readonly available: boolean;
}

/**
 * Every download the site declares, read from its own `DOWNLOADS` literal.
 *
 * A regex over TypeScript, for the same reason `scripts/docs-seed.mjs` uses one: the
 * alternative is transpiling a Next module inside a release script, and the shape being
 * read is one this repository controls and this package's test pins.
 *
 * Throws rather than returning an empty list when it matches nothing. Parsing nothing and
 * reporting success is exactly how a check like this quietly stops checking.
 */
export function parseDownloads(source: string): readonly ParsedTarget[] {
  const found: ParsedTarget[] = [];

  const entry =
    /id:\s*"([^"]+)"[\s\S]*?asset:\s*"([^"]+)"[\s\S]*?available:\s*(true|false)/g;

  for (const match of source.matchAll(entry)) {
    found.push({
      id: match[1] as string,
      asset: match[2] as string,
      available: match[3] === "true",
    });
  }

  if (found.length === 0) {
    throw new Error("no downloads parsed - the shape of DOWNLOADS has changed");
  }

  return found;
}

/**
 * The assets a release actually has to carry.
 *
 * A platform marked unavailable is one the site advertises as coming soon and does not
 * link, so requiring its installer would block every release on a build nobody is being
 * offered. Pass an id to narrow to one platform, for a per-runner check.
 */
export function requiredAssets(
  targets: readonly ParsedTarget[],
  only?: string,
): readonly string[] {
  return targets
    .filter((target) => target.available && (only === undefined || target.id === only))
    .map((target) => target.asset);
}

/**
 * Which of `wanted` are not in `present`, in the order they were wanted.
 *
 * Every missing name, not the first: a release that is short three files should say so
 * once rather than over three build attempts.
 */
export function missingFrom(
  present: readonly string[],
  wanted: readonly string[],
): readonly string[] {
  const have = new Set(present);
  return wanted.filter((name) => !have.has(name));
}
