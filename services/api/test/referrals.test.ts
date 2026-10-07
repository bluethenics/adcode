import { describe, expect, it } from "vitest";
import {
  DAY_MS,
  USER_CODE_ALPHABET,
  buildSourcesReport,
  checkAdvertiserClaim,
  checkUserClaim,
  entriesForShares,
  firstName,
  isCampaignCode,
  newUserCode,
  normalizeCode,
  planReferralShares,
  sourceFactsFrom,
  summarizeReferrer,
  type SettlementInput,
} from "../src/referrals.ts";
import {
  DEFAULT_REFERRAL_CONFIG,
  type AttributionRecord,
  type ReceiptRecord,
  type RefCodeRecord,
  type ReferralShareRecord,
  type SourceFact,
  type UserRecord,
} from "../src/store.ts";
import type { LedgerEntry } from "../src/ledger.ts";

const DAY = "2026-10-06";
const START = Date.parse(`${DAY}T00:00:00.000Z`);
const NOON = START + DAY_MS / 2;

const user = (uid: string, createdAt = START - 3 * DAY_MS, extra: Partial<UserRecord> = {}): UserRecord => ({
  uid,
  status: "active",
  createdAt,
  ...extra,
});

const code = (value: string, ownerUid: string | null, extra: Partial<RefCodeRecord> = {}): RefCodeRecord => ({
  code: value,
  ownerUid,
  label: "",
  active: true,
  showName: true,
  createdAt: START - 10 * DAY_MS,
  ...extra,
});

const attribution = (
  subjectKind: "user" | "advertiser",
  subjectId: string,
  referrerUid: string | null,
  claimedAt = START - DAY_MS,
  codeValue = "k7p4qzm",
): AttributionRecord => ({ subjectKind, subjectId, code: codeValue, referrerUid, how: "clipboard", claimedAt });

let receiptSeq = 0;
const receipt = (uid: string, campaignId: string, costMicros: bigint, createdAt = NOON): ReceiptRecord => ({
  receiptId: `r-${++receiptSeq}`,
  uid,
  creativeId: "cr",
  campaignId,
  outcome: "impression",
  creditedMicros: costMicros / 2n,
  costMicros,
  createdAt,
});

/** One invited viewer (`viewer`, brought by `sam`) and one referred advertiser (`adv-x`, brought by `kim`). */
function settlement(overrides: Partial<SettlementInput> = {}): SettlementInput {
  return {
    day: DAY,
    config: DEFAULT_REFERRAL_CONFIG,
    receipts: [],
    campaignAdvertiser: new Map([
      ["camp-x", "adv-x"],
      ["camp-other", "adv-other"],
      ["camp-house", "adv-house"],
    ]),
    attributions: [attribution("user", "viewer", "sam"), attribution("advertiser", "adv-x", "kim")],
    userStatus: new Map([
      ["viewer", "active"],
      ["sam", "active"],
      ["kim", "active"],
      ["stranger", "active"],
    ]),
    badAdvertisers: new Set(),
    ...overrides,
  };
}

describe("normalizeCode", () => {
  it.each([
    ["k7p4qzm", "k7p4qzm"],
    ["  ADCode invite: K7P4QZM \n", "k7p4qzm"],
    ["adcode invite:k7p4qzm", "k7p4qzm"],
    ["https://adcode.bluethenics.com/i/k7p4qzm?from=readme", "k7p4qzm"],
    ["adcode.bluethenics.com/i/threads-oct06/", "threads-oct06"],
    ["/i/threads-oct06", "threads-oct06"],
    ["https://www.adcode.bluethenics.com/i/K7P4QZM#top", "k7p4qzm"],
  ])("reads %j as %j", (raw, expected) => {
    expect(normalizeCode(raw)).toBe(expected);
  });

  it.each([
    "hello k7p4qzm",
    "",
    "   ",
    "ADCode invite:",
    "a".repeat(33),
    "ab",
    "-bad",
    "https://evil.example/i/k7p4qzm",
    "https://adcode.bluethenics.com.evil.example/i/k7p4qzm",
    "https://adcode.bluethenics.com/docs/k7p4qzm",
    "k7p 4qzm",
  ])("refuses %j", (raw) => {
    expect(normalizeCode(raw)).toBeNull();
  });

  it("refuses anything that is not a string", () => {
    expect(normalizeCode(42)).toBeNull();
    expect(normalizeCode(null)).toBeNull();
    expect(normalizeCode({ code: "k7p4qzm" })).toBeNull();
  });
});

