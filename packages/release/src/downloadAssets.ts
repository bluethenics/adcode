/**
 * Do the built installers have the names the terminal install scripts will ask for?
 *
 * The install scripts (`apps/web/public/install.ps1` and `install.sh`) fetch the latest
 * GitHub release and pick an asset by pattern - `*.exe` on Windows, `.deb` or
 * `.AppImage` on Linux. The exact filenames below are what `electron-builder.yml`
 * produces through `artifactName` templates whose `${arch}` token resolves differently
 * per target - `x64` for an `.exe`, `x86_64` for an AppImage, `amd64` for a `.deb`.
 *
 * The failure this check guards against is the quiet kind: the build succeeds, the
 * release publishes, and the install scripts find no asset for the platform.
 *
 * Pure - no filesystem, no process. `scripts/check-release-assets.mjs` reads the directory
 * and hands the strings here, the same arrangement `releaseDirectory.ts` already has
 * with `scripts/release-directory.mjs`.
 */

/** One installer the terminal install scripts can fetch, as parsed out of a source file. */
export interface ParsedTarget {
  readonly id: string;
  readonly asset: string;
  readonly available: boolean;
}

/**
 * The installers the terminal install scripts need, by the platform id the release
 * workflow checks per runner (`windows`, `linux`, `linux-deb`, `macos`, `macos-intel`).
 *
 * macOS ids map to nothing: macOS installs are advertised as coming soon, so requiring
 * a .dmg would block every release on a build nobody is being offered.
 */
export const TERMINAL_REQUIRED_ASSETS: Readonly<Record<string, readonly string[]>> = {
  windows: ["ADCode-Setup-x64.exe"],
  linux: ["ADCode-x86_64.AppImage"],
  "linux-deb": ["ADCode-amd64.deb"],
  macos: [],
  "macos-intel": [],
};

/** Every asset a release has to carry for the terminal install to work everywhere. */
export const ALL_TERMINAL_ASSETS: readonly string[] = [
  ...(TERMINAL_REQUIRED_ASSETS["windows"] ?? []),
  ...(TERMINAL_REQUIRED_ASSETS["linux"] ?? []),
  ...(TERMINAL_REQUIRED_ASSETS["linux-deb"] ?? []),
];

/**
 * Every installer declared in a `DOWNLOADS`-shaped source, read with a regex.
 *
 * Kept as a pure parser so the shape of an asset list stays tested without a
 * filesystem. `scripts/check-release-assets.mjs` no longer reads
 * `apps/web/src/lib/downloads.ts` - the website has no file downloads - but the parsing
 * and set-difference helpers below are still the units under test.
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
 * A platform marked unavailable is one advertised as coming soon, so requiring its
 * installer would block every release on a build nobody is being offered. Pass an id
 * to narrow to one platform, for a per-runner check. Unknown ids fall back to the
 * terminal asset table above, which is what the release workflow checks.
 */
export function requiredAssets(
  targets: readonly ParsedTarget[],
  only?: string,
): readonly string[] {
  // No parsed list (the website no longer declares downloads): answer from the static
  // table of what the terminal install scripts fetch.
  if (targets.length === 0) {
    if (only === undefined) return ALL_TERMINAL_ASSETS;
    return TERMINAL_REQUIRED_ASSETS[only] ?? [];
  }
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
