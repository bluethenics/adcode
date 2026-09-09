import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PortalActions } from "../src/components/PortalActions";
import { ALL_TERMINAL_ASSETS } from "../../../packages/release/src/downloadAssets.ts";
import { buildSupportRequest } from "../src/lib/support";

describe("terminal install assets", () => {
  /*
   * macOS is not published yet.
   *
   * Signing and notarisation need a paid Apple membership, and an un-notarised app is
   * refused by Gatekeeper rather than merely warned about - so there is no honest
   * installer to offer. The release check requires only what the terminal scripts fetch.
   */
  it("names the installers the terminal scripts fetch", () => {
    expect([...ALL_TERMINAL_ASSETS].sort()).toEqual([
      "ADCode-Setup-x64.exe",
      "ADCode-amd64.deb",
      "ADCode-x86_64.AppImage",
    ]);
    for (const asset of ALL_TERMINAL_ASSETS) {
      expect(asset).toMatch(/^ADCode-.+\.(exe|AppImage|deb)$/);
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
