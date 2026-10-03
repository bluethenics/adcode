/**
 * Which build a visitor wants, and how they should get it.
 *
 * Pure, and separated from the components that use it, because "what does this user
 * agent mean" is the kind of thing that is worth a test rather than a guess repeated
 * twice.
 */
export type Platform = "windows" | "macos" | "macos-intel" | "linux" | "mobile" | "unknown";

/**
 * Apple silicon is guessed rather than detected.
 *
 * A browser will not say which chip it is on, and every Mac that is not explicitly
 * reported as an older Intel one is Apple silicon. Guessing wrong costs a person one click
 * on the install page; asking everyone to choose costs everyone one click.
 */
export function detectPlatform(userAgent: string, maxTouchPoints = 0): Platform {
  // Mobile browsers include desktop OS names; iPadOS can even report Macintosh.
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)) return "mobile";
  if (/Win|WOW/.test(userAgent)) return "windows";
  if (/Mac/.test(userAgent)) {
    return /Intel Mac OS X 10_1[0-4]/.test(userAgent) ? "macos-intel" : "macos";
  }
  if (/Linux|X11|CrOS/.test(userAgent)) return "linux";
  return "unknown";
}

/**
 * The Microsoft Store listing.
 *
 * The Store build is the one Windows install that is signed - by Microsoft, as part of
 * certification - so it is the one a browser can download without SmartScreen's "Windows
 * protected your PC" dialog. `installerUrl` is the Store's own web installer: a small
 * Microsoft-signed `ADCode Installer.exe` that installs the Store package without opening
 * the Store app, which is the fewest clicks Windows offers. `cid` tags the source in Partner
 * Center's acquisition report.
 */
export const MICROSOFT_STORE = {
  productId: "9MSW2N027GJX",
  installerUrl: (source: string) =>
    `https://get.microsoft.com/installer/download/9MSW2N027GJX?referrer=appbadge&cid=${encodeURIComponent(source)}`,
  pageUrl: "https://apps.microsoft.com/detail/9MSW2N027GJX",
  /** Opens the listing in the Store app, for when the web installer is blocked. */
  appUrl: "ms-windows-store://pdp/?productid=9MSW2N027GJX",
} as const;

/**
 * Direct Linux downloads. `releases/latest/download/<name>` always resolves to the newest
 * published release, so these never go stale between site deploys.
 */
export const LINUX_DOWNLOADS = (repo: string) => ({
  deb: `https://github.com/${repo}/releases/latest/download/ADCode-amd64.deb`,
  appImage: `https://github.com/${repo}/releases/latest/download/ADCode-x86_64.AppImage`,
});

/**
 * How this platform should install, which is not the same question as what it can run.
 *
 * - `store` - Windows. One button, the Microsoft Store's signed installer. The terminal
 *   command stays available for people who prefer it.
 * - `download` - Linux. The .deb for Debian and Ubuntu, the AppImage for everything else.
 * - `soon` - macOS. Notarisation needs a paid Apple membership and an un-notarised app is
 *   refused rather than warned about, so there is nothing honest to offer yet.
 * - `send` - a phone or tablet. ADCode is a desktop app; the useful thing to offer someone
 *   who arrived from a post on their phone is a way to get the link onto their computer.
 * - `choose` - before hydration, and anything unrecognised: the page that lists every option.
 */
export type InstallRoute = "store" | "download" | "soon" | "send" | "choose";

export function installRoute(platform: Platform): InstallRoute {
  switch (platform) {
    case "windows":
      return "store";
    case "linux":
      return "download";
    case "macos":
    case "macos-intel":
      return "soon";
    case "mobile":
      return "send";
    default:
      return "choose";
  }
}

/** The one-liner for a platform that can install from a terminal, or null if it cannot. */
export function installCommand(platform: Platform, origin: string): string | null {
  const site = origin.replace(/\/$/, "");
  if (platform === "windows") return `irm ${site}/install.ps1 | iex`;
  if (platform === "linux") return `curl -fsSL ${site}/install.sh | sh`;
  return null;
}

/** Only recognize our complete installer commands, never arbitrary copied code. */
export function isInstallCommand(text: string, origin: string): boolean {
  const command = text.trim();
  return command === installCommand("windows", origin) || command === installCommand("linux", origin);
}
