import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PortalActions } from "../src/components/PortalActions";
import { DOWNLOADS, downloadHref } from "../src/lib/downloads";
import { buildSupportRequest } from "../src/lib/support";

describe("public download destinations", () => {
  it("offers each supported desktop build through an ADCode download route", () => {
    expect(DOWNLOADS.map(downloadHref)).toEqual([
      "/dl/windows",
      "/dl/linux",
      "/dl/linux-deb",
      "/dl/macos",
      "/dl/macos-intel",
    ]);
    expect(DOWNLOADS.every((download) => downloadHref(download).startsWith("/dl/"))).toBe(true);
  });

  /*
   * macOS is listed and cannot ship.
   *
   * Signing and notarisation need a paid Apple membership, and an un-notarised app is
   * refused by Gatekeeper rather than merely warned about - so a download button for it
   * would hand somebody a file their machine will not open. The platform stays on the
   * page, labelled, because "does this run on my Mac?" deserves an answer either way.
   */
  it("ships what it can and says so about what it cannot", () => {
    const shipping = DOWNLOADS.filter((download) => download.available).map((d) => d.id);
    const soon = DOWNLOADS.filter((download) => !download.available).map((d) => d.id);

    expect(shipping).toEqual(["windows", "linux", "linux-deb"]);
    expect(soon).toEqual(["macos", "macos-intel"]);
  });

  it("names an installer for every platform, shipping or not", () => {
    // The name has to exist before the platform can be switched on, and it is what
    // scripts/check-release-assets.mjs compares the build output against.
    for (const download of DOWNLOADS) {
      expect(download.asset, download.id).toMatch(/^ADCode-.+\.(exe|dmg|AppImage|deb)$/);
    }
  });
});

describe("support requests", () => {
  it("maps a signed-in support form to the existing reports contract", () => {
    expect(buildSupportRequest({
      kind: "help",
      subject: "Payout details",
      message: "Where can I update my bank information?",
      reference: "withdrawal_123",
      platform: "Win32",
    })).toEqual({
      kind: "help",
      title: "Payout details",
      body: "Reference: withdrawal_123\n\nWhere can I update my bank information?",
      appVersion: "website",
      platform: "Win32",
    });
  });

  it("trims fields and refuses incomplete or oversized submissions", () => {
    expect(buildSupportRequest({ kind: "other", subject: "  Hello  ", message: "  Hi  ", reference: "", platform: "" }))
      .toMatchObject({ title: "Hello", body: "Hi", platform: "web" });
    expect(() => buildSupportRequest({ kind: "bug", subject: "", message: "Missing title", reference: "", platform: "web" }))
      .toThrow("subject");
    expect(() => buildSupportRequest({ kind: "bug", subject: "Title", message: "x".repeat(4_001), reference: "", platform: "web" }))
      .toThrow("message");
  });
});

describe("global portal actions", () => {
  it("presents the advertiser and user destinations as one two-sided action rail", () => {
    const markup = renderToStaticMarkup(<PortalActions />);

    expect(markup).toContain("glass-portal-rail");
    expect(markup).toContain('href="/portal"');
    expect(markup).toContain("Advertiser portal");
    expect(markup).toContain('href="/dashboard"');
    expect(markup).toContain("User portal");
    expect((markup.match(/class="glass-portal-button(?: glass-portal-button-primary)?"/g) ?? [])).toHaveLength(2);
  });
});
