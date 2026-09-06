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
const panelStyles = read("styles/panels.css");
const aiStyles = read("styles/ai.css");
const settings = read("settings/settingsView.ts");

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
    expect(settings).toContain("createHelpPopover(panel)");
  });

  it("keeps task close controls at a practical hit size after generic button rules", () => {
    expect(panelStyles).toMatch(
      /\.scm-panel \.scm-close\s*\{[^}]*min-width: 32px;[^}]*min-height: 32px;/,
    );
    expect(aiStyles).toMatch(
      /\[aria-label="Close Assistant"\][\s\S]*\[aria-label="Close Connect a model"\][\s\S]*min-width: 32px;[\s\S]*min-height: 32px;/,
    );
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

  it("launches narrow Help dialogs through the public palette and isolates audit failures", () => {
    expect(smoke).toContain("async function choosePaletteCommand(commandId, itemLabel)");
    expect(smoke).toContain(
      'choosePaletteCommand("help.guide", "Feature Guide")',
    );
    expect(smoke).toContain(
      'choosePaletteCommand("help.shortcuts", "Keyboard Shortcuts")',
    );
    expect(smoke).toContain("catch (error)");
    expect(smoke).toContain("launched: false");
    expect(smoke).toContain("await pressEscape()");
  });

  it("scopes the dependent Connect audit and reports failed selector evidence", () => {
    expect(smoke).toContain(
      "#popup-dependent-host dialog[data-popup-id=\"connect\"]",
    );
    expect(smoke).toContain("const rootFound =");
    expect(smoke).toContain("const surfaceFound =");
    expect(smoke).toContain("const closeFound =");
    expect(smoke).toContain("const rootOpen =");
  });
});
