import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { licencePaths, readLicences } from "../src/main/licencePaths.ts";
import { licenceTabs, REPOSITORY_URL } from "../src/renderer/help/licencesModel.ts";

describe("licencePaths", () => {
  it("reads from resources in an installed build", () => {
    const paths = licencePaths({ packaged: true, resourcesPath: "/opt/ADCode/resources", appPath: "/ignored" });
    expect(paths.licence).toBe(join("/opt/ADCode/resources", "licenses", "LICENSE"));
    expect(paths.notice).toBe(join("/opt/ADCode/resources", "licenses", "NOTICE"));
    expect(paths.thirdParty).toBe(join("/opt/ADCode/resources", "licenses", "THIRD-PARTY-NOTICES.txt"));
  });

  it("reads from the repository in a source checkout", () => {
    const appPath = join("/repo", "apps", "desktop");
    const paths = licencePaths({ packaged: false, resourcesPath: "/ignored", appPath });
    expect(paths.licence).toBe(join("/repo", "LICENSE"));
    expect(paths.notice).toBe(join("/repo", "NOTICE"));
    expect(paths.thirdParty).toBe(join("/repo", "build", "licenses", "THIRD-PARTY-NOTICES.txt"));
  });
});

describe("readLicences", () => {
  const paths = { licence: "L", notice: "N", thirdParty: "T" };

  it("returns the three documents", async () => {
    const documents = await readLicences(paths, async (path) => `text of ${path}`);
    expect(documents).toEqual({ licence: "text of L", notice: "text of N", thirdParty: "text of T" });
  });

  it("resolves with null for a file that cannot be read, never rejects", async () => {
    const documents = await readLicences(paths, async (path) => {
      if (path === "T") throw new Error("ENOENT");
      return "ok";
    });
    expect(documents).toEqual({ licence: "ok", notice: "ok", thirdParty: null });
  });
});

describe("licenceTabs", () => {
  it("shows each document under its own tab, ADCode's licence first", () => {
    const tabs = licenceTabs({ licence: "APACHE", notice: "NOTICE TEXT", thirdParty: "THIRD" });
    expect(tabs.map((tab) => tab.id)).toEqual(["licence", "notice", "third-party"]);
    expect(tabs.map((tab) => tab.label)).toEqual(["ADCode licence", "Notice", "Third-party"]);
    expect(tabs[0]!.text).toBe("APACHE");
  });

  it("explains a missing third-party file instead of showing an empty tab", () => {
    const tab = licenceTabs({ licence: "A", notice: "N", thirdParty: null })[2]!;
    expect(tab.text).toContain("generated when ADCode is packaged");
    expect(tab.text).toContain("node scripts/third-party-notices.mjs");
  });

  it("points at the repository when ADCode's own licence cannot be read", () => {
    const tab = licenceTabs({ licence: null, notice: null, thirdParty: null })[0]!;
    expect(tab.text).toContain("could not be read");
    expect(tab.text).toContain(REPOSITORY_URL);
    expect(tab.text).toContain("Apache License 2.0");
  });
});
