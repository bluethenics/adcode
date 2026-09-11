import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const HTML = readFileSync(
  join(import.meta.dirname, "../src/renderer/index.html"),
  "utf8",
);
const MAIN = readFileSync(
  join(import.meta.dirname, "../src/renderer/main.ts"),
  "utf8",
);
const LIBRARY = readFileSync(
  join(import.meta.dirname, "../src/renderer/features/featureLibrary.ts"),
  "utf8",
);
const SMOKE = readFileSync(
  join(import.meta.dirname, "../../../scripts/smoke.mjs"),
  "utf8",
);
const CSS_PATH = join(
  import.meta.dirname,
  "../src/renderer/styles/features.css",
);

describe("All Features renderer contract", () => {
  it("keeps All Features as a popup launcher and moves its host out of the structural sidebar", () => {
    const earningsAt = HTML.indexOf('id="open-earnings"');
    const featuresAt = HTML.indexOf('id="open-features"');
    const settingsAt = HTML.indexOf('id="open-settings"');
    const button = HTML.slice(
      featuresAt,
      HTML.indexOf("</button>", featuresAt),
    );
    const sidebarContent = HTML.slice(
      HTML.indexOf('class="sidebar-content"'),
      HTML.indexOf("</aside>", HTML.indexOf('class="sidebar-content"')),
    );

    expect(earningsAt).toBeGreaterThan(-1);
    expect(featuresAt).toBeGreaterThan(earningsAt);
    expect(settingsAt).toBeGreaterThan(featuresAt);
    expect(button).toContain('data-sidebar-view="features"');
    expect(button).toContain('aria-pressed="false"');
    expect(button).toContain('aria-expanded="false"');
    expect(button).toContain('aria-haspopup="dialog"');
    expect(button).toContain('aria-label="All Features"');
    expect(sidebarContent).not.toContain('id="view-features"');
    expect(HTML).toContain('<div id="popup-primary-host"></div>');
    expect(HTML).toContain('<div id="popup-dependent-host"></div>');
    expect(button.match(/<rect /g)).toHaveLength(4);
  });

  it("uses the shared help and delegates actions instead of reimplementing them", () => {
    expect(MAIN).toContain("createFeatureLibrary");
    expect(LIBRARY).toContain("createHelpButton");
    expect(MAIN).toContain("commands.run(action.command)");
    expect(MAIN).toContain("openSetting(action.settingId)");
    expect(MAIN).toContain('size: "large"');
    expect(MAIN).toContain('openPrimaryPopup("features", featuresShell');
  });

  it("renders categories beside a spacious results workspace", () => {
    const css = readFileSync(CSS_PATH, "utf8");

    // Removing either region would collapse the two-pane library back into a narrow list.
    expect(LIBRARY).toContain(
      'categoryRail.className = "feature-library-categories"',
    );
    expect(LIBRARY).toContain(
      'workspace.className = "feature-library-workspace"',
    );
    expect(LIBRARY).toContain("body.append(categoryRail, workspace)");
    expect(css).toContain(".feature-library-body");
    expect(css).toContain("grid-template-columns: 220px minmax(0, 1fr)");
  });

  it("exposes the popup as a modal dialog", () => {
    expect(LIBRARY).toContain('sheet.setAttribute("role", "dialog")');
    expect(LIBRARY).toContain('sheet.setAttribute("aria-modal", "true")');
  });

  it("keeps the results as the bounded scrolling region", () => {
    const css = readFileSync(CSS_PATH, "utf8");

    expect(css).toMatch(/\.feature-library-body\s*\{[^}]*overflow: hidden;/s);
    expect(css).toMatch(/\.feature-library-workspace\s*\{[^}]*min-height: 0;[^}]*overflow: hidden;/s);
    expect(css).toMatch(/\.feature-library-results\s*\{[^}]*overflow-y: auto;/s);
    expect(css).toMatch(/\.feature-library-workspace-header\s*\{[^}]*position: sticky;/s);
  });

  it("renders boolean actions as accessible switches", () => {
    expect(LIBRARY).toContain('button.className = "feature-library-toggle"');
    expect(LIBRARY).toContain('button.setAttribute("role", "switch")');
    expect(LIBRARY).toContain('button.setAttribute("aria-checked"');
  });

  it("places the Assistant launcher immediately below All Features", () => {
    const featuresAt = HTML.indexOf('id="open-features"');
    const assistantAt = HTML.indexOf('id="ai-toggle"');
    const settingsAt = HTML.indexOf('id="open-settings"');

    expect(assistantAt).toBeGreaterThan(featuresAt);
    expect(settingsAt).toBeGreaterThan(assistantAt);
    expect(HTML.slice(featuresAt, assistantAt)).toContain("</button>");
  });

  it("does not position or dismiss its own overlay", () => {
    // The shared shell is the only owner of placement and document-level dismissal.
    expect(LIBRARY).not.toContain("positionPopover");
    expect(LIBRARY).not.toContain('document.addEventListener("pointerdown"');
    expect(LIBRARY).not.toContain('document.addEventListener("keydown"');
  });

  it("keeps the activated category control in place while updating selection", () => {
    // Replacing a focused category button makes keyboard activation drop focus to the page.
    expect(LIBRARY).toContain("const categoryButtons = new Map");
    expect(LIBRARY).not.toContain("categoryRail.replaceChildren()");
  });

  it("requires settings highlight and focus evidence before smoke passes", () => {
    expect(SMOKE).toContain("rowFocused: document.activeElement === row");
    expect(SMOKE).toContain(
      "checks.featureLibraryActionEvidence.rowMarked === true",
    );
    expect(SMOKE).toContain(
      "checks.featureLibraryActionEvidence.rowFocused === true",
    );
    expect(SMOKE).toContain("checks.helpGuideJumpEvidence.rowMarked === true");
    expect(SMOKE).toContain("checks.helpGuideJumpEvidence.rowFocused === true");
  });

  it("uses semantic materials and removes motion when requested", () => {
    const css = readFileSync(CSS_PATH, "utf8");

    expect(css).toContain("var(--bg-elevated)");
    expect(css).toContain("var(--border-hairline)");
    expect(css).toContain("var(--text-primary)");
    expect(css).toContain("backdrop-filter");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("keeps the focused search visible in Windows forced-colors mode", () => {
    const css = readFileSync(CSS_PATH, "utf8");

    expect(css).toMatch(/@media \(forced-colors: active\)[\s\S]*\.feature-library-search:focus[\s\S]*outline: 2px solid Highlight;/);
  });
});
