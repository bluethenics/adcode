/**
 * The referral programme's rules, with nothing to do but compute.
 *
 * Every decision about an invite lives here: what counts as a code, who may claim one,
 * what a day of invites pays, and how the Sources report adds people up. The in-memory
 * and Firestore stores call these directly; Postgres implements settlement and the report
 * facts in SQL (`supabase/migrations/20261006180000_referrals.sql`), and that SQL is held
 * to the same cases as `test/referrals.test.ts`. Two definitions of money that drift apart
 * are a bug that pays somebody the wrong amount every night, silently.
 *
 * The terms, as people are told them: whoever invites a person gets 10% of the cost of
 * every paid view that person sees, and whoever brings an advertiser gets 5% of what it
 * spends, for 365 days from the claim. Both come out of ADCode's half. The invited
 * person's own share is never touched - nothing here reads or writes it.
 */
import type { LedgerEntry } from "./ledger.ts";
import type {
  AttributionKind,
  AttributionRecord,
  ReceiptRecord,
  RefCodeRecord,
  ReferralConfig,
  ReferralShareRecord,
  SourceFact,
  UserRecord,
  UserStatus,
} from "./store.ts";

export const DAY_MS = 86_400_000;

/** No 0/o, 1/l/i: a code read aloud or off a screenshot should not be guessable two ways. */
export const USER_CODE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
const USER_CODE_LENGTH = 7;
/** The largest multiple of the alphabet's length a byte can hold. Above it, modulo is biased. */
const UNBIASED_BYTE_LIMIT = 256 - (256 % USER_CODE_ALPHABET.length);

/** Credit orders that mean ADCode may never have had the money a commission would be a cut of. */
export const BAD_ORDER_STATUSES: readonly string[] = ["disputed", "reversed", "partially_reversed", "review_required"];

