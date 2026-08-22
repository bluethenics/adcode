"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Mark } from "./Mark";
import { NavAccount } from "./NavAccount";

export function Nav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled((previous) => {
      const next = window.scrollY > 24;
      return previous === next ? previous : next;
    });
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className={`nav ${scrolled ? "nav-scrolled" : ""}`}>
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
          <Link href="/blog" data-optional="true">
            Blog
          </Link>
          <NavAccount />
          <Link href="/download" className="btn btn-primary nav-download">
            Download ADCode
          </Link>
        </nav>
      </div>
    </header>
  );
}
