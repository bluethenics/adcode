import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (relative: string): string =>
  readFileSync(new URL(`../src/renderer/${relative}`, import.meta.url), "utf8");

const guide = read("help/helpGuide.ts");
const popover = read("help/helpPopover.ts");
const shortcuts = read("dialogs/shortcutsDialog.ts");
const structure = read("panels/structurePopup.ts");
const main = read("main.ts");
const smoke = readFileSync(new URL("../../../scripts/smoke.mjs", import.meta.url), "utf8");
const helpStyles = read("styles/help.css");
const popupStyles = read("styles/popups.css");

describe("dialog accessibility polish", () => {
  it("gives Help and Shortcuts visible, task-specific close controls", () => {
    expect(guide).toContain('closeButton.className = "help-guide-close"');
    expect(guide).toContain('closeButton.setAttribute("aria-label", "Close ADCode Guide")');
    expect(shortcuts).toContain('close.setAttribute("aria-label", "Close Keyboard Shortcuts")');
    expect(structure).toContain('close.setAttribute("aria-label", "Close Structure")');
    expect(helpStyles).toMatch(/\.help-guide-close\s*\{[^}]*min-height: 32px;/);
    expect(popupStyles).toMatch(/\.structure-popup-close\s*\{[^}]*min-width: 32px;[^}]*min-height: 32px;/);
    expect(popupStyles).toMatch(/\.shortcuts-close\s*\{[^}]*min-width: 32px;[^}]*min-height: 32px;/);
  });

  it("uses complete boxed material for native Help and Shortcuts dialogs", () => {
    expect(guide).toContain('panel.className = "settings-panel help-guide-panel"');
    expect(popupStyles).toMatch(/\.shortcuts-card\s*\{[\s\S]*border-radius: 16px;/);
    expect(helpStyles).toMatch(/\.help-guide-panel\s*\{[\s\S]*border-radius: 16px;/);
  });

  it("puts row help in the browser top layer and restores its anchor", () => {
    expect(popover).toContain('card.setAttribute("popover", "manual")');
    expect(popover).toContain("card.showPopover()");
    expect(popover).toContain("card.hidePopover()");
    expect(popover).toContain("returnTo.focus()");
  });

  it("routes task dialogs to their primary input instead of the shell", () => {
    for (const selector of [
      ".settings-search",
      ".feature-library-search",
      ".scm-message",
      ".chat-input",
    ]) {
      expect(main).toContain(`querySelector<HTMLElement>("${selector}")`);
    }
  });

  it("runtime-audits every required popup close control", () => {
    expect(smoke).toContain("checks.dialogCloseAudit");
    for (const name of [
      "Structure",
      "Earnings",
      "Source Control",
      "All Features",
      "Settings",
      "Assistant",
      "Connect a model",
      "ADCode Guide",
      "Keyboard Shortcuts",
    ]) {
      expect(smoke).toContain(`name: '${name}'`);
    }
  });
});
