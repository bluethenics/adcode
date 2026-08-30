import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { expectedAssets, missingFrom } from "@adcode/release/downloadAssets";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const ROUTE = join(ROOT, "apps", "web", "src", "app", "dl", "[platform]", "route.ts");
const BUILDER = join(ROOT, "electron-builder.yml");

const route = readFileSync(ROUTE, "utf8");
const builder = readFileSync(BUILDER, "utf8");

describe("the names the website will ask for", () => {
  it("reads one asset for every platform the download route serves", () => {
    const assets = expectedAssets(route);

    expect([...assets.keys()].sort()).toEqual([
      "linux",
      "linux-deb",
      "macos",
      "macos-intel",
      "windows",
    ]);
    expect(assets.get("windows")).toBe("ADCode-Setup-x64.exe");
    expect(assets.get("macos")).toBe("ADCode-arm64.dmg");
    expect(assets.get("linux")).toBe("ADCode-x86_64.AppImage");
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
    const wanted = ["ADCode-Setup-x64.exe", "ADCode-arm64.dmg", "ADCode-amd64.deb"];

    // Every one, in the order they were wanted: a release three files short should say so
    // once, not over three build attempts.
    expect(missingFrom(present, wanted)).toEqual(["ADCode-arm64.dmg", "ADCode-amd64.deb"]);
    expect(missingFrom(present, ["latest.yml"])).toEqual([]);
  });

  it("refuses to pass when the route's shape has changed under it", () => {
    // Parsing nothing and reporting success is how this check would quietly stop working.
    expect(() => expectedAssets("const PLATFORMS = {} as const;")).toThrow();
    expect(() => expectedAssets("nothing like the route at all")).toThrow();
  });
});
