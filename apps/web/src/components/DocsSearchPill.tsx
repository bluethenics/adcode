"use client";

import Link from "@/components/IntentLink";

/**
 * The docs search shortcut, at the top of the docs sidebar.
 *
 * It used to sit in a second top bar inside the docs frame, under the site's own navigation:
 * two bars, two logos, and "Install" and "Support" links the site nav already has. Only the
 * search was the docs' own, so only the search stayed.
 *
 * The pill does not run its own search. On the index it focuses the real search field below;
 * on a page it goes to the index's field. One query, one result list, one shortcut (`/`).
 */
export function DocsSearchPill({ searchOnPage = false }: { searchOnPage?: boolean }) {
  const focusSearch = (): void => {
    const field = document.getElementById("docs-search-input");
    field?.focus({ preventScroll: false });
    field?.scrollIntoView({ behavior: "auto", block: "center" });
  };

  const content = <><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg><span>Search docs</span>{searchOnPage && <kbd>/</kbd>}</>;

  return searchOnPage
    ? <button type="button" className="docs-topbar-search docs-sidebar-search" onClick={focusSearch} aria-label="Search documentation">{content}</button>
    : <Link href="/docs#docs-search-input" className="docs-topbar-search docs-sidebar-search" aria-label="Search documentation">{content}</Link>;
}
