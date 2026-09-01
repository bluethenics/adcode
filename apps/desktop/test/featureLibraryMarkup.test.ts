import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const HTML = readFileSync(join(import.meta.dirname, "../src/renderer/index.html"), "utf8");
const MAIN = readFileSync(join(import.meta.dirname, "../src/renderer/main.ts"), "utf8");
const LIBRARY = readFileSync(
  join(import.meta.dirname, "../src/renderer/features/featureLibrary.ts"),
  "utf8",
);
const CSS_PATH = join(import.meta.dirname, "../src/renderer/styles/features.css");

describe("All Features renderer contract", () => {
  it("places a four-cell docked-view button below Earnings and above Settings", () => {
    const earningsAt = HTML.indexOf('id="open-earnings"');
    const featuresAt = HTML.indexOf('id="open-features"');
    const settingsAt = HTML.indexOf('id="open-settings"');
    const button = HTML.slice(featuresAt, HTML.indexOf("</button>", featuresAt));

    expect(earningsAt).toBeGreaterThan(-1);
    expect(featuresAt).toBeGreaterThan(earningsAt);
    expect(settingsAt).toBeGreaterThan(featuresAt);
    expect(button).toContain('data-sidebar-view="features"');
    expect(button).toContain('aria-pressed="false"');
    expect(button).toContain('aria-expanded="false"');
    expect(button).toContain('aria-label="All Features"');
    expect(button).not.toContain('aria-haspopup="dialog"');
    expect(HTML).toContain('class="sidebar-view" id="view-features" data-sidebar-view="features"');
    expect(button.match(/<rect /g)).toHaveLength(4);
  });

  it("uses the shared help and delegates actions instead of reimplementing them", () => {
    expect(MAIN).toContain("createFeatureLibrary");
    expect(LIBRARY).toContain("createHelpButton");
    expect(MAIN).toContain("commands.run(action.command)");
    expect(MAIN).toContain("openSetting(action.settingId)");
    expect(MAIN).toContain('showView("features", "keyboard")');
    expect(MAIN).toContain("featureLibrary.open()");
  });

  it("chooses a category from a menu, not a strip that scrolls out of reach", () => {
    const css = readFileSync(CSS_PATH, "utf8");

    /*
     * The strip this replaced was `overflow-x: auto` with `scrollbar-width: none`. Arrow
     * keys walked it, so it looked accessible, but once the catalogue outgrew the sheet's
     * width a pointer had no scrollbar and no gesture that reached the categories past the
     * edge. A vertical menu has no edge to fall off.
     */
    expect(css).not.toContain("scrollbar-width: none");
    expect(css).toContain(".feature-library-filter-menu");

    expect(LIBRARY).toContain('filterButton.setAttribute("aria-haspopup", "listbox")');
    expect(LIBRARY).toContain('menu.setAttribute("role", "listbox")');
    expect(LIBRARY).toContain('option.setAttribute("role", "option")');
    // Escape closes the menu before the sheet, so one press is never two dismissals.
    expect(LIBRARY).toContain("if (menuIsOpen()) closeMenu();");
  });

  it("uses semantic materials and removes motion when requested", () => {
    const css = readFileSync(CSS_PATH, "utf8");

    expect(css).toContain("var(--bg-elevated)");
    expect(css).toContain("var(--border-hairline)");
    expect(css).toContain("var(--text-primary)");
    expect(css).toContain("backdrop-filter");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
