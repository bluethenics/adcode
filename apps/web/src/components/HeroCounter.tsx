"use client";

import { useEffect, useRef, useState } from "react";
import { formatCount, heroStats, LAUNCH_GOAL } from "@/lib/heroStats";

/**
 * The live count in the hero, counting towards the first thousand.
 *
 * The animation is the argument. A number that arrives already sitting there is furniture;
 * one that climbs while somebody watches reads as a thing in motion that they are not yet
 * part of - which is the honest version of urgency, because the number underneath it is
 * true and checkable against the release page.
 *
 * Reduced motion gets the final figure immediately. Somebody who has asked their operating
 * system to stop animating things has not asked for a slower version of the same effect.
 */

/** Long enough to read as a climb, short enough not to delay the real number. */
const COUNT_MS = 1_600;

/** Fast at first and settling at the end, so the last few numbers are readable. */
const easeOutExpo = (t: number): number => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

export function HeroCounter({ goal = LAUNCH_GOAL }: { goal?: number }) {
  const [installs, setInstalls] = useState<number | null>(null);
  const [shown, setShown] = useState(0);
  const [filled, setFilled] = useState(false);
  const frame = useRef<number | null>(null);

  // Read once on mount. A failure leaves `installs` null and the block stays empty rather
  // than claiming a number it could not confirm.
  useEffect(() => {
    let live = true;
    void heroStats().then((stats) => {
      if (live && stats !== null) setInstalls(stats.installs);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (installs === null) return;

    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduced) {
      setShown(installs);
      setFilled(true);
      return;
    }

    const startedAt = performance.now();

    const step = (now: number): void => {
      const progress = Math.min(1, (now - startedAt) / COUNT_MS);
      setShown(Math.round(installs * easeOutExpo(progress)));
      if (progress < 1) frame.current = window.requestAnimationFrame(step);
    };

    frame.current = window.requestAnimationFrame(step);
    // The bar is a CSS transition on a width, so it only needs the class to change once
    // the element has been painted at zero.
    const bar = window.setTimeout(() => setFilled(true), 60);

    return () => {
      if (frame.current !== null) window.cancelAnimationFrame(frame.current);
      window.clearTimeout(bar);
    };
  }, [installs]);

  /*
   * The element is always in the tree, holding its own height, even before there is
   * anything to say. Rendering nothing and then appearing would push the install buttons
   * down the page a second after somebody has already started moving towards them.
   */
  if (installs === null) return <div className="hero-counter" aria-hidden="true" />;

  const percent = Math.min(100, (installs / goal) * 100);

  return (
    <div className="hero-counter" data-ready="true">
      <p className="hero-counter-line">
        <span className="hero-counter-dot" aria-hidden="true" />
        {/*
          The whole sentence is the live region, not just the digits. A screen reader
          announcing "10" on its own says nothing; announcing it once, complete, says
          everything the sighted version does.
        */}
        <span aria-live="polite">
          <strong>{formatCount(shown)}</strong> of the first {formatCount(goal)} developers
        </span>
      </p>

      <div
        className="hero-counter-track"
        role="progressbar"
        aria-valuenow={installs}
        aria-valuemin={0}
        aria-valuemax={goal}
        aria-label={`${formatCount(installs)} of the first ${formatCount(goal)} developers`}
      >
        <span
          className="hero-counter-fill"
          style={{ width: filled ? `${Math.max(percent, 1.5)}%` : "0%" }}
        />
      </div>
    </div>
  );
}
