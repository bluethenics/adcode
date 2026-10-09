import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Home from "../src/app/page";
import { Partners } from "../src/components/Partners";
import { PARTNERS } from "../src/lib/partners";

const publicFile = (src: string): string => fileURLToPath(new URL(`../public${src}`, import.meta.url));

describe("partners", () => {
  it("lists Tagflow AI, linked to its site", () => {
    const markup = renderToStaticMarkup(<Partners />);
    expect(markup).toContain("Tagflow AI");
    expect(markup).toContain('href="https://tagflow-ai.com"');
    expect(markup).toContain('rel="noreferrer"');
  });

  it("sits directly under the hero recording", () => {
    const markup = renderToStaticMarkup(<Home />);
    const showcase = markup.indexOf('class="app-showcase"');
    const partners = markup.indexOf('class="partners"');
    expect(showcase).toBeGreaterThan(-1);
    expect(partners).toBeGreaterThan(showcase);
    // Nothing else between the end of the recording's figure and the partners row.
    expect(markup.slice(markup.indexOf("</figure>", showcase), partners)).toBe("</figure><section ");
  });

  it("never points at a logo that is not committed, and links only over https", () => {
    for (const partner of PARTNERS) {
      expect(partner.name.trim().length).toBeGreaterThan(0);
      expect(partner.href.startsWith("https://")).toBe(true);
      for (const logo of [partner.logo, partner.logoDark]) {
        if (logo === undefined) continue;
        expect(existsSync(publicFile(logo.src)), logo.src).toBe(true);
        if (logo.src.endsWith(".svg")) expect(readFileSync(publicFile(logo.src), "utf8")).not.toMatch(/<script|on\w+=/i);
      }
    }
  });

  it("draws only logos that exist, and the name either way", () => {
    const markup = renderToStaticMarkup(<Partners />);
    const logos = PARTNERS.reduce((sum, partner) => sum + (partner.logo ? 1 : 0) + (partner.logoDark ? 1 : 0), 0);
    expect((markup.match(/<img /g) ?? []).length).toBe(logos);
    expect((markup.match(/class="partner-name"/g) ?? []).length).toBe(PARTNERS.length);
  });
});
