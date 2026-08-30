import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  missingFrom,
  parseDownloads,
  requiredAssets,
} from "@adcode/release/downloadAssets";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const SOURCE = join(ROOT, "apps", "web", "src", "lib", "downloads.ts");
const BUILDER = join(ROOT, "electron-builder.yml");

const downloads = readFileSync(SOURCE, "utf8");
const builder = readFileSync(BUILDER, "utf8");

describe("the names the website will ask for", () => {
  it("reads every download the site declares, with whether it can ship", () => {
    const targets = parseDownloads(downloads);

    expect(targets.map((target) => target.id).sort()).toEqual([
      "linux",
      "linux-deb",
      "macos",
      "macos-intel",
      "windows",
    ]);
    expect(targets.find((target) => target.id === "windows")?.asset).toBe(
      "ADCode-Setup-x64.exe",
    );
    expect(targets.find((target) => target.id === "linux")?.asset).toBe(
      "ADCode-x86_64.AppImage",
    );
  });

  /*
   * macOS is listed and not shippable.
   *
   * Signing and notarisation need a paid Apple membership, and an un-notarised app is not
   * warned about but refused. Requiring the .dmg would block every release on a build
   * nobody is being offered, so "coming soon" has to mean something to the release check
   * and not only to the page.
   */
  it("does not require an installer for a platform it advertises as coming soon", () => {
    const targets = parseDownloads(downloads);
    const required = requiredAssets(targets);

    expect(required).not.toContain("ADCode-arm64.dmg");
    expect(required).not.toContain("ADCode-x64.dmg");
    expect(required).toEqual([
      "ADCode-Setup-x64.exe",
      "ADCode-x86_64.AppImage",
      "ADCode-amd64.deb",
    ]);
  });

  it("narrows to one platform for a per-runner check", () => {
    const targets = parseDownloads(downloads);

    expect(requiredAssets(targets, "windows")).toEqual(["ADCode-Setup-x64.exe"]);
    // Asking about a platform that cannot ship is not an error; there is simply nothing
    // for that runner to prove.
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
