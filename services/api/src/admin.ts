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
  AdminRecord,
  AdvertiserRecord,
  Clock,
  CreativeRecord,
  IdGen,
  NoticeRecord,
  Page,
  PostRecord,
  PostSurface,
  ReleaseRecord,
  Store,
  UserPage,
  UserStatus,
} from "./store.ts";
import { assetKey, assetUrl, isDataUrl, parseDataUrl } from "./assets.ts";

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

/**
 * Move any artwork still stored inline onto the asset host.
 *
 * A repair tool, and it exists because the rows that need repairing were written before
 * `createCreative` learned to store artwork separately. Those rows are individually fatal
 * to serving: a `data:` logo makes the creatives read cost ~1,960ms of the editor's
 * 3,000ms budget, and the editor rejects the value anyway - one bad creative fails the
 * whole serve response, so a single unrepaired row takes every other creative with it.
 *
 * Idempotent: a creative whose logos are already https URLs is skipped, so running it
 * twice costs two reads and changes nothing.
 */
export async function handleRehostAssets(
  deps: AdminDeps,
  adminUid: string,
  origin: string,
): Promise<{ scanned: number; rehosted: number }> {
  await deps.store.writeAudit({
    adminUid,
    action: "rehost-assets",
    subjectUid: "*",
    at: deps.clock.now(),
  });

  const creatives = [
    ...(await deps.store.creativesByStatus("approved")),
    ...(await deps.store.creativesByStatus("pending")),
  ];

  let rehosted = 0;

  for (const creative of creatives) {
    if (!isDataUrl(creative.logoLight) && !isDataUrl(creative.logoDark)) continue;

    const logoLight = await rehost(deps, origin, creative.creativeId, "light", creative.logoLight);
    const logoDark = await rehost(deps, origin, creative.creativeId, "dark", creative.logoDark);

    await deps.store.putCreative({ ...creative, logoLight, logoDark });
    rehosted += 1;
  }

  return { scanned: creatives.length, rehosted };
}

