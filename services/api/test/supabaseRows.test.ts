/**
 * The Supabase adapter's translation layer.
 *
 * These are the tests that need no database, and they cover the half of the adapter where
 * bugs actually live. Two properties matter more than the rest and are tested hardest:
 * that money survives the round trip as an exact integer well past the point a JS number
 * would have given up, and that an absent optional field comes back absent rather than
 * present-and-undefined - which `exactOptionalPropertyTypes` makes a type error at the
 * boundary and a wrong `hasOwnProperty` everywhere else.
 */
import { describe, it, expect } from "vitest";
import {
  fromAdvertiser,
  fromConfig,
  fromMicros,
  fromPost,
  fromServe,
  fromUser,
  toAdvertiser,
  toConfig,
  toCreative,
  toEntry,
  toMicros,
  toPost,
  toServe,
  toUser,
  ADVERTISER_COLS,
  BALANCE_COLS,
  CAMPAIGN_COLS,
  CONFIG_COLS,
  FUNDING_COLS,
  LEDGER_COLS,
} from "../adapters/supabaseRows.ts";

describe("money survives Postgres exactly", () => {
  it("round-trips a value far above 2^53, where a JS number would have lost precision", () => {
    const huge = 9_007_199_254_740_993n; // 2^53 + 1
    expect(toMicros(fromMicros(huge))).toBe(huge);
  });

  it("round-trips a negative value, which debits and reversals are", () => {
    const debit = -9_007_199_254_740_993n;
    expect(toMicros(fromMicros(debit))).toBe(debit);
  });

  it("reads a missing column as zero rather than NaN", () => {
    expect(toMicros(null)).toBe(0n);
    expect(toMicros(undefined)).toBe(0n);
  });

  it("throws on a fractional value instead of silently truncating it", () => {
    // This is the shape a missed `::text` cast takes once the value is big enough to
    // land between two representable doubles. Failing loudly here is the whole point.
    expect(() => toMicros(1.5)).toThrow();
  });

  it("selects every money column with an explicit text cast", () => {
    // The guard for the precision bug above: if someone adds a money column to a
    // selection without the cast, this fails rather than the balance quietly drifting.
    for (const cols of [ADVERTISER_COLS, CAMPAIGN_COLS, LEDGER_COLS, BALANCE_COLS, FUNDING_COLS, CONFIG_COLS]) {
      for (const column of cols.split(",")) {
        if (/_micros$|^micros$|rev_share_percent$/.test(column.replace("::text", ""))) {
          expect(column).toMatch(/::text$/);
        }
      }
    }
  });
});

describe("optional fields stay absent", () => {
  it("omits linkedAt entirely when the column is null", () => {
    const user = toUser({ uid: "u1", status: "active", created_at: 5, linked_at: null });
    expect("linkedAt" in user).toBe(false);
  });

  it("keeps linkedAt when the column has a value", () => {
    const user = toUser({ uid: "u1", status: "active", created_at: 5, linked_at: 9 });
    expect(user.linkedAt).toBe(9);
  });

  it("omits the test flag on an ordinary serve, and sets it on a test serve", () => {
    const base = {
      serve_id: "s1",
      uid: "u1",
      creative_id: "c1",
      campaign_id: "camp1",
      served_at: 1,
      expires_at: 2,
    };
    expect("test" in toServe({ ...base, test: false })).toBe(false);
    expect(toServe({ ...base, test: true }).test).toBe(true);
  });

  it("omits every absent ledger annotation", () => {
    const entry = toEntry({
      entry_id: "e1",
      uid: "u1",
      kind: "impression",
      micros: "4000",
      ref_id: null,
      created_at: 1,
      description: "an impression",
      reason: null,
      admin_uid: null,
      provider_ref: null,
      currency: null,
    });
    expect("reason" in entry).toBe(false);
    expect("adminUid" in entry).toBe(false);
    expect("providerRef" in entry).toBe(false);
    expect("currency" in entry).toBe(false);
    expect(entry.refId).toBeNull();
  });

  it("omits an unset cap rather than reporting it as undefined", () => {
    const config = toConfig({
      kill_switch: false,
      min_interval_ms: null,
      daily_cap: 12,
      default_cpm_micros: "8000000",
      rev_share_percent: "50",
      spend_shard_count: 4,
      serve_ttl_ms: 600_000,
      rate_window_ms: 60_000,
      requests_per_window: 120,
    });
    expect("minIntervalMs" in config.caps).toBe(false);
    expect(config.caps.dailyCap).toBe(12);
  });
});

describe("records round-trip through their rows", () => {
  it("preserves an advertiser, funded and reserved amounts included", () => {
    const advertiser = {
      advertiserId: "a1",
      name: "Acme",
      ownerUids: ["u1", "u2"],
      status: "active" as const,
      fundedMicros: 12_345_678_901_234_567n,
      reservedMicros: 999n,
      createdAt: 1700,
    };
    expect(toAdvertiser(fromAdvertiser(advertiser))).toEqual(advertiser);
  });

  it("maps the post's `order` onto `order_index`, because `order` is reserved in SQL", () => {
    const post = {
      slug: "hello",
      title: "Hello",
      description: "d",
      body: "b",
      status: "published" as const,
      surface: "docs" as const,
      section: "guides",
      order: 3,
      related: ["other"],
      authorUid: "u1",
      publishedAt: 100,
      updatedAt: 200,
    };
    const row = fromPost(post);
    expect(row.order_index).toBe(3);
    expect(toPost(row)).toEqual(post);
  });

  it("preserves a config, including the caps that are set", () => {
    const config = {
      killSwitch: true,
      caps: { minIntervalMs: 1000, dailyCap: 5 },
      defaultCpmMicros: 8_000_000n,
      revSharePercent: 50n,
      spendShardCount: 4,
      serveTtlMs: 600_000,
      rateWindowMs: 60_000,
      requestsPerWindow: 120,
    };
    expect(toConfig(fromConfig(config))).toEqual(config);
  });

  it("preserves a user with no linked time", () => {
    const user = { uid: "u1", status: "active" as const, createdAt: 42 };
    expect(toUser(fromUser(user))).toEqual(user);
  });

  it("preserves a serve", () => {
    const serve = {
      serveId: "s1",
      uid: "u1",
      creativeId: "c1",
      campaignId: "camp1",
      servedAt: 10,
      expiresAt: 20,
    };
    expect(toServe(fromServe(serve))).toEqual(serve);
  });
});

describe("a value outside the known set does not become one", () => {
  /*
   * The columns have check constraints, so these cases should be unreachable. They are
   * tested anyway because the alternative to a defined fallback is a record whose status
   * is a string the rest of the code has never heard of, and the failure then surfaces
   * somewhere far away from the row that caused it.
   */
  it("treats an unknown user status as banned-by-default's opposite: active", () => {
    expect(toUser({ uid: "u", status: "wat", created_at: 1, linked_at: null }).status).toBe("active");
  });

  it("treats an unknown creative status as pending, never as approved", () => {
    const creative = toCreative({
      creative_id: "c",
      campaign_id: "camp",
      advertiser: "Acme",
      headline: "h",
      body: null,
      click_url: "https://example.com",
      logo_light: "l",
      logo_dark: "d",
      status: "wat",
    });
    // The direction matters: an unrecognised status must never be the one that serves.
    expect(creative.status).toBe("pending");
  });
});
