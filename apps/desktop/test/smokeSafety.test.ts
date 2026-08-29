import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("packaged smoke safety", () => {
  it("routes the title-bar centre to universal search while preserving focused searches", () => {
    const main = readFileSync(
      resolve(import.meta.dirname, "../src/renderer/main.ts"),
      "utf8",
    );
    const centre = readFileSync(
      resolve(import.meta.dirname, "../src/renderer/workbench/commandCentre.ts"),
      "utf8",
    );

    expect(centre).toContain('aria-label", "Search all of ADCode"');
    expect(centre).toContain("deps.openSearch(text)");
    expect(main).toContain("createUniversalSearch");
    expect(main).toContain("openUniversalSearch = (seed = \"\") => universalSearch.open(seed)");
    expect(main).toContain('add("go.file", "Go to File", () => quickOpen.toggle())');
    expect(main).toContain('add("go.symbol", "Go to Symbol", () => symbolSearch.open())');
    expect(main).toContain('add("palette.open", "Command Palette", () => palette.toggle())');
    expect(main).toContain('add("view.search", "Find in Files", () => showView("search"))');
  });

  it("keeps the universal ranking core on a browser-safe package entrypoint", () => {
    const renderer = readFileSync(
      resolve(import.meta.dirname, "../src/renderer/workbench/universalSearch.ts"),
      "utf8",
    );
    const config = readFileSync(
      resolve(import.meta.dirname, "../electron.vite.config.ts"),
      "utf8",
    );

    expect(renderer).toContain('from "@adcode/search/universal"');
    expect(renderer).not.toContain('from "@adcode/search"');
    expect(config).toContain('"@adcode/search/universal"');
    expect(config.indexOf('"@adcode/search/universal"')).toBeLessThan(
      config.indexOf('"@adcode/search"'),
    );
  });

  it("drives the complete feature-discovery journey in the built app", () => {
    const source = readFileSync(
      resolve(import.meta.dirname, "../../../scripts/smoke.mjs"),
      "utf8",
    );

    for (const check of [
      "featureLibraryPlacement",
      "featureLibrarySearch",
      "featureLibraryHelp",
      "featureLibraryActionDispatch",
      "featureLibraryFromViewMenu",
      "universalSearchSources",
      "discoveryCloseRestoresEditor",
      "focusedSearchShortcuts",
    ]) {
      expect(source).toContain(`checks.${check}`);
    }

    expect(source).toContain("#open-features");
    expect(source).toContain(".feature-library-search");
    expect(source).toContain(".help-popover-detail");
    expect(source).toContain('chooseMenu("View", "All Features…")');
    expect(source).toContain(".universal-search-group-title");
    expect(source).toContain("Quick open");
    expect(source).toContain("Command palette");
    expect(source).toContain("Go to symbol in project");
    expect(source).toContain("Search the workspace");
  });

  it("cannot inherit Electron's Node-only mode from the invoking agent shell", () => {
    const source = readFileSync(resolve(import.meta.dirname, "../../../scripts/smoke.mjs"), "utf8");

    expect(source).toContain("delete childEnv.ELECTRON_RUN_AS_NODE");
    expect(source).toContain("env: childEnv");
  });

  it("re-resolves its scratch folder before destructive Explorer checks", () => {
    const source = readFileSync(resolve(import.meta.dirname, "../../../scripts/smoke.mjs"), "utf8");
    const start = source.indexOf("// Delete, through however many confirmations");
    const end = source.indexOf("The Problems panel, end to end", start);
    const deletion = source.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(deletion).toContain("const deletePoint = await evaluate");
    expect(deletion).not.toContain("rightClickAt(folderPoint.x, folderPoint.y)");
    expect(source).toContain("checks.createFolder = await waitForTreePath(SCRATCH)");
  });

  it("resolves packaged ad smoke artifacts through the shared release policy", () => {
    const source = readFileSync(resolve(import.meta.dirname, "../../../scripts/smoke-ads.mjs"), "utf8");
    expect(source).toContain('import { releaseDirectory } from "./release-directory.mjs"');
    expect(source).toContain('join(releaseDirectory(REPO), "win-unpacked", "ADCode.exe")');
  });
});
