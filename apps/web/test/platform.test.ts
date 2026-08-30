import { describe, expect, it } from "vitest";
import {
  detectPlatform,
  installCommand,
  installRoute,
  type Platform,
} from "../src/lib/platform";

const UA = {
  windows11:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36",
  appleSilicon:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  oldIntelMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0 Safari/605.1.15",
  ubuntu:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36",
  chromeOs:
    "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36",
  iphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile Safari/604.1",
};

describe("reading the machine", () => {
  it("names the desktop platforms it can serve", () => {
    expect(detectPlatform(UA.windows11)).toBe("windows");
    expect(detectPlatform(UA.ubuntu)).toBe("linux");
    expect(detectPlatform(UA.chromeOs)).toBe("linux");
  });

  /*
   * Every Mac reports "Intel Mac OS X" in its user agent, Apple silicon included - Safari
   * froze that string years ago. Only the older minor versions are genuinely Intel, which
   * is why the check is on 10_10 through 10_14 rather than on the word "Intel".
   */
  it("tells an Apple silicon Mac from a genuinely old Intel one", () => {
    expect(detectPlatform(UA.appleSilicon)).toBe("macos");
    expect(detectPlatform(UA.oldIntelMac)).toBe("macos-intel");
  });

  it("gives up rather than guessing on anything else", () => {
    expect(detectPlatform("")).toBe("unknown");
    expect(detectPlatform("some crawler/1.0")).toBe("unknown");
  });

  it("treats an iPhone as a Mac, which costs one click and never a wrong download", () => {
    // It matches /Mac/, so it lands on "coming soon" and a link to the download page -
    // which is the right destination for a phone anyway.
    expect(installRoute(detectPlatform(UA.iphone))).toBe("soon");
  });
});

describe("how each platform should install", () => {
  /*
   * The routes differ because the platforms genuinely do, not for variety.
   *
   * Windows takes the terminal because a browser download of an unsigned installer earns
   * the SmartScreen dialog and a terminal fetch does not. Linux has nothing to sign.
   * macOS cannot ship at all until it is notarised.
   */
  it("sends Windows to the terminal and Linux to the button", () => {
    expect(installRoute("windows")).toBe("terminal");
    expect(installRoute("linux")).toBe("download");
  });

  it("offers macOS nothing it cannot deliver", () => {
    expect(installRoute("macos")).toBe("soon");
    expect(installRoute("macos-intel")).toBe("soon");
  });

  it("shows the full list before hydration, rather than guessing in the loudest place", () => {
    expect(installRoute("unknown")).toBe("choose");
  });
});

describe("the command a visitor is asked to paste", () => {
  const origin = "https://adcode.bluethenics.com";

  it("matches the installer each platform actually has", () => {
    expect(installCommand("windows", origin)).toBe(
      "irm https://adcode.bluethenics.com/install.ps1 | iex",
    );
    expect(installCommand("linux", origin)).toBe(
      "curl -fsSL https://adcode.bluethenics.com/install.sh | sh",
    );
  });

  it("offers no command for a platform that has no installer", () => {
    for (const platform of ["macos", "macos-intel", "unknown"] as Platform[]) {
      expect(installCommand(platform, origin), platform).toBeNull();
    }
  });

  it("never produces a double slash from a trailing one", () => {
    // The origin comes from configuration, and a trailing slash there would otherwise put
    // a 404 in the single most copied string on the site.
    expect(installCommand("linux", "https://adcode.bluethenics.com/")).toBe(
      "curl -fsSL https://adcode.bluethenics.com/install.sh | sh",
    );
  });
});
