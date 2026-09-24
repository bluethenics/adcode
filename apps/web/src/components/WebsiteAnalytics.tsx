"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useReportWebVitals } from "next/web-vitals";
import { analyticsChoice, analyticsPath, flushWebsiteAnalytics, setAnalyticsChoice, trackWebsiteEvent, type AnalyticsChoice } from "@/lib/websiteAnalytics";
import "./websiteAnalytics.css";

// Web Vitals describe the document load, not whichever client route is open later.
let documentPath: string | undefined;
const reportedVitals = new Set<string>();
function reportVital(metric: { id: string; name: string; value: number }) {
  if (analyticsChoice() !== "accepted" || !documentPath || reportedVitals.has(metric.id)) return;
  if (!["LCP", "CLS", "INP", "FCP", "TTFB"].includes(metric.name)) return;
  reportedVitals.add(metric.id);
  trackWebsiteEvent(metric.name as "LCP" | "CLS" | "INP" | "FCP" | "TTFB", metric.value, documentPath);
  flushWebsiteAnalytics();
}

export function WebsiteAnalytics() {
  const pathname = usePathname();
  const [choice, setChoice] = useState<AnalyticsChoice | null>(null);
  const [ready, setReady] = useState(false);
  const [editing, setEditing] = useState(false);
  useReportWebVitals(reportVital);

  useEffect(() => {
    documentPath ??= location.pathname;
    const sync = () => { setChoice(analyticsChoice()); setReady(true); };
    sync();
    window.addEventListener("website-analytics-choice", sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener("website-analytics-choice", sync); window.removeEventListener("storage", sync); };
  }, []);

  useEffect(() => {
    if (!ready || choice !== "accepted" || !analyticsPath(pathname)) return;
    trackWebsiteEvent("page_view", 0, pathname);
    let visibleSince = document.visibilityState === "visible" ? performance.now() : null;
    const milestones = new Set<number>();
    let errors = 0;
    const engagement = () => {
      if (visibleSince !== null) {
        const elapsed = performance.now() - visibleSince;
        if (elapsed >= 1000) trackWebsiteEvent("engagement", elapsed, pathname);
        visibleSince = null;
      }
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") { engagement(); flushWebsiteAnalytics(); }
      else visibleSince = performance.now();
    };
    const pagehide = () => { engagement(); flushWebsiteAnalytics(); };
    const scroll = () => {
      const available = document.documentElement.scrollHeight - innerHeight;
      if (available <= 0) return;
      const percent = scrollY / available * 100;
      for (const threshold of [50, 90]) if (percent >= threshold && !milestones.has(threshold)) {
        milestones.add(threshold); trackWebsiteEvent(threshold === 50 ? "scroll_50" : "scroll_90", 0, pathname);
      }
    };
    const click = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest("a") : null;
      if (!anchor) return;
      try {
        const target = new URL(anchor.href);
        if (!["http:", "https:"].includes(target.protocol)) return;
        if (anchor.hasAttribute("download") || /\.(exe|msi|dmg|deb|rpm|appimage|zip|tar\.gz)$/i.test(target.pathname)) trackWebsiteEvent("download_click", 0, pathname);
        else if (target.origin === location.origin && (target.pathname === "/advertise" || target.hash === "#advertise" || target.pathname === "/portal" || target.pathname === "/portal/campaigns/new")) trackWebsiteEvent("advertise_click", 0, pathname);
        else if (target.origin !== location.origin) trackWebsiteEvent("outbound_click", 0, pathname);
      } catch { /* invalid link */ }
    };
    const error = () => { if (errors++ < 5) trackWebsiteEvent("js_error", 0, pathname); };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", pagehide);
    window.addEventListener("scroll", scroll, { passive: true });
    document.addEventListener("click", click);
    window.addEventListener("error", error);
    window.addEventListener("unhandledrejection", error);
    return () => {
      engagement(); flushWebsiteAnalytics();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", pagehide);
      window.removeEventListener("scroll", scroll);
      document.removeEventListener("click", click);
      window.removeEventListener("error", error);
      window.removeEventListener("unhandledrejection", error);
    };
  }, [pathname, choice, ready]);

  if (!ready || pathname.startsWith("/admin")) return null;
  const choose = (value: AnalyticsChoice) => { setAnalyticsChoice(value); setEditing(false); };
  return (
    <>
      {(choice === null || editing) && <aside className="website-consent" aria-label="Website analytics preference">
        <p><strong>Help improve ADCode</strong><br />Allow anonymous visit, button, and page-speed measurements? We never record form contents. <a href="/privacy">Privacy details</a></p>
        <div><button type="button" className="btn btn-small" onClick={() => choose("declined")}>Decline</button><button type="button" className="btn btn-small" onClick={() => choose("accepted")}>Allow analytics</button></div>
        {choice === "declined" && <small>Browser privacy signals are respected even if you select Allow.</small>}
      </aside>}
      <button type="button" className="website-preference" onClick={() => setEditing(open => !open)}>Analytics preferences</button>
    </>
  );
}
