import Link from "@/components/IntentLink";
import { Icon } from "@/components/Icon";
import { ArrowUpRight } from "lucide";

export function PortalActions() {
  return (
    <span className="glass-portal-rail" role="group" aria-label="Advertise on ADCode">
      <Link href="/advertisers" className="glass-portal-button header-advertise">
        <span>Advertise</span><i aria-hidden="true"><Icon node={ArrowUpRight} /></i>
      </Link>
    </span>
  );
}
