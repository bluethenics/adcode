"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "@/components/IntentLink";
import { Buck } from "./Buck";
import type { AdcodeMascot } from "./adcodeMascot";

/**
 * Buck, keeping you company in the corner of the public site.
 *
 * Every reaction answers something the reader did, never a timer for its own sake:
 *
 * - a new section scrolls into view, and Buck looks it over;
 * - the pointer rests on a download or a main button, and Buck leans in;
 * - the reader reaches the footer, and Buck celebrates once;
 * - nothing moves for half a minute, and Buck dozes off, waking with a start at the next touch;
 * - a poke gets a reaction and the page's tip.
 *
 * One tip per page, once per visit, gone by itself after a few seconds. "Tuck Buck away"
 * leaves just the top of his head peeking up, remembered on this browser, and a tap brings him
 * back. Off on the admin, portal and account pages, where people are working, and in print.
 * Section changes are watched with IntersectionObserver, not scroll events.
 */

const QUIET: readonly string[] = ["/admin", "/portal", "/dashboard", "/email-preview", "/loader-preview", "/desktop-sign-in", "/i/"];
const IDLE_MS = 30_000;
const TIP_MS = 9_000;

interface Tip { readonly text: string; readonly href?: string; readonly link?: string }

function tipFor(path: string): Tip {
  if (path === "/") return { text: "Hi, I'm Buck. ADCode is a full code editor that pays you a share of its ad revenue.", href: "/versions", link: "Get the app" };
  if (path.startsWith("/pricing")) return { text: "The editor and Tagflow AI are free. Other models are pay as you go, with nothing that renews.", href: "/ai-models", link: "See the models" };
  if (path === "/docs/phone-link") return { text: "Try it: in ADCode, run Phone Link: Chat From Your Phone and scan the code." };
  if (path === "/docs/power-when-done") return { text: "I nap when the work's done. Your computer can too." };
  if (path.startsWith("/docs")) return { text: "Every feature has a guide here. New this month: chat from your phone, and sleep when done.", href: "/docs/phone-link", link: "Phone link" };
  if (path.startsWith("/versions")) return { text: "Pick your system below. Updates install quietly after that." };
  if (path.startsWith("/support")) return { text: "Tell us what happened in your own words. A person reads every message." };
  return { text: "Need a hand? The guides cover every feature.", href: "/docs", link: "Open the docs" };
}

const remember = {
  get(): string | null { try { return localStorage.getItem("adcode.buck"); } catch { return null; } },
  set(value: string): void { try { localStorage.setItem("adcode.buck", value); } catch { /* Not remembered. */ } },
};

export function BuckGuide() {
  const path = usePathname() ?? "/";
  const quiet = QUIET.some((prefix) => path.startsWith(prefix));
  const [state, setState] = useState<"hidden" | "shown" | "tucked">("hidden");
  const [tip, setTip] = useState<Tip | null>(null);
  const buck = useRef<AdcodeMascot | null>(null);
  const tipTimer = useRef<number | null>(null);

  const showTip = useCallback((next: Tip) => {
    setTip(next);
    if (tipTimer.current !== null) window.clearTimeout(tipTimer.current);
    tipTimer.current = window.setTimeout(() => setTip(null), TIP_MS);
  }, []);

  // Arrives a moment after the page, so the first thing a reader sees is the page itself.
  useEffect(() => {
    if (quiet) { setState("hidden"); return; }
    const timer = window.setTimeout(() => setState(remember.get() === "tucked" ? "tucked" : "shown"), 1400);
    return () => window.clearTimeout(timer);
  }, [quiet]);

  // One tip per page per visit.
  useEffect(() => {
    if (quiet || state !== "shown") return;
    const key = `adcode.buck.tip:${path}`;
    let told = false;
    try { told = sessionStorage.getItem(key) === "1"; sessionStorage.setItem(key, "1"); } catch { /* Shown each time then. */ }
    if (told) return;
    const timer = window.setTimeout(() => { showTip(tipFor(path)); buck.current?.play("greeting", 1600); }, 900);
    return () => window.clearTimeout(timer);
  }, [path, quiet, state, showTip]);

  // Reading, hovering, reaching the end, and dozing off.
  useEffect(() => {
    if (quiet || state === "hidden") return;
    let sleeping = false;
    let idle = window.setTimeout(doze, IDLE_MS);
    let lastLook = 0;
    function doze(): void { sleeping = true; buck.current?.setMood("sleeping"); }
    const wake = (): void => {
      window.clearTimeout(idle);
      idle = window.setTimeout(doze, IDLE_MS);
      if (!sleeping) return;
      sleeping = false;
      buck.current?.setMood("idle");
      buck.current?.play("surprised", 900);
    };
    const look = (entries: IntersectionObserverEntry[]): void => {
      if (sleeping || !entries.some((entry) => entry.isIntersecting)) return;
      const now = Date.now();
      if (now - lastLook < 2500) return;
      lastLook = now;
      buck.current?.play("searching", 1100);
    };
    const sections = new IntersectionObserver(look, { rootMargin: "0px 0px -40% 0px" });
    for (const heading of document.querySelectorAll("main h2")) sections.observe(heading);
    let cheered = false;
    const end = new IntersectionObserver((entries) => {
      if (cheered || !entries.some((entry) => entry.isIntersecting)) return;
      cheered = true;
      buck.current?.play("celebrating", 2000);
    }, { threshold: 0.2 });
    const footer = document.querySelector("footer");
    if (footer !== null) end.observe(footer);

    let leaning = false;
    const over = (event: PointerEvent): void => {
      const target = (event.target as Element | null)?.closest?.("a[href='/versions'], a[href^='/versions'], .btn-primary, [data-buck]");
      const mood = target?.getAttribute("data-buck");
      if (target && !leaning) { leaning = true; buck.current?.setMood(mood === "earning" || mood === "proud" || mood === "wink" ? mood : "proud"); }
      else if (!target && leaning) { leaning = false; buck.current?.setMood("idle"); }
    };
    const events = ["pointermove", "keydown", "touchstart", "wheel"] as const;
    for (const name of events) window.addEventListener(name, wake, { passive: true });
    document.addEventListener("pointerover", over, { passive: true });
    return () => {
      window.clearTimeout(idle);
      sections.disconnect();
      end.disconnect();
      for (const name of events) window.removeEventListener(name, wake);
      document.removeEventListener("pointerover", over);
    };
  }, [path, quiet, state]);

  useEffect(() => () => { if (tipTimer.current !== null) window.clearTimeout(tipTimer.current); }, []);

  if (quiet) return null;

  const tuck = (): void => { remember.set("tucked"); setTip(null); setState("tucked"); };
  const poke = (): void => {
    if (state === "tucked") { remember.set("shown"); setState("shown"); buck.current?.play("greeting", 1400); return; }
    if (tip === null) showTip(tipFor(path));
    else setTip(null);
  };

  return (
    <aside className="buck-guide" data-state={state} aria-label="Buck, the ADCode mascot">
      <div className="buck-guide-body" onClickCapture={poke}>
        <Buck size={64} interactive label={state === "tucked" ? "Bring Buck back" : "Buck. Tap for a tip."} onReady={(instance) => { buck.current = instance; }} />
      </div>
      {tip !== null && state === "shown" && (
        <div className="buck-bubble" role="status">
          <p>{tip.text}</p>
          <div className="buck-bubble-actions">
            {tip.href !== undefined && <Link href={tip.href}>{tip.link}</Link>}
            <button type="button" onClick={tuck}>Tuck Buck away</button>
          </div>
        </div>
      )}
    </aside>
  );
}
