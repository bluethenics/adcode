import Link from "next/link";
import { Mark } from "./Mark";

export function Nav() {
  return (
    <header className="nav">
      <div className="wrap nav-inner">
        <Link href="/" className="nav-brand" aria-label="ADCode home">
          <Mark />
          ADCode
        </Link>
        <nav className="nav-links" aria-label="Main">
          <Link href="/#ledger" data-optional="true">
            How you earn
          </Link>
          <Link href="/advertise" data-optional="true">
            Advertise
          </Link>
          <Link href="/blog">Blog</Link>
          <Link href="/download" className="btn btn-primary" style={{ padding: "7px 16px", fontSize: 14 }}>
            Download
          </Link>
        </nav>
      </div>
    </header>
  );
}