/** The one shape every code has, user or campaign: lowercase, 3-32, no leading hyphen. */
const CODE = /^[a-z0-9][a-z0-9-]{2,31}$/;
const INVITE_LINE = /^adcode invite:\s*([a-z0-9-]+)$/i;
const INVITE_LINK = /^(?:https?:\/\/)?(?:www\.)?adcode\.bluethenics\.com\/i\/([a-z0-9-]+)\/?(?:[?#].*)?$/i;
const INVITE_PATH = /^\/i\/([a-z0-9-]+)\/?(?:[?#].*)?$/i;
const BARE = /^[a-z0-9-]+$/i;

export function newUserCode(random: (size: number) => Uint8Array): string {
  let code = "";
  while (code.length < USER_CODE_LENGTH) {
    for (const byte of random(16)) {
      if (byte >= UNBIASED_BYTE_LIMIT) continue;
      code += USER_CODE_ALPHABET[byte % USER_CODE_ALPHABET.length];
      if (code.length === USER_CODE_LENGTH) break;
    }
  }
  return code;
}

/**
 * A code out of whatever someone pasted: the bare code, the clipboard line the invite page
 * writes, or the invite link. Anything else is not an invite, and null.
 *
 * A link counts only on ADCode's own host - an `/i/` path on somebody else's site is
 * not a code we issued, however it is spelled.
 */
export function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (text.length === 0 || text.length > 300) return null;
  const found = INVITE_LINE.exec(text)?.[1] ?? INVITE_LINK.exec(text)?.[1] ?? INVITE_PATH.exec(text)?.[1] ?? (BARE.test(text) ? text : null);
  if (found === null) return null;
  const code = found.toLowerCase();
  return CODE.test(code) ? code : null;
}

/** What an admin may name a campaign code. Exactly the code shape, already lowercase. */
export function isCampaignCode(code: string): boolean {
  return CODE.test(code);
}

/** "Sinan" out of "Sinan Faizal": the most an invite page ever says about a person. */
export function firstName(displayName: string | undefined): string | null {
  const first = displayName?.trim().split(/\s+/)[0];
  return first === undefined || first === "" ? null : first.slice(0, 24);
}

export type ClaimError = "unknown-code" | "already-claimed" | "too-late" | "own-code";

/**
 * May this account claim this code? Null for yes, the reason otherwise.
 *
 * A banned owner reads as an unknown code: the claimer has no business learning that an
 * account was banned, and nothing they could do with the difference.
 *
 * `heldUids` are the accounts this machine has used before. Resetting the editor makes a
 * new anonymous account, and inviting yourself from it would pay you 10% of your own views.
 */
export function checkUserClaim(input: {
  now: number;
  claimer: UserRecord;
  existing: AttributionRecord | null;
  code: RefCodeRecord | null;
  owner: UserRecord | null;
  heldUids: readonly string[];
  claimDays: number;
}): ClaimError | null {
  if (input.existing !== null) return "already-claimed";
  if (input.now > input.claimer.createdAt + input.claimDays * DAY_MS) return "too-late";
  const { code } = input;
  if (code === null || !code.active) return "unknown-code";
  if (code.ownerUid === null) return null;
  if (input.owner === null || input.owner.status !== "active") return "unknown-code";
  if (code.ownerUid === input.claimer.uid || input.heldUids.includes(code.ownerUid)) return "own-code";
  return null;
}

/**
 * May a new advertiser be attributed to this code? Never an error: an advertiser signing
 * up must not fail because the link they followed was stale, so a bad code is just no
 * attribution.
 */
export function checkAdvertiserClaim(input: {
  code: RefCodeRecord | null;
  owner: UserRecord | null;
  ownerUids: readonly string[];
}): boolean {
  const { code } = input;
  if (code === null || !code.active) return false;
  if (code.ownerUid === null) return true;
  if (input.owner === null || input.owner.status !== "active") return false;
  return !input.ownerUids.includes(code.ownerUid);
}

export interface SettlementInput {
  /** The UTC day being paid, `YYYY-MM-DD`. */
  day: string;
  config: ReferralConfig;
  receipts: Iterable<ReceiptRecord>;
  /** campaign id → advertiser id. A receipt whose campaign is unknown pays nothing. */
  campaignAdvertiser: ReadonlyMap<string, string>;
  attributions: Iterable<AttributionRecord>;
  userStatus: ReadonlyMap<string, UserStatus>;
  /** Advertisers with a credit order in `BAD_ORDER_STATUSES`. */
  badAdvertisers: ReadonlySet<string>;
}

/**
 * What one day of invites pays, per referrer and per person or advertiser they brought.
 *
 * Costs are summed for the day first and floored once per row: at most a micro lost per
 * invitee per day, and every row still explains itself.
 */
export function planReferralShares(input: SettlementInput): ReferralShareRecord[] {
  const start = Date.parse(`${input.day}T00:00:00.000Z`);
  const end = start + DAY_MS;
  const windowMs = input.config.windowDays * DAY_MS;
  const house = new Set(input.config.houseAdvertiserIds);

  const people = new Map<string, AttributionRecord>();
  const advertisers = new Map<string, AttributionRecord>();
  for (const a of input.attributions) (a.subjectKind === "user" ? people : advertisers).set(a.subjectId, a);

  const active = (uid: string | null): uid is string => uid !== null && input.userStatus.get(uid) === "active";
  const inWindow = (a: AttributionRecord, at: number): boolean => at >= a.claimedAt && at < a.claimedAt + windowMs;

  const rows = new Map<string, ReferralShareRecord>();
  const add = (referrerUid: string, subjectKind: AttributionKind, subjectId: string, cost: bigint): void => {
    const key = `${referrerUid}\u0000${subjectKind}\u0000${subjectId}`;
    const row = rows.get(key) ?? { day: input.day, referrerUid, subjectKind, subjectId, baseMicros: 0n, shareMicros: 0n };
    row.baseMicros += cost;
    rows.set(key, row);
  };

  for (const r of input.receipts) {
    if (r.costMicros <= 0n || r.createdAt < start || r.createdAt >= end) continue;
    const advertiserId = input.campaignAdvertiser.get(r.campaignId);
    if (advertiserId === undefined || house.has(advertiserId)) continue;

    const viewer = people.get(r.uid);
    if (viewer !== undefined && inWindow(viewer, r.createdAt) && active(r.uid) && active(viewer.referrerUid)) {
      add(viewer.referrerUid, "user", r.uid, r.costMicros);
    }

    const brought = advertisers.get(advertiserId);
    if (brought !== undefined && inWindow(brought, r.createdAt) && active(brought.referrerUid) && !input.badAdvertisers.has(advertiserId)) {
      add(brought.referrerUid, "advertiser", advertiserId, r.costMicros);
    }
  }

  const percent = (kind: AttributionKind): bigint =>
    kind === "user" ? input.config.userPercent : input.config.advertiserPercent;

  return [...rows.values()]
    .map((row) => ({ ...row, shareMicros: (row.baseMicros * percent(row.subjectKind)) / 100n }))
    .filter((row) => row.shareMicros > 0n)
    .sort(
      (a, b) =>
        a.referrerUid.localeCompare(b.referrerUid) ||
        a.subjectKind.localeCompare(b.subjectKind) ||
        a.subjectId.localeCompare(b.subjectId),
    );
}

const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/**
 * One ledger entry per referrer for the day.
 *
 * The id is the idempotency: `referral:<uid>:<day>` can only be inserted once, so a night
 * the job runs twice - or a backfill over days already paid - pays nobody twice.
 */
export function entriesForShares(day: string, now: number, shares: readonly ReferralShareRecord[]): LedgerEntry[] {
  const byReferrer = new Map<string, { micros: bigint; people: Set<string>; advertisers: Set<string> }>();
  for (const share of shares) {
    const totals = byReferrer.get(share.referrerUid) ?? { micros: 0n, people: new Set<string>(), advertisers: new Set<string>() };
    totals.micros += share.shareMicros;
    (share.subjectKind === "user" ? totals.people : totals.advertisers).add(share.subjectId);
    byReferrer.set(share.referrerUid, totals);
  }

  return [...byReferrer.entries()]
    .filter(([, totals]) => totals.micros > 0n)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([uid, totals]) => {
      const parts = [
        ...(totals.people.size > 0 ? [count(totals.people.size, "person", "people")] : []),
        ...(totals.advertisers.size > 0 ? [count(totals.advertisers.size, "advertiser", "advertisers")] : []),
      ];
      return {
        entryId: `referral:${uid}:${day}`,
        uid,
        kind: "referral" as const,
        micros: totals.micros,
        refId: day,
        createdAt: now,
        description: `Invites on ${day}: ${parts.join(", ")}`,
      };
    });
}

/** Distinct UTC days each account was seen on. */
function seenDays(sightings: Iterable<{ uid: string; at: number }>): Map<string, Set<number>> {
  const days = new Map<string, Set<number>>();
  for (const s of sightings) {
    const set = days.get(s.uid) ?? new Set<number>();
    set.add(Math.floor(s.at / DAY_MS));
    days.set(s.uid, set);
  }
  return days;
}

export interface ReferrerSummary {
  /** People who claimed this account's code. */
  claimed: number;
  /** Of them, seen using ADCode at least once. */
  seen: number;
  /** Of them, seen on two or more different days. */
  cameBack: number;
  advertisers: number;
  earnedMicros: bigint;
  last30Micros: bigint;
}

export function summarizeReferrer(input: {
  uid: string;
  now: number;
  attributions: Iterable<AttributionRecord>;
  sightings: Iterable<{ uid: string; at: number }>;
  /** This account's ledger entries; only `referral` ones count. */
  entries: Iterable<LedgerEntry>;
}): ReferrerSummary {
  const mine = [...input.attributions].filter((a) => a.referrerUid === input.uid);
  const people = mine.filter((a) => a.subjectKind === "user").map((a) => a.subjectId);
  const days = seenDays(input.sightings);
  const since30 = input.now - 30 * DAY_MS;

  let earnedMicros = 0n;
  let last30Micros = 0n;
  for (const entry of input.entries) {
    if (entry.kind !== "referral" || entry.uid !== input.uid) continue;
    earnedMicros += entry.micros;
    if (entry.createdAt >= since30) last30Micros += entry.micros;
  }

  return {
    claimed: people.length,
    seen: people.filter((uid) => (days.get(uid)?.size ?? 0) >= 1).length,
    cameBack: people.filter((uid) => (days.get(uid)?.size ?? 0) >= 2).length,
    advertisers: mine.filter((a) => a.subjectKind === "advertiser").length,
    earnedMicros,
    last30Micros,
  };
}

export interface FactsInput {
  since: number;
  users: Iterable<UserRecord>;
  attributions: Iterable<AttributionRecord>;
  sightings: Iterable<{ uid: string; at: number }>;
  receipts: Iterable<ReceiptRecord>;
  campaignAdvertiser: ReadonlyMap<string, string>;
  houseAdvertiserIds: readonly string[];
  shares: Iterable<ReferralShareRecord>;
}

/**
 * Every person and advertiser the Sources report counts: each attribution made since
 * `since`, plus each active account made since then that nobody claimed (the Unknown row).
 *
 * Money is measured from the claim on - what a source brought, not what the person did
 * before anyone could say where they came from.
 */
export function sourceFactsFrom(input: FactsInput): SourceFact[] {
  const house = new Set(input.houseAdvertiserIds);
  const attributions = [...input.attributions];
  const claimedUsers = new Set(attributions.filter((a) => a.subjectKind === "user").map((a) => a.subjectId));
  const days = seenDays(input.sightings);
  const receipts = [...input.receipts].filter((r) => {
    if (r.costMicros <= 0n) return false;
    const advertiserId = input.campaignAdvertiser.get(r.campaignId);
    return advertiserId !== undefined && !house.has(advertiserId);
  });

  const paid = new Map<string, bigint>();
  for (const share of input.shares) {
    const key = `${share.subjectKind}\u0000${share.subjectId}`;
    paid.set(key, (paid.get(key) ?? 0n) + share.shareMicros);
  }

  const subjects: { code: string | null; subjectKind: AttributionKind; subjectId: string; referrerUid: string | null; at: number }[] = [
    ...attributions
      .filter((a) => a.claimedAt >= input.since)
      .map((a) => ({ code: a.code, subjectKind: a.subjectKind, subjectId: a.subjectId, referrerUid: a.referrerUid, at: a.claimedAt })),
    ...[...input.users]
      .filter((u) => u.status === "active" && u.createdAt >= input.since && !claimedUsers.has(u.uid))
      .map((u) => ({ code: null, subjectKind: "user" as const, subjectId: u.uid, referrerUid: null, at: u.createdAt })),
  ];

  return subjects
    .map((s): SourceFact => {
      const mine = receipts.filter((r) =>
        r.createdAt >= s.at && (s.subjectKind === "user" ? r.uid === s.subjectId : input.campaignAdvertiser.get(r.campaignId) === s.subjectId),
      );
      const seen = s.subjectKind === "user" ? days.get(s.subjectId)?.size ?? 0 : 0;
      return {
        ...s,
        seen: seen >= 1,
        cameBack: seen >= 2,
        grossMicros: mine.reduce((sum, r) => sum + r.costMicros, 0n),
        creditedMicros: mine.reduce((sum, r) => sum + r.creditedMicros, 0n),
        paidMicros: paid.get(`${s.subjectKind}\u0000${s.subjectId}`) ?? 0n,
      };
    })
    .sort((a, b) => a.at - b.at || a.subjectId.localeCompare(b.subjectId));
}

export interface SourceRow {
  /** `campaign:<code>`, `users`, or `unknown`. */
  key: string;
  kind: "campaign" | "users" | "unknown";
  code: string | null;
  label: string;
  /** Consenting website sessions on the code's invite page. Null where there is no page. */
  visits: number | null;
  /** People who arrived this way. */
  people: number;
  realUsers: number;
  cameBack: number;
  adRevenueMicros: bigint;
  advertisers: number;
  advertiserSpendMicros: bigint;
  paidMicros: bigint;
  /** Revenue and spend, less developers' credit and referral shares on it. */
  keptMicros: bigint;
}

export interface ReferrerRow extends Omit<SourceRow, "key" | "kind" | "label"> {
  referrerUid: string;
  code: string;
}

export interface SourcesReport {
  rows: SourceRow[];
  topReferrers: ReferrerRow[];
  /** Of new real users, how many came with any code. Whether attribution works at all. */
  coverage: { attributedRealUsers: number; realUsers: number };
}

type Totals = Omit<SourceRow, "key" | "kind" | "code" | "label" | "visits">;

const emptyTotals = (): Totals => ({
  people: 0, realUsers: 0, cameBack: 0, adRevenueMicros: 0n, advertisers: 0, advertiserSpendMicros: 0n, paidMicros: 0n, keptMicros: 0n,
});

function addFact(totals: Totals, fact: SourceFact): void {
  if (fact.subjectKind === "user") {
    totals.people += 1;
    if (fact.seen) totals.realUsers += 1;
    if (fact.cameBack) totals.cameBack += 1;
    totals.adRevenueMicros += fact.grossMicros;
  } else {
    totals.advertisers += 1;
    totals.advertiserSpendMicros += fact.grossMicros;
  }
  totals.paidMicros += fact.paidMicros;
  totals.keptMicros += fact.grossMicros - fact.creditedMicros - fact.paidMicros;
}

const brought = (row: Totals): bigint => row.adRevenueMicros + row.advertiserSpendMicros;

export function buildSourcesReport(input: {
  facts: readonly SourceFact[];
  codes: readonly RefCodeRecord[];
  /** Consenting sessions per code. Null when website analytics is unavailable. */
  visits: ReadonlyMap<string, number> | null;
}): SourcesReport {
  const visitsFor = (code: string): number | null => (input.visits === null ? null : input.visits.get(code) ?? 0);

  const campaigns = new Map<string, { label: string; totals: Totals }>();
  for (const code of input.codes) {
    if (code.ownerUid === null) campaigns.set(code.code, { label: code.label, totals: emptyTotals() });
  }
  const users = emptyTotals();
  const unknown = emptyTotals();
  const referrers = new Map<string, { code: string; totals: Totals }>();
  const userCodes = new Set<string>();
  let attributedRealUsers = 0;
  let realUsers = 0;

  for (const fact of input.facts) {
    if (fact.subjectKind === "user" && fact.seen) {
      realUsers += 1;
      if (fact.code !== null) attributedRealUsers += 1;
    }
    if (fact.code === null) {
      addFact(unknown, fact);
    } else if (fact.referrerUid === null) {
      const campaign = campaigns.get(fact.code) ?? { label: "", totals: emptyTotals() };
      addFact(campaign.totals, fact);
      campaigns.set(fact.code, campaign);
    } else {
      addFact(users, fact);
      userCodes.add(fact.code);
      const referrer = referrers.get(fact.referrerUid) ?? { code: fact.code, totals: emptyTotals() };
      addFact(referrer.totals, fact);
      referrers.set(fact.referrerUid, referrer);
    }
  }

  let userVisits: number | null = null;
  if (input.visits !== null) {
    userVisits = 0;
    for (const code of userCodes) userVisits += input.visits.get(code) ?? 0;
  }

  const rows: SourceRow[] = [
    ...[...campaigns.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, { label, totals }]): SourceRow => ({ key: `campaign:${code}`, kind: "campaign", code, label, visits: visitsFor(code), ...totals })),
    { key: "users", kind: "users", code: null, label: "Invites from users", visits: userVisits, ...users },
    { key: "unknown", kind: "unknown", code: null, label: "Unknown", visits: null, ...unknown },
  ];

  const topReferrers = [...referrers.entries()]
    .map(([referrerUid, { code, totals }]): ReferrerRow => ({ referrerUid, code, visits: visitsFor(code), ...totals }))
    .sort(
      (a, b) =>
        (brought(b) > brought(a) ? 1 : brought(b) < brought(a) ? -1 : 0) ||
        b.people - a.people ||
        b.advertisers - a.advertisers ||
        a.code.localeCompare(b.code),
    )
    .slice(0, 10);

  return { rows, topReferrers, coverage: { attributedRealUsers, realUsers } };
}
