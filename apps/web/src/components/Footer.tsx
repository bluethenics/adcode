import Link from "next/link";
import { SITE } from "@/lib/site";

export function Footer() {
  return (
    <footer className="marketplace-footer">
      <div className="marketplace-wrap"><span>© {new Date().getFullYear()} {SITE.name}</span><nav aria-label="Legal"><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></nav><span>Earn while you code.</span></div>
    </footer>
  );
}
