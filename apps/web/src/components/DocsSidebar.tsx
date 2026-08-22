import Link from "next/link";

const sections = [
  { title: "Product", links: [["Desktop app", "/download"], ["AI workspace", "/download"], ["Earnings", "/#ledger"]] },
  { title: "Guides", links: [["How it works", "/blog"], ["Privacy", "/privacy"], ["Terms", "/terms"]] },
  { title: "Developers", links: [["All notes", "/blog"], ["Advertise", "/advertise"]] },
] as const;

/** Static navigation shell; Claude can wire it to admin-managed content later. */
export function DocsSidebar() {
  return <aside className="docs-sidebar" aria-label="Documentation navigation">{sections.map((section) => <section key={section.title}><h2>{section.title}</h2>{section.links.map(([label, href]) => <Link href={href} key={label}>{label}</Link>)}</section>)}</aside>;
}
