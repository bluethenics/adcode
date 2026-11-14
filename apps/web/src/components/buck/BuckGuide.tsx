"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "@/components/IntentLink";
import { Buck } from "./Buck";
import type { AdcodeMascot } from "./adcodeMascot";
import { BUCK_ASK_EVENT } from "./AskBuck";

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
 *
 * Buck also talks: his bubble has a short question box, answered through Tagflow AI by
 * /v1/ai/buck (the server holds the key and caps the use). A page can hand him a question with
 * an Ask Buck button (AskBuck.tsx). While a conversation is open the bubble stays until closed.
 */

const QUIET: readonly string[] = ["/admin", "/portal", "/dashboard", "/email-preview", "/loader-preview", "/desktop-sign-in", "/i/"];
const IDLE_MS = 30_000;
const TIP_MS = 9_000;
const MESSAGE_MAX = 400;

interface Tip { readonly text: string; readonly href?: string; readonly link?: string }
interface Turn { readonly role: "user" | "assistant"; readonly content: string; readonly tagflow?: boolean }

/** Which page Buck is on, in the server's words, so his answer can fit it. */
export function buckPage(path: string): "home" | "pricing" | "credits" | "docs" | "download" | "other" {
  if (path === "/") return "home";
  if (path.startsWith("/pricing")) return "pricing";
  if (path.startsWith("/ai-tokens")) return "credits";
  if (path.startsWith("/docs")) return "docs";
  if (path.startsWith("/versions")) return "download";
  return "other";
}

function tipFor(path: string): Tip {
  if (path === "/") return { text: "Hi, I'm Buck. ADCode is a full code editor that pays you a share of its ad revenue.", href: "/versions", link: "Get the app" };
  if (path.startsWith("/pricing")) return { text: "Most people who code every day pick Pro. Not sure? Ask me below, or start free.", href: "/ai-tokens?plan=pro&go=1#plans", link: "Get Pro" };
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
  const [chat, setChat] = useState<Turn[] | null>(null);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const chatRef = useRef<Turn[]>([]);
  const log = useRef<HTMLDivElement>(null);

  const showTip = useCallback((next: Tip) => {
    setTip(next);
    if (tipTimer.current !== null) window.clearTimeout(tipTimer.current);
    tipTimer.current = window.setTimeout(() => setTip(null), TIP_MS);
  }, []);

  /** Opens the conversation; the tip's timer stops, so the bubble stays until it is closed. */
  const openChat = useCallback(() => {
    if (tipTimer.current !== null) window.clearTimeout(tipTimer.current);
    setTip(null);
    setChat((current) => current ?? []);
    setState("shown");
    remember.set("shown");
  }, []);

  const ask = useCallback(async (raw: string) => {
    const message = raw.trim().slice(0, MESSAGE_MAX);
    if (message === "" || thinking) return;
    openChat();
    const history = chatRef.current.slice(-6).map(({ role, content }) => ({ role, content: content.slice(0, MESSAGE_MAX * 2) }));
    const asked = [...chatRef.current, { role: "user", content: message } as Turn];
    chatRef.current = asked; setChat(asked); setDraft(""); setThinking(true);
    buck.current?.setMood("thinking");
    let reply: Turn;
    try {
      const response = await fetch("/v1/ai/buck", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message, page: buckPage(path), history }) });
      const body = await response.json() as { reply?: string; source?: string };
      reply = typeof body.reply === "string" ? { role: "assistant", content: body.reply, tagflow: body.source === "tagflow" } : { role: "assistant", content: "I lost my train of thought. Try asking that a different way, or see /support." };
    } catch {
      reply = { role: "assistant", content: "I can't reach the server right now. The guides at /docs have the answers too." };
    }
    chatRef.current = [...chatRef.current, reply]; setChat(chatRef.current); setThinking(false);
    buck.current?.setMood("idle"); buck.current?.play("wink", 1200);
  }, [openChat, path, thinking]);

  // A page's Ask Buck button hands over its question.
  useEffect(() => {
    if (quiet) return;
    const listen = (event: Event): void => { const question = (event as CustomEvent<unknown>).detail; if (typeof question === "string") void ask(question); };
    window.addEventListener(BUCK_ASK_EVENT, listen);
    return () => window.removeEventListener(BUCK_ASK_EVENT, listen);
  }, [ask, quiet]);

  // The newest line stays in view.
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }); }, [chat, thinking]);

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

  const tuck = (): void => { remember.set("tucked"); setTip(null); setChat(null); setState("tucked"); };
  const poke = (): void => {
    if (state === "tucked") { remember.set("shown"); setState("shown"); buck.current?.play("greeting", 1400); return; }
    if (chat !== null) return;
    if (tip === null) showTip(tipFor(path));
    else setTip(null);
  };
  const closeChat = (): void => { setChat(null); chatRef.current = []; setDraft(""); };

  return (
    <aside className="buck-guide" data-state={state} aria-label="Buck, the ADCode mascot">
      <div className="buck-guide-body" onClickCapture={poke}>
        <Buck size={64} interactive label={state === "tucked" ? "Bring Buck back" : chat !== null ? "Buck" : "Buck. Tap for a tip."} onReady={(instance) => { buck.current = instance; }} />
      </div>
      {chat !== null && state === "shown" ? (
        <div className="buck-bubble buck-chat" role="dialog" aria-label="Ask Buck">
          <div className="buck-chat-log" ref={log} aria-live="polite">
            {chat.length === 0 && <p className="buck-chat-hint">Ask me about plans, credits, or what&apos;s free.</p>}
            {chat.map((turn, index) => (
              <p key={index} className="buck-chat-turn" data-role={turn.role}>
                {turn.content}
                {turn.tagflow === true && <span className="buck-chat-source">Answered with Tagflow AI</span>}
              </p>
            ))}
            {thinking && <p className="buck-chat-turn" data-role="assistant" aria-label="Buck is thinking"><span className="buck-chat-dots" aria-hidden="true"><i /><i /><i /></span></p>}
          </div>
          <form className="buck-chat-form" onSubmit={(event) => { event.preventDefault(); void ask(draft); }}>
            <label className="sr-only" htmlFor="buck-chat-input">Your question for Buck</label>
            <input id="buck-chat-input" value={draft} maxLength={MESSAGE_MAX} placeholder="Ask Buck…" autoComplete="off" disabled={thinking}
              onFocus={() => buck.current?.setMood("listening")} onBlur={() => buck.current?.setMood("idle")} onChange={(event) => setDraft(event.target.value)} />
            <button type="submit" disabled={thinking || draft.trim() === ""}>Ask</button>
          </form>
          <div className="buck-bubble-actions">
            <button type="button" onClick={closeChat}>Close</button>
            <button type="button" onClick={tuck}>Tuck Buck away</button>
          </div>
        </div>
      ) : tip !== null && state === "shown" && (
        <div className="buck-bubble" role="status">
          <p>{tip.text}</p>
          <div className="buck-bubble-actions">
            {tip.href !== undefined && <Link href={tip.href}>{tip.link}</Link>}
            <button type="button" onClick={openChat}>Ask Buck</button>
            <button type="button" onClick={tuck}>Tuck Buck away</button>
          </div>
        </div>
      )}
    </aside>
  );
}
