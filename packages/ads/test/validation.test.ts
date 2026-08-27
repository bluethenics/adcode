import { describe, it, expect } from "vitest";
import {
  parseServeResponse,
  parseConfigResponse,
  parseBalanceResponse,
} from "../src/validation.ts";

const HOST = "cdn.adcode.test";

function creative(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    creativeId: "cr-123",
    advertiser: "Sentry",
    headline: "catch errors before users",
    body: "Error monitoring for developers",
    clickUrl: "https://sentry.io/",
    logoLight: `https://${HOST}/sentry-light.png`,
    logoDark: `https://${HOST}/sentry-dark.png`,
    ttlMs: 600_000,
    ...overrides,
  };
}

const serve = (...cs: Record<string, unknown>[]) => JSON.stringify({ creatives: cs });

describe("parseServeResponse - the happy path", () => {
  it("accepts a well-formed creative", () => {
    const result = parseServeResponse(serve(creative()), HOST);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0]!.creativeId).toBe("cr-123");
      expect(result.value[0]!.body).toBe("Error monitoring for developers");
    }
  });

  it("accepts a creative with no body", () => {
    const result = parseServeResponse(serve(creative({ body: null })), HOST);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value[0]!.body).toBeNull();
  });

  it("accepts an empty inventory", () => {
    const result = parseServeResponse(serve(), HOST);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual([]);
  });
});

describe("parseServeResponse - prototype pollution", () => {
  // Brief §9: "__proto__ rejected". This has to happen at JSON.parse time via a
  // reviver: a schema library only ever sees an object that has already been built, by
  // which point the pollution has happened.
  it("rejects __proto__ and leaves Object.prototype untouched", () => {
    const raw = '{"creatives":[{"__proto__":{"polluted":true},"creativeId":"a"}]}';
    expect(parseServeResponse(raw, HOST).ok).toBe(false);
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  it("rejects __proto__ riding alongside an otherwise valid payload", () => {
    // Built as a string on purpose: `{ __proto__: x }` in a JS object literal sets the
    // prototype rather than creating an own property, so JSON.stringify would never
    // emit the key and the test would prove nothing.
    const raw = `{"creatives":[${JSON.stringify(creative())}],"__proto__":{"polluted":true}}`;
    expect(raw).toContain('"__proto__"');
    expect(parseServeResponse(raw, HOST).ok).toBe(false);
  });

  it("rejects __proto__ nested inside a creative", () => {
    const raw = `{"creatives":[{"creativeId":"a","__proto__":{"polluted":true}}]}`;
    expect(parseServeResponse(raw, HOST).ok).toBe(false);
  });

  it("rejects constructor and prototype keys", () => {
    expect(parseServeResponse('{"creatives":[],"constructor":{}}', HOST).ok).toBe(false);
    expect(parseServeResponse('{"creatives":[],"prototype":{}}', HOST).ok).toBe(false);
  });
});

describe("parseServeResponse - URL rules", () => {
  it("rejects a host that merely suffixes the allowed host", () => {
    // The case §11 calls out by name. `evil-cdn.adcode.test` ends with the allowed
    // host as a substring; exact hostname equality is the only check that catches it.
    const result = parseServeResponse(
      serve(creative({ logoLight: `https://evil-${HOST}/x.png` })),
      HOST,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a subdomain of the allowed host", () => {
    expect(parseServeResponse(serve(creative({ logoDark: `https://a.${HOST}/x.png` })), HOST).ok).toBe(false);
  });

  it("rejects the allowed host as a prefix of another", () => {
    expect(parseServeResponse(serve(creative({ logoLight: `https://${HOST}.evil.test/x.png` })), HOST).ok).toBe(false);
  });

  it("rejects javascript: URLs", () => {
    expect(parseServeResponse(serve(creative({ clickUrl: "javascript:alert(1)" })), HOST).ok).toBe(false);
  });

  it("rejects data: URLs", () => {
    expect(parseServeResponse(serve(creative({ logoLight: "data:image/png;base64,AAAA" })), HOST).ok).toBe(false);
  });

  it("rejects plain http", () => {
    expect(parseServeResponse(serve(creative({ clickUrl: "http://sentry.io/" })), HOST).ok).toBe(false);
    expect(parseServeResponse(serve(creative({ logoLight: `http://${HOST}/x.png` })), HOST).ok).toBe(false);
  });

  it("rejects a malformed URL", () => {
    expect(parseServeResponse(serve(creative({ clickUrl: "not a url" })), HOST).ok).toBe(false);
  });

  it("rejects credentials embedded in a URL", () => {
    expect(parseServeResponse(serve(creative({ clickUrl: "https://user:pass@sentry.io/" })), HOST).ok).toBe(false);
  });
});

describe("parseServeResponse - shape", () => {
  it("rejects unknown fields rather than ignoring them", () => {
    expect(parseServeResponse(serve(creative({ trackingPixel: "https://evil.test/p" })), HOST).ok).toBe(false);
  });

  it("rejects a creative missing logoDark", () => {
    const { logoDark: _omitted, ...withoutDark } = creative();
    expect(parseServeResponse(serve(withoutDark), HOST).ok).toBe(false);
  });

  it("rejects a creative missing logoLight", () => {
    const { logoLight: _omitted, ...withoutLight } = creative();
    expect(parseServeResponse(serve(withoutLight), HOST).ok).toBe(false);
  });

  it("rejects wrong types", () => {
    expect(parseServeResponse(serve(creative({ ttlMs: "600000" })), HOST).ok).toBe(false);
    expect(parseServeResponse(serve(creative({ headline: 42 })), HOST).ok).toBe(false);
    expect(parseServeResponse('{"creatives":"not-an-array"}', HOST).ok).toBe(false);
  });

  it("rejects malformed JSON", () => {
    expect(parseServeResponse("{not json", HOST).ok).toBe(false);
    expect(parseServeResponse("", HOST).ok).toBe(false);
  });

  it("rejects a creativeId outside the permitted charset", () => {
    expect(parseServeResponse(serve(creative({ creativeId: "cr 123" })), HOST).ok).toBe(false);
    expect(parseServeResponse(serve(creative({ creativeId: "../../etc/passwd" })), HOST).ok).toBe(false);
    expect(parseServeResponse(serve(creative({ creativeId: "" })), HOST).ok).toBe(false);
  });
});

describe("parseServeResponse - text safety", () => {
  it("rejects oversized text", () => {
    expect(parseServeResponse(serve(creative({ headline: "x".repeat(81) })), HOST).ok).toBe(false);
    expect(parseServeResponse(serve(creative({ body: "x".repeat(161) })), HOST).ok).toBe(false);
    expect(parseServeResponse(serve(creative({ advertiser: "x".repeat(41) })), HOST).ok).toBe(false);
  });

  it("strips markup from text fields", () => {
    const result = parseServeResponse(
      serve(creative({ headline: "catch <script>alert(1)</script> errors" })),
      HOST,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value[0]!.headline).not.toMatch(/<|>/);
      expect(result.value[0]!.headline).not.toMatch(/script/i);
    }
  });

  it("strips control characters, including terminal escapes", () => {
    const hostile = "catch \u001b[31merrors\u0000 \u0007now";
    const result = parseServeResponse(serve(creative({ headline: hostile })), HOST);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value[0]!.headline).not.toMatch(/[\u0000-\u001f\u007f]/);
  });
});

describe("parseBalanceResponse - money", () => {
  it("parses decimal strings into bigint", () => {
    const result = parseBalanceResponse('{"availableMicros":"1250000","lifetimeMicros":"98765432"}');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.availableMicros).toBe(1_250_000n);
      expect(result.value.lifetimeMicros).toBe(98_765_432n);
    }
  });

  it("rejects a JSON number, which would already have lost precision", () => {
    // By the time JSON.parse produces 9007199254740993 it is 9007199254740992.
    expect(parseBalanceResponse('{"availableMicros":1250000,"lifetimeMicros":"1"}').ok).toBe(false);
    expect(parseBalanceResponse('{"availableMicros":1.5,"lifetimeMicros":"1"}').ok).toBe(false);
  });

  it("rejects a non-numeric string", () => {
    expect(parseBalanceResponse('{"availableMicros":"1e6","lifetimeMicros":"1"}').ok).toBe(false);
    expect(parseBalanceResponse('{"availableMicros":"0x10","lifetimeMicros":"1"}').ok).toBe(false);
    expect(parseBalanceResponse('{"availableMicros":" 1 ","lifetimeMicros":"1"}').ok).toBe(false);
  });

  it("rejects a value beyond int64", () => {
    expect(parseBalanceResponse(`{"availableMicros":"${"9".repeat(20)}","lifetimeMicros":"1"}`).ok).toBe(false);
  });

  it("preserves precision above 2^53", () => {
    const result = parseBalanceResponse('{"availableMicros":"9007199254740993","lifetimeMicros":"1"}');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.availableMicros).toBe(9_007_199_254_740_993n);
  });
});

