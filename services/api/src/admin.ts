/**
 * Admin routes.
 *
 * Spec §9: admin power over other people's money is itself audited. Every read and every
 * write here writes an `adminAudit` row first - before the action, so a failure partway
 * through still leaves evidence that the attempt was made.
 */
import { handleLedger } from "./balance.ts";
import type { LedgerResponseBody } from "./contract.ts";
import type {
  Clock,
  CreativeRecord,
  Page,
  PostRecord,
  Store,
  UserPage,
  UserStatus,
} from "./store.ts";

export interface AdminDeps {
  store: Store;
  clock: Clock;
}

export async function handleAdminLedger(
  deps: AdminDeps,
  adminUid: string,
  subjectUid: string,
  page: Page,
): Promise<LedgerResponseBody> {
  await deps.store.writeAudit({
    adminUid,
    action: "read-ledger",
    subjectUid,
    at: deps.clock.now(),
  });

  // The same function the user's own view calls, so the two can never drift.
  return handleLedger(deps.store, subjectUid, page);
}

export async function handleSetUserStatus(
  deps: AdminDeps,
  adminUid: string,
  subjectUid: string,
  status: UserStatus,
): Promise<void> {
  const user = await deps.store.getUser(subjectUid);
  if (user === null) throw new Error(`no such user: ${subjectUid}`);

  await deps.store.writeAudit({
    adminUid,
    action: `set-status:${status}`,
    subjectUid,
    at: deps.clock.now(),
  });

  await deps.store.putUser({ ...user, status });
}

/* ── Moderation ─────────────────────────────────────────────────────────── */


export async function handleListUsers(
  deps: AdminDeps,
  adminUid: string,
  page: Page,
): Promise<UserPage> {
  await deps.store.writeAudit({ adminUid, action: "read-users", subjectUid: "*", at: deps.clock.now() });
  return deps.store.listUsers(page);
}

/** The review queue. Creatives sit here until an admin looks at them. */
export async function handleReviewQueue(
  deps: AdminDeps,
  adminUid: string,
): Promise<CreativeRecord[]> {
  await deps.store.writeAudit({ adminUid, action: "read-review-queue", subjectUid: "*", at: deps.clock.now() });
  return deps.store.creativesByStatus("pending");
}

export async function handleSetCreativeStatus(
  deps: AdminDeps,
  adminUid: string,
  creativeId: string,
  status: CreativeRecord["status"],
): Promise<CreativeRecord | null> {
  const creative = await deps.store.getCreative(creativeId);
  if (creative === null) return null;

  await deps.store.writeAudit({
    adminUid,
    // The campaign is the subject: a creative is not a person, but it belongs to one.
    action: `creative:${status}:${creativeId}`,
    subjectUid: creative.campaignId,
    at: deps.clock.now(),
  });

  const updated: CreativeRecord = { ...creative, status };
  await deps.store.putCreative(updated);
  return updated;
}

/* ── Test serves ────────────────────────────────────────────────────────── */

/**
 * Queue one creative to be served to a specific user, ignoring targeting and budget.
 *
 * Single-use and flagged, so the receipt it produces is recorded but bills nobody and
 * credits nobody. A delivery test that moved real money would be a way to mint it.
 *
 * It appears on that client's next scheduled ad slot, not instantly - the editor's own
 * scheduler decides when to interrupt, and the server cannot override that. Set the
 * cadence to `max` in settings to shorten the wait.
 */
export async function handleQueueTestServe(
  deps: AdminDeps,
  adminUid: string,
  targetUid: string,
  creativeId: string,
): Promise<{ ok: true } | { ok: false; error: "not-found" }> {
  const creative = await deps.store.getCreative(creativeId);
  if (creative === null) return { ok: false, error: "not-found" };

  await deps.store.writeAudit({
    adminUid,
    action: `test-serve:${creativeId}`,
    subjectUid: targetUid,
    at: deps.clock.now(),
  });

  await deps.store.setTestServe(targetUid, creativeId);
  return { ok: true };
}

/* ── Blog ───────────────────────────────────────────────────────────────── */

/** Lowercase, digits, hyphens. Anything else would break the URL it becomes. */
export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface PostInput {
  slug: string;
  title: string;
  description: string;
  body: string;
  status: "draft" | "published";
}

export function parsePost(raw: unknown): PostInput | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;

  const text = (v: unknown, max: number): string | null => {
    if (typeof v !== "string") return null;
    const trimmed = v.trim();
    return trimmed.length === 0 || trimmed.length > max ? null : trimmed;
  };

  const slug = text(r["slug"], 80);
  const title = text(r["title"], 140);
  const description = text(r["description"], 300);
  const body = text(r["body"], 40_000);
  const status = r["status"];

  if (slug === null || !SLUG.test(slug)) return null;
  if (title === null || description === null || body === null) return null;
  if (status !== "draft" && status !== "published") return null;

  return { slug, title, description, body, status };
}

export async function handleSavePost(
  deps: AdminDeps,
  adminUid: string,
  input: PostInput,
): Promise<PostRecord> {
  const existing = await deps.store.getPost(input.slug);
  const now = deps.clock.now();

  await deps.store.writeAudit({
    adminUid,
    action: `post:${input.status}:${input.slug}`,
    subjectUid: "*",
    at: now,
  });

  const post: PostRecord = {
    slug: input.slug,
    title: input.title,
    description: input.description,
    body: input.body,
    status: input.status,
    authorUid: existing?.authorUid ?? adminUid,
    // First publish stamps the date; re-publishing an already-live post keeps the
    // original, because a post's publication date is not "the last time it was saved".
    publishedAt:
      input.status === "published" ? (existing?.publishedAt ?? now) : (existing?.publishedAt ?? null),
    updatedAt: now,
  };

  await deps.store.putPost(post);
  return post;
}

export async function handleListPosts(
  deps: AdminDeps,
  adminUid: string,
): Promise<PostRecord[]> {
  await deps.store.writeAudit({ adminUid, action: "read-posts", subjectUid: "*", at: deps.clock.now() });
  return deps.store.listPosts({ publishedOnly: false });
}
