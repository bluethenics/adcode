/**
 * The invite endpoints: what a person sees of their own invite, claiming one, the public
 * lookup an invite page makes, and the admin's codes, terms, settlement and Sources.
 *
 * Every rule is in `referrals.ts`; this module reads the store, applies a rule, and shapes
 * the answer for the wire - money as decimal strings, as everywhere else in this service.
 *
 * Every handler here can throw `ReferralsUnavailable` when the store cannot answer - which
 * is what a deploy that ran ahead of `20261006180000_referrals.sql` looks like. The router
 * turns it into a 503 for these endpoints only, so serving, receipts and balances never
 * notice that invites are not there yet.
 */
import type { LedgerEntry } from "./ledger.ts";
import {
  DAY_MS,
  buildSourcesReport,
  checkAdvertiserClaim,
  checkUserClaim,
  firstName,
  isCampaignCode,
  newUserCode,
  normalizeCode,
  type ClaimError,
  type SourcesReport,
} from "./referrals.ts";
import type { AttributionHow, Clock, RefCodeRecord, ReferralConfig, Store, UserRecord } from "./store.ts";
import type { WebsiteAnalyticsStore } from "./websiteAnalytics.ts";

export class ReferralsUnavailable extends Error {}

export interface ReferralDeps {
  store: Store;
  clock: Clock;
  siteOrigin: string;
  random?: (size: number) => Uint8Array;
}

const randomBytes = (size: number): Uint8Array => crypto.getRandomValues(new Uint8Array(size));

/** Runs a store read or write, turning any failure into "invites are not available". */
async function guarded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ReferralsUnavailable) throw error;
    throw new ReferralsUnavailable(error instanceof Error ? error.message : String(error));
  }
}

const inviteLink = (siteOrigin: string, code: string): string => `${siteOrigin}/i/${code}`;

/** What the owner lets an invite page say about them: a first name, or nothing. */
function shownName(code: RefCodeRecord, owner: UserRecord | null): string | null {
  return code.showName && owner !== null && owner.status === "active" ? firstName(owner.displayName) : null;
}

export interface ReferralView {
  code: string;
  link: string;
  showName: boolean;
  /** Exactly what this account's invite page says at the top. */
  inviterPreview: string;
  /** Whether this account came in through an invite. */
  claimed: boolean;
  /** The first name of whoever invited them, if that person shows it. */
  invitedBy: string | null;
  canClaim: boolean;
  claimEndsAt: number;
  people: { claimed: number; seen: number; cameBack: number };
  advertisers: number;
  earnedMicros: string;
  last30Micros: string;
  rates: { userPercent: number; advertiserPercent: number; windowDays: number };
}

/** This account's code, made now if it has none. Two racing first requests end with one. */
async function ensureCode(deps: ReferralDeps, uid: string): Promise<RefCodeRecord> {
  const existing = await deps.store.refCodeForOwner(uid);
  if (existing !== null) return existing;
  const random = deps.random ?? randomBytes;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const record: RefCodeRecord = { code: newUserCode(random), ownerUid: uid, label: "", active: true, showName: true, createdAt: deps.clock.now() };
    if (await deps.store.createRefCode(record)) return record;
    // Either the code was taken (try another) or a parallel request made this owner's code.
    const raced = await deps.store.refCodeForOwner(uid);
    if (raced !== null) return raced;
  }
  throw new ReferralsUnavailable("could not allocate an invite code");
}

export async function readMyReferrals(deps: ReferralDeps, uid: string): Promise<ReferralView> {
  return guarded(async () => {
    const now = deps.clock.now();
    const [code, me, config, attribution, summary] = await Promise.all([
      ensureCode(deps, uid),
      deps.store.getUser(uid),
      deps.store.getReferralConfig(),
      deps.store.getAttribution("user", uid),
      deps.store.referralSummary(uid, now),
    ]);

    let invitedBy: string | null = null;
    if (attribution !== null && attribution.referrerUid !== null) {
      const [inviterCode, inviter] = await Promise.all([
        deps.store.refCodeForOwner(attribution.referrerUid),
        deps.store.getUser(attribution.referrerUid),
      ]);
      invitedBy = inviterCode === null ? null : shownName(inviterCode, inviter);
    }

    const name = code.showName ? firstName(me?.displayName) : null;
    const claimEndsAt = (me?.createdAt ?? now) + config.claimDays * DAY_MS;
    return {
      code: code.code,
      link: inviteLink(deps.siteOrigin, code.code),
      showName: code.showName,
      inviterPreview: `${name ?? "A developer"} invited you to ADCode`,
      claimed: attribution !== null,
      invitedBy,
      canClaim: attribution === null && now <= claimEndsAt,
      claimEndsAt,
      people: { claimed: summary.claimed, seen: summary.seen, cameBack: summary.cameBack },
      advertisers: summary.advertisers,
      earnedMicros: summary.earnedMicros.toString(),
      last30Micros: summary.last30Micros.toString(),
      rates: {
        userPercent: Number(config.userPercent),
        advertiserPercent: Number(config.advertiserPercent),
        windowDays: config.windowDays,
      },
    };
  });
}

