import Link from "next/link";
import { Mark } from "./Mark";
import { SITE } from "@/lib/site";

export function Footer() {
  return (
    <footer className="footer">
      <div className="wrap">
        <div className="footer-cols">
          <div>
            <span className="nav-brand" style={{ color: "var(--on-ink)" }}>
              <Mark />
              ADCode
            </span>
            <p style={{ marginTop: 12, maxWidth: "34ch", color: "var(--on-ink-muted)" }}>
              A free editor funded by advertisers, with a share of what they pay going back
              to the people doing the work.
            </p>
          </div>

          <div>
            <h4>Product</h4>
            <Link href="/download">Download</Link>
            <Link href="/#ledger">How you earn</Link>
            <Link href="/#restraint">When ads appear</Link>
            <Link href="/dashboard">Your earnings</Link>
          </div>

          <div>
            <h4>Advertisers</h4>
            <Link href="/advertise">Reach developers</Link>
            <Link href="/portal">Advertiser portal</Link>
          </div>

          <div>
            <h4>Company</h4>
            <Link href="/blog">Blog</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
          </div>
        </div>

        <div className="footer-base">
          <span>
            © {new Date().getFullYear()} {SITE.name}
          </span>
          <span>Built for people who would rather be paid than pay.</span>
        </div>
      </div>
    </footer>
  );
}
