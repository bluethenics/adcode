"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { downloadFor } from "@/lib/downloads";

type Platform = "windows" | "macos" | "macos-intel" | "linux" | "unknown";

const LABEL: Record<Platform, string> = {
  windows: "Download for Windows",
  macos: "Download for macOS",
  "macos-intel": "Download for macOS",
  linux: "Download for Linux",
  unknown: "Get ADCode",
};

/** What to say to somebody whose platform is listed but not shipping yet. */
const SOON: Record<string, string> = {
  macos: "ADCode for macOS - coming soon",
  "macos-intel": "ADCode for macOS - coming soon",
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

  /*
   * A visitor whose platform cannot ship yet goes to the download page, not to a route
   * that will refuse them.
   *
   * `/dl/macos` answers 503 while macOS is unpublished, and pointing the one prominent
   * button on the homepage at it would turn "coming soon" into what looks like a broken
   * site. `/versions` says which builds exist and offers the terminal install.
   */
  const target = downloadFor(platform);

  if (platform === "unknown" || target === undefined || !target.available) {
    return (
      <Link href="/versions" className={className}>
        {children ?? SOON[platform] ?? LABEL[platform]}
      </Link>
    );
  }

  return (
    <a href={`/dl/${platform}`} className={className}>
      {children ?? LABEL[platform]}
    </a>
  );
}
