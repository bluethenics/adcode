import { describe, expect, it } from "vitest";
import {
  detectPlatform,
  installCommand,
  isInstallCommand,
  installRoute,
  LINUX_DOWNLOADS,
  MICROSOFT_STORE,
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

  it("offers phones and tablets a way to send the link to a computer, not commands for their reported OS", () => {
    for (const ua of [UA.iphone, "Mozilla/5.0 (Linux; Android 14) Mobile", "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)"]) {
      const platform = detectPlatform(ua);
      expect(platform).toBe("mobile");
      expect(installRoute(platform)).toBe("send");
      expect(installCommand(platform, "https://example.com")).toBeNull();
    }
    expect(detectPlatform(UA.appleSilicon, 5)).toBe("mobile");
    expect(detectPlatform(UA.appleSilicon, 0)).toBe("macos");
  });
});

describe("how each platform should install", () => {
  /*
   * Windows installs from the Microsoft Store: its package is signed by Microsoft, so a
   * browser download raises no SmartScreen dialog. Linux downloads a package directly.
   * macOS cannot ship at all until it is notarised.
   */
  it("sends Windows to the Microsoft Store and Linux to a direct download", () => {
    expect(installRoute("windows")).toBe("store");
    expect(installRoute("linux")).toBe("download");
  });

  it("points at the real Store listing and the latest Linux release", () => {
    expect(MICROSOFT_STORE.installerUrl("hero")).toBe("https://get.microsoft.com/installer/download/9MSW2N027GJX?referrer=appbadge&cid=hero");
    expect(MICROSOFT_STORE.pageUrl).toBe("https://apps.microsoft.com/detail/9MSW2N027GJX");
    expect(LINUX_DOWNLOADS("bluethenics/adcode")).toEqual({
      deb: "https://github.com/bluethenics/adcode/releases/latest/download/ADCode-amd64.deb",
      appImage: "https://github.com/bluethenics/adcode/releases/latest/download/ADCode-x86_64.AppImage",
    });
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

  it("counts only complete installer commands as installation intent", () => {
    expect(isInstallCommand(`  ${installCommand("windows", origin)}\n`, origin)).toBe(true);
    expect(isInstallCommand(installCommand("linux", origin)!, origin)).toBe(true);
    for (const command of ["adcode open .", "sudo apt remove adcode", "git config user.email private@example.com", "curl -fsSL https://other.example/install.sh | sh", `${installCommand("linux", origin)}\necho done`]) {
      expect(isInstallCommand(command, origin)).toBe(false);
    }
  });

  it("matches the installer each platform actually has", () => {
    expect(installCommand("windows", origin)).toBe(
      "irm https://adcode.bluethenics.com/install.ps1 | iex",
    );
    expect(installCommand("linux", origin)).toBe(
      "curl -fsSL https://adcode.bluethenics.com/install.sh | sh",
    );
  });

  it("offers no command for a platform that has no installer", () => {
    for (const platform of ["macos", "macos-intel", "mobile", "unknown"] as Platform[]) {
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
