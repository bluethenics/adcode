import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The monochrome charcoal theme, applied app-wide.
 *
 * Dark is warm charcoal with an off-white accent; light is warm paper with a
 * near-black accent; Midnight keeps its own identity. These assertions pin the
 * palette so a stray blue cannot creep back in, and pin the surfaces that
 * carry their own hardcoded colours (Monaco, xterm, theme-picker swatches).
 */
const styles = (name: string): string =>
  readFileSync(new URL(`../src/renderer/styles/${name}.css`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const source = (path: string): string =>
  readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");

describe("app-wide charcoal theme", () => {
  it("themes dark charcoal with an off-white accent", () => {
    const tokens = styles("tokens");
    for (const hex of ["#151515", "#1c1b19", "#ebe8e1", "#8f8c85", "#5f5d58", "#2d2b28", "#ece9e2", "#6fb98f", "#e0685c"]) {
      expect(tokens).toContain(hex);
    }
    // Accent-coloured text on accent fills stays readable.
    expect(tokens).toContain("--text-on-accent: #1a1917");
  });

  it("leaves no blue-era values anywhere in the token file", () => {
    const tokens = styles("tokens");
    for (const stale of ["2f81f7", "007aff", "0a0d13", "12161d", "0d1117", "eef1f5", "9aa4b2"]) {
      expect(tokens).not.toContain(stale);
    }
  });

  it("keeps Midnight exactly as it was", () => {
    const tokens = styles("tokens");
    expect(tokens).toContain('--accent: #f1f3f3;');
    expect(tokens).toContain("--bg-app: #000000;");
  });

  it("paints Monaco and the terminal from the same palette", () => {
    const editor = source("../src/renderer/editor/editorHost.ts");
    expect(editor).toContain('"editor.background": "#151515"');
    expect(editor).toContain('"editorCursor.foreground": "#ece9e2"');
    expect(editor).not.toContain("2f81f7");
    expect(editor).not.toContain("0d1117");

    const terminal = source("../src/renderer/terminal/terminalHost.ts");
    expect(terminal).toContain('background: "#151515"');
    expect(terminal).toContain('cursor: "#ece9e2"');
    // Roomy rows, and a light palette where no ANSI colour vanishes on paper.
    expect(terminal).toContain("lineHeight: 1.5");
    expect(terminal).toContain('white: "#6f6c66"');
    expect(terminal).toContain("brightWhite:");
  });

  it("previews the real palette in the theme picker", () => {
    const picker = source("../src/renderer/settings/themePicker.ts");
    expect(picker).toContain('accent: "#ece9e2"');
    expect(picker).toContain('app: "#151515"');
    expect(picker).not.toContain("2f81f7");
  });

  it("leaves every toggle switch exactly alone", () => {
    const settings = styles("settings");
    expect(settings).toContain(".ios-switch input:checked + .ios-switch-track {\n  background: var(--success);");
    const features = styles("features");
    expect(features).toContain(".feature-library-toggle");
  });
});

describe("success and error message styles", () => {
  it("offers all four toast tones with matching markers", () => {
    const centre = source("../src/renderer/notifications/notifications.ts");
    expect(centre).toContain('"info" | "success" | "warning" | "error"');
    const css = styles("notifications");
    for (const tone of ["success", "warning", "error"]) {
      expect(css).toContain(`.toast[data-tone="${tone}"]`);
      expect(css).toContain(`.toast[data-tone="${tone}"]::before`);
      expect(css).toContain(`.toast[data-tone="${tone}"] .toast-title`);
    }
  });

  it("keeps the inline notice tones", () => {
    const css = styles("design-system");
    for (const tone of ["success", "info", "warning", "error"]) {
      expect(css).toContain(`.ad-notif[data-tone="${tone}"] .ad-notif-dot`);
    }
  });
});
