"use client";

import { useEffect, useRef, useState } from "react";
import Link from "@/components/IntentLink";
import { Icon } from "@/components/Icon";
import { ArrowUpRight, Moon, Smartphone } from "lucide";
import { Buck } from "@/components/buck/Buck";
import "./homeNewFeatures.css";

/**
 * The two newest things ADCode does, each shown working rather than described.
 *
 * Phone link: a phone plays a short conversation with the computer when it scrolls into view,
 * the same steps the real page shows (your message, the tools it uses, the reply). Sleep when
 * done: press Try it and a ten-second countdown runs down to Buck falling asleep, with Cancel
 * doing what it does in the app. Both settle on their last frame with Reduce motion on.
 */

const SCRIPT: readonly { readonly kind: "user" | "tool" | "reply"; readonly text: string; readonly at: number }[] = [
  { kind: "user", text: "Make the header stay at the top while I scroll", at: 300 },
  { kind: "tool", text: "Reading header.css", at: 1300 },
  { kind: "tool", text: "Editing header.css", at: 2100 },
  { kind: "tool", text: "Running the preview", at: 2900 },
  { kind: "reply", text: "Done. The header is sticky now, with a soft shadow once the page scrolls.", at: 3800 },
];

function reducedMotion(): boolean {
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}

function PhoneDemo() {
  const box = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(0);
  const [run, setRun] = useState(0);

  useEffect(() => {
    const element = box.current;
    if (element === null) return;
    if (reducedMotion()) { setShown(SCRIPT.length); return; }
    const timers: number[] = [];
    const seen = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      seen.disconnect();
      setShown(0);
      SCRIPT.forEach((step, index) => timers.push(window.setTimeout(() => setShown(index + 1), step.at)));
    }, { threshold: 0.45 });
    seen.observe(element);
    return () => { seen.disconnect(); for (const timer of timers) window.clearTimeout(timer); };
  }, [run]);

  const working = shown > 0 && shown < SCRIPT.length;
  return (
    <div className="nf-phone" ref={box} aria-label="A phone chatting with ADCode on a computer" role="img">
      <div className="nf-phone-bar">
        <span><strong>Studio laptop</strong><small>{working ? "Working…" : shown === SCRIPT.length ? "Done" : "Online"}</small></span>
        <Buck mood={working ? "working" : shown === SCRIPT.length ? "success" : "idle"} size={30} />
      </div>
      <ol className="nf-phone-chat">
        {SCRIPT.slice(0, shown).map((step) => (
          <li key={step.text} className={`nf-step nf-${step.kind}`}>{step.text}</li>
        ))}
      </ol>
      <div className="nf-phone-composer"><span>Message your computer</span><i /></div>
      {shown === SCRIPT.length && !reducedMotion() && (
        <button type="button" className="nf-replay" onClick={() => setRun((count) => count + 1)}>Play again</button>
      )}
    </div>
  );
}

function SleepDemo() {
  const [left, setLeft] = useState<number | null>(null);
  const [asleep, setAsleep] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => () => { if (timer.current !== null) window.clearInterval(timer.current); }, []);

  const start = (): void => {
    setAsleep(false);
    if (reducedMotion()) { setLeft(null); setAsleep(true); return; }
    setLeft(10);
    if (timer.current !== null) window.clearInterval(timer.current);
    timer.current = window.setInterval(() => {
      setLeft((value) => {
        if (value === null || value <= 1) {
          if (timer.current !== null) window.clearInterval(timer.current);
          timer.current = null;
          setAsleep(true);
          return null;
        }
        return value - 1;
      });
    }, 1000);
  };
  const cancel = (): void => {
    if (timer.current !== null) window.clearInterval(timer.current);
    timer.current = null;
    setLeft(null);
  };

  const ring = 2 * Math.PI * 44;
  return (
    <div className="nf-sleep" data-asleep={asleep ? "true" : undefined}>
      <div className="nf-dial" aria-hidden="true">
        <svg viewBox="0 0 100 100"><circle className="nf-track" cx="50" cy="50" r="44" /><circle className="nf-ring" cx="50" cy="50" r="44" strokeDasharray={ring} strokeDashoffset={left === null ? (asleep ? ring : 0) : ring * (1 - left / 10)} /></svg>
        <Buck mood={asleep ? "sleeping" : left !== null ? "thinking" : "success"} size={64} />
      </div>
      <p className="nf-sleep-line" role="status" aria-live="polite">
        {asleep ? "Asleep. The work is saved and done." : left !== null ? `All chats finished. Sleeping in ${left} s` : "Every chat has finished."}
      </p>
      <div className="nf-sleep-actions">
        {left === null
          ? <button type="button" className="nf-btn" onClick={start}>{asleep ? "Wake up and try again" : "Try it"}</button>
          : <button type="button" className="nf-btn nf-btn-primary" onClick={cancel} autoFocus>Cancel</button>}
      </div>
    </div>
  );
}

export function HomeNewFeatures() {
  return (
    <section className="nf marketplace-wrap" aria-labelledby="nf-heading" data-home-reveal>
      <header className="nf-head">
        <p className="marketplace-eyebrow">NEW IN ADCODE</p>
        <h2 id="nf-heading">Your computer works.<br /><span>You don&apos;t have to watch.</span></h2>
      </header>
      <div className="nf-grid">
        <article className="nf-card">
          <PhoneDemo />
          <div className="nf-copy">
            <h3><Icon node={Smartphone} /> Chat from your phone</h3>
            <p>Turn on Phone link, scan the code, and keep the assistant on your computer going from anywhere. Your computer does the work with your projects and keys. Your phone sends messages and follows along.</p>
            <Link className="home-text-link" href="/docs/phone-link">How Phone link works <Icon node={ArrowUpRight} /></Link>
          </div>
        </article>
        <article className="nf-card">
          <SleepDemo />
          <div className="nf-copy">
            <h3><Icon node={Moon} /> Sleep when it&apos;s done</h3>
            <p>Hand over a long job and walk away. Once every chat has finished, ADCode can put your computer to sleep, lock it or shut it down, after a countdown you can cancel.</p>
            <Link className="home-text-link" href="/docs/power-when-done">Set it up <Icon node={ArrowUpRight} /></Link>
          </div>
        </article>
      </div>
    </section>
  );
}