export function parseShowName(raw: unknown): boolean | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = (raw as Record<string, unknown>)["showName"];
  return typeof value === "boolean" ? value : null;
}

export async function setShowName(deps: ReferralDeps, uid: string, showName: boolean): Promise<ReferralView> {
  await guarded(async () => {
    const code = await ensureCode(deps, uid);
    await deps.store.updateRefCode(code.code, { showName });
  });
  return readMyReferrals(deps, uid);
}

export interface ClaimBody {
  code: string;
  how: Exclude<AttributionHow, "portal">;
  heldUids: string[];
}

/** `{ code, how, heldUids? }`. `portal` is not a claim a person makes; it comes with sign-up. */
export function parseClaim(raw: unknown): ClaimBody | null {
  if (typeof raw !== "object" || raw === null) return null;
  const fields = raw as Record<string, unknown>;
  const code = normalizeCode(fields["code"]);
  const how = fields["how"];
  const held = fields["heldUids"] ?? [];
  if (code === null) return null;
  if (how !== "clipboard" && how !== "paste" && how !== "web") return null;
  if (!Array.isArray(held) || held.length > 20) return null;
  if (!held.every((uid): uid is string => typeof uid === "string" && uid.length > 0 && uid.length <= 128)) return null;
  return { code, how, heldUids: held };
}

export type ClaimOutcome = { ok: true; inviterName: string | null } | { ok: false; error: ClaimError };

export async function claimReferral(deps: ReferralDeps, uid: string, body: ClaimBody): Promise<ClaimOutcome> {
  return guarded(async () => {
    const now = deps.clock.now();
    const [claimer, existing, code, config] = await Promise.all([
      deps.store.getUser(uid),
      deps.store.getAttribution("user", uid),
      deps.store.getRefCode(body.code),
      deps.store.getReferralConfig(),
    ]);
    if (claimer === null) return { ok: false, error: "unknown-code" };
    const owner = code?.ownerUid ? await deps.store.getUser(code.ownerUid) : null;

    const refused = checkUserClaim({ now, claimer, existing, code, owner, heldUids: body.heldUids, claimDays: config.claimDays });
    if (refused !== null || code === null) return { ok: false, error: refused ?? "unknown-code" };

    const written = await deps.store.createAttribution({
      subjectKind: "user",
      subjectId: uid,
      code: code.code,
      referrerUid: code.ownerUid,
      how: body.how,
      claimedAt: now,
    });
    if (!written) return { ok: false, error: "already-claimed" };
    return { ok: true, inviterName: shownName(code, owner) };
  });
}

/**
 * After an advertiser is created: remember who brought it, if anyone validly did.
 *
 * Never fails the sign-up. A stale link, someone else's typo, an unavailable table - the
 * advertiser still gets their account, and simply is not attributed.
 */
export async function attributeAdvertiser(deps: ReferralDeps, advertiserId: string, ownerUids: readonly string[], ref: string | undefined): Promise<void> {
  const codeValue = normalizeCode(ref);
  if (codeValue === null) return;
  try {
    const code = await deps.store.getRefCode(codeValue);
    const owner = code?.ownerUid ? await deps.store.getUser(code.ownerUid) : null;
    if (!checkAdvertiserClaim({ code, owner, ownerUids })) return;
    await deps.store.createAttribution({
      subjectKind: "advertiser",
      subjectId: advertiserId,
      code: codeValue,
      referrerUid: code?.ownerUid ?? null,
      how: "portal",
      claimedAt: deps.clock.now(),
    });
  } catch {
    // Attribution is a nice-to-have on this path; the sign-up is not.
  }
}

export interface InviteLookup {
  valid: boolean;
  inviterName: string | null;
  kind: "user" | "campaign" | null;
}

/** The public lookup an invite page makes. Says only what the page shows. */
export async function lookupInvite(deps: ReferralDeps, raw: string): Promise<InviteLookup> {
  return guarded(async () => {
    const codeValue = normalizeCode(raw);
    const code = codeValue === null ? null : await deps.store.getRefCode(codeValue);
    if (code === null || !code.active) return { valid: false, inviterName: null, kind: null };
    if (code.ownerUid === null) return { valid: true, inviterName: null, kind: "campaign" };
    const owner = await deps.store.getUser(code.ownerUid);
    if (owner === null || owner.status !== "active") return { valid: false, inviterName: null, kind: null };
    return { valid: true, inviterName: shownName(code, owner), kind: "user" };
  });
}

