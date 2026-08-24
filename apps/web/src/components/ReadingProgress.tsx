"use client";

import { useEffect, useState } from "react";

/**
 * A hairline fixed under the top edge that fills as the reader moves through the piece.
 *
 * "Where am I in this document" answered without a single pixel of chrome: the bar is
 * two pixels tall, sits above everything, and only exists on pages long enough to get
 * lost in. Width is applied as a transform so scrolling never triggers layout.
 */
export function ReadingProgress() {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let frame = 0;
    const measure = (): void => {
      frame = 0;
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      const value = scrollable > 0 ? Math.min(1, Math.max(0, window.scrollY / scrollable)) : 0;
      setProgress((previous) => (Math.abs(previous - value) < 0.002 ? previous : value));
    };
    const onScroll = (): void => {
      if (frame === 0) frame = window.requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <div className="reading-progress" aria-hidden="true">
      <span style={{ ["--progress" as string]: progress }} />
    </div>
  );
}
