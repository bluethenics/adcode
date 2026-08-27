import Link from "next/link";

export function PortalActions() {
  return (
    <span className="glass-portal-rail" role="group" aria-label="Open a portal">
      <Link href="/portal" className="glass-portal-button">
        <span>Advertiser portal</span><i aria-hidden="true">↗</i>
      </Link>
      <Link href="/dashboard" className="glass-portal-button glass-portal-button-primary">
        <span>User portal</span><i aria-hidden="true">→</i>
      </Link>
    </span>
  );
}
