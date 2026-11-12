"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { createAdcodeMascot, type AdcodeMascot, type AdcodeMascotMood } from "./adcodeMascot";
import "./adcodeMascot.css";
import "./buck.css";

/**
 * Buck, the ADCode mascot, on the website: the desktop's own drawing (`adcodeMascot.ts`, copied
 * by `scripts/vendor-buck.mjs`) in a React wrapper.
 *
 * Buck draws itself into a span this component owns, so React never touches the SVG and a
 * re-render never restarts an animation. `mood` is the standing mood; `hoverMood` plays while
 * the pointer is over the element named by `reactTo` (its closest ancestor matching that
 * selector, or Buck's own box), which is how a button can make Buck lean in. Interactive Buck
 * is a real button with a label: a poke gets a reaction.
 *
 * Server pages render an empty, sized box, so nothing shifts when Buck arrives.
 */
export interface BuckProps {
  readonly mood?: AdcodeMascotMood;
  readonly size?: number;
  readonly interactive?: boolean;
  readonly label?: string;
  readonly hoverMood?: AdcodeMascotMood;
  /** A CSS selector for the ancestor whose hover plays `hoverMood`. */
  readonly reactTo?: string;
  /** Play this once when Buck scrolls into view. */
  readonly greet?: AdcodeMascotMood;
  readonly className?: string;
  readonly style?: CSSProperties;
  /** Hands the instance to a parent that wants to drive it (the companion does). */
  readonly onReady?: (buck: AdcodeMascot) => void;
}

export function Buck({ mood = "idle", size = 96, interactive = false, label, hoverMood, reactTo, greet, className, style, onReady }: BuckProps) {
  const host = useRef<HTMLSpanElement>(null);
  const instance = useRef<AdcodeMascot | null>(null);

  useEffect(() => {
    const box = host.current;
    if (box === null) return;
    const buck = createAdcodeMascot({ mood, size, interactive, ...(label === undefined ? {} : { label }) });
    instance.current = buck;
    box.replaceChildren(buck.element);
    onReady?.(buck);

    const cleanups: (() => void)[] = [];
    if (hoverMood !== undefined) {
      const target = reactTo === undefined ? box : box.closest<HTMLElement>(reactTo) ?? box;
      let over = false;
      const enter = (): void => { if (!over) { over = true; buck.setMood(hoverMood); } };
      const leave = (): void => { over = false; buck.setMood(instance.current === buck ? currentMood.current : mood); };
      target.addEventListener("pointerenter", enter);
      target.addEventListener("pointerleave", leave);
      target.addEventListener("focusin", enter);
      target.addEventListener("focusout", leave);
      cleanups.push(() => {
        target.removeEventListener("pointerenter", enter);
        target.removeEventListener("pointerleave", leave);
        target.removeEventListener("focusin", enter);
        target.removeEventListener("focusout", leave);
      });
    }
    if (greet !== undefined && typeof IntersectionObserver !== "undefined") {
      const seen = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          buck.play(greet);
          seen.disconnect();
        }
      }, { threshold: 0.6 });
      seen.observe(box);
      cleanups.push(() => seen.disconnect());
    }
    return () => {
      for (const undo of cleanups) undo();
      buck.destroy();
      instance.current = null;
    };
    // The drawing is made once; mood and size changes are applied below without remaking it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interactive, hoverMood, reactTo, greet]);

  const currentMood = useRef(mood);
  useEffect(() => {
    currentMood.current = mood;
    instance.current?.setMood(mood);
  }, [mood]);
  useEffect(() => {
    instance.current?.setSize(size);
  }, [size]);

  return (
    <span
      ref={host}
      className={["buck-host", className].filter(Boolean).join(" ")}
      style={{ width: size, height: size, ...style }}
      aria-hidden={interactive ? undefined : true}
    />
  );
}
