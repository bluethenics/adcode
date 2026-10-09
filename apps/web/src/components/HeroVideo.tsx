"use client";

import { useEffect, useRef } from "react";
import { showcase, type ShowcaseVideo } from "@/lib/showcase";
import "./heroMotion.css";

/**
 * The hero's recording, in the visitor's theme.
 *
 * Both takes are in the page and CSS shows the one that matches the theme (the same rule the
 * screenshots used). Only that one ever plays, only while the hero is on screen, and it
 * switches when the theme does. Until it plays - and for anyone who asked for less motion -
 * the poster stands in: the finished game, which is the screenshot this replaced.
 */
export function HeroVideo() {
  const frame = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = frame.current;
    if (element === null) return;
    const videos = [...element.querySelectorAll("video")];
    const still = window.matchMedia("(prefers-reduced-motion: reduce)");
    const dark = window.matchMedia("(prefers-color-scheme: dark)");
    let visible = false;

    const sync = () => {
      for (const video of videos) {
        const shown = window.getComputedStyle(video).display !== "none";
        video.controls = still.matches && shown;
        if (shown && visible && !still.matches) {
          video.preload = "auto";
          void video.play().catch(() => { video.controls = true; });
        } else {
          video.pause();
        }
      }
    };

    const observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting === true;
      sync();
    }, { threshold: 0.15 });
    observer.observe(element);
    const theme = new MutationObserver(sync);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    dark.addEventListener("change", sync);
    still.addEventListener("change", sync);
    return () => {
      observer.disconnect();
      theme.disconnect();
      dark.removeEventListener("change", sync);
      still.removeEventListener("change", sync);
    };
  }, []);

  const video = (take: ShowcaseVideo, className: string) => (
    <video
      className={className}
      muted
      loop
      playsInline
      preload="metadata"
      poster={take.poster}
      width={take.width}
      height={take.height}
      aria-label={showcase.alt}
    >
      <source src={take.webm} type="video/webm" />
      <source src={take.mp4} type="video/mp4" />
    </video>
  );

  return (
    <div className="showcase-images" ref={frame} style={{ aspectRatio: `${showcase.light.width} / ${showcase.light.height}` }}>
      {video(showcase.light, "showcase-image-light")}
      {video(showcase.dark, "showcase-image-dark")}
    </div>
  );
}
