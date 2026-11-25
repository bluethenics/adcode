import type { SupabaseClient } from "@supabase/supabase-js";
import { REVIEW_REASONS, type EarningReviewRecord, type EarningReviewStatus, type EarningReviewStore, type ReviewReason } from "../src/earningReview.ts";

/**
 * The earnings review in Postgres: `earning_reviews`, `earning_trusted_domains`, and the two
 * functions of migration 20261124120000 (the shared-domain / shared-mailbox counts and the
 * flag that never overrides an administrator's decision unless asked to).
 */
type Row = { uid: string; status: string; reasons: string[] | null; email: string | null; domain: string | null; flagged_at: number | string; decided_at: number | string | null; decided_by: string | null; note: string | null };

const check = (error: { message: string } | null, what: string): void => { if (error !== null) throw new Error(`Earnings review (${what}): ${error.message}`); };
const STATUSES: readonly EarningReviewStatus[] = ["review", "cleared", "blocked"];

function record(row: Row): EarningReviewRecord {
  return {
    uid: row.uid,
    status: STATUSES.includes(row.status as EarningReviewStatus) ? (row.status as EarningReviewStatus) : "review",
    reasons: (row.reasons ?? []).filter((reason): reason is ReviewReason => (REVIEW_REASONS as readonly string[]).includes(reason)),
    email: row.email,
    domain: row.domain,
    flaggedAt: Number(row.flagged_at),
    decidedAt: row.decided_at === null ? null : Number(row.decided_at),
    decidedBy: row.decided_by,
    note: row.note,
  };
}

export function createEarningReviewStore(lazy: () => Promise<SupabaseClient>): EarningReviewStore {
  return {
    async get(uid) {
      const { data, error } = await (await lazy()).from("earning_reviews").select("*").eq("uid", uid).maybeSingle();
      check(error, "get");
      return data === null ? null : record(data as Row);
    },
    async flag({ uid, reasons, email, domain, now, reopen }) {
      const { data, error } = await (await lazy()).rpc("flag_earning_review", { p_uid: uid, p_reasons: [...reasons], p_email: email, p_domain: domain, p_now: now, p_reopen: reopen });
      check(error, "flag");
      return record(data as Row);
    },
    async decide({ uid, status, adminUid, note, now }) {
      const { data, error } = await (await lazy()).from("earning_reviews").update({ status, decided_at: now, decided_by: adminUid, note }).eq("uid", uid).select("*").maybeSingle();
      check(error, "decide");
      return data === null ? null : record(data as Row);
    },
    async list(status, limit) {
      const { data, error } = await (await lazy()).from("earning_reviews").select("*").eq("status", status).order("flagged_at", { ascending: false }).limit(limit);
      check(error, "list");
      return ((data ?? []) as Row[]).map(record);
    },
    async signals(email) {
      const { data, error } = await (await lazy()).rpc("earning_review_signals", { p_email: email });
      check(error, "signals");
      const raw = (data ?? {}) as { domainAccounts?: unknown; mailboxAccounts?: unknown };
      return { domainAccounts: Number(raw.domainAccounts ?? 0) || 0, mailboxAccounts: Number(raw.mailboxAccounts ?? 0) || 0 };
    },
    async trustDomain(domain, adminUid, now) {
      const { error } = await (await lazy()).from("earning_trusted_domains").upsert({ domain, trusted_by: adminUid, trusted_at: now });
      check(error, "trust");
    },
    async isTrustedDomain(domain) {
      const { data, error } = await (await lazy()).from("earning_trusted_domains").select("domain").eq("domain", domain).maybeSingle();
      check(error, "trusted");
      return data !== null;
    },
  };
}
