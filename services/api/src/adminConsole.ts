/**
 * The admin console: find any account and act on it, and run email campaigns.
 *
 * Two jobs the panel could not do before. The users screen searched only the newest 200
 * accounts, in the browser, so most people could not be found by the address they wrote in
 * with. And the only bulk email was the fixed three-step return sequence, which reaches the
 * handful who opted in: an administrator could not write a message of their own, cap it at a
 * thousand sends, and let it drip out fifty a day.
 *
 * Like `tagflow.ts`, this is a `fetch`-shaped handler that answers its own paths and returns
 * `null` for everything else. The rules that keep a campaign safe - who may be emailed, the
 * daily pace, suppressions, one email per address per three days - live in the database
 * (`supabase/migrations/20261117120000_email_campaigns.sql`), so this file validates input,
 * checks the administrator, writes the audit line, and translates.
 */
import { authenticate, type TokenVerifier } from "./auth.ts";
import { corsHeaders } from "./cors.ts";
import type { Clock, Store } from "./store.ts";
import type { SendResult } from "./mailing.ts";

export type CampaignAudience = "everyone" | "subscribed";
export type CampaignStatus = "draft" | "running" | "paused" | "completed" | "cancelled";

/** What an administrator writes. Everything else on a campaign is the system's. */
export interface CampaignInput {
  name: string;
  subject: string;
  /** The grey line inbox lists show after the subject. */
  preheader: string;
  heading: string;
  /** Plain text. Blank lines separate paragraphs; `{{name}}` becomes the first name, or "there". */
  body: string;
  ctaLabel: string | null;
  ctaUrl: string | null;
  audience: CampaignAudience;
  /** Only people who have not opened the editor for this many days. Null: everyone in the audience. */
  inactiveDays: number | null;
  totalLimit: number;
  dailyLimit: number;
}

export interface CampaignRecord extends CampaignInput {
  id: string;
  status: CampaignStatus;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  finishReason: string | null;
}

export interface CampaignStats {
  queued: number;
  sent: number;
  failed: number;
  delivered: number;
  opened: number;
  clicked: number;
  bounced: number;
  complained: number;
  /** Sent, and opened the editor at any point afterwards. */
  returned: number;
  /** Claimed today (UTC), against the daily cap. */
  today: number;
  lastSentAt: number | null;
}

export const EMPTY_STATS: CampaignStats = {
  queued: 0, sent: 0, failed: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0, complained: 0, returned: 0, today: 0, lastSentAt: null,
};

export interface CampaignSendRow {
  email: string;
  status: string;
  attempts: number;
  claimedAt: number;
  sentAt: number | null;
  deliveredAt: number | null;
  openedAt: number | null;
  clickedAt: number | null;
  bouncedAt: number | null;
  lastError: string | null;
}

/** One email the schedule is about to send. */
export interface CampaignJob {
  id: string;
  campaignId: string;
  uid: string;
  email: string;
  attempts: number;
  unsubscribeToken: string;
  displayName: string | null;
}

export type EmailBlockResult = "blocked" | "allowed" | "no-email" | "provider-suppressed";
export type CampaignStatusResult = "ok" | "not-found" | "finished" | "unchanged" | "bad-status";

export interface AdminConsoleStore {
  searchUsers(query: string, limit: number): Promise<unknown[]>;
  userProfile(uid: string, now: number): Promise<Record<string, unknown> | null>;
  setEmailBlocked(uid: string, blocked: boolean, now: number): Promise<EmailBlockResult>;
  listCampaigns(): Promise<CampaignRecord[]>;
  getCampaign(id: string): Promise<CampaignRecord | null>;
  createCampaign(input: CampaignInput, by: string, now: number): Promise<CampaignRecord>;
  /** Only a draft or a paused campaign can be edited; null otherwise. */
  updateCampaign(id: string, input: CampaignInput, now: number): Promise<CampaignRecord | null>;
  setCampaignStatus(id: string, status: "running" | "paused" | "cancelled", now: number): Promise<CampaignStatusResult>;
  campaignStats(ids: readonly string[], now: number): Promise<Record<string, CampaignStats>>;
  recentSends(id: string, limit: number): Promise<CampaignSendRow[]>;
  audience(audience: CampaignAudience, inactiveDays: number | null, now: number): Promise<number>;
  claimCampaignSends(now: number, limit: number): Promise<CampaignJob[]>;
  finishCampaignSend(id: string, result: SendResult, now: number): Promise<void>;
}

