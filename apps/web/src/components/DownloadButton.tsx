"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Platform = "windows" | "macos" | "macos-intel" | "linux" | "unknown";

const LABEL: Record<Platform, string> = {
  windows: "Download for Windows",
  macos: "Download for macOS",
  "macos-intel": "Download for macOS",
  linux: "Download for Linux",
  unknown: "Get ADCode",
};

/**
 * Which build this visitor wants.
 *
 * Apple silicon is guessed rather than detected: a browser will not say which chip it is
 * on, and every modern Mac that is not explicitly reported as Intel is one. Guessing
 * wrong costs a person one click on the download page; asking everyone to choose costs
 * everyone one click.
 */
function detect(): Platform {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent;

  if (/Win|WOW/.test(ua)) return "windows";
  if (/Mac/.test(ua)) return /Intel Mac OS X 10_1[0-4]/.test(ua) ? "macos-intel" : "macos";
  if (/Linux|X11|CrOS/.test(ua)) return "linux";
  return "unknown";
}

/**
 * One click from anywhere to the right installer.
 *
 * The href is this site's own `/dl/<platform>`, which streams the file back (see
 * `app/dl/[platform]/route.ts`). Nothing about where the build is published appears in
 * the status bar, the download list, or the URL - a download should look like it came
 * from the product, because it did.
 *
 * Before hydration it renders as a plain link to `/versions`, so the markup is honest on
 * first paint and gets faster, never wronger, once JS runs.
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
      <Link href="/versions" className={className}>
        {children ?? LABEL.unknown}
      </Link>
    );
  }

  return (
    <a href={`/dl/${platform}`} className={className}>
      {children ?? LABEL[platform]}
    </a>
  );
}
