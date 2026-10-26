import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PaidTokensSettings, SalesTable } from "../src/components/PaidTokensAdmin";
import { DEFAULT_PAID_CONFIG } from "@adcode/api/src/paidTokens.ts";

describe("paid tokens in the admin panel", () => {
  it("shows the switch, the free allowance and every pack, off until switched on", () => {
    const html = renderToStaticMarkup(<PaidTokensSettings value={undefined} onChange={() => undefined} />);
    expect(html).toContain("Sell tokens for paid models");
    expect(html).not.toMatch(/type="checkbox"[^>]*checked/);
    expect(html).toContain('value="10000000"');
    expect(html).toContain('value="50m"');
    expect(html).toContain('value="1000"');
    expect(html).toContain('value="300000000"');
    expect(html).toContain("custom-heabsy");
  });

  it("shows a switched-on configuration as on", () => {
    const html = renderToStaticMarkup(<PaidTokensSettings value={{ ...DEFAULT_PAID_CONFIG, enabled: true }} onChange={() => undefined} />);
    expect(html).toMatch(/type="checkbox"[^>]*checked/);
  });

  it("lists sales by day in dollars and tokens", () => {
    const html = renderToStaticMarkup(<SalesTable days={[{ day: "2026-10-21", orders: 3, revenueCents: 8500, tokensSold: 490_000_000, tokensUsed: 12_500_000 }]} />);
    expect(html).toContain("2026-10-21");
    expect(html).toContain("$85.00");
    expect(html).toContain("490M");
    expect(html).toContain("12.5M");
  });
});
