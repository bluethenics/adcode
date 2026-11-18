"use client";

import { useEffect, useState } from "react";
import type { DocOutlineItem } from "@/lib/docsToc";

/**
 * "On this page": the outline of the open guide, with the section being read marked.
 *
 * The marker follows the reader through an IntersectionObserver rather than a scroll
 * listener: the browser reports headings crossing a band near the top of the viewport,
 * and nothing runs while the reader is between them.
 */
export function DocsToc({ items }: { items: DocOutlineItem[] }) {
  const [active, setActive] = useState<string | null>(items[0]?.id ?? null);

  useEffect(() => {
    const headings = items
      .map((item) => document.getElementById(item.id))
      .filter((element): element is HTMLElement => element !== null);
    if (headings.length === 0 || typeof IntersectionObserver === "undefined") return;

    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        const first = headings.find((heading) => visible.has(heading.id));
        if (first !== undefined) {
          setActive(first.id);
          return;
        }
        // Between headings: the last one above the band is the section being read.
        const above = headings.filter((heading) => heading.getBoundingClientRect().top < 120);
        const last = above[above.length - 1];
        if (last !== undefined) setActive(last.id);
      },
      { rootMargin: "-96px 0px -66% 0px", threshold: 0 },
    );

    for (const heading of headings) observer.observe(heading);
    return () => observer.disconnect();
  }, [items]);

  if (items.length < 2) return null;

  return (
    <nav className="dx-toc" aria-label="On this page">
      <p className="dx-toc-title">On this page</p>
      <ol>
        {items.map((item) => (
          <li key={item.id} className={item.level === 3 ? "dx-toc-sub" : undefined}>
            <a
              href={`#${item.id}`}
              aria-current={item.id === active ? "location" : undefined}
              onClick={() => setActive(item.id)}
            >
              {item.text}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
