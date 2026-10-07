import { describe, expect, it } from "vitest";
import { stickyInstallAction } from "../src/lib/stickyInstall";

/**
 * The install bar that follows a reader down the home page.
 *
 * The hero and the closing section were the only install buttons, with a long page in
 * between - the product tour, the features, the advertiser builder. Once the hero scrolls
 * away a slim bar offers the same install, routed for the machine the reader is on.
 */
describe("stickyInstallAction", () => {
  it("gives Windows the Store's signed installer, tagged as the sticky bar", () => {
    const action = stickyInstallAction("windows", "bluethenics/adcode");
    expect(action).toMatchObject({ kind: "download", label: "Download for Windows" });
    expect(action?.href).toContain("get.microsoft.com/installer/download/9MSW2N027GJX");
    expect(action?.href).toContain("cid=sticky");
  });

  it("gives Linux the .deb", () => {
    expect(stickyInstallAction("linux", "bluethenics/adcode")).toMatchObject({
      kind: "download",
      href: "https://github.com/bluethenics/adcode/releases/latest/download/ADCode-amd64.deb",
    });
  });

  it("lets a phone send the link to its computer in one tap", () => {
    expect(stickyInstallAction("mobile", "r")).toMatchObject({ kind: "send", label: "Send to my computer" });
  });

  it("points a Mac and anything unknown at every install option", () => {
    expect(stickyInstallAction("macos", "r")).toMatchObject({ kind: "link", href: "/versions" });
    expect(stickyInstallAction("unknown", "r")).toMatchObject({ kind: "link", href: "/versions" });
  });
});
