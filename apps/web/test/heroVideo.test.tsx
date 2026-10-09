import { existsSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppShowcase } from "../src/components/AppShowcase";
import { showcase } from "../src/lib/showcase";

describe("the hero is a recording, not a picture", () => {
  const markup = renderToStaticMarkup(<AppShowcase />);

  it("plays one recording per theme, muted and inline, with a poster", () => {
    expect(markup).not.toContain("<img");
    for (const take of [showcase.light, showcase.dark]) {
      expect(markup).toContain(`poster="${take.poster}"`);
      expect(markup).toContain(`src="${take.webm}"`);
      expect(markup).toContain(`src="${take.mp4}"`);
    }
    expect(markup.match(/<video[^>]*muted[^>]*>/g)).toHaveLength(2);
    expect(markup.match(/<video[^>]*loop[^>]*>/g)).toHaveLength(2);
    expect(markup.match(/<video[^>]*playsinline[^>]*>/gi)).toHaveLength(2);
    expect(markup).toContain(`aria-label="${showcase.alt}"`);
  });

  it("says how it was made", () => {
    expect(markup).toContain("Recorded in ADCode");
    expect(markup).toContain("scripted");
  });

  it("points at files that exist", () => {
    for (const take of [showcase.light, showcase.dark]) {
      for (const file of [take.poster, take.webm, take.mp4]) {
        expect(existsSync(new URL(`../public${file}`, import.meta.url)), file).toBe(true);
      }
    }
  });
});
