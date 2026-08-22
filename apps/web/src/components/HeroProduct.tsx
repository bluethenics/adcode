"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { DesktopMockup } from "./DesktopMockup";

const tabs = [{ label: "Desktop", href: "/download" }, { label: "Terminal", href: "/download" }, { label: "AI workspace", href: "/download" }, { label: "Advertisers", href: "/advertise" }] as const;

export function HeroProduct() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => { const element = ref.current; if (!element) return; const observer = new IntersectionObserver((entries) => setVisible(entries[0]?.isIntersecting ?? false), { threshold: 0.15 }); observer.observe(element); return () => observer.disconnect(); }, []);
  return <><nav className="product-tabs" aria-label="ADCode products">{tabs.map((tab, index) => <Link className={index === 0 ? "is-active" : undefined} href={tab.href} key={tab.label}>{tab.label}</Link>)}</nav><div ref={ref} className={`hero-product ${visible ? "is-visible" : ""}`}><p className="hero-community">Built for <b>developers</b> who stay in flow.</p><DesktopMockup /></div></>;
}
