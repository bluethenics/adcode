import { existsSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Home from "../src/app/page";
import { DocsShowcase, FEATURED_DOCS } from "../src/components/DocsShowcase";
import { LiveAgentsShowcase } from "../src/components/LiveAgentsShowcase";
import { LiveRecording } from "../src/components/LiveRecording";
import { DOC_SEED } from "../src/lib/docsSeed";
import { liveRecording } from "../src/lib/liveRecording";

const at = (markup: string, needle: string): number => {
  const index = markup.indexOf(needle);
  expect(index, needle).toBeGreaterThan(-1);
  return index;
};

describe("the homepage shows agents at work and ends with the docs", () => {
  it("puts the agents tour after the first steps, and the docs after everything else", () => {
    const markup = renderToStaticMarkup(<Home />);
    expect(at(markup, 'id="how-it-works"')).toBeLessThan(at(markup, 'id="agents"'));
    expect(at(markup, 'id="agents"')).toBeLessThan(at(markup, 'id="live-recording-heading"'));
    expect(at(markup, 'id="live-recording-heading"')).toBeLessThan(at(markup, 'class="closing-cta'));
    expect(at(markup, 'id="advertise"')).toBeLessThan(at(markup, 'id="docs"'));
    expect(at(markup, 'class="marketplace-principles"')).toBeLessThan(at(markup, 'id="docs"'));
  });
});

describe("the agents tour", () => {
  it("renders the whole story as one still frame before any script runs", () => {
    const markup = renderToStaticMarkup(<LiveAgentsShowcase />);
    expect(markup).toContain("Your agents,");
    expect(markup).toContain("01 / 04");
    expect(markup).toContain("04 / 04");
    expect(markup).toContain("Checks passed");
    expect(markup).toContain("Unverified");
    expect(markup).toContain("Project memory");
    // The four points are buttons, so the stage can be driven from the keyboard.
    expect(markup.match(/<button type="button" aria-pressed=/g)).toHaveLength(4);
  });
});

describe("the recording", () => {
  it("plays muted and inline, has a poster, and says the model was scripted", () => {
    const markup = renderToStaticMarkup(<LiveRecording />);
    expect(markup).toMatch(/<video[^>]*muted/);
    expect(markup).toMatch(/<video[^>]*loop/);
    expect(markup).toMatch(/<video[^>]*playsInline|<video[^>]*playsinline/i);
    expect(markup).toContain(`poster="${liveRecording.poster}"`);
    expect(markup).toContain('type="video/webm"');
    expect(markup).toContain('type="video/mp4"');
    expect(markup).toContain("scripted for the recording");
  });

  it("points at files that exist", () => {
    for (const file of [liveRecording.poster, liveRecording.webm, liveRecording.mp4]) {
      expect(existsSync(new URL(`../public${file}`, import.meta.url)), file).toBe(true);
    }
  });
});

describe("the docs, last on the page", () => {
  it("links only to guides that exist", () => {
    const slugs = new Set(DOC_SEED.map((doc) => doc.slug));
    for (const slug of FEATURED_DOCS) expect(slugs.has(slug), slug).toBe(true);
    const markup = renderToStaticMarkup(<DocsShowcase />);
    for (const slug of FEATURED_DOCS) expect(markup).toContain(`href="/docs/${slug}"`);
    expect(markup).toContain('href="/docs"');
  });
});
