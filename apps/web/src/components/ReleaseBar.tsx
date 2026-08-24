"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/**
 * A thin line at the top of the site saying a new version shipped.
 *
 * The web version of the editor's release card, and it follows the same principle for the
 * same reason: it is allowed to say something once. Dismissing it writes the version to
 * `localStorage`, and that version never produces a bar again on this browser. There is no
 * timer that brings it back and no counter that resets.
 *
 * It renders nothing at all until the version is known and confirmed unseen, so a returning
 * visitor never sees it flash in and disappear — which would be worse than showing it.
 */
const DISMISSED_KEY = "adcode.changelog.dismissed";

export interface ReleaseBarProps {
  /** The newest published version, or null when nothing has been published. */
  version: string | null;
  title: string;
}

export function ReleaseBar({ version, title }: ReleaseBarProps) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (version === null) return;

    try {
      if (window.localStorage.getItem(DISMISSED_KEY) !== version) setShow(true);
    } catch {
      // Private browsing, or storage switched off. Showing nothing is the safe side of
      // this: an undismissable bar on every page load is worse than no bar.
    }
  }, [version]);

  if (!show || version === null) return null;

  const dismiss = () => {
    setShow(false);
    try {
      window.localStorage.setItem(DISMISSED_KEY, version);
    } catch {
      // It closes for this page load either way.
    }
  };

  return (
    <div className="release-bar" role="status">
      <Link href={`/changelog#v${version}`} className="release-bar-link">
        <span className="release-bar-version mono">{version}</span>
        <span className="release-bar-title">{title}</span>
        <span className="release-bar-more">Read the notes &rarr;</span>
      </Link>
      <button
        type="button"
        className="release-bar-close"
        onClick={dismiss}
        aria-label="Dismiss"
        title="Dismiss — this version will not be mentioned again"
      >
        &times;
      </button>
    </div>
  );
}