describe("codes", () => {
  it("makes a seven-character code from the unambiguous alphabet", () => {
    let n = 0;
    const generated = newUserCode((size) => Uint8Array.from({ length: size }, () => (n += 37) % 256));
    expect(generated).toHaveLength(7);
    for (const char of generated) expect(USER_CODE_ALPHABET).toContain(char);
  });

  it("never lets a byte above the last full alphabet cycle pick a letter", () => {
    // 248 and up would bias the first eight letters; they must be skipped, not wrapped.
    const bytes = [255, 250, 248, 0, 1, 2, 3, 4, 5, 6];
    let i = 0;
    const generated = newUserCode((size) => Uint8Array.from({ length: size }, () => bytes[i++ % bytes.length]!));
    expect(generated).toBe("2345678");
  });

  it("accepts a campaign slug and refuses everything else", () => {
    expect(isCampaignCode("threads-oct06")).toBe(true);
    expect(isCampaignCode("x-ad-3")).toBe(true);
    expect(isCampaignCode("-bad")).toBe(false);
    expect(isCampaignCode("ab")).toBe(false);
    expect(isCampaignCode("UPPER")).toBe(false);
    expect(isCampaignCode("a".repeat(33))).toBe(false);
  });

  it("uses only the first word of a display name", () => {
    expect(firstName("Sinan Faizal")).toBe("Sinan");
    expect(firstName("  Sam ")).toBe("Sam");
    expect(firstName(undefined)).toBeNull();
    expect(firstName("   ")).toBeNull();
    expect(firstName("x".repeat(60))).toBe("x".repeat(24));
  });
});

describe("checkUserClaim", () => {
  const now = START;
  const base = {
    now,
    claimer: user("new", now - 2 * DAY_MS),
    existing: null,
    code: code("k7p4qzm", "sam"),
    owner: user("sam"),
    heldUids: [] as string[],
    claimDays: 14,
  };

  it("lets a new account claim a friend's code", () => {
    expect(checkUserClaim(base)).toBeNull();
  });

  it("lets a new account claim a campaign code, which has no owner", () => {
    expect(checkUserClaim({ ...base, code: code("threads-oct06", null), owner: null })).toBeNull();
  });

  it("allows the last moment of the claim window and refuses the next", () => {
    expect(checkUserClaim({ ...base, claimer: user("new", now - 14 * DAY_MS) })).toBeNull();
    expect(checkUserClaim({ ...base, claimer: user("new", now - 14 * DAY_MS - 1) })).toBe("too-late");
  });

  it("refuses a second claim", () => {
    expect(checkUserClaim({ ...base, existing: attribution("user", "new", "kim") })).toBe("already-claimed");
  });

  it("refuses an unknown or switched-off code", () => {
    expect(checkUserClaim({ ...base, code: null, owner: null })).toBe("unknown-code");
    expect(checkUserClaim({ ...base, code: code("k7p4qzm", "sam", { active: false }) })).toBe("unknown-code");
  });

  it("does not reveal that the owner was banned", () => {
    expect(checkUserClaim({ ...base, owner: user("sam", undefined, { status: "banned" }) })).toBe("unknown-code");
    expect(checkUserClaim({ ...base, owner: null })).toBe("unknown-code");
  });

  it("refuses your own code, and a code owned by an account this machine held before", () => {
    expect(checkUserClaim({ ...base, claimer: user("sam", now - DAY_MS) })).toBe("own-code");
    expect(checkUserClaim({ ...base, heldUids: ["old", "sam"] })).toBe("own-code");
  });
});

describe("checkAdvertiserClaim", () => {
  it("accepts a friend's code and a campaign code", () => {
    expect(checkAdvertiserClaim({ code: code("k7p4qzm", "sam"), owner: user("sam"), ownerUids: ["boss"] })).toBe(true);
    expect(checkAdvertiserClaim({ code: code("threads-oct06", null), owner: null, ownerUids: ["boss"] })).toBe(true);
  });

  it("refuses the advertiser's own owner, a banned owner, and a dead code", () => {
    expect(checkAdvertiserClaim({ code: code("k7p4qzm", "boss"), owner: user("boss"), ownerUids: ["boss"] })).toBe(false);
    expect(checkAdvertiserClaim({ code: code("k7p4qzm", "sam"), owner: user("sam", undefined, { status: "banned" }), ownerUids: ["boss"] })).toBe(false);
    expect(checkAdvertiserClaim({ code: code("k7p4qzm", "sam", { active: false }), owner: user("sam"), ownerUids: ["boss"] })).toBe(false);
    expect(checkAdvertiserClaim({ code: null, owner: null, ownerUids: ["boss"] })).toBe(false);
  });
});

