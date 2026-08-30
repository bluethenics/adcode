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
  CREDIT_ORDER_COLS,
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
    for (const cols of [ADVERTISER_COLS, CAMPAIGN_COLS, LEDGER_COLS, BALANCE_COLS, CREDIT_ORDER_COLS, CONFIG_COLS]) {
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
    const user = toUser({ uid: "u1", status: "active", created_at: 5, linked_at: null , email: null, display_name: null, photo_url: null, email_verified: false });
    expect("linkedAt" in user).toBe(false);
  });

  it("omits an identity nobody has ever supplied", () => {
    // The normal case: first launch signs in anonymously with no UI, so an anonymous
    // account has no address, no name and no picture - and "never been told" has to stay
    // distinguishable from "told us nothing".
    const user = toUser({
      uid: "u1",
      status: "active",
      created_at: 5,
      linked_at: null,
      email: null,
      display_name: null,
      photo_url: null,
      email_verified: false,
    });

    expect("email" in user).toBe(false);
    expect("displayName" in user).toBe(false);
    expect("photoUrl" in user).toBe(false);
  });

  it("carries an identity back and forth without inventing or losing one", () => {
    const row = {
      uid: "u1",
      status: "active",
      created_at: 5,
      linked_at: null,
      email: "someone@example.com",
      display_name: "Someone",
      photo_url: "https://example.com/a.png",
      email_verified: true,
    };

    const user = toUser(row);
    expect(user.email).toBe("someone@example.com");
    expect(user.displayName).toBe("Someone");
    expect(user.photoUrl).toBe("https://example.com/a.png");
    expect(fromUser(user)).toEqual(row);
  });

  it("keeps linkedAt when the column has a value", () => {
    const user = toUser({ uid: "u1", status: "active", created_at: 5, linked_at: 9 , email: null, display_name: null, photo_url: null, email_verified: false });
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
      max_bid_cpm_micros: "8000000",
      clearing_cpm_micros: "5010000",
      cost_micros: "5010",
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
      floor_cpm_micros: "3000000",
      auction_increment_cpm_micros: "10000",
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
      floorCpmMicros: 3_000_000n,
      auctionIncrementCpmMicros: 10_000n,
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
    // The round trip gains `emailVerified: false` rather than dropping it: unlike the
    // identity fields, "we were never told" and "not verified" are the same answer to the
    // only question it is asked.
    expect(toUser(fromUser(user))).toEqual({ ...user, emailVerified: false });
  });

  it("preserves a serve", () => {
    const serve = {
      serveId: "s1",
      uid: "u1",
      creativeId: "c1",
      campaignId: "camp1",
      servedAt: 10,
      expiresAt: 20,
      maxBidCpmMicros: 8_000_000n,
      clearingCpmMicros: 5_010_000n,
      costMicros: 5_010n,
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
    expect(toUser({ uid: "u", status: "wat", created_at: 1, linked_at: null , email: null, display_name: null, photo_url: null, email_verified: false }).status).toBe("active");
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