/* ── Admin ─────────────────────────────────────────────────────────────── */

export interface CampaignCodeView extends RefCodeRecord {
  link: string;
}

export async function listCampaignCodes(deps: ReferralDeps): Promise<{ codes: CampaignCodeView[] }> {
  return guarded(async () => ({
    codes: (await deps.store.listCampaignCodes()).map((c) => ({ ...c, link: inviteLink(deps.siteOrigin, c.code) })),
  }));
}

export function parseNewCampaignCode(raw: unknown): { code: string; label: string } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const fields = raw as Record<string, unknown>;
  const code = fields["code"];
  const label = fields["label"] ?? "";
  if (typeof code !== "string" || !isCampaignCode(code)) return null;
  if (typeof label !== "string" || label.length > 120) return null;
  return { code, label: label.trim() };
}

export async function createCampaignCode(deps: ReferralDeps, input: { code: string; label: string }): Promise<CampaignCodeView | null> {
  return guarded(async () => {
    const record: RefCodeRecord = { code: input.code, ownerUid: null, label: input.label, active: true, showName: false, createdAt: deps.clock.now() };
    return (await deps.store.createRefCode(record)) ? { ...record, link: inviteLink(deps.siteOrigin, record.code) } : null;
  });
}

export function parseCodePatch(raw: unknown): { label?: string; active?: boolean } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const fields = raw as Record<string, unknown>;
  const patch: { label?: string; active?: boolean } = {};
  if (fields["label"] !== undefined) {
    if (typeof fields["label"] !== "string" || fields["label"].length > 120) return null;
    patch.label = fields["label"].trim();
  }
  if (fields["active"] !== undefined) {
    if (typeof fields["active"] !== "boolean") return null;
    patch.active = fields["active"];
  }
  return Object.keys(patch).length === 0 ? null : patch;
}

/** Admin edits a campaign code. A person's own code is theirs, so this refuses one. */
export async function updateCampaignCode(deps: ReferralDeps, code: string, patch: { label?: string; active?: boolean }): Promise<CampaignCodeView | null> {
  return guarded(async () => {
    const current = await deps.store.getRefCode(code);
    if (current === null || current.ownerUid !== null) return null;
    const updated = await deps.store.updateRefCode(code, patch);
    return updated === null ? null : { ...updated, link: inviteLink(deps.siteOrigin, updated.code) };
  });
}

export interface ReferralConfigView {
  userPercent: string;
  advertiserPercent: string;
  windowDays: number;
  claimDays: number;
  houseAdvertiserIds: string[];
}

const configView = (config: ReferralConfig): ReferralConfigView => ({
  userPercent: config.userPercent.toString(),
  advertiserPercent: config.advertiserPercent.toString(),
  windowDays: config.windowDays,
  claimDays: config.claimDays,
  houseAdvertiserIds: [...config.houseAdvertiserIds],
});

export async function readReferralConfig(deps: ReferralDeps): Promise<ReferralConfigView> {
  return guarded(async () => configView(await deps.store.getReferralConfig()));
}

/** The same bounds the table's check constraints hold, so a bad value is a 400, not a 500. */
export function parseReferralConfig(raw: unknown): ReferralConfig | null {
  if (typeof raw !== "object" || raw === null) return null;
  const f = raw as Record<string, unknown>;
  const percent = (v: unknown): bigint | null =>
    typeof v === "string" && /^\d{1,2}$/.test(v) && Number(v) <= 50 ? BigInt(v) : null;
  const whole = (v: unknown, max: number): number | null =>
    typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max ? v : null;
  const userPercent = percent(f["userPercent"]);
  const advertiserPercent = percent(f["advertiserPercent"]);
  const windowDays = whole(f["windowDays"], 1095);
  const claimDays = whole(f["claimDays"], 60);
  const house = f["houseAdvertiserIds"];
  if (userPercent === null || advertiserPercent === null || windowDays === null || claimDays === null) return null;
  if (!Array.isArray(house) || house.length > 20 || !house.every((id) => typeof id === "string" && id.length > 0 && id.length <= 128)) return null;
  return { userPercent, advertiserPercent, windowDays, claimDays, houseAdvertiserIds: [...new Set(house as string[])] };
}

export async function saveReferralConfig(deps: ReferralDeps, adminUid: string, config: ReferralConfig): Promise<ReferralConfigView> {
  return guarded(async () => {
    await deps.store.putReferralConfig(config);
    await deps.store.writeAudit({ adminUid, action: "save-referral-config", subjectUid: "*", at: deps.clock.now() });
    return configView(config);
  });
}

