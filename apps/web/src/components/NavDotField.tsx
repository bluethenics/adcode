"use client";
import { useEffect, useRef } from "react";
import "./navDotField.css";

/**
 * The header's dot grid: the desktop app's halftone field (renderer/onboarding/dotField.ts),
 * made to answer the pointer. Resting, it is a faint even grid you barely notice. Move over the
 * header and the dots under the cursor swell and light up in ADCode's green, with a short
 * trail that fades behind it, so the bar feels like a surface you are touching.
 *
 * It costs nothing at rest: it draws only while the pointer is over the header or its trail is
 * still fading, at most 30 frames a second, on a canvas sized to the bar at the device's pixel
 * ratio (capped at 2). Touch screens and reduced motion get the still grid and nothing else.
 */
const PITCH = 9;
const REACH = 70;
const FRAME_MS = 1000 / 30;
const TRAIL = 6;

interface Point { x: number; y: number; at: number }

export function NavDotField() {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const element = canvas.current;
    const host = element?.closest("header");
    const context = element?.getContext("2d");
    if (!element || !host || !context) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches || !window.matchMedia("(hover: hover)").matches;
    const trail: Point[] = [];
    let pointer: Point | null = null;
    let frame = 0;
    let last = 0;

    const draw = (now: number): boolean => {
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const width = Math.round(element.clientWidth * ratio);
      const height = Math.round(element.clientHeight * ratio);
      if (width === 0 || height === 0) return false;
      if (element.width !== width || element.height !== height) { element.width = width; element.height = height; }
      const style = getComputedStyle(element);
      const base = style.color || "#fff";
      const accent = style.getPropertyValue("--nav-dot-accent").trim() || "#6fb98f";
      const cell = PITCH * ratio;
      const reach = REACH * ratio;
      context.clearRect(0, 0, width, height);
      // Older trail points count for less, so the glow follows the cursor and then lets go.
      const lights = [...trail.map((point, index) => ({ ...point, weight: 0.5 * ((index + 1) / (trail.length + 1)) * Math.max(0, 1 - (now - point.at) / 600) })), ...(pointer ? [{ ...pointer, weight: 1 }] : [])]
        .filter((light) => light.weight > 0.02);
      let lit = false;
      for (let y = cell / 2; y < height; y += cell) {
        for (let x = cell / 2; x < width; x += cell) {
          let glow = 0;
          for (const light of lights) {
            const dx = x - light.x * ratio;
            const dy = y - light.y * ratio;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance < reach) glow = Math.max(glow, light.weight * (1 - distance / reach) ** 2);
          }
          if (glow > 0.01) lit = true;
          context.fillStyle = glow > 0.05 ? accent : base;
          context.globalAlpha = 0.07 + glow * 0.75;
          context.beginPath();
          context.arc(x, y, cell * (0.07 + glow * 0.2), 0, Math.PI * 2);
          context.fill();
        }
      }
      context.globalAlpha = 1;
      return lit;
    };

    const tick = (now: number): void => {
      frame = 0;
      if (now - last >= FRAME_MS) {
        last = now;
        while (trail.length > 0 && now - trail[0]!.at > 600) trail.shift();
        const lit = draw(now);
        // Keep going while the pointer is here or a trail is still fading; then rest.
        if (!lit && pointer === null) return;
      }
      frame = requestAnimationFrame(tick);
    };
    const wake = (): void => { if (frame === 0 && !still) frame = requestAnimationFrame(tick); };

    const onMove = (event: PointerEvent): void => {
      if (event.pointerType !== "mouse") return;
      const box = element.getBoundingClientRect();
      const now = performance.now();
      if (pointer) { trail.push(pointer); if (trail.length > TRAIL) trail.shift(); }
      pointer = { x: event.clientX - box.left, y: event.clientY - box.top, at: now };
      wake();
    };
    const onLeave = (): void => {
      if (pointer) trail.push({ ...pointer, at: performance.now() });
      pointer = null;
      wake();
    };

    draw(performance.now());
    const resized = new ResizeObserver(() => draw(performance.now()));
    resized.observe(element);
    if (!still) {
      host.addEventListener("pointermove", onMove);
      host.addEventListener("pointerleave", onLeave);
    }
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      resized.disconnect();
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <span className="nav-dot-field" aria-hidden="true">
      <canvas ref={canvas} />
    </span>
  );
}
