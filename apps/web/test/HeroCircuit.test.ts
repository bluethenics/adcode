import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HeroCircuit } from "../src/components/HeroCircuit";

/**
 * The hero's paint budget, written down.
 *
 * These used to assert "at least eight pulses", which read as a richness requirement and
 * was in fact the landing page's biggest performance problem: `stroke-dashoffset` cannot
 * be composited, so every pulse repaints a viewport-sized box sixty times a second, and
 * each one carried two `drop-shadow` filters on top of that.
 *
 * So the count is now an upper bound. Adding a ninth pulse should fail this test, because
 * the next person to make the hero "a bit livelier" is the person these assertions exist
 * to stop.
 */
describe("HeroCircuit", () => {
  it("draws the full circuit", () => {
    const markup = renderToStaticMarkup(createElement(HeroCircuit));

    expect(markup).toContain('class="hero-circuit"');
    expect((markup.match(/hero-circuit__trace/g) ?? []).length).toBeGreaterThanOrEqual(18);
  });

  it("keeps the animated pulses within the paint budget", () => {
    const markup = renderToStaticMarkup(createElement(HeroCircuit));
    const pulses = (markup.match(/hero-circuit__pulse/g) ?? []).length;

    expect(pulses).toBeGreaterThanOrEqual(2);
    expect(pulses).toBeLessThanOrEqual(4);
  });

  it("gives every pulse its own glow rather than a filter", () => {
    // The glow is a second, wider, translucent stroke. A `drop-shadow` filter would send
    // the whole layer through a filter pass on every frame of the animation.
    const markup = renderToStaticMarkup(createElement(HeroCircuit));

    expect((markup.match(/hero-circuit__glow/g) ?? []).length).toBe(
      (markup.match(/hero-circuit__pulse/g) ?? []).length,
    );
  });

  it("times each pulse independently", () => {
    // Four identical animations look like one blinking light. The per-pulse classes carry
    // different durations and negative delays, which is what makes it read as traffic.
    const markup = renderToStaticMarkup(createElement(HeroCircuit));
    const named = new Set(markup.match(/pulse-(one|two|three|four|five|six|seven|eight)/g) ?? []);

    expect(named.size).toBeGreaterThanOrEqual(2);
  });
});
