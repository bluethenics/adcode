import { describe, expect, it } from "vitest";
import { formatCount, goalProgress, installsFrom, LAUNCH_GOAL } from "../src/lib/heroStats";

/** The shape GitHub returns, trimmed to the fields the counter reads. */
const releases = [
  {
    assets: [
      { name: "ADCode-Setup-x64.exe", download_count: 4 },
      { name: "ADCode-Setup-x64.exe.blockmap", download_count: 91 },
      { name: "ADCode-x86_64.AppImage", download_count: 3 },
      { name: "ADCode-amd64.deb", download_count: 3 },
      { name: "ADCode-arm64.dmg", download_count: 0 },
      { name: "latest.yml", download_count: 260 },
    ],
  },
];

describe("counting installs", () => {
  it("counts the files a person installs, and nothing else", () => {
    // 4 + 3 + 3 + 0. The blockmap and latest.yml are fetched by the auto-updater on a
    // timer, so counting them would report update traffic as new developers.
    expect(installsFrom(releases)).toBe(10);
  });

  it("adds up across every published release", () => {
    expect(installsFrom([...releases, { assets: [{ name: "a.deb", download_count: 5 }] }])).toBe(15);
  });

  it("ignores anything shaped wrongly rather than counting NaN", () => {
    expect(
      installsFrom([
        { assets: [{ name: "x.exe", download_count: "many" }] },
        { assets: [{ download_count: 4 }] },
        { assets: [{ name: "y.exe" }] },
        { assets: "not an array" },
        {},
      ] as never),
    ).toBe(0);
  });

  it("never counts a negative download backwards", () => {
    expect(installsFrom([{ assets: [{ name: "x.exe", download_count: -7 }] }])).toBe(0);
  });
});

describe("progress towards the goal", () => {
  it("reports the real fraction", () => {
    expect(goalProgress(250, 1000)).toBe(0.25);
  });

  it("fills rather than overflows once the goal is passed", () => {
    expect(goalProgress(4000, 1000)).toBe(1);
  });

  it("is zero before anything has happened", () => {
    expect(goalProgress(0)).toBe(0);
    expect(goalProgress(-3)).toBe(0);
  });

  it("counts towards a round, stated goal", () => {
    expect(LAUNCH_GOAL).toBe(1000);
  });
});

describe("formatting", () => {
  it("groups thousands so a large number stays readable", () => {
    expect(formatCount(1234)).toBe("1,234");
    expect(formatCount(10)).toBe("10");
  });

  it("never renders a fraction of a person", () => {
    expect(formatCount(12.7)).toBe("12");
  });
});