/** One logo. Anything already hosted, or undecodable, is left exactly as it is. */
async function rehost(
  deps: AdminDeps,
  origin: string,
  creativeId: string,
  variant: "light" | "dark",
  value: string,
): Promise<string> {
  if (!isDataUrl(value)) return value;

  const parsed = parseDataUrl(value);
  if (parsed === null) return value;

  const key = assetKey(creativeId, variant, parsed.contentType);
  await deps.store.putAsset(key, parsed);
  return assetUrl(origin, key);
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
  /*
   * Optional, all four: a caller that only wants a blog post should not have to say so in
   * four fields. `parsePost` fills them in from the wire and `handleSavePost` defaults
   * whatever is still missing, so a record always has them even when a caller does not.
   */
  surface?: PostSurface;
  section?: string;
  order?: number;
  related?: string[];
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

  /*
   * Surface defaults to `blog`, which is what every record written before this field
   * existed is. Defaulting to `docs` would silently move old posts into a reference
   * section they were never written for.
   */
  const rawSurface = r["surface"];
  const surface: PostSurface =
    rawSurface === "docs" || rawSurface === "both" ? rawSurface : "blog";

  const rawSection = r["section"];
  const section =
    typeof rawSection === "string" && rawSection.trim().length > 0
      ? rawSection.trim().slice(0, 60)
      : "Guides";

  const rawOrder = r["order"];
  const order = typeof rawOrder === "number" && Number.isFinite(rawOrder) ? Math.trunc(rawOrder) : 0;

  const rawRelated = r["related"];
  const related = Array.isArray(rawRelated)
    ? rawRelated.filter((one): one is string => typeof one === "string" && SLUG.test(one)).slice(0, 8)
    : [];

  return { slug, title, description, body, status, surface, section, order, related };
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
    surface: input.surface ?? existing?.surface ?? "blog",
    section: input.section ?? existing?.section ?? "Guides",
    order: input.order ?? existing?.order ?? 0,
    related: [...(input.related ?? existing?.related ?? [])],
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


/* -- Releases ------------------------------------------------------------ */

export interface ReleaseInput {
  readonly version: string;
  readonly title: string;
  readonly body: string;
  readonly highlights: readonly string[];
  readonly announce: boolean;
  readonly critical: boolean;
  readonly status: "draft" | "published";
  /** Set when a tool drafted this rather than a person. */
  readonly authoredBy?: "human" | "agent";
}

/**
 * Write a release note.
 *
 * Keyed by version, so saving the same version twice edits it rather than making a second
 * one. The publication date is stamped on the first publish and kept afterwards: a
 * release's date is when it shipped, not the last time somebody fixed a typo in the note.
 */
export async function handleSaveRelease(
  deps: AdminDeps,
  adminUid: string,
  input: ReleaseInput,
): Promise<ReleaseRecord> {
  const existing = await deps.store.getRelease(input.version);
  const now = deps.clock.now();

  await deps.store.writeAudit({
    adminUid,
    action: `release:${input.status}:${input.version}`,
    subjectUid: "*",
    at: now,
  });

  const release: ReleaseRecord = {
    version: input.version,
    title: input.title,
    body: input.body,
    highlights: [...input.highlights],
    announce: input.announce,
    critical: input.critical,
    status: input.status,
    authoredBy: input.authoredBy ?? existing?.authoredBy ?? "human",
    authorUid: existing?.authorUid ?? adminUid,
    publishedAt:
      input.status === "published"
        ? (existing?.publishedAt ?? now)
        : (existing?.publishedAt ?? null),
    updatedAt: now,
  };

  await deps.store.putRelease(release);
  return release;
}

export async function handleListReleases(
  deps: AdminDeps,
  adminUid: string,
): Promise<ReleaseRecord[]> {
  await deps.store.writeAudit({
    adminUid,
    action: "read-releases",
    subjectUid: "*",
    at: deps.clock.now(),
  });
  return deps.store.listReleases({ publishedOnly: false });
}

/**
 * A release note written by a tool.
 *
 * Always a draft, whatever the caller asks for, and that is the whole design rather than a
 * default: an AI-written note that reaches every user with no human read cannot be unsaid.
 * The agent proposes; a person publishes.
 */
export async function handleDraftRelease(
  deps: AdminDeps,
  input: ReleaseInput,
): Promise<ReleaseRecord> {
  return handleSaveRelease(deps, "agent", {
    ...input,
    status: "draft",
    authoredBy: "agent",
  });
}


/**
 * Read a release out of a request body.
 *
 * Every field checked, and the two that decide whether anybody gets interrupted -
 * `announce` and `critical` - default to false rather than to whatever a malformed body
 * happened to contain. The safe default for "interrupt everybody" is no.
 */
export function parseRelease(raw: unknown): ReleaseInput | null {
  if (typeof raw !== "object" || raw === null) return null;
  const body = raw as Record<string, unknown>;

  const version = body["version"];
  const title = body["title"];
  const text = body["body"];

  // Semver-ish and short: this becomes a document id, and a key in the desktop client's
  // dismissed-versions file.
  if (typeof version !== "string" || !/^[0-9A-Za-z.\-+]{1,32}$/.test(version)) return null;
  if (typeof title !== "string" || title.length === 0 || title.length > 140) return null;
  if (typeof text !== "string" || text.length > 20000) return null;

  const rawHighlights = body["highlights"];
  const highlights = Array.isArray(rawHighlights)
    ? rawHighlights
        .filter((one): one is string => typeof one === "string" && one.length > 0)
        .slice(0, 6)
        .map((one) => one.slice(0, 200))
    : [];

  return {
    version,
    title,
    body: text,
    highlights,
    announce: body["announce"] === true,
    critical: body["critical"] === true,
    status: body["status"] === "published" ? "published" : "draft",
  };
}

/* ── Advertisers ────────────────────────────────────────────────────────── */

export async function handleListAdvertisers(
  deps: AdminDeps,
  adminUid: string,
): Promise<AdvertiserRecord[]> {
  await deps.store.writeAudit({
    adminUid,
    action: "read-advertisers",
    subjectUid: "*",
    at: deps.clock.now(),
  });
  return deps.store.listAdvertisers();
}

/**
 * Suspend or reinstate an advertiser.
 *
 * Suspension stops them reaching the portal at all, which also stops any campaign being
 * activated or funded. It deliberately does NOT pause their live campaigns: money is
 * already committed to those, and silently halting delivery an advertiser has paid for
 * is a refund question, not a moderation one. Pause the campaigns explicitly if that is
 * what is meant.
 */
export async function handleSetAdvertiserStatus(
  deps: AdminDeps,
  adminUid: string,
  advertiserId: string,
  status: "active" | "suspended",
): Promise<AdvertiserRecord | null> {
  const advertiser = await deps.store.getAdvertiser(advertiserId);
  if (advertiser === null) return null;

  await deps.store.writeAudit({
    adminUid,
    action: `advertiser:${status}`,
    subjectUid: advertiserId,
    at: deps.clock.now(),
  });

  const updated: AdvertiserRecord = { ...advertiser, status };
  await deps.store.putAdvertiser(updated);
  return updated;
}

/* ── Notices ────────────────────────────────────────────────────────────── */

export interface NoticeInput {
  severity: "info" | "warning";
  title: string;
  body: string;
}

export function parseNotice(raw: unknown): NoticeInput | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;

  const severity = r["severity"];
  if (severity !== "info" && severity !== "warning") return null;

  const text = (v: unknown, max: number): string | null => {
    if (typeof v !== "string") return null;
    const trimmed = v.trim();
    return trimmed.length === 0 || trimmed.length > max ? null : trimmed;
  };

  const title = text(r["title"], 100);
  const body = text(r["body"], 500);
  if (title === null || body === null) return null;

  return { severity, title, body };
}

