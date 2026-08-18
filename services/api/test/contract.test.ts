import { describe, it, expect } from "vitest";
import { parseServeRequest, parseReceiptsRequest, isTag, TAG_VOCABULARY, LIMITS } from "../src/contract.ts";

describe("the tag vocabulary is closed", () => {
  it("holds exactly the 45 tags the client knows", () => {
    expect(TAG_VOCABULARY).toHaveLength(45);
    expect(isTag("lang:typescript")).toBe(true);
    expect(isTag("fw:react")).toBe(true);
    expect(isTag("lang:brainfuck")).toBe(false);
    expect(isTag("")).toBe(false);
  });
});

describe("parseServeRequest", () => {
  it("accepts a well-formed body", () => {
    const parsed = parseServeRequest({ tags: ["lang:rust"], themeKind: "dark", count: 2 });
    expect(parsed).toEqual({ tags: ["lang:rust"], themeKind: "dark", count: 2 });
  });

  it("drops tags outside the vocabulary rather than failing the request", () => {
    const parsed = parseServeRequest({ tags: ["lang:rust", "evil"], themeKind: "dark", count: 1 });
    expect(parsed?.tags).toEqual(["lang:rust"]);
  });

  it("rejects a malformed body", () => {
    expect(parseServeRequest({ tags: "no", themeKind: "dark", count: 1 })).toBeNull();
    expect(parseServeRequest({ tags: [], themeKind: "puce", count: 1 })).toBeNull();
    expect(parseServeRequest({ tags: [], themeKind: "dark", count: "1" })).toBeNull();
    expect(parseServeRequest({ tags: [], themeKind: "dark" })).toBeNull();
    expect(parseServeRequest(null)).toBeNull();
  });

  it("clamps count to the response ceiling the client enforces", () => {
    expect(parseServeRequest({ tags: [], themeKind: "dark", count: 9999 })?.count).toBe(LIMITS.maxCreatives);
    expect(parseServeRequest({ tags: [], themeKind: "dark", count: -3 })?.count).toBe(0);
  });
});

describe("parseReceiptsRequest", () => {
  const receipt = {
    receiptId: "r-1",
    creativeId: "c-1",
    shownAt: 1_700_000_000_000,
    dwellMs: 4200,
    themeKind: "dark",
    outcome: "impression",
  };

  it("accepts a well-formed batch", () => {
    expect(parseReceiptsRequest({ receipts: [receipt] })?.receipts).toHaveLength(1);
  });

  it("rejects a batch containing any malformed receipt", () => {
    expect(parseReceiptsRequest({ receipts: [{ ...receipt, outcome: "stolen" }] })).toBeNull();
    expect(parseReceiptsRequest({ receipts: [{ ...receipt, dwellMs: "long" }] })).toBeNull();
    expect(parseReceiptsRequest({ receipts: [{ ...receipt, receiptId: "" }] })).toBeNull();
    expect(parseReceiptsRequest({ receipts: {} })).toBeNull();
  });
});
