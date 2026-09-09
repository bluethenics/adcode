import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ALL_TERMINAL_ASSETS,
  missingFrom,
  parseDownloads,
  requiredAssets,
  TERMINAL_REQUIRED_ASSETS,
} from "@adcode/release/downloadAssets";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const BUILDER = join(ROOT, "electron-builder.yml");

const builder = readFileSync(BUILDER, "utf8");

// The website no longer declares file downloads - every install is a terminal command.
// These tests pin what the terminal install scripts fetch, using inline fixtures for the
// pure parser and the static table for the release check itself.

describe("the installers the terminal scripts will ask for", () => {
  it("requires the Windows and Linux installers, and nothing for macOS", () => {
    expect([...ALL_TERMINAL_ASSETS].sort()).toEqual([
      "ADCode-Setup-x64.exe",
      "ADCode-amd64.deb",
      "ADCode-x86_64.AppImage",
    ]);
    expect(TERMINAL_REQUIRED_ASSETS["windows"]).toEqual(["ADCode-Setup-x64.exe"]);
    expect([...(TERMINAL_REQUIRED_ASSETS["linux"] ?? []), ...(TERMINAL_REQUIRED_ASSETS["linux-deb"] ?? [])].sort()).toEqual([
      "ADCode-amd64.deb",
      "ADCode-x86_64.AppImage",
    ]);
  });

  /*
   * macOS is not published yet.
   *
   * Signing and notarisation need a paid Apple membership, and an un-notarised app is not
   * warned about but refused. Requiring the .dmg would block every release on a build
   * nobody is being offered, so "coming soon" has to mean something to the release check
   * and not only to the page.
   */
  it("does not require an installer for a platform that is coming soon", () => {
    expect(requiredAssets([], "macos")).toEqual([]);
    expect(requiredAssets([], "macos-intel")).toEqual([]);
    expect(requiredAssets([])).toEqual([
      "ADCode-Setup-x64.exe",
      "ADCode-x86_64.AppImage",
      "ADCode-amd64.deb",
    ]);
  });

  it("narrows to one platform for a per-runner check", () => {
    expect(requiredAssets([], "windows")).toEqual(["ADCode-Setup-x64.exe"]);
    // Asking about a platform that cannot ship is not an error; there is simply nothing
    // for that runner to prove.
    expect(requiredAssets([], "macos")).toEqual([]);
  });

  it("still parses a declared list when one is given", () => {
    const targets = parseDownloads(`
      id: "windows" asset: "ADCode-Setup-x64.exe" available: true
      id: "macos" asset: "ADCode-arm64.dmg" available: false
    `);

    expect(requiredAssets(targets)).toEqual(["ADCode-Setup-x64.exe"]);
    expect(requiredAssets(targets, "macos")).toEqual([]);
  });

  /*
   * The templates that have to produce those names.
   *
   * `${arch}` resolves per target - `x64` for the .exe, `x86_64` for the AppImage,
   * `amd64` for the .deb - so the two files agree only by the author having known that.
   * This asserts the templates are still the ones that were reasoned about. It cannot
   * prove what electron-builder emits; `scripts/check-release-assets.mjs` does that
   * against the real output, in CI, before a release is drafted.
   */
  it("keeps electron-builder's templates in the shape those names came from", () => {
    expect(builder).toContain("artifactName: ADCode-Setup-${arch}.${ext}");
    expect(builder).toContain("artifactName: ADCode-${arch}.${ext}");
    expect(builder).toContain("artifactName: ADCode-${arch}.AppImage");
  });

  it("names every missing asset rather than only the first", () => {
    const present = ["ADCode-Setup-x64.exe", "latest.yml"];
    const wanted = ["ADCode-Setup-x64.exe", "ADCode-x86_64.AppImage", "ADCode-amd64.deb"];

    expect(missingFrom(present, wanted)).toEqual([
      "ADCode-x86_64.AppImage",
      "ADCode-amd64.deb",
    ]);
    expect(missingFrom(present, ["latest.yml"])).toEqual([]);
  });

  it("refuses to pass when the shape it parses has changed under it", () => {
    // Parsing nothing and reporting success is how this check would quietly stop working.
    expect(() => parseDownloads("export const DOWNLOADS = [];")).toThrow();
    expect(() => parseDownloads("nothing like the file at all")).toThrow();
  });
});
