/**
 * Admin > Earnings review: the accounts earningReview.ts held, and the decision on each.
 *
 *   GET  /v1/admin/earning-reviews?status=review|cleared|blocked
 *   POST /v1/admin/earning-reviews/:uid   { status: "cleared" | "blocked", note?, trustDomain? }
 *
 * Audited like every admin read and write (admin.ts), before the action.
 */
import { formatMicros } from "./money.ts";
import { emailDomain, isPublicMailbox, REASON_LABEL, type EarningReviewStatus } from "./earningReview.ts";
import type { Clock, Store } from "./store.ts";

export interface ReviewRouteResult {
  status: number;
  body: Record<string, unknown>;
}

const STATUSES: readonly EarningReviewStatus[] = ["review", "cleared", "blocked"];

export async function handleListEarningReviews(deps: { store: Store; clock: Clock }, adminUid: string, rawStatus: string | null): Promise<ReviewRouteResult> {
  const reviews = deps.store.earningReviews;
  if (reviews === undefined) return { status: 503, body: { error: "unavailable" } };
  const status = STATUSES.includes(rawStatus as EarningReviewStatus) ? (rawStatus as EarningReviewStatus) : "review";
  await deps.store.writeAudit({ adminUid, action: `read-earning-reviews:${status}`, subjectUid: "*", at: deps.clock.now() });
  const rows = await reviews.list(status, 200);
  const balances = await Promise.all(rows.map((row) => deps.store.getBalance(row.uid).catch(() => null)));
  return {
    status: 200,
    body: {
      status,
      reviews: rows.map((row, index) => ({
        ...row,
        reasonLabels: row.reasons.map((reason) => REASON_LABEL[reason] ?? reason),
        availableMicros: balances[index] === null ? null : formatMicros(balances[index]!.availableMicros),
        lifetimeMicros: balances[index] === null ? null : formatMicros(balances[index]!.lifetimeMicros),
      })),
    },
  };
}

export async function handleDecideEarningReview(deps: { store: Store; clock: Clock }, adminUid: string, uid: string, raw: unknown): Promise<ReviewRouteResult> {
  const reviews = deps.store.earningReviews;
  if (reviews === undefined) return { status: 503, body: { error: "unavailable" } };
  const value = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const status = value["status"];
  if (status !== "cleared" && status !== "blocked") return { status: 400, body: { error: "malformed status" } };
  const note = typeof value["note"] === "string" && value["note"].trim() !== "" ? value["note"].trim().slice(0, 500) : null;
  const now = deps.clock.now();
  await deps.store.writeAudit({ adminUid, action: `earning-review:${status}`, subjectUid: uid, at: now });
  const decided = await reviews.decide({ uid, status, adminUid, note, now });
  if (decided === null) return { status: 404, body: { error: "not-found" } };
  // Trusting a domain clears its people from the custom-domain rules for good. Never a public
  // mailbox: "trust gmail.com" would mean nothing and read as if it did something.
  let trustedDomain: string | null = null;
  if (status === "cleared" && value["trustDomain"] === true) {
    const domain = emailDomain(decided.email);
    if (domain !== null && !isPublicMailbox(domain)) {
      await deps.store.writeAudit({ adminUid, action: `earning-review:trust-domain:${domain}`, subjectUid: uid, at: now });
      await reviews.trustDomain(domain, adminUid, now);
      trustedDomain = domain;
      // Everybody else held only for their domain goes with it.
      for (const other of await reviews.list("review", 200)) {
        if (other.uid === uid || other.domain !== domain) continue;
        if (other.reasons.every((reason) => reason === "custom-domain-shared" || reason === "custom-domain-fast")) {
          await reviews.decide({ uid: other.uid, status: "cleared", adminUid, note: `Domain ${domain} trusted`, now });
        }
      }
    }
  }
  return { status: 200, body: { ok: true, review: decided, trustedDomain } };
}
