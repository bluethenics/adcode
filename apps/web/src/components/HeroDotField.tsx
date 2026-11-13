"use client";

import { useEffect, useRef } from "react";

/**
 * The hero's background: the desktop app's halftone dot field (renderer/onboarding/dotField.ts),
 * drifting like clouds seen through a screen, and answering the pointer - dots near the cursor
 * swell and take ADCode's green, then settle back as it moves on.
 *
 * Bounded like the field it replaced: no React renders per frame, at most 30 frames a second
 * (20 if a frame ever costs more than 7ms), only while the hero is on screen and the tab is
 * visible, on a canvas capped at 1.25x pixel ratio. Reduced motion draws one still frame and
 * ignores the pointer.
 */
const PITCH = 12;
const REACH = 150;

/**
 * Brightness, 0-1, at a grid cell and time: three soft blobs on slow orbits plus a faint ripple,
 * thresholded softly so the shapes have halftone edges. The same arithmetic as the app's field.
 */
export function fieldValue(x: number, y: number, t: number, columns: number, rows: number): number {
  const speed = 0.12;
  let sum = 0;
  for (let index = 0; index < 3; index += 1) {
    const phase = index * 2.094;
    const cx = columns * (0.5 + 0.38 * Math.sin(t * speed * (0.9 + index * 0.23) + phase));
    const cy = rows * (0.5 + 0.36 * Math.cos(t * speed * (0.7 + index * 0.31) + phase * 1.7));
    const radius = Math.min(columns, rows) * (0.36 + 0.08 * Math.sin(t * speed * 1.3 + phase));
    const dx = x - cx;
    const dy = (y - cy) * 1.15;
    sum += Math.exp(-(dx * dx + dy * dy) / (radius * radius));
  }
  const ripple = 0.5 + 0.5 * Math.sin(x * 0.42 + t * speed * 2.1) * Math.cos(y * 0.37 - t * speed * 1.6);
  const value = sum * 0.62 + ripple * 0.16;
  return Math.max(0, Math.min(1, (value - 0.34) / 0.28));
}

export function HeroDotField() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const host = canvas?.parentElement;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !host || !ctx) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const scheme = matchMedia("(prefers-color-scheme: dark)");
    let width = 0, height = 0, raf = 0, last = 0;
    let visible = false, hovering = false, slow = false;
    let targetX = 0, targetY = 0, pointerX = 0, pointerY = 0, strength = 0;
    let base = "#fff", accent = "#6fb98f";
    let bounds = host.getBoundingClientRect();
    const started = performance.now();

    const stop = () => { cancelAnimationFrame(raf); raf = 0; last = 0; };
    const paint = (now: number) => {
      ctx.clearRect(0, 0, width, height);
      const columns = Math.ceil(width / PITCH);
      const rows = Math.ceil(height / PITCH);
      const t = reduced.matches ? 6 : (now - started) / 1000;
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const x = (column + 0.5) * PITCH;
          const y = (row + 0.5) * PITCH;
          const value = fieldValue(column, row, t, columns, rows);
          const dx = x - pointerX, dy = y - pointerY;
          const near = strength > 0.01 ? Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) / REACH) ** 2 * strength : 0;
          const alpha = 0.03 + value * 0.13 + near * 0.55;
          if (alpha < 0.04) continue;
          ctx.globalAlpha = Math.min(1, alpha);
          ctx.fillStyle = near > 0.12 ? accent : base;
          // Near the cursor the dots also lean away from it a little, as if pressed.
          const push = near * 4 / Math.max(1, Math.hypot(dx, dy));
          ctx.beginPath();
          ctx.arc(x + dx * push, y + dy * push, PITCH * (0.1 + value * 0.16 + near * 0.18), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    };
    const frame = (now: number) => {
      raf = 0;
      if (!visible || document.hidden || reduced.matches) return;
      const elapsed = last ? now - last : 34;
      if (elapsed < (slow ? 50 : 1000 / 30) - 1) { raf = requestAnimationFrame(frame); return; }
      last = now;
      const delta = Math.min(elapsed / 1000, .08);
      const follow = 1 - Math.exp(-delta * 9);
      pointerX += (targetX - pointerX) * follow;
      pointerY += (targetY - pointerY) * follow;
      strength += ((hovering ? 1 : 0) - strength) * follow;
      const begin = performance.now();
      paint(now);
      if (performance.now() - begin > 7) slow = true;
      raf = requestAnimationFrame(frame);
    };
    const start = () => {
      if (!raf && visible && !document.hidden && !reduced.matches) raf = requestAnimationFrame(frame);
    };
    const palette = () => {
      const style = getComputedStyle(canvas);
      base = style.color || base;
      accent = style.getPropertyValue("--hero-dot-accent").trim() || accent;
      paint(performance.now());
    };
    const resize = () => {
      bounds = host.getBoundingClientRect();
      width = Math.round(bounds.width); height = Math.round(bounds.height);
      const ratio = Math.min(devicePixelRatio || 1, 1.25);
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      palette(); start();
    };
    const enter = (event: PointerEvent) => {
      if (event.pointerType === "touch" || reduced.matches) return;
      bounds = host.getBoundingClientRect();
      targetX = pointerX = event.clientX - bounds.left;
      targetY = pointerY = event.clientY - bounds.top;
      hovering = true;
    };
    const move = (event: PointerEvent) => {
      targetX = event.clientX - bounds.left;
      targetY = event.clientY - bounds.top;
    };
    const leave = () => { hovering = false; };
    const scroll = () => { hovering = false; };
    const visibility = () => { stop(); start(); };
    const preference = () => { stop(); strength = 0; paint(performance.now()); start(); };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting === true;
      if (visible) start(); else stop();
    });
    const size = new ResizeObserver(resize);
    const theme = new MutationObserver(palette);
    resize(); observer.observe(host); size.observe(host);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    host.addEventListener("pointerenter", enter, { passive: true });
    host.addEventListener("pointermove", move, { passive: true });
    host.addEventListener("pointerleave", leave);
    window.addEventListener("scroll", scroll, { passive: true });
    document.addEventListener("visibilitychange", visibility);
    reduced.addEventListener("change", preference);
    scheme.addEventListener("change", palette);
    return () => {
      stop(); observer.disconnect(); size.disconnect(); theme.disconnect();
      host.removeEventListener("pointerenter", enter);
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerleave", leave);
      window.removeEventListener("scroll", scroll);
      document.removeEventListener("visibilitychange", visibility);
      reduced.removeEventListener("change", preference);
      scheme.removeEventListener("change", palette);
    };
  }, []);
  return <canvas ref={ref} className="hero-dot-field" aria-hidden="true" />;
}
