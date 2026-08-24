import Link from "next/link";

export interface Crumb {
  name: string;
  href?: string;
}

/**
 * The visible trail a reader follows: Home / Docs / Section / This page.
 *
 * The JSON-LD breadcrumbs record the same path for search engines; this renders it for
 * the person reading, so opening a deep page never feels like arriving nowhere. The
 * current page is plain text - a link to the page you are on is noise.
 */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      {items.map((item, index) => {
        const last = index === items.length - 1;
        return (
          <span key={`${item.name}-${index}`} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            {last || item.href === undefined ? (
              <span aria-current={last ? "page" : undefined}>{item.name}</span>
            ) : (
              <Link href={item.href}>{item.name}</Link>
            )}
            {!last && (
              <span className="crumbs-sep" aria-hidden="true">
                /
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