describe("parseConfigResponse", () => {
  const config = (overrides: Record<string, unknown> = {}) =>
    JSON.stringify({
      killSwitch: false,
      caps: { minIntervalMs: 3_600_000, dailyCap: 4 },
      projections: { off: "0", light: "40000", standard: "90000", max: "210000" },
      ...overrides,
    });

  it("accepts a well-formed config", () => {
    const result = parseConfigResponse(config());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.killSwitch).toBe(false);
      expect(result.value.projections.standard).toBe(90_000n);
    }
  });

  it("accepts a config with no caps - that is the server declining to tighten", () => {
    expect(parseConfigResponse(config({ caps: {} })).ok).toBe(true);
  });

  it("rejects a projections table missing a preset", () => {
    expect(parseConfigResponse(config({ projections: { off: "0", light: "1", standard: "2" } })).ok).toBe(false);
  });

  it("rejects unknown fields", () => {
    expect(parseConfigResponse(config({ forceShowNow: true })).ok).toBe(false);
  });

  it("rejects a non-boolean kill switch", () => {
    expect(parseConfigResponse(config({ killSwitch: "false" })).ok).toBe(false);
  });
});

/*
 * The test flag on a served card.
 *
 * It lets a card skip the pacing rules, so it is exactly the field a malformed or
 * hostile response would most like to set. `onlyKnownKeys` also means adding it to the
 * wire without admitting it here would have made the client reject every test serve
 * outright - the whole response, over one unrecognised key.
 */
describe("parseServeResponse - the admin test flag", () => {
  it("accepts a card that carries it", () => {
    const parsed = parseServeResponse(serve(creative({ test: true })), HOST);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value[0]?.test).toBe(true);
  });

  it("leaves it absent on an ordinary card", () => {
    const parsed = parseServeResponse(serve(creative()), HOST);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect("test" in (parsed.value[0] ?? {})).toBe(false);
  });

  it("treats anything that is not literally true as not a test", () => {
    // Coercing here would let a malformed response bypass the daily cap, which is the
    // shape of thing §1 refuses to let a server do.
    for (const hostile of ["true", 1, {}, [], "yes"]) {
      const parsed = parseServeResponse(serve(creative({ test: hostile })), HOST);
      expect(parsed.ok, JSON.stringify(hostile)).toBe(true);
      if (parsed.ok) expect(parsed.value[0]?.test, JSON.stringify(hostile)).toBeUndefined();
    }
  });
});