describe("planReferralShares", () => {
  const share = (referrerUid: string, subjectKind: "user" | "advertiser", subjectId: string, baseMicros: bigint, shareMicros: bigint): ReferralShareRecord => ({
    day: DAY, referrerUid, subjectKind, subjectId, baseMicros, shareMicros,
  });

  it("pays the inviter 10% of an $8 CPM view", () => {
    const shares = planReferralShares(settlement({ receipts: [receipt("viewer", "camp-other", 8000n)] }));
    expect(shares).toEqual([share("sam", "user", "viewer", 8000n, 800n)]);
  });

  it("pays whoever brought the advertiser 5% of what it spends", () => {
    const shares = planReferralShares(settlement({ receipts: [receipt("stranger", "camp-x", 8000n)] }));
    expect(shares).toEqual([share("kim", "advertiser", "adv-x", 8000n, 400n)]);
  });

  it("pays both when an invited person sees a referred advertiser's ad", () => {
    const shares = planReferralShares(settlement({ receipts: [receipt("viewer", "camp-x", 8000n)] }));
    expect(shares).toEqual([share("kim", "advertiser", "adv-x", 8000n, 400n), share("sam", "user", "viewer", 8000n, 800n)]);
  });

  it("pays nothing on a test view or a house ad", () => {
    expect(planReferralShares(settlement({ receipts: [receipt("viewer", "camp-other", 0n)] }))).toEqual([]);
    const house = settlement({
      receipts: [receipt("viewer", "camp-house", 8000n)],
      config: { ...DEFAULT_REFERRAL_CONFIG, houseAdvertiserIds: ["adv-house"] },
    });
    expect(planReferralShares(house)).toEqual([]);
  });

  it("pays nothing on a receipt whose campaign it cannot place", () => {
    expect(planReferralShares(settlement({ receipts: [receipt("viewer", "camp-gone", 8000n)] }))).toEqual([]);
  });

  it("counts from the claim and stops exactly when the window ends", () => {
    const claimedAt = NOON;
    const attributions = [attribution("user", "viewer", "sam", claimedAt)];
    expect(planReferralShares(settlement({ attributions, receipts: [receipt("viewer", "camp-other", 8000n, claimedAt - 1)] }))).toEqual([]);
    expect(planReferralShares(settlement({ attributions, receipts: [receipt("viewer", "camp-other", 8000n, claimedAt)] }))).toHaveLength(1);

    const endsToday = attribution("user", "viewer", "sam", NOON - 365 * DAY_MS);
    expect(planReferralShares(settlement({ attributions: [endsToday], receipts: [receipt("viewer", "camp-other", 8000n, NOON - 1)] }))).toHaveLength(1);
    expect(planReferralShares(settlement({ attributions: [endsToday], receipts: [receipt("viewer", "camp-other", 8000n, NOON)] }))).toEqual([]);
  });

  it("pays nothing for a banned viewer or to a banned referrer", () => {
    const receipts = [receipt("viewer", "camp-x", 8000n)];
    const viewerBanned = planReferralShares(settlement({ receipts, userStatus: new Map([["viewer", "banned"], ["sam", "active"], ["kim", "active"]]) }));
    // The advertiser share still stands: the advertiser really spent it.
    expect(viewerBanned.map((s) => s.subjectKind)).toEqual(["advertiser"]);

    const referrersBanned = planReferralShares(settlement({ receipts, userStatus: new Map([["viewer", "active"], ["sam", "banned"], ["kim", "banned"]]) }));
    expect(referrersBanned).toEqual([]);
  });

  it("pays nothing on an advertiser whose payment was disputed", () => {
    const shares = planReferralShares(settlement({ receipts: [receipt("stranger", "camp-x", 8000n)], badAdvertisers: new Set(["adv-x"]) }));
    expect(shares).toEqual([]);
  });

  it("only settles the day it was asked for", () => {
    const receipts = [receipt("viewer", "camp-other", 8000n, START - 1), receipt("viewer", "camp-other", 8000n, START + DAY_MS)];
    expect(planReferralShares(settlement({ receipts }))).toEqual([]);
  });

  it("floors once per invitee per day, not once per view", () => {
    const receipts = [1, 2, 3].map(() => receipt("viewer", "camp-other", 333n));
    expect(planReferralShares(settlement({ receipts }))).toEqual([share("sam", "user", "viewer", 999n, 99n)]);
  });

  it("drops a share that floors to nothing", () => {
    expect(planReferralShares(settlement({ receipts: [receipt("viewer", "camp-other", 9n)] }))).toEqual([]);
  });

  it("pays nobody for a campaign code, which has no owner", () => {
    const shares = planReferralShares(settlement({
      attributions: [attribution("user", "viewer", null, START - DAY_MS, "threads-oct06")],
      receipts: [receipt("viewer", "camp-other", 8000n)],
    }));
    expect(shares).toEqual([]);
  });
});

