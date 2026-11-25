import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { columnOf, countryCode, dollarsToMicros, formatUsd, fromDrafts, importCountryPay, marginOf, payFromShare, tierOf, toDraft } from "../src/lib/countryCardPay";

/*
 * The admin side of pay by country (2026-11-25): reading the owner's sheet, the shares per tier,
 * and the rule that no row may pay more than a card there earns.
 */
const sheet = readFileSync(new URL("./fixtures/zeekend-country-report-2026-11-24.tsv", import.meta.url), "utf8");

describe("reading a sheet's cells", () => {
  it("knows countries by code, English name and the names reports use", () => {
    expect(countryCode("US")).toBe("US");
    expect(countryCode("gb")).toBe("GB");
    expect(countryCode("United Kingdom")).toBe("GB");
    expect(countryCode("UAE")).toBe("AE");
    expect(countryCode("Turkey")).toBe("TR");
    expect(countryCode("Russia")).toBe("RU");
    expect(countryCode("16 other countries")).toBeNull();
    expect(countryCode("XX")).toBeNull();
  });
  it("reads dollar amounts as a sheet writes them", () => {
    expect(dollarsToMicros("$3.51")).toBe(3_510_000);
    expect(dollarsToMicros("1,250.50")).toBe(1_250_500_000);
    expect(dollarsToMicros("0.002 USD")).toBe(2_000);
    expect(dollarsToMicros("mostly $3.50")).toBeNull();
  });
  it("names its columns from the header", () => {
    expect(["Country", "Requests", "Impressions", "CPM", "Tier", "Pay per card", "Cards a day"].map(columnOf)).toEqual(["country", null, null, "cpm", "tier", "pay", "cap"]);
    expect(columnOf("Revenue per card")).toBe("earn");
  });
  it("reads the owner's colour marks from a Tier column", () => {
    expect(["green", "Red", "", undefined, "white"].map(tierOf)).toEqual(["green", "red", "plain", "plain", "plain"]);
  });
});

describe("importing the owner's sheet (24 Nov)", () => {
  const imported = importCountryPay(sheet);
  const pay = (code: string) => imported.rows.find((row) => row.country === code)?.payPerCardMicros;
  it("pays green 45%, red 30%, and keeps the default for the rest", () => {
    expect(pay("GB")).toBe("4500");
    expect(pay("US")).toBe("4300");
    expect(pay("IN")).toBe("1000");
    expect(pay("LT")).toBe("900");
    expect(pay("DE")).toBe("2000");
    expect(pay("AE")).toBe("2000");
  });
  it("records what a card earns, from the CPM", () => {
    expect(imported.rows.find((row) => row.country === "GB")?.earnPerCardMicros).toBe("10130");
  });
  it("pays nothing where a card earns nothing, and skips the total line", () => {
    expect(pay("RU")).toBe("0");
    expect(imported.rows).toHaveLength(28);
    expect(imported.problems.some((line) => line.includes("16 other countries"))).toBe(true);
  });
  it("never imports a row that pays more than it earns", () => {
    for (const row of imported.rows) expect(Number(row.payPerCardMicros)).toBeLessThanOrEqual(Number(row.earnPerCardMicros));
  });
  it("keeps ADCode more than the flat $0.002 did, on the sheet's own cards", () => {
    const cards = new Map(sheet.trim().split("\n").slice(1).map((line) => line.split("\t")).filter((cells) => countryCode(cells[0]!) !== null).map((cells) => [countryCode(cells[0]!)!, Number(cells[2]!.replace(/,/g, ""))]));
    let flat = 0, proposed = 0;
    for (const row of imported.rows) {
      const n = cards.get(row.country)!;
      flat += (Number(row.earnPerCardMicros) - 2000) * n;
      proposed += (Number(row.earnPerCardMicros) - Number(row.payPerCardMicros)) * n;
    }
    expect(proposed).toBeGreaterThan(flat);
  });
  it("replaces a pasted loss with the tier's pay, and says so", () => {
    const result = importCountryPay("Country\tCPM\tPay\tTier\nIndia\t3.50\t0.005\tred");
    expect(result.rows[0]?.payPerCardMicros).toBe("1000");
    expect(result.problems[0]).toMatch(/loss/);
  });
  it("lowers a kept default to what a card earns", () => {
    expect(importCountryPay("Country,CPM\nKenya,1.20").rows[0]?.payPerCardMicros).toBe("1200");
  });
  it("needs a country column and an earnings or pay column", () => {
    expect(importCountryPay("Name,Requests\nIndia,4").rows).toEqual([]);
    expect(importCountryPay("Country,Requests\nIndia,4").problems[0]).toMatch(/CPM/);
  });
});

describe("the admin's table", () => {
  it("round-trips a row through the editor", () => {
    const row = { country: "GB", payPerCardMicros: "4500", earnPerCardMicros: "10130", paidCardsPerDay: 200 };
    expect(fromDrafts([toDraft(row)])).toEqual([row]);
  });
  it("refuses a loss, a repeated country, a bad cap or pay", () => {
    expect(fromDrafts([{ country: "IN", pay: "0.004", earn: "0.0035", cap: "" }])).toMatch(/never pays more/);
    expect(fromDrafts([{ country: "IN", pay: "0.001", earn: "", cap: "" }, { country: "IN", pay: "0.001", earn: "", cap: "" }])).toMatch(/twice/);
    expect(fromDrafts([{ country: "IN", pay: "0.001", earn: "", cap: "1001" }])).toMatch(/cap/);
    expect(fromDrafts([{ country: "IN", pay: "0.2", earn: "", cap: "" }])).toMatch(/\$0\.10/);
  });
  it("shows the margin, flagging a loss and a thin one", () => {
    expect(marginOf(4500, 10130)).toMatchObject({ state: "ok", marginMicros: 5630 });
    expect(marginOf(3000, 3500).state).toBe("thin");
    expect(marginOf(4000, 3500).state).toBe("loss");
    expect(marginOf(2000, null).state).toBe("unknown");
  });
  it("formats and rounds amounts", () => {
    expect(formatUsd(4500)).toBe("$0.0045");
    expect(formatUsd(100_000)).toBe("$0.10");
    expect(payFromShare(3510, 0.3)).toBe(1000);
  });
});
