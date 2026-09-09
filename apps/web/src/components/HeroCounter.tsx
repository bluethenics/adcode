"use client";

import { useEffect, useState } from "react";
import { DEMO_COUNT_START, formatCount } from "@/lib/heroStats";

export function HeroCounter() {
  const [shown, setShown] = useState(DEMO_COUNT_START);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(preference.matches);
    update();
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);

  const running = !paused && !reducedMotion;
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) setShown((count) => count + 1);
    }, 100);
    return () => window.clearInterval(timer);
  }, [running]);

  return (
    <div className="hero-counter" data-running={running}>
      <div className="hero-counter-heading">
        <span className="hero-counter-dot" aria-hidden="true" />
        <span>developers on AdCode</span>
      </div>
      <div className="hero-counter-line">
        <strong className="hero-counter-number" aria-label={formatCount(shown)} aria-live="off">
          {formatCount(shown).split("").map((digit, index) => (
            <span className={digit === "," ? "hero-counter-comma" : "hero-counter-digit"} key={index} aria-hidden="true">
              <span key={digit}>{digit}</span>
            </span>
          ))}
        </strong>
        {/* <button
          className="hero-counter-toggle"
          type="button"
          aria-label={running ? "Pause demo counter" : "Resume demo counter"}
          disabled={reducedMotion}
          onClick={() => setPaused((value) => !value)}
        >
          {running ? "Pause" : "Resume"}
        </button> */}
      </div>
    </div>
  );
}
