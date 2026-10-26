import Link from "next/link";

/** The three model catalogues, in the same tab style as every other admin page with sections. */
export function AdminModelTabs({ active }: { active: "free" | "byok" | "reports" }) {
  const tabs = [
    { id: "free", label: "Free models", href: "/admin/tagflow" },
    { id: "reports", label: "Provider reports", href: "/admin/tagflow/reports" },
    { id: "byok", label: "Bring your own key models", href: "/admin/models" },
  ] as const;
  return <nav className="admin-tabs" aria-label="Model catalogs">
    {tabs.map((tab) => (
      <Link key={tab.id} className="admin-tab" href={tab.href} aria-current={active === tab.id ? "page" : undefined}>{tab.label}</Link>
    ))}
  </nav>;
}
