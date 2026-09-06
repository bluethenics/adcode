"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

export interface DocsSearchSection {
  title: string;
  pages: Array<{
    slug: string;
    title: string;
    description: string;
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
  const resultCount = filteredSections.reduce(
    (count, section) => count + section.pages.length,
    0,
  );

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
      <div className="docs-search-shell" role="search">
        <div className="docs-search-field">
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="6.5" />
            <path d="m16 16 4 4" />
          </svg>
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
            <span className="docs-search-hint">
              Press <kbd>/</kbd> to search
            </span>
          )}
        </div>
        <p id="docs-search-status" className="docs-search-status" aria-live="polite">
          {query.length > 0
            ? `${resultCount} ${resultCount === 1 ? "page" : "pages"} found`
            : `${resultCount} pages`}
        </p>
      </div>

      <div className="docs-index-groups" id="docs-search-results">
        {filteredSections.length > 0 ? (
          filteredSections.map((section) => (
            <section key={section.title} className="docs-index-group rise">
              <h2>{section.title}</h2>
              <ul>
                {section.pages.map((page) => (
                  <li key={page.slug} className="docs-index-item">
                    <Link href={`/docs/${page.slug}`} className="docs-index-link">
                      <span>{page.title}</span>
                      <span>{page.description}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))
        ) : (
          <div className="docs-search-empty">
            <strong>No documentation found</strong>
            <p>Try a feature name or describe what you want to do.</p>
            <button type="button" onClick={() => setQuery("")}>Show all pages</button>
          </div>
        )}
      </div>
    </>
  );
}