export const CAMPAIGN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const CAMPAIGN_LIMITS = { total: 100_000, daily: 5_000, inactiveDays: 3650 } as const;

const isRecord = (raw: unknown): raw is Record<string, unknown> => typeof raw === "object" && raw !== null && !Array.isArray(raw);
const text = (raw: unknown, min: number, max: number): string | null =>
  typeof raw === "string" && raw.trim().length >= min && raw.trim().length <= max ? raw.trim() : null;
const whole = (raw: unknown, min: number, max: number): number | null =>
  typeof raw === "number" && Number.isSafeInteger(raw) && raw >= min && raw <= max ? raw : null;

/** A campaign as written, or the one sentence that says what to fix. */
export function parseCampaignInput(raw: unknown): CampaignInput | { error: string } {
  if (!isRecord(raw)) return { error: "Send the campaign as an object." };
  const name = text(raw["name"], 1, 120);
  if (name === null) return { error: "Give the campaign a name of up to 120 characters." };
  const subject = text(raw["subject"], 1, 160);
  if (subject === null) return { error: "Write a subject line of up to 160 characters." };
  const preheader = raw["preheader"] === undefined || raw["preheader"] === "" ? "" : text(raw["preheader"], 0, 200);
  if (preheader === null) return { error: "Keep the preview line to 200 characters." };
  const heading = text(raw["heading"], 1, 160);
  if (heading === null) return { error: "Write a heading of up to 160 characters." };
  const body = text(raw["body"], 1, 8000);
  if (body === null) return { error: "Write the message, up to 8,000 characters." };

  const label = raw["ctaLabel"] === null || raw["ctaLabel"] === undefined || raw["ctaLabel"] === "" ? null : text(raw["ctaLabel"], 1, 60);
  const link = raw["ctaUrl"] === null || raw["ctaUrl"] === undefined || raw["ctaUrl"] === "" ? null : text(raw["ctaUrl"], 1, 500);
  if ((label === null) !== (link === null)) return { error: "A button needs both its words and its link, or neither." };
  if (link !== null) {
    let parsed: URL | null = null;
    try { parsed = new URL(link); } catch { /* reported below */ }
    if (parsed === null || parsed.protocol !== "https:") return { error: "The button's link must be a full https:// address." };
  }

  const audience = raw["audience"];
  if (audience !== "everyone" && audience !== "subscribed") return { error: "Choose who receives it: everyone, or only people who said yes to updates." };
  const inactiveDays = raw["inactiveDays"] === null || raw["inactiveDays"] === undefined ? null : whole(raw["inactiveDays"], 1, CAMPAIGN_LIMITS.inactiveDays);
  if (inactiveDays === null && raw["inactiveDays"] !== null && raw["inactiveDays"] !== undefined) return { error: "Inactive days must be a whole number from 1 to 3,650." };
  const totalLimit = whole(raw["totalLimit"], 1, CAMPAIGN_LIMITS.total);
  if (totalLimit === null) return { error: "The total must be a whole number from 1 to 100,000." };
  const dailyLimit = whole(raw["dailyLimit"], 1, CAMPAIGN_LIMITS.daily);
  if (dailyLimit === null) return { error: "The daily limit must be a whole number from 1 to 5,000." };
  if (dailyLimit > totalLimit) return { error: "The daily limit can't be larger than the total." };

  return { name, subject, preheader, heading, body, ctaLabel: label, ctaUrl: link, audience, inactiveDays, totalLimit, dailyLimit };
}

/** `{{name}}` with the person's first name, or "there" when we never learned one. */
export function personalize(template: string, displayName: string | null): string {
  const first = displayName?.trim().split(/\s+/)[0] ?? "";
  return template.replace(/\{\{\s*name\s*\}\}/gi, first.length > 0 && first.length <= 40 ? first : "there");
}

/** Days until a campaign has sent its total, at its daily cap, given what is already out. */
export function daysToFinish(campaign: Pick<CampaignInput, "totalLimit" | "dailyLimit">, sent: number): number {
  return Math.ceil(Math.max(0, campaign.totalLimit - sent) / campaign.dailyLimit);
}

