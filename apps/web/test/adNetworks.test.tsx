import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AdNetworkTable, NetworkTestPreview, ProviderReadiness, newAdNetwork, payoutMicros } from "../src/components/AdNetworksAdmin";

describe("ad network administration", () => {
  it("converts dollars exactly and rejects precision or payout-limit mistakes", () => {
    expect(payoutMicros("0.000001")).toBe("1");
    expect(payoutMicros("0.0012")).toBe("1200");
    expect(payoutMicros("10")).toBe("10000000");
    for (const value of ["-1", "10.000001", "0.0000001", "1e-3", "", "NaN"]) expect(payoutMicros(value)).toBeNull();
  });
  it("starts every connection disabled and keeps keys out of its configuration", () => {
    for (const provider of ["http-json", "beehiiv", "imprezia"] as const) {
      const config = newAdNetwork(provider);
      expect(config.enabled).toBe(false);
      expect(config).not.toHaveProperty("key");
    }
  });
  it("states the real limitations of named providers", () => {
    expect(renderToStaticMarkup(<ProviderReadiness provider="imprezia" />)).toContain("Delivery stays disabled");
    const beehiiv = renderToStaticMarkup(<ProviderReadiness provider="beehiiv" />);
    expect(beehiiv).toContain("newsletter advertisement content");
    expect(beehiiv).toContain("desktop payouts");
  });
  it("shows write-only key state and disables tests that cannot run", () => {
    const html = renderToStaticMarkup(<AdNetworkTable networks={[{ ...newAdNetwork("imprezia"), id: "imprezia", keyConfigured: true, readiness: "documentation-required" }]} selected={null} busy={null} onEdit={() => undefined} onTest={() => undefined} />);
    expect(html).toContain("API documentation needed");
    expect(html).toContain("Configured");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Test saved connection<\/button>/);
    const beehiiv = renderToStaticMarkup(<AdNetworkTable networks={[{ ...newAdNetwork("beehiiv"), id: "newsletter", keyConfigured: true, readiness: "newsletter-preview-only" }]} selected={null} busy={null} onEdit={() => undefined} onTest={() => undefined} />);
    expect(beehiiv).not.toContain("disabled");
    const missingKey = renderToStaticMarkup(<AdNetworkTable networks={[{ ...newAdNetwork("http-json"), id: "generic", keyConfigured: false, readiness: "key-required" }]} selected={null} busy={null} onEdit={() => undefined} onTest={() => undefined} />);
    expect(missingKey).toMatch(/<button[^>]*disabled=""[^>]*>Test saved connection<\/button>/);
  });
  it("renders provider content as text and makes preview-only status clear", () => {
    const html = renderToStaticMarkup(<NetworkTestPreview result={{ advertisements: [{ id: "ad", name: "Sponsor", headline: "<script>alert(1)</script>", text: "Sample", description: "" }] }} />);
    expect(html).toContain("&lt;script&gt;"); expect(html).not.toContain("<script>");
    expect(html).toContain("haven&#x27;t been delivered to desktop users");
  });
});
