/**
 * What ADCode can be downloaded as, and which of those actually exist yet.
 *
 * One source for three consumers that used to hold overlapping copies of it: the download
 * cards on `/versions`, the streaming route at `/dl/[platform]`, and
 * `scripts/check-release-assets.mjs`, which refuses a release whose installers do not
 * match the names the route will ask for.
 *
 * `available: false` is the honest half. macOS builds cannot ship yet - Apple requires a
 * paid Developer Program membership to sign and notarise, and an un-notarised app is not
 * merely warned about but refused by Gatekeeper. Listing the platform and saying "soon"
 * is truthful; offering a button that hands somebody an app their machine will not open
 * is not, and it is also unverifiable from a Windows development machine.
 */
export interface DownloadTarget {
  /** The `/dl/<id>` segment, and the id used everywhere else. */
  readonly id: string;
  readonly platform: string;
  readonly detail: string;
  /** The exact filename on the GitHub release. `electron-builder.yml` must produce it. */
  readonly asset: string;
  readonly type: string;
  /**
   * False while the build cannot ship. The card renders as "Coming soon" rather than a
   * link, `/dl/<id>` answers 503 instead of streaming, and the release check does not
   * require the asset - so a release is not blocked on a platform nobody is offering.
   */
  readonly available: boolean;
}

export const DOWNLOADS: readonly DownloadTarget[] = [
  {
    id: "windows",
    platform: "Windows",
    detail: "64-bit installer",
    asset: "ADCode-Setup-x64.exe",
    type: "application/vnd.microsoft.portable-executable",
    available: true,
  },
  {
    id: "linux",
    platform: "Linux",
    detail: "AppImage",
    asset: "ADCode-x86_64.AppImage",
    type: "application/x-executable",
    available: true,
  },
  {
    id: "linux-deb",
    platform: "Linux",
    detail: "Debian package",
    asset: "ADCode-amd64.deb",
    type: "application/vnd.debian.binary-package",
    available: true,
  },
  {
    id: "macos",
    platform: "macOS",
    detail: "Apple silicon",
    asset: "ADCode-arm64.dmg",
    type: "application/x-apple-diskimage",
    available: false,
  },
  {
    id: "macos-intel",
    platform: "macOS",
    detail: "Intel",
    asset: "ADCode-x64.dmg",
    type: "application/x-apple-diskimage",
    available: false,
  },
];

export const downloadHref = (target: DownloadTarget): string => `/dl/${target.id}`;

export const downloadFor = (id: string): DownloadTarget | undefined =>
  DOWNLOADS.find((target) => target.id === id);

/** The platforms a release actually has to carry. */
export const availableDownloads = (): readonly DownloadTarget[] =>
  DOWNLOADS.filter((target) => target.available);
