"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useReportWebVitals } from "next/web-vitals";
import { analyticsChoice, analyticsPath, browserExcluded, flushWebsiteAnalytics, setAnalyticsChoice, touchWebsiteSession, trackWebsiteEvent, trackWebsiteVital, type AnalyticsChoice, type WebVitalName } from "@/lib/websiteAnalytics";
import "./websiteAnalytics.css";

// Web Vitals describe the document load, not whichever client route is open later.
let documentPath: string | undefined;
function reportVital(metric: { id: string; name: string; value: number }) {
  if (analyticsChoice() !== "accepted" || !documentPath) return;
  if (!["LCP", "CLS", "INP", "FCP", "TTFB"].includes(metric.name)) return;
  // CLS and INP report again when they change; each report replaces the last for this metric id.
  trackWebsiteVital(metric.name as WebVitalName, metric.value, documentPath, metric.id);
  flushWebsiteAnalytics();
}

/** Engaged time stops counting this long after the last scroll, click, key press or pointer movement. */
const IDLE_MS = 60_000;

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
    if (!ready || choice !== "accepted" || !analyticsPath(pathname) || browserExcluded()) return;
    trackWebsiteEvent("page_view", 0, pathname);
    /*
     * Engaged time, not merely visible time: each stretch between two signs of somebody
     * there counts for at most a minute, so a tab left open on a page overnight is a minute,
     * not eight hours.
     */
    let mark = document.visibilityState === "visible" ? performance.now() : null;
    let engagedMs = 0;
    let lastInput = 0;
    const accrue = () => {
      if (mark === null) return;
      const now = performance.now();
      engagedMs += Math.min(now - mark, IDLE_MS);
      mark = now;
    };
    const engagement = () => {
      accrue();
      if (engagedMs >= 1000) trackWebsiteEvent("engagement", engagedMs, pathname);
      engagedMs = 0;
    };
    const input = () => {
      const now = performance.now();
      if (now - lastInput < 1000) return;
      lastInput = now;
      accrue();
      touchWebsiteSession();
    };
    const milestones = new Set<number>();
    let errors = 0;
    const visibility = () => {
      if (document.visibilityState === "hidden") { engagement(); mark = null; flushWebsiteAnalytics(); }
      else mark = performance.now();
    };
    const pagehide = () => { engagement(); flushWebsiteAnalytics(); };
    const scroll = () => {
      input();
      const available = document.documentElement.scrollHeight - innerHeight;
      if (available <= 0) return;
      const percent = scrollY / available * 100;
      for (const threshold of [50, 90]) if (percent >= threshold && !milestones.has(threshold)) {
        milestones.add(threshold); trackWebsiteEvent(threshold === 50 ? "scroll_50" : "scroll_90", 0, pathname);
      }
    };
    const click = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest("a") : null;
      // A link that records its own click (an install button, with the button's placement)
      // says so, and is not counted a second time here.
      if (!anchor || anchor.dataset.tracked !== undefined) return;
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
    for (const name of ["pointerdown", "pointermove", "keydown", "touchstart"] as const) window.addEventListener(name, input, { passive: true });
    window.addEventListener("error", error);
    window.addEventListener("unhandledrejection", error);
    return () => {
      engagement(); flushWebsiteAnalytics();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", pagehide);
      window.removeEventListener("scroll", scroll);
      document.removeEventListener("click", click);
      for (const name of ["pointerdown", "pointermove", "keydown", "touchstart"] as const) window.removeEventListener(name, input);
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
