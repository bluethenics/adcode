"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { GITHUB_REPO } from "@/lib/site";

type Platform = "windows" | "macos" | "linux" | "unknown";

/** The latest-release asset URLs that never change, because electron-builder pins the names. */
const DIRECT: Record<Exclude<Platform, "unknown">, string> = {
  windows: `https://github.com/${GITHUB_REPO}/releases/latest/download/ADCode-Setup-x64.exe`,
  linux: `https://github.com/${GITHUB_REPO}/releases/latest/download/ADCode-x86_64.AppImage`,
  macos: `https://github.com/${GITHUB_REPO}/releases/latest`,
};

const LABEL: Record<Platform, string> = {
  windows: "Download for Windows",
  macos: "Download for macOS",
  linux: "Download for Linux",
  unknown: "Get ADCode",
};

function detect(): Platform {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent;
  if (/Win|WOW/.test(ua)) return "windows";
  if (/Mac/.test(ua)) return "macos";
  if (/Linux|X11|CrOS/.test(ua)) return "linux";
  return "unknown";
}

/**
 * One click from anywhere to the right installer.
 *
 * The platform is detected in the browser and the button points straight at the release
 * asset - not at a downloads page, and not at a GitHub page where the file is one more
 * click down. Before hydration it renders as a plain link to /download, so the markup is
 * honest on first paint and gets faster, never wronger, once JS runs.
 */
export function DownloadButton({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  const [platform, setPlatform] = useState<Platform>("unknown");

  useEffect(() => setPlatform(detect()), []);

  if (platform === "unknown") {
    return (
      <Link href="/download" className={className}>
        {children ?? LABEL.unknown}
      </Link>
    );
  }

  return (
    <a href={DIRECT[platform]} className={className}>
      {children ?? LABEL[platform]}
    </a>
  );
}
