"use client";

import Link from "@/components/IntentLink";
import { Search } from "lucide";
import { Icon } from "./Icon";

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

  const content = <><Icon node={Search} className="dx-pill-icon" /><span>Search docs</span>{searchOnPage && <kbd>/</kbd>}</>;

  return searchOnPage
    ? <button type="button" className="dx-pill" onClick={focusSearch} aria-label="Search documentation">{content}</button>
    : <Link href="/docs#docs-search-input" className="dx-pill" aria-label="Search documentation">{content}</Link>;
}
