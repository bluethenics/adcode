export interface DownloadTarget {
  href: `/dl/${string}`;
  platform: string;
  detail: string;
}

export const DOWNLOADS: readonly DownloadTarget[] = [
  { href: "/dl/windows", platform: "Windows", detail: "64-bit installer" },
  { href: "/dl/macos", platform: "macOS", detail: "Apple silicon" },
  { href: "/dl/macos-intel", platform: "macOS", detail: "Intel" },
  { href: "/dl/linux", platform: "Linux", detail: "AppImage" },
  { href: "/dl/linux-deb", platform: "Linux", detail: "Debian package" },
] as const;