/** A finished UTC day, `YYYY-MM-DD`, or null. Settling today would pay a day still happening. */
export function parseSettleDay(raw: unknown, now: number): string | null {
  if (typeof raw !== "object" || raw === null) return null;
  const day = (raw as Record<string, unknown>)["day"];
  if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const start = Date.parse(`${day}T00:00:00.000Z`);
  if (Number.isNaN(start) || new Date(start).toISOString().slice(0, 10) !== day) return null;
  return start + DAY_MS <= now ? day : null;
}

export async function settleDay(deps: ReferralDeps, adminUid: string, day: string): Promise<{ day: string; referrers: number; micros: string }> {
  return guarded(async () => {
    const result = await deps.store.settleReferrals(day, deps.clock.now());
    await deps.store.writeAudit({ adminUid, action: "settle-referrals", subjectUid: day, at: deps.clock.now() });
    return { day, referrers: result.referrers, micros: result.micros.toString() };
  });
}

type Wire<T> = { [K in keyof T]: T[K] extends bigint ? string : T[K] extends (infer U)[] ? Wire<U>[] : T[K] extends object | null ? T[K] : T[K] };

function rowToWire<T extends object>(row: T): Wire<T> {
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v])) as Wire<T>;
}

/**
 * The Sources report for the last `days` days (0 = all time), with consenting visits to
 * each code's invite page from website analytics when it is there.
 */
export async function readSources(
  deps: ReferralDeps & { websiteAnalytics: WebsiteAnalyticsStore | undefined },
  days: number,
): Promise<{ days: number; asOf: number; rows: Wire<SourcesReport["rows"][number]>[]; topReferrers: Wire<SourcesReport["topReferrers"][number]>[]; coverage: SourcesReport["coverage"] }> {
  const now = deps.clock.now();
  const since = days === 0 ? 0 : now - days * DAY_MS;
  const [facts, codes] = await guarded(() => Promise.all([deps.store.referralSourceFacts(since), deps.store.listCampaignCodes()]));

  let visits: Map<string, number> | null = null;
  if (deps.websiteAnalytics !== undefined) {
    try {
      // Website events are kept 90 days; "all time" is as far back as they go.
      const end = now + 1;
      const start = Math.max(since, now - 90 * DAY_MS);
      const { events } = await deps.websiteAnalytics.read(start, end);
      const sessions = new Map<string, Set<string>>();
      for (const event of events) {
        if (!event.campaign.startsWith("ref.")) continue;
        const code = event.campaign.slice(4);
        const set = sessions.get(code) ?? new Set<string>();
        set.add(event.session);
        sessions.set(code, set);
      }
      visits = new Map([...sessions.entries()].map(([code, set]) => [code, set.size]));
    } catch {
      visits = null;
    }
  }

  const report = buildSourcesReport({ facts, codes, visits });
  return {
    days,
    asOf: now,
    rows: report.rows.map(rowToWire),
    topReferrers: report.topReferrers.map(rowToWire),
    coverage: report.coverage,
  };
}

export async function readUserReferrals(deps: ReferralDeps, uid: string) {
  return guarded(() => deps.store.referralsForUser(uid));
}

/* ── Thank-you awards (Phase 4) ────────────────────────────────────────── */

/** Positive whole micros, at most $100 - an award, not a salary. */
export function parseAward(raw: unknown): bigint | null {
  if (typeof raw !== "object" || raw === null) return null;
  const micros = (raw as Record<string, unknown>)["micros"];
  if (typeof micros !== "string" || !/^\d{1,9}$/.test(micros)) return null;
  const value = BigInt(micros);
  return value > 0n && value <= 100_000_000n ? value : null;
}

export type AwardOutcome = { ok: true; micros: string } | { ok: false; error: "not-found" | "already-awarded" };

/**
 * Thanks the person who filed a report, once per report, into their balance - and closes
 * the report, because an award is the end of its story.
 */
export async function awardReport(deps: { store: Store; clock: Clock }, adminUid: string, reportId: string, micros: bigint): Promise<AwardOutcome> {
  const report = await deps.store.getReport(reportId);
  if (report === null) return { ok: false, error: "not-found" };
  const title = report.title.length > 80 ? `${report.title.slice(0, 79)}…` : report.title;
  const entry: LedgerEntry = {
    entryId: `contribution:${reportId}`,
    uid: report.uid,
    kind: "contribution",
    micros,
    refId: reportId,
    createdAt: deps.clock.now(),
    description: `Thanks from ADCode: ${title}`,
  };
  try {
    await deps.store.appendEntryAndUpdateBalance(entry);
  } catch {
    return { ok: false, error: "already-awarded" };
  }
  await deps.store.setReportStatus(reportId, "closed");
  await deps.store.writeAudit({ adminUid, action: "award-report", subjectUid: report.uid, at: deps.clock.now() });
  return { ok: true, micros: micros.toString() };
}
