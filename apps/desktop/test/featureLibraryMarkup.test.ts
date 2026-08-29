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
  it("places a four-cell dialog button below Earnings and above Settings", () => {
    const earningsAt = HTML.indexOf('id="open-earnings"');
    const featuresAt = HTML.indexOf('id="open-features"');
    const settingsAt = HTML.indexOf('id="open-settings"');
    const button = HTML.slice(featuresAt, HTML.indexOf("</button>", featuresAt));

    expect(earningsAt).toBeGreaterThan(-1);
    expect(featuresAt).toBeGreaterThan(earningsAt);
    expect(settingsAt).toBeGreaterThan(featuresAt);
    expect(button).toContain('aria-haspopup="dialog"');
    expect(button).toContain('aria-expanded="false"');
    expect(button).toContain('aria-label="All Features"');
    expect(button).not.toContain("data-view");
    expect(button.match(/<rect /g)).toHaveLength(4);
  });

  it("uses the shared help and delegates actions instead of reimplementing them", () => {
    expect(MAIN).toContain("createFeatureLibrary");
    expect(LIBRARY).toContain("createHelpButton");
    expect(MAIN).toContain("commands.run(action.command)");
    expect(MAIN).toContain("settingsView.openAt(action.settingId)");
    expect(MAIN).toContain("openFeatureLibrary = () => featureLibrary.toggle()");
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
