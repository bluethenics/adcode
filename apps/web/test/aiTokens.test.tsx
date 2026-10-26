import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BalanceSummary, formatTokens, PackList, refillText } from "../src/app/ai-tokens/AiTokens";

describe("the AI tokens page", () => {
  it("says token amounts the way people read them", () => {
    expect(formatTokens(50_000_000)).toBe("50M");
    expect(formatTokens(1_250_000)).toBe("1.25M");
    expect(formatTokens(980_000)).toBe("980K");
    expect(formatTokens(0)).toBe("0");
  });

  it("says when the free tokens refill", () => {
    const now = Date.parse("2026-10-21T00:00:00Z");
    expect(refillText(now + 4 * 86_400_000, now)).toBe("in 4 days");
    expect(refillText(now + 5 * 3_600_000, now)).toBe("in 5 hours");
    expect(refillText(now + 20 * 60_000, now)).toBe("in 20 minutes");
    expect(refillText(now - 1, now)).toBe("now");
  });

  it("lists every pack with its price and tokens, and the per-million price", () => {
    const html = renderToStaticMarkup(<PackList packs={[{ id: "50m", priceCents: 1000, tokens: 50_000_000 }, { id: "300m", priceCents: 5000, tokens: 300_000_000 }]} busy={null} onBuy={() => undefined} />);
    expect(html).toContain("$10");
    expect(html).toContain("50M tokens");
    expect(html).toContain("$50");
    expect(html).toContain("300M tokens");
    expect(html).toContain("$0.20 per million");
    expect(html).toContain("$0.17 per million");
  });

  it("shows the free week and purchased balance, and says when the free tokens refill", () => {
    const html = renderToStaticMarkup(<BalanceSummary tokens={{ enabled: true, free: { limit: 10_000_000, used: 4_000_000, held: 0, remaining: 6_000_000, resetsAt: Date.parse("2026-10-25T00:00:00Z") }, purchased: 48_000_000 }} now={Date.parse("2026-10-21T00:00:00Z")} />);
    expect(html).toContain("6M of 10M free");
    expect(html).toContain("48M purchased");
    expect(html).toContain("refill in 4 days");
  });
});

describe("coming back from checkout", () => {
  it("never says a payment arrived before the order is paid", async () => {
    const { arrivalMessage } = await import("../src/app/ai-tokens/AiTokens");
    expect(arrivalMessage("checking")).toBe("Checking your payment…");
    expect(arrivalMessage("checking")).not.toMatch(/received/i);
    expect(arrivalMessage("added")).toContain("Your tokens are added");
    expect(arrivalMessage("not-yet")).toContain("We haven't received this payment yet");
    expect(arrivalMessage("not-yet")).toContain("nothing was charged");
  });
});

describe("the AI tokens page for search engines and link previews", () => {
  it("has a complete share card and a heading in the server-rendered page", async () => {
    const { metadata, AiTokensHeading } = await import("../src/app/ai-tokens/page");
    expect(metadata.openGraph).toBeDefined();
    expect(metadata.twitter).toBeDefined();
    expect(renderToStaticMarkup(<AiTokensHeading />)).toMatch(/<h1[^>]*>AI tokens<\/h1>/);
  });
});
