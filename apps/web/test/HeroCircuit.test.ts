import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HeroCircuit } from "../src/components/HeroCircuit";

describe("HeroCircuit", () => {
  it("renders circuit routes with several independently timed signal pulses", () => {
    const markup = renderToStaticMarkup(createElement(HeroCircuit));

    expect(markup).toContain('class="hero-circuit"');
    expect((markup.match(/hero-circuit__trace/g) ?? []).length).toBeGreaterThanOrEqual(18);
    expect((markup.match(/hero-circuit__pulse/g) ?? []).length).toBeGreaterThanOrEqual(8);
  });
});