describe("entriesForShares", () => {
  const s = (referrerUid: string, subjectKind: "user" | "advertiser", subjectId: string, shareMicros: bigint): ReferralShareRecord => ({
    day: DAY, referrerUid, subjectKind, subjectId, baseMicros: shareMicros * 10n, shareMicros,
  });

  it("writes one earning per referrer for the day, named so a rerun cannot pay twice", () => {
    const entries = entriesForShares(DAY, 123, [
      s("sam", "user", "a", 800n),
      s("sam", "user", "b", 100n),
      s("sam", "advertiser", "adv-x", 400n),
      s("kim", "advertiser", "adv-y", 50n),
    ]);
    expect(entries).toEqual<LedgerEntry[]>([
      { entryId: `referral:kim:${DAY}`, uid: "kim", kind: "referral", micros: 50n, refId: DAY, createdAt: 123, description: `Invites on ${DAY}: 1 advertiser` },
      { entryId: `referral:sam:${DAY}`, uid: "sam", kind: "referral", micros: 1300n, refId: DAY, createdAt: 123, description: `Invites on ${DAY}: 2 people, 1 advertiser` },
    ]);
  });

  it("says person, not people, for one", () => {
    const [entry] = entriesForShares(DAY, 1, [s("sam", "user", "a", 5n)]);
    expect(entry?.description).toBe(`Invites on ${DAY}: 1 person`);
  });

  it("writes nothing for no shares", () => {
    expect(entriesForShares(DAY, 1, [])).toEqual([]);
  });
});

describe("summarizeReferrer", () => {
  const now = START + 40 * DAY_MS;
  const earning = (micros: bigint, createdAt: number, kind: LedgerEntry["kind"] = "referral"): LedgerEntry => ({
    entryId: `e-${createdAt}-${kind}`, uid: "sam", kind, micros, refId: null, createdAt, description: "",
  });

  it("counts who joined, who used ADCode, who came back, and what it earned", () => {
    const summary = summarizeReferrer({
      uid: "sam",
      now,
      attributions: [
        attribution("user", "a", "sam"),
        attribution("user", "b", "sam"),
        attribution("user", "c", "sam"),
        attribution("advertiser", "adv-x", "sam"),
        attribution("user", "someone-else", "kim"),
      ],
      sightings: [
        { uid: "a", at: START },
        { uid: "a", at: START + 2 * DAY_MS },
        { uid: "b", at: START },
        { uid: "b", at: START + 1000 },
        { uid: "someone-else", at: START },
      ],
      entries: [earning(800n, now - 40 * DAY_MS), earning(300n, now - DAY_MS), earning(5000n, now - DAY_MS, "impression")],
    });
    expect(summary).toEqual({ claimed: 3, seen: 2, cameBack: 1, advertisers: 1, earnedMicros: 1100n, last30Micros: 300n });
  });
});