export async function handlePublishNotice(
  deps: AdminDeps & { ids: IdGen },
  adminUid: string,
  input: NoticeInput,
): Promise<NoticeRecord> {
  const notice: NoticeRecord = {
    noticeId: deps.ids.next("note"),
    severity: input.severity,
    title: input.title,
    body: input.body,
    active: true,
    authorUid: adminUid,
    createdAt: deps.clock.now(),
  };

  await deps.store.writeAudit({
    adminUid,
    action: `notice:publish:${notice.noticeId}`,
    subjectUid: "*",
    at: notice.createdAt,
  });

  await deps.store.putNotice(notice);
  return notice;
}

/** Retracts rather than deletes: what was said, and when, stays on the record. */
export async function handleRetractNotice(
  deps: AdminDeps,
  adminUid: string,
  noticeId: string,
): Promise<NoticeRecord | null> {
  const notice = await deps.store.getNotice(noticeId);
  if (notice === null) return null;

  await deps.store.writeAudit({
    adminUid,
    action: `notice:retract:${noticeId}`,
    subjectUid: "*",
    at: deps.clock.now(),
  });

  const updated: NoticeRecord = { ...notice, active: false };
  await deps.store.putNotice(updated);
  return updated;
}

export async function handleListNotices(
  deps: AdminDeps,
  adminUid: string,
): Promise<NoticeRecord[]> {
  await deps.store.writeAudit({
    adminUid,
    action: "read-notices",
    subjectUid: "*",
    at: deps.clock.now(),
  });
  return deps.store.listNotices({ activeOnly: false });
}

/* ── Administrators ──────────────────────────────────────────────────────── */

/**
 * A very small amount of validation, on purpose.
 *
 * This is not a signup form: it checks the address is shaped like one and lowercases it,
 * and leaves everything else to the fact that an admin only counts once a real provider
 * has verified that same address (see `adminFromEmail` in `auth.ts`). Being generous here
 * cannot grant anybody anything.
 */
