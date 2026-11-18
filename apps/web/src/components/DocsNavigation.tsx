"use client";

import { ChevronDown } from "lucide";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icon";

/** Desktop keeps its rail; phones open the same links only when they need them. */
export function DocsNavigation({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const contentRef = useRef<HTMLDivElement>(null);

  /*
   * On a guide, the page's own link can sit far below the fold of a long rail. Scroll the
   * rail - not the window - so it starts with the current page in view.
   */
  useEffect(() => {
    const rail = contentRef.current?.closest<HTMLElement>(".dx-sidebar");
    const current = contentRef.current?.querySelector<HTMLElement>('.dx-nav-pages a[aria-current="page"]');
    if (rail === null || rail === undefined || current === null || current === undefined) return;
    if (rail.scrollHeight <= rail.clientHeight) return;
    const offset = current.getBoundingClientRect().top - rail.getBoundingClientRect().top;
    if (offset > rail.clientHeight * 0.7) rail.scrollTop += offset - rail.clientHeight / 3;
  }, []);

  return (
    <>
      <button className="dx-mobile-toggle" type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((value) => !value)}>
        <span>Browse documentation</span>
        <Icon node={ChevronDown} className="dx-mobile-chevron" />
      </button>
      <div className="dx-navigation" id={id} ref={contentRef} data-open={open} onClick={(event) => {
        if ((event.target as Element).closest("a")) setOpen(false);
      }}>
        {children}
      </div>
      <noscript><style>{".dx .dx-mobile-toggle{display:none}.dx .dx-navigation{display:grid!important}"}</style></noscript>
    </>
  );
}