describe("sourceFactsFrom and buildSourcesReport", () => {
  const since = START - 30 * DAY_MS;
  const input = {
    since,
    users: [
      user("viewer", START - 5 * DAY_MS),
      user("lurker", START - 4 * DAY_MS),
      user("organic", START - 3 * DAY_MS),
      user("old-organic", since - DAY_MS),
      user("banned", START - 3 * DAY_MS, { status: "banned" }),
    ],
    attributions: [
      attribution("user", "viewer", "sam", START - 5 * DAY_MS, "k7p4qzm"),
      attribution("user", "lurker", null, START - 4 * DAY_MS, "threads-oct06"),
      attribution("advertiser", "adv-x", "kim", START - 2 * DAY_MS, "kimcode"),
      attribution("user", "before-window", "sam", since - 1, "k7p4qzm"),
    ],
    sightings: [
      { uid: "viewer", at: START - 5 * DAY_MS },
      { uid: "viewer", at: START - DAY_MS },
      { uid: "organic", at: START - 3 * DAY_MS },
    ],
    receipts: [
      receipt("viewer", "camp-other", 8000n, START - DAY_MS),
      receipt("viewer", "camp-other", 8000n, START - 6 * DAY_MS), // before the claim
      receipt("viewer", "camp-house", 2000n, START - DAY_MS), // house
      receipt("organic", "camp-x", 8000n, START - DAY_MS),
      receipt("organic", "camp-other", 0n, START - DAY_MS), // test
    ],
    campaignAdvertiser: new Map([
      ["camp-x", "adv-x"],
      ["camp-other", "adv-other"],
      ["camp-house", "adv-house"],
    ]),
    houseAdvertiserIds: ["adv-house"],
    shares: [
      { day: DAY, referrerUid: "sam", subjectKind: "user" as const, subjectId: "viewer", baseMicros: 8000n, shareMicros: 800n },
      { day: DAY, referrerUid: "kim", subjectKind: "advertiser" as const, subjectId: "adv-x", baseMicros: 8000n, shareMicros: 400n },
    ],
  };

  it("makes one fact per attribution in the window and per unattributed new account", () => {
    const facts = sourceFactsFrom(input);
    expect(facts).toEqual<SourceFact[]>([
      { code: "k7p4qzm", subjectKind: "user", subjectId: "viewer", referrerUid: "sam", at: START - 5 * DAY_MS, seen: true, cameBack: true, grossMicros: 8000n, creditedMicros: 4000n, paidMicros: 800n },
      { code: "threads-oct06", subjectKind: "user", subjectId: "lurker", referrerUid: null, at: START - 4 * DAY_MS, seen: false, cameBack: false, grossMicros: 0n, creditedMicros: 0n, paidMicros: 0n },
      { code: null, subjectKind: "user", subjectId: "organic", referrerUid: null, at: START - 3 * DAY_MS, seen: true, cameBack: false, grossMicros: 8000n, creditedMicros: 4000n, paidMicros: 0n },
      { code: "kimcode", subjectKind: "advertiser", subjectId: "adv-x", referrerUid: "kim", at: START - 2 * DAY_MS, seen: false, cameBack: false, grossMicros: 8000n, creditedMicros: 4000n, paidMicros: 400n },
    ]);
  });

  it("folds facts into campaign rows, one row for every user invite, and unknown", () => {
    const report = buildSourcesReport({
      facts: sourceFactsFrom(input),
      codes: [code("threads-oct06", null, { label: "Threads post" }), code("x-ad-3", null, { label: "Quiet" })],
      visits: new Map([["threads-oct06", 12], ["k7p4qzm", 3], ["kimcode", 1]]),
    });

    const byKey = new Map(report.rows.map((row) => [row.key, row]));
    expect(byKey.get("campaign:threads-oct06")).toMatchObject({ label: "Threads post", visits: 12, people: 1, realUsers: 0, cameBack: 0, adRevenueMicros: 0n, keptMicros: 0n });
    expect(byKey.get("campaign:x-ad-3")).toMatchObject({ label: "Quiet", visits: 0, people: 0 });
    expect(byKey.get("users")).toMatchObject({
      visits: 4, people: 1, realUsers: 1, cameBack: 1, adRevenueMicros: 8000n, advertisers: 1, advertiserSpendMicros: 8000n,
      paidMicros: 1200n, keptMicros: 8000n + 8000n - 4000n - 4000n - 1200n,
    });
    expect(byKey.get("unknown")).toMatchObject({ visits: null, people: 1, realUsers: 1, adRevenueMicros: 8000n, paidMicros: 0n, keptMicros: 4000n });
    // Equal money: the one who brought a person ranks above the one who brought only an advertiser.
    expect(report.topReferrers.map((r) => r.referrerUid)).toEqual(["sam", "kim"]);
    expect(report.coverage).toEqual({ attributedRealUsers: 1, realUsers: 2 });
  });

  it("orders top referrers by what their people brought in, most first", () => {
    const report = buildSourcesReport({
      facts: [
        { code: "small", subjectKind: "user", subjectId: "a", referrerUid: "small-uid", at: 1, seen: true, cameBack: false, grossMicros: 10n, creditedMicros: 5n, paidMicros: 1n },
        { code: "big", subjectKind: "user", subjectId: "b", referrerUid: "big-uid", at: 1, seen: true, cameBack: false, grossMicros: 900n, creditedMicros: 450n, paidMicros: 90n },
      ],
      codes: [],
      visits: new Map(),
    });
    expect(report.topReferrers.map((r) => r.code)).toEqual(["big", "small"]);
  });
});