export function isAdminConsolePath(path: string): boolean {
  return path === "/v1/admin/console/users" || /^\/v1\/admin\/console\/users\/[^/]+(\/email)?$/.test(path) ||
    path === "/v1/admin/campaigns" || path === "/v1/admin/campaigns/audience" ||
    /^\/v1\/admin\/campaigns\/[^/]+(\/(state|test))?$/.test(path);
}

export interface AdminConsoleOptions {
  store: Store;
  verifier: TokenVerifier;
  clock: Clock;
  console: AdminConsoleStore;
  /** Sends one campaign to an address as a test: no recipient row, no cap used. */
  sendTest?: (campaign: CampaignInput, to: string, displayName: string | null) => Promise<SendResult>;
}

export function createAdminConsoleHandler(options: AdminConsoleOptions): (request: Request) => Promise<Response | null> {
  const { store, clock } = options;
  const db = options.console;

  return async (request) => {
    const url = new URL(request.url);
    if (!isAdminConsolePath(url.pathname)) return null;

    const headers: Record<string, string> = { ...corsHeaders(request.headers.get("origin") ?? undefined), "cache-control": "no-store" };
    const json = (status: number, value: unknown): Response =>
      new Response(JSON.stringify(value), { status, headers: { ...headers, "content-type": "application/json" } });
    const fail = (status: number, code: string, message: string): Response => json(status, { error: code, message });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });

    const auth = await authenticate({ store, verifier: options.verifier, clock }, request.headers.get("authorization") ?? undefined);
    if (!auth.ok) return fail(auth.failure === "banned" ? 403 : 401, auth.failure, "Sign in as an administrator.");
    if (!auth.isAdmin) return fail(403, "not-admin", "Administrator access is required.");
    const audit = (action: string, subjectUid = "*"): Promise<void> => store.writeAudit({ adminUid: auth.uid, action, subjectUid, at: clock.now() });
    const body = async (): Promise<unknown> => {
      if (Number(request.headers.get("content-length")) > 64_000) return undefined;
      try { return await request.json(); } catch { return undefined; }
    };

    try {
      /* ── People ─────────────────────────────────────────────────────────── */
      if (url.pathname === "/v1/admin/console/users" && request.method === "GET") {
        const query = (url.searchParams.get("q") ?? "").trim();
        if (query.length < 2 || query.length > 200) return fail(400, "bad-query", "Type at least two characters of a uid, an email or a name.");
        const rows = await db.searchUsers(query, 25);
        await audit("search-users");
        return json(200, { rows });
      }

      const emailRoute = /^\/v1\/admin\/console\/users\/([^/]+)\/email$/.exec(url.pathname);
      if (emailRoute !== null) {
        if (request.method !== "POST") return fail(405, "method", "Use POST.");
        const uid = decodeURIComponent(emailRoute[1]!);
        const raw = await body();
        if (!isRecord(raw) || typeof raw["blocked"] !== "boolean") return fail(400, "bad-request", "Say whether email is blocked.");
        const result = await db.setEmailBlocked(uid, raw["blocked"], clock.now());
        await audit(raw["blocked"] ? "block-user-email" : "allow-user-email", uid);
        if (result === "no-email") return fail(409, "no-email", "This account has no email address.");
        if (result === "provider-suppressed") return fail(409, "provider-suppressed", "This address bounced or marked ADCode as spam. That can't be undone from here.");
        return json(200, { result });
      }

      const userRoute = /^\/v1\/admin\/console\/users\/([^/]+)$/.exec(url.pathname);
      if (userRoute !== null) {
        if (request.method !== "GET") return fail(405, "method", "Use GET.");
        const uid = decodeURIComponent(userRoute[1]!);
        if (uid.length === 0 || uid.length > 128) return fail(400, "bad-user", "That isn't a uid.");
        const profile = await db.userProfile(uid, clock.now());
        await audit("read-user-profile", uid);
        return profile === null ? fail(404, "not-found", "No account has that uid.") : json(200, profile);
      }

      /* ── Campaigns ──────────────────────────────────────────────────────── */
      if (url.pathname === "/v1/admin/campaigns/audience" && request.method === "GET") {
        const audience = url.searchParams.get("audience");
        const days = url.searchParams.get("inactiveDays");
        const inactiveDays = days === null || days === "" ? null : Number(days);
        if ((audience !== "everyone" && audience !== "subscribed") ||
            (inactiveDays !== null && (!Number.isSafeInteger(inactiveDays) || inactiveDays < 1 || inactiveDays > CAMPAIGN_LIMITS.inactiveDays))) {
          return fail(400, "bad-audience", "Choose an audience and a whole number of inactive days.");
        }
        return json(200, { count: await db.audience(audience, inactiveDays, clock.now()) });
      }

      if (url.pathname === "/v1/admin/campaigns") {
        if (request.method === "GET") {
          const campaigns = await db.listCampaigns();
          const stats = await db.campaignStats(campaigns.map((one) => one.id), clock.now());
          return json(200, { campaigns: campaigns.map((one) => ({ ...one, stats: stats[one.id] ?? EMPTY_STATS })) });
        }
        if (request.method === "POST") {
          const input = parseCampaignInput(await body());
          if ("error" in input) return fail(400, "bad-campaign", input.error);
          const created = await db.createCampaign(input, auth.uid, clock.now());
          await audit(`create-email-campaign:${created.id}`);
          return json(200, { ...created, stats: EMPTY_STATS });
        }
        return fail(405, "method", "Use GET or POST.");
      }

      const campaignRoute = /^\/v1\/admin\/campaigns\/([^/]+?)(?:\/(state|test))?$/.exec(url.pathname);
      if (campaignRoute !== null) {
        const id = decodeURIComponent(campaignRoute[1]!);
        if (!CAMPAIGN_ID.test(id)) return fail(404, "not-found", "No campaign has that id.");
        const action = campaignRoute[2];

        if (action === "state") {
          if (request.method !== "POST") return fail(405, "method", "Use POST.");
          const raw = await body();
          const next = isRecord(raw) ? raw["status"] : undefined;
          if (next !== "running" && next !== "paused" && next !== "cancelled") return fail(400, "bad-status", "Start, pause or cancel.");
          const result = await db.setCampaignStatus(id, next, clock.now());
          if (result === "not-found") return fail(404, "not-found", "No campaign has that id.");
          if (result === "finished") return fail(409, "finished", "This campaign has finished and can't change.");
          if (result === "bad-status") return fail(400, "bad-status", "Start, pause or cancel.");
          await audit(`${next === "running" ? "start" : next === "paused" ? "pause" : "cancel"}-email-campaign:${id}`);
          return json(200, { result });
        }

        if (action === "test") {
          if (request.method !== "POST") return fail(405, "method", "Use POST.");
          if (options.sendTest === undefined) return fail(503, "not-configured", "Email sending isn't configured on this server.");
          const campaign = await db.getCampaign(id);
          if (campaign === null) return fail(404, "not-found", "No campaign has that id.");
          const me = await store.getUser(auth.uid);
          if (me?.email === undefined || me.emailVerified !== true) return fail(409, "no-email", "Your account needs a verified email to receive a test.");
          const sent = await options.sendTest(campaign, me.email, me.displayName ?? null);
          await audit(`test-email-campaign:${id}`);
          if (!("providerId" in sent)) return fail(502, "send-failed", `Resend didn't accept the test (${sent.code}).`);
          return json(200, { to: me.email });
        }

        if (request.method === "GET") {
          const campaign = await db.getCampaign(id);
          if (campaign === null) return fail(404, "not-found", "No campaign has that id.");
          const [stats, sends] = await Promise.all([db.campaignStats([id], clock.now()), db.recentSends(id, 50)]);
          return json(200, { ...campaign, stats: stats[id] ?? EMPTY_STATS, sends });
        }
        if (request.method === "POST") {
          const input = parseCampaignInput(await body());
          if ("error" in input) return fail(400, "bad-campaign", input.error);
          const updated = await db.updateCampaign(id, input, clock.now());
          if (updated === null) return fail(409, "not-editable", "Pause the campaign before editing it. A finished campaign can't be edited.");
          await audit(`edit-email-campaign:${id}`);
          return json(200, updated);
        }
        return fail(405, "method", "Use GET or POST.");
      }
    } catch (error) {
      // Most likely: the campaigns migration has not been applied to this database yet.
      console.warn("admin console failed", { path: url.pathname, reason: error instanceof Error ? error.message : "unknown" });
      return fail(503, "unavailable", "The database didn't answer. If this is new, apply the email campaigns migration.");
    }
    return fail(404, "not-found", "Nothing here.");
  };
}
