import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const redesignCss = readFileSync(new URL("../src/app/redesign.css", import.meta.url), "utf8");
const globalsCss = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

/**
 * The counter once painted dark text on a dark card in light mode, so the label
 * and digits were invisible while dark mode looked fine.
 *
 * The mechanism: `light-dark()` used raw in an element rule resolves against
 * that element's `color-scheme`, but `var(--text)`-style colors resolve once on
 * `:root` and are inherited. A stale `body { color-scheme: dark; }` left over
 * from the dark-only era split the two, and the card and its text picked
 * opposite themes.
 *
 * So the counter keeps every color it paints in element-scoped `--dev-*`
 * custom properties, declared and used inside the same `.hero-dev-counter`
 * subtree. One scheme resolves them all, which means the background and the
 * text can never disagree again no matter what an ancestor declares. These
 * assertions exist to stop the next edit from reaching back out to the root
 * theme vars and reintroducing the split.
 */
describe("DeveloperCounter theme", () => {
  const counterLines = redesignCss.split("\n").filter((line) => line.includes("hero-dev-counter"));
  it("paints only from element-scoped --dev-* colors, never root theme vars", () => {
    expect(counterLines.length).toBeGreaterThan(0);
    const used = counterLines
      .flatMap((line) => [...line.matchAll(/var\((--[\w-]+)/g)].map((match) => match[1]))
      .filter((name): name is string => typeof name === "string");
    expect(used.length).toBeGreaterThan(0);
    for (const name of used) {
      expect(name === "--font-mono" || name.startsWith("--dev-"), `counter must not use ${name}`).toBe(true);
    }
  });

  it("declares every --dev-* color it uses", () => {
    const base = counterLines.find((line) => line.startsWith(".hero-dev-counter {"));
    for (const name of ["--dev-bg", "--dev-ink", "--dev-muted", "--dev-line", "--dev-digit-bg", "--dev-digit-border", "--dev-shadow"]) {
      expect(base?.includes(`${name}:`), `missing ${name} declaration`).toBe(true);
    }
  });

  it("has no competing body color-scheme override outside the theme system", () => {
    // redesign.css owns the themed `body { color-scheme: var(--appearance-scheme) }`.
    // A second bare rule here would force a dark subtree inside light mode and
    // split raw light-dark() uses from inherited theme vars again.
    expect(globalsCss.includes("body { color-scheme: dark; }")).toBe(false);
  });
});
