"use client";

import { useEffect, useRef, useState } from "react";

const ROUTES = [
  "M-60 136H112L176 200H362L426 136H552", "M24 454H140V378H244L310 312H466L540 238H716",
  "M490 -30V92L552 154H718V268H906L972 334H1180", "M690 606V498H812L888 422H1034V330H1184",
  "M898 696V578L966 510H1116L1194 432H1354", "M-20 678H124L196 606V504H332L402 434",
  "M1062 76H950L886 140H804V230H662", "M280 770V648L354 574H490V502H590",
  "M1320 188H1212L1152 248H1042V358H920", "M-32 314H78L142 250H258V156H390",
  "M102 42V112H222L286 176H512", "M1210 -8V104L1136 178H858L790 246H650",
  "M-40 548H92L162 478H374L446 406H574", "M1322 558H1174L1096 480H874L806 412H682",
  "M508 748V640L572 576V468", "M772 748V642L708 578V468",
  "M-28 226H126L194 294H384L452 362H572", "M1308 272H1150L1082 340H890L820 410H696",
  "M252 -20V82L322 152H472L548 228V338", "M1006 -20V78L932 152H786L712 226V338",
] as const;

/**
 * Four, not eight.
 *
 * Each pulse is a `stroke-dashoffset` animation, and that property cannot be handed to
 * the compositor - every frame repaints the path's whole bounding box, and these boxes
 * span the viewport. Eight of them, each previously carrying two `drop-shadow` filters,
 * meant the browser re-rasterised most of the hero sixty times a second for as long as
 * the tab was open. Four unfiltered ones read as the same effect and cost a fraction of
 * it; the glow is now a second, wider, translucent stroke, which is paint rather than a
 * filter pass.
 */
const PULSES = [
  [0, "pulse-one"],
  [2, "pulse-two"],
  [5, "pulse-three"],
  [11, "pulse-four"],
] as const;

const NODES = [
  "112 136", "176 200", "426 136", "140 378", "310 312", "552 154", "718 268",
  "888 422", "966 510", "196 606", "354 574", "1152 248", "142 250",
] as const;

/**
 * The circuit behind the headline.
 *
 * A client component only so it can stop. Once the hero has scrolled away the pulses are
 * still animating, still repainting, and still competing with the scroll they are no
 * longer visible during - which is exactly what "the landing page feels laggy" was. An
 * `IntersectionObserver` pauses them the moment the hero leaves the screen.
 *
 * It renders identically on the server, so the picture is right on first paint and only
 * the pausing arrives with the JavaScript.
 */
export function HeroCircuit() {
  const box = useRef<HTMLDivElement>(null);
  const [running, setRunning] = useState(true);

  useEffect(() => {
    const element = box.current;
    if (element === null) return;

    const observer = new IntersectionObserver(
      (entries) => setRunning(entries[0]?.isIntersecting ?? true),
      // A margin, so it resumes a beat before it is visible rather than starting
      // mid-scroll with every dash frozen where it stopped.
      { rootMargin: "160px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="hero-circuit" data-paused={running ? undefined : "true"} ref={box} aria-hidden="true">
      <svg viewBox="0 0 1280 720" preserveAspectRatio="xMidYMid slice" role="presentation">
        <g className="hero-circuit__traces">
          {ROUTES.map((route, index) => (
            <path className="hero-circuit__trace" d={route} key={index} />
          ))}
        </g>
        <g className="hero-circuit__nodes">
          {NODES.map((point) => {
            const [cx, cy] = point.split(" ");
            return <circle cx={cx} cy={cy} r="5" key={point} />;
          })}
        </g>
        <g className="hero-circuit__signals">
          {PULSES.map(([routeIndex, name]) => (
            <g key={name}>
              {/* The glow: the same dash, wider and faint, under the bright one. Two
                  cheap strokes instead of one stroke and two filter passes. */}
              <path className={`hero-circuit__glow ${name}`} d={ROUTES[routeIndex]} />
              <path className={`hero-circuit__pulse ${name}`} d={ROUTES[routeIndex]} />
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}
