import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(join(import.meta.dirname, "../src/renderer/styles/community.css"), "utf8");
const PAGE = ["communityShell.ts", "pluginsPage.ts", "artifactsPage.ts"].map((file) => readFileSync(join(import.meta.dirname, "../src/renderer/community", file), "utf8")).join("\n");

describe("Community page motion", () => {
  const gated = CSS.slice(CSS.indexOf("@media (prefers-reduced-motion: no-preference)"));
  const ungated = CSS.slice(0, CSS.indexOf("@media (prefers-reduced-motion: no-preference)"));

  it("starts animations only behind both stillness switches", () => {
    expect(ungated).not.toMatch(/\banimation\s*:/);
    for (const rule of gated.match(/[^{}]+\{[^{}]*\banimation\s*:[^{}]*\}/g) ?? []) {
      expect(rule).toContain(':root:not([data-reduced-motion="true"])');
    }
  });

  it("moves only with transform and opacity, and never transitions everything", () => {
    expect(CSS).not.toMatch(/transition\s*:\s*all\b/);
    for (const frames of CSS.match(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})+\s*\}/g) ?? []) {
      expect(frames).not.toMatch(/\b(?:width|height|top|left|margin|padding)\s*:/);
    }
    expect(CSS).not.toMatch(/scale\(0\)/);
    expect(CSS).not.toMatch(/ease-in\b(?!-out)/);
  });

  it("builds on the design system's controls instead of drawing its own", () => {
    for (const part of ["ad-btn", "ad-tabs", "ad-tab", "ad-switch", "ad-search", "ad-select", "ad-card-row", "ad-progress", "ad-icon-btn"]) {
      expect(PAGE).toContain(part);
    }
    expect(PAGE).not.toContain("tools-switch");
    expect(PAGE).not.toContain("agents-primary");
  });

  it("uses no emoji or star glyphs as icons", () => {
    expect(PAGE).not.toMatch(/[\u{1F300}-\u{1FAFF}✨★☆]/u);
  });
});
