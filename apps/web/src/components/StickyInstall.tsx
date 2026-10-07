"use client";

import { useEffect, useState } from "react";
import { detectPlatform } from "@/lib/platform";
import { installLinkFor, sendInstallLink } from "@/lib/sendToDesktop";
import { GITHUB_REPO, SITE } from "@/lib/site";
import { stickyInstallAction, type StickyInstallAction } from "@/lib/stickyInstall";
import { trackWebsiteEvent } from "@/lib/websiteAnalytics";
import "./stickyInstall.css";

const DISMISSED = "adcode.sticky-install.dismissed";

/**
 * The install button that follows a reader down the home page.
 *
 * The hero and the closing section were the only ways to install, with the product tour,
 * the features and the advertiser builder between them. Once the hero's button has scrolled
 * away this bar offers the same install in one line; it steps aside from the closing section
 * on, where that section's own button takes over, and waits while the analytics question is
 * open (stickyInstall.css). × puts it away for the visit. Each click is recorded as the
 * "sticky" placement, so it is judged on its own (Admin > Analytics).
 */
export function StickyInstall() {
  const [action, setAction] = useState<StickyInstallAction | null>(null);
  const [heroGone, setHeroGone] = useState(false);
  const [closingReached, setClosingReached] = useState(false);
  const [dismissed, setDismissed] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setAction(stickyInstallAction(detectPlatform(navigator.userAgent, navigator.maxTouchPoints), GITHUB_REPO));
    try {
      setDismissed(sessionStorage.getItem(DISMISSED) === "1");
    } catch {
      setDismissed(false);
    }

    const hero = document.getElementById("earn");
    const closing = document.querySelector(".closing-cta");
    if (hero === null || typeof IntersectionObserver === "undefined") return;
    const heroWatch = new IntersectionObserver(([entry]) => setHeroGone(entry !== undefined && !entry.isIntersecting && entry.boundingClientRect.top < 0), { threshold: 0 });
    heroWatch.observe(hero);
    // On screen or already scrolled past: below the closing section is only the footer.
    const closingWatch = new IntersectionObserver(([entry]) => setClosingReached(entry !== undefined && (entry.isIntersecting || entry.boundingClientRect.top < 0)), { threshold: 0.2 });
    if (closing !== null) closingWatch.observe(closing);
    return () => {
      heroWatch.disconnect();
      closingWatch.disconnect();
    };
  }, []);

  if (action === null || dismissed) return null;
  const shown = heroGone && !closingReached;

  const dismiss = (): void => {
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISSED, "1");
    } catch {
      // Private window: gone for this page view.
    }
  };

  return (
    <aside className="sticky-install" data-shown={shown} aria-label="Install ADCode" aria-hidden={!shown}>
      <div className="sticky-install-copy">
        <strong>ADCode</strong>
        <span>The free AI code editor that pays you to build.</span>
      </div>
      <a
        className="sticky-install-cta"
        href={action.href}
        data-tracked
        tabIndex={shown ? 0 : -1}
        onClick={(event) => {
          if (action.kind === "download") trackWebsiteEvent("download_click", 0, undefined, "sticky");
          if (action.kind === "send") {
            event.preventDefault();
            void sendInstallLink(navigator, installLinkFor(SITE.origin)).then((outcome) => {
              // Counted when the link went somewhere, not when the bar was tapped.
              if (outcome === "shared" || outcome === "copied") trackWebsiteEvent("send_to_desktop", 0, undefined, "sticky");
              if (outcome === "copied") setCopied(true);
              // Neither share nor copy: the hero offers email and shows the link.
              if (outcome === "failed") document.getElementById("earn")?.scrollIntoView({ behavior: "smooth", block: "start" });
            });
          }
        }}
      >
        <span>{copied ? "Link copied" : action.label}</span>
        <small>{copied ? "Paste it on your computer" : action.detail}</small>
      </a>
      <button type="button" className="sticky-install-close" aria-label="Hide this bar" tabIndex={shown ? 0 : -1} onClick={dismiss}>×</button>
    </aside>
  );
}
