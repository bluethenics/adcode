/**
 * Which build a visitor wants, and how they should get it.
 *
 * Pure, and separated from the components that use it, because two of them need the same
 * answer - the hero and the download button - and because "what does this user agent
 * mean" is the kind of thing that is worth a test rather than a guess repeated twice.
 */
export type Platform = "windows" | "macos" | "macos-intel" | "linux" | "unknown";

/**
 * Apple silicon is guessed rather than detected.
 *
 * A browser will not say which chip it is on, and every Mac that is not explicitly
 * reported as an older Intel one is Apple silicon. Guessing wrong costs a person one click
 * on the download page; asking everyone to choose costs everyone one click.
 */
export function detectPlatform(userAgent: string): Platform {
  if (/Win|WOW/.test(userAgent)) return "windows";
  if (/Mac/.test(userAgent)) {
    return /Intel Mac OS X 10_1[0-4]/.test(userAgent) ? "macos-intel" : "macos";
  }
  if (/Linux|X11|CrOS/.test(userAgent)) return "linux";
  return "unknown";
}

/**
 * How this platform should install, which is not the same question as what it can run.
 *
 * - `terminal` - Windows. The build is not code-signed, and a *browser* download of an
 *   unsigned installer earns the "Windows protected your PC" dialog that hides the Run
 *   button behind More info. That dialog fires on the Mark of the Web, a zone tag browsers
 *   attach to downloads; `Invoke-WebRequest` does not set it, and the install is per-user
 *   so it needs no elevation either. The terminal route is not a workaround for the
 *   warning, it is the one that never raises it - so it is what the hero offers.
 * - `download` - Linux. Nothing to sign, nothing to warn about, so a button is simplest.
 * - `soon` - macOS. Notarisation needs a paid Apple membership and an un-notarised app is
 *   refused rather than warned about, so there is nothing honest to offer yet.
 */
export type InstallRoute = "terminal" | "download" | "soon" | "choose";

export function installRoute(platform: Platform): InstallRoute {
  switch (platform) {
    case "windows":
      return "terminal";
    case "linux":
      return "download";
    case "macos":
    case "macos-intel":
      return "soon";
    default:
      // Before hydration, and for anything unrecognised: send them to the page that lists
      // every option rather than guess and be wrong in the most prominent place on the site.
      return "choose";
  }
}

/** The one-liner for a platform that installs from a terminal, or null if it does not. */
export function installCommand(platform: Platform, origin: string): string | null {
  const site = origin.replace(/\/$/, "");
  if (platform === "windows") return `irm ${site}/install.ps1 | iex`;
  if (platform === "linux") return `curl -fsSL ${site}/install.sh | sh`;
  return null;
}
