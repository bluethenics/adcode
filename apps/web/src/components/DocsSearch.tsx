"use client";

import Link from "@/components/IntentLink";
import { ArrowUpRight, Search } from "lucide";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./Icon";

export interface DocsSearchSection {
  title: string;
  pages: Array<{
    slug: string;
    title: string;
    description: string;
    /** Small trailing badge, e.g. the publication date on the "New" shelf. */
    meta?: string;
  }>;
}

interface Props {
  sections: DocsSearchSection[];
  initialQuery?: string;
}

const normalize = (value: string): string => value.trim().toLowerCase();

export function docsSearchKeyAction(input: {
  key: string;
  isTyping: boolean;
  isSearchFocused: boolean;
}): "focus" | "clear" | null {
  if (input.key === "/" && !input.isTyping) return "focus";
  if (input.key === "Escape" && input.isSearchFocused) return "clear";
  return null;
}

export function DocsSearch({ sections, initialQuery = "" }: Props) {
  const [query, setQuery] = useState(initialQuery);
  const inputRef = useRef<HTMLInputElement>(null);
  const filteredSections = useMemo(
    () => {
      const terms = normalize(query).split(/\s+/).filter(Boolean);
      return sections
        .map((section) => ({
          ...section,
          pages: section.pages.filter((page) => {
            const searchable = normalize(
              `${section.title} ${page.title} ${page.description}`,
            );
            return terms.every((term) => searchable.includes(term));
          }),
        }))
        .filter((section) => section.pages.length > 0);
    },
    [query, sections],
  );
  // Distinct pages, not rows: the "New in the docs" shelf repeats pages that also sit in
  // their own section, and counting both made the index say 119 under a heading of 115.
  const resultCount = new Set(
    filteredSections.flatMap((section) => section.pages.map((page) => page.slug)),
  ).size;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable === true;
      const action = docsSearchKeyAction({
        key: event.key,
        isTyping,
        isSearchFocused: document.activeElement === inputRef.current,
      });

      if (action === "focus") {
        event.preventDefault();
        inputRef.current?.focus();
      }

      if (action === "clear") setQuery("");
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <div className="dx-search" role="search">
        <div className="dx-search-field">
          <Icon node={Search} className="dx-search-icon" />
          <label className="sr-only" htmlFor="docs-search-input">
            Search documentation
          </label>
          <input
            ref={inputRef}
            id="docs-search-input"
            type="search"
            placeholder="Search documentation"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-controls="docs-search-results"
            aria-describedby="docs-search-status"
            aria-keyshortcuts="/"
          />
          {query.length > 0 ? (
            <button type="button" onClick={() => setQuery("")} aria-label="Clear search">
              Clear
            </button>
          ) : (
            <span className="dx-search-hint">
              Press <kbd>/</kbd> to search
            </span>
          )}
        </div>
        <p id="docs-search-status" className="dx-search-status" aria-live="polite">
          {query.length > 0
            ? `${resultCount} ${resultCount === 1 ? "page" : "pages"} found`
            : `${resultCount} pages`}
        </p>
      </div>

      <div className="dx-groups" id="docs-search-results">
        {filteredSections.length > 0 ? (
          filteredSections.map((section, sectionIndex) => (
            <section
              key={section.title}
              className={sectionIndex === 0 && section.pages.some((page) => page.meta !== undefined) ? "dx-group dx-group-fresh" : "dx-group"}
            >
              <header className="dx-group-head">
                <h2>{section.title}</h2>
                <span>{section.pages.length}</span>
              </header>
              <ul className="dx-cards">
                {section.pages.map((page, index) => (
                  <li
                    key={page.slug}
                    className="dx-item"
                    style={{ ["--i" as string]: Math.min(index, 8) }}
                  >
                    <Link href={`/docs/${page.slug}`} className="dx-card">
                      <span className="dx-card-title">
                        {page.title}
                        <Icon node={ArrowUpRight} className="dx-card-arrow" />
                      </span>
                      <span className="dx-card-text">{page.description}</span>
                      {page.meta !== undefined && (
                        <time className="dx-card-meta">{page.meta}</time>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))
        ) : (
          <div className="dx-empty">
            <strong>No documentation found</strong>
            <p>Try a feature name or describe what you want to do.</p>
            <button type="button" onClick={() => setQuery("")}>Show all pages</button>
          </div>
        )}
      </div>
    </>
  );
}
