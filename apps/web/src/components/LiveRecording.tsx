"use client";

import { useEffect, useRef, useState } from "react";
import { liveRecording } from "@/lib/liveRecording";
import "./liveRecording.css";

/**
 * "Watch it for real." - a recording of the desktop app's live room.
 *
 * The drawing above it shows the idea; this shows the thing. It was recorded from the built
 * app by `scripts/smoke-live-agents.mjs --record`, a real Team of three working against a
 * scripted model, and the caption says so. It plays muted, only while it is on screen; for
 * anyone who asked for less motion it waits on its poster with controls instead.
 */
export function LiveRecording() {
  const video = useRef<HTMLVideoElement | null>(null);
  const [still, setStill] = useState(false);

  useEffect(() => {
    const element = video.current;
    if (element === null) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setStill(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting === true) void element.play().catch(() => setStill(true));
      else element.pause();
    }, { threshold: 0.35 });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <section className="live-recording marketplace-wrap" aria-labelledby="live-recording-heading">
      <div className="live-recording-copy">
        <p className="marketplace-eyebrow"><span /> Recorded in the app</p>
        <h2 id="live-recording-heading">Watch it for real.</h2>
        <p>A Team of three in ADCode: Build writes the code and tells Docs it is ready, Docs writes the README, and Review picks up Build&apos;s handoff. Every window, message and badge is the app itself.</p>
      </div>
      <figure className="live-recording-frame">
        <video
          ref={video}
          muted
          loop
          playsInline
          preload="metadata"
          controls={still}
          poster={liveRecording.poster}
          width={liveRecording.width}
          height={liveRecording.height}
          aria-label="Screen recording of ADCode's live room: three agents, Build, Docs and Review, each in a live window, with code typing in and a message passing between their mascots."
        >
          <source src={liveRecording.webm} type="video/webm" />
          <source src={liveRecording.mp4} type="video/mp4" />
        </video>
        <figcaption>A real ADCode window, recorded from the app. The model&apos;s replies were scripted for the recording.</figcaption>
      </figure>
    </section>
  );
}