export function parseAdminEmail(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null) return null;
  const email = (raw as { email?: unknown }).email;
  if (typeof email !== "string") return null;

  const trimmed = email.trim().toLowerCase();
  if (trimmed.length === 0 || trimmed.length > 320) return null;
  // One `@`, something either side, and a dot in the domain. Deliberately not RFC 5322.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null;

  return trimmed;
}

export async function handleListAdmins(deps: AdminDeps, adminUid: string): Promise<AdminRecord[]> {
  await deps.store.writeAudit({
    adminUid,
    action: "read-admins",
    subjectUid: "*",
    at: deps.clock.now(),
  });
  return deps.store.listAdmins();
}

export type AdminChange =
  | { ok: true; admins: AdminRecord[] }
  | { ok: false; reason: "already-admin" | "not-admin" | "last-admin" };

export async function handleAddAdmin(
  deps: AdminDeps,
  adminUid: string,
  email: string,
): Promise<AdminChange> {
  const added = await deps.store.addAdmin({ email, addedBy: adminUid, addedAt: deps.clock.now() });
  if (!added) return { ok: false, reason: "already-admin" };

  await deps.store.writeAudit({
    adminUid,
    action: `admin:grant:${email}`,
    subjectUid: email,
    at: deps.clock.now(),
  });

  return { ok: true, admins: await deps.store.listAdmins() };
}

/**
 * Remove an administrator.
 *
 * Refuses to remove the last one. Nothing else in this system can appoint an admin - the
 * founding row was seeded by a migration - so emptying this table locks everybody out of
 * the admin panel permanently, and the only way back is a hand-written SQL statement
 * against production. Removing yourself is allowed as long as somebody else remains.
 */
export async function handleRemoveAdmin(
  deps: AdminDeps,
  adminUid: string,
  email: string,
): Promise<AdminChange> {
  if ((await deps.store.countAdmins()) <= 1) return { ok: false, reason: "last-admin" };

  const removed = await deps.store.removeAdmin(email);
  if (!removed) return { ok: false, reason: "not-admin" };

  await deps.store.writeAudit({
    adminUid,
    action: `admin:revoke:${email}`,
    subjectUid: email,
    at: deps.clock.now(),
  });

  return { ok: true, admins: await deps.store.listAdmins() };
}

/**
 * What is waiting for an administrator, in one number each.
 *
 * The panel had no home: opening it landed you in the creative queue, which said nothing
 * about the three withdrawal requests or the eleven unread bug reports one page over. So
 * every queue that can block somebody else is counted here, and the overview is the first
 * screen rather than a queue that happens to be first alphabetically.
 *
 * Counts, not contents. This is read on every visit to the panel, and a screen that
 * fetches five full lists to render five integers is a screen people stop opening.
 */
export interface AdminOverview {
  creativesWaiting: number;
  withdrawalsPending: number;
  reportsOpen: number;
  advertisers: number;
  noticesActive: number;
  /** Held across all accounts, so an unusual total is visible without opening the list. */
  pendingWithdrawalMicros: string;
}

export async function handleOverview(deps: AdminDeps, adminUid: string): Promise<AdminOverview> {
  await deps.store.writeAudit({
    adminUid,
    action: "read-overview",
    subjectUid: "*",
    at: deps.clock.now(),
  });

  const [creatives, withdrawals, reports, advertisers, notices] = await Promise.all([
    deps.store.creativesByStatus("pending"),
    deps.store.listWithdrawals(null, { limit: 200, cursor: null }),
    deps.store.listReports({ limit: 200, cursor: null }),
    deps.store.listAdvertisers(),
    deps.store.listNotices({ activeOnly: true }),
  ]);

  const waiting = withdrawals.rows.filter(
    (row) => row.status === "requested" || row.status === "approved",
  );
  const held = waiting.reduce((total, row) => total + row.amountMicros, 0n);

  return {
    creativesWaiting: creatives.length,
    withdrawalsPending: waiting.length,
    reportsOpen: reports.rows.filter((row) => row.status === "open").length,
    advertisers: advertisers.length,
    noticesActive: notices.length,
    pendingWithdrawalMicros: held.toString(),
  };
}
