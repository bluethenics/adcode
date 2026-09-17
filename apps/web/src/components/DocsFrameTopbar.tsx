"use client";

import Link from "next/link";
import { Mark } from "./Mark";

/**
 * The Primer-style window bar for the documentation frame.
 *
 * The reference is a small app window: brand on the left, a couple of
 * destination links on the right, and a pill search. The pill does not run
 * its own search - it focuses the real search field below, so there is one
 * query, one result list, and one keyboard shortcut (`/`) to remember.
 */
export function DocsFrameTopbar() {
  const focusSearch = (): void => {
    document.getElementById("docs-search-input")?.focus({ preventScroll: false });
    document.getElementById("docs-search-input")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <div className="docs-topbar">
      <Link href="/docs" className="docs-topbar-brand" aria-label="ADCode documentation home">
        <Mark size={19} />
        <span>
          ADCode <em>Docs</em>
        </span>
      </Link>
      <nav className="docs-topbar-links" aria-label="Documentation destinations">
        <Link href="/docs">Guides</Link>
        <Link href="/versions">Versions</Link>
        <Link href="/support" data-optional="true">
          Support
        </Link>
      </nav>
      <button type="button" className="docs-topbar-search" onClick={focusSearch} aria-label="Search documentation">
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="6.5" />
          <path d="m16 16 4 4" />
        </svg>
        <span>Search docs</span>
        <kbd>/</kbd>
      </button>
    </div>
  );
}
