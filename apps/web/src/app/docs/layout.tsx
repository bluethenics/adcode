import type { ReactNode } from "react";
import "./docs.css";

/**
 * Loads the documentation stylesheet for /docs and every guide under it.
 *
 * The docs layout is its own namespace (`.dx-*`) rather than another layer of overrides on
 * the older `.docs-*` rules spread across the site sheets, so nothing here depends on
 * winning a specificity contest with them.
 */
export default function DocsLayout({ children }: { children: ReactNode }) {
  return children;
}
