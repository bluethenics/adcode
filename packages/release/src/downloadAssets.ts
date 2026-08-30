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
 * and the route file and hands the strings here, the same arrangement
 * `releaseDirectory.ts` already has with `scripts/release-directory.mjs`.
 */

/**
 * The asset each platform id resolves to, read from the route's own `PLATFORMS` literal.
 *
 * A regex over TypeScript, for the same reason `scripts/docs-seed.mjs` uses one: the
 * alternative is transpiling a Next route inside a release script, and the shape being
 * read is one this repository controls and this package's test pins.
 *
 * Throws rather than returning an empty map when it matches nothing. Parsing nothing and
 * reporting success is exactly how a check like this quietly stops checking.
 */
export function expectedAssets(source: string): ReadonlyMap<string, string> {
  const block = /const PLATFORMS = \{([\s\S]*?)\n\} as const;/.exec(source);
  if (block === null) {
    throw new Error("could not find the PLATFORMS literal - the route's shape has changed");
  }

  const found = new Map<string, string>();
  for (const line of (block[1] ?? "").matchAll(/"?([a-z-]+)"?:\s*\{\s*asset:\s*"([^"]+)"/g)) {
    found.set(line[1] as string, line[2] as string);
  }

  if (found.size === 0) {
    throw new Error("PLATFORMS parsed as empty - the route's shape has changed");
  }

  return found;
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
