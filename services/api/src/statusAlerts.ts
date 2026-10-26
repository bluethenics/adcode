/**
 * Status alerts by email, for anybody - no ADCode account needed.
 *
 * The status page already says when an included model is struggling; this tells the people who
 * asked, the moment it starts and again when it is over. Two lists a visitor can join from
 * /status with just an address:
 *
 *   * `models` - sent by the service itself, no human in the loop: a model has started failing
 *     requests (degraded or outage), and later that it is back to normal;
 *   * `incidents` - the incident updates an administrator posts and chooses to email.
 *
 * Joining is double opt-in. A form anyone can post must never become a way to mail a stranger,
 * so the address gets one confirmation email (rate limited per address, per network and per
 * day) and nothing else until its owner clicks it. Every alert carries a one-click unsubscribe.
 *
 * Health is judged on the turns since the previous check, not the whole day, so an alert says
 * what is happening now: the watcher keeps each model's running daily counts and diffs them.
 * A window with too few turns is no evidence either way and changes nothing; recovery needs two
 * good windows in a row, so a model that flickers does not send an email every quarter hour.
 *
 * Alerts come from `noreply@bluethenics.com` - the same verified Resend domain as the rest of
 * ADCode's mail - and wait for the same sending switch and postal address as every bulk email.
 */
import { utcDay } from "./day.ts";
import type { ModelOutcomeRow } from "./modelOutcomes.ts";
import type { RenderedMail } from "./mailingDelivery.ts";
import type { SendResult } from "./mailing.ts";
import { SERVICE_FAILURES, includedOutcomes, levelFor, modelDisplayName, statusCatalog, type StatusCatalog } from "./status.ts";
import type { TagflowConfigRecord } from "./tagflowTypes.ts";

export const STATUS_ALERT_SENDER = "ADCode Status <noreply@bluethenics.com>";

export type StatusAlertTopic = "models" | "incidents";

/** The model states an alert can announce. `operational` is the all-clear. */
export type WatchedLevel = "operational" | "degraded" | "outage";

/**
 * Fewer turns than this since the last check say nothing about a model. Twice the page's daily
 * floor, because a quarter hour is a much smaller sample than a day.
 */
export const ALERT_MIN_SAMPLE = 10;

/** Good windows in a row before "back to normal" is sent. */
export const RECOVERY_WINDOWS = 2;

/** An alert nobody received within this long is history, not news; it is dropped, not sent late. */
export const ALERT_STALE_MS = 6 * 3_600_000;

export interface ModelWatchRow {
  /** `provider:model`, the status page's own key. */
  modelKey: string;
  name: string;
  /** The UTC day the counts below belong to. */
  day: string;
  /** That day's running totals at the last check: answered plus service failures, and failures. */
  turns: number;
  errors: number;
  /** What subscribers were last told. */
  notified: WatchedLevel;
  goodStreak: number;
  changedAt: number | null;
  checkedAt: number;
}

export interface StatusAlertPayload {
  title: string;
  summary: string;
  /** For model alerts: the level being announced. For incidents: the update's state. */
  status: string;
  url: string;
  /** For model alerts: the measured error rate in the window that triggered it. */
  errorPct?: number;
  model?: string;
}

export interface StatusAlertJob {
  id: string;
  email: string;
  attempts: number;
  topic: StatusAlertTopic;
  subject: string;
  payload: StatusAlertPayload;
  manageToken: string;
}

export interface StatusSubscribeResult {
  /** False when the address is rate limited, suppressed or over the day's confirmation budget. */
  send: boolean;
  confirmToken: string | null;
}

export interface StatusAlertStore {
  subscribe(input: { email: string; models: boolean; incidents: boolean; now: number }): Promise<StatusSubscribeResult>;
  recordConfirmation(email: string, providerId: string): Promise<void>;
  /** "confirmed", "expired" (older than a week) or "invalid". */
  confirm(token: string, now: number): Promise<"confirmed" | "expired" | "invalid">;
  /** By the manage token every alert carries. False when the token matches nobody. */
  unsubscribe(token: string, now: number): Promise<boolean>;
  watchRows(): Promise<ModelWatchRow[]>;
  saveWatchRows(rows: readonly ModelWatchRow[]): Promise<void>;
  /** Queues one alert for every active subscriber of its topic; -1 when that ref was already queued. */
  queueAlert(input: { topic: StatusAlertTopic; ref: string; subject: string; payload: StatusAlertPayload; now: number }): Promise<number>;
  claimAlerts(now: number, limit: number): Promise<StatusAlertJob[]>;
  finishAlert(id: string, result: SendResult, now: number): Promise<void>;
  /** For the admin panel: how many people are on each list. */
  counts(): Promise<{ active: number; models: number; incidents: number; pending: number }>;
}

/* ── The subscribe form ──────────────────────────────────────────────────── */

const EMAIL = /^[^\s@<>()[\]\\,;:"]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
export const STATUS_TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ParsedSubscribe =
  | { ok: true; email: string; models: boolean; incidents: boolean }
  | { ok: false; error: "invalid-email" | "no-topic" | "bot" };

/**
 * The form's fields, from either a plain HTML post (the status page has no client script) or
 * JSON. A checkbox is present when ticked. `website` is a field people never see; a bot that
 * fills every input fills it too, and gets the same "check your inbox" with nothing sent.
 */
export function parseSubscribe(fields: Record<string, unknown>): ParsedSubscribe {
  const flag = (value: unknown): boolean => value === true || value === "on" || value === "true" || value === "1";
  if (typeof fields["website"] === "string" && fields["website"].trim() !== "") return { ok: false, error: "bot" };
  const raw = typeof fields["email"] === "string" ? fields["email"].trim().toLowerCase() : "";
  if (raw.length > 254 || !EMAIL.test(raw)) return { ok: false, error: "invalid-email" };
  const models = flag(fields["models"]), incidents = flag(fields["incidents"]);
  if (!models && !incidents) return { ok: false, error: "no-topic" };
  return { ok: true, email: raw, models, incidents };
}

/* ── Watching model health ───────────────────────────────────────────────── */

export interface ModelTally {
  modelKey: string;
  name: string;
  day: string;
  turns: number;
  errors: number;
}

/** Today's running totals per included model, in the status page's own terms. */
export function tallyToday(outcomes: readonly ModelOutcomeRow[], catalog: StatusCatalog, day: string): ModelTally[] {
  const byKey = new Map<string, ModelTally>();
  for (const row of includedOutcomes(outcomes, catalog)) {
    if (row.day !== day) continue;
    if (row.outcome !== "ok" && !SERVICE_FAILURES.has(row.outcome)) continue;
    const key = `${row.provider}:${row.model}`;
    const tally = byKey.get(key) ?? { modelKey: key, name: catalog?.get(row.model)?.name ?? modelDisplayName(row.model), day, turns: 0, errors: 0 };
    tally.turns += row.count;
    if (row.outcome !== "ok") tally.errors += row.count;
    byKey.set(key, tally);
  }
  return [...byKey.values()];
}

export interface HealthChange {
  to: WatchedLevel;
  from: WatchedLevel;
  /** The error rate in the window that decided it, two decimals. */
  errorPct: number;
  turns: number;
}

/**
 * One model, one check. Pure: the previous row and today's totals in, the next row and any
 * change worth an email out.
 *
 * A first sighting only records a baseline - a deploy, or a model added to the catalog, must not
 * open with an alert. Counts that went down (a new day, a repaired row) start the window from zero.
 */
export function evaluateModelHealth(previous: ModelWatchRow | undefined, current: ModelTally, now: number): { row: ModelWatchRow; change: HealthChange | null } {
  if (previous === undefined) {
    return { row: { ...current, notified: "operational", goodStreak: 0, changedAt: null, checkedAt: now }, change: null };
  }
  const sameDay = previous.day === current.day && current.turns >= previous.turns && current.errors >= previous.errors;
  const turns = sameDay ? current.turns - previous.turns : current.turns;
  const errors = sameDay ? current.errors - previous.errors : current.errors;
  const base = { ...previous, name: current.name, day: current.day, turns: current.turns, errors: current.errors, checkedAt: now };
  if (turns < ALERT_MIN_SAMPLE) return { row: base, change: null };

  const errorPct = Math.round((errors / turns) * 10_000) / 100;
  const level = levelFor(errorPct, turns);
  const observed: WatchedLevel = level === "outage" ? "outage" : level === "degraded" ? "degraded" : "operational";
  const from = previous.notified;

  if (observed === "operational") {
    if (from === "operational") return { row: { ...base, goodStreak: 0 }, change: null };
    const streak = previous.goodStreak + 1;
    if (streak < RECOVERY_WINDOWS) return { row: { ...base, goodStreak: streak }, change: null };
    return { row: { ...base, notified: "operational", goodStreak: 0, changedAt: now }, change: { from, to: "operational", errorPct, turns } };
  }
  // Worse news is sent at once; an outage easing to degraded is still not fixed, so it waits for recovery.
  const rank: Record<WatchedLevel, number> = { operational: 0, degraded: 1, outage: 2 };
  if (rank[observed] > rank[from]) {
    return { row: { ...base, notified: observed, goodStreak: 0, changedAt: now }, change: { from, to: observed, errorPct, turns } };
  }
  return { row: { ...base, goodStreak: 0 }, change: null };
}

/** How a change reads in an email: subject, heading and one plain paragraph. */
export function describeChange(name: string, change: HealthChange): { subject: string; title: string; summary: string } {
  const pct = `${change.errorPct.toFixed(change.errorPct < 10 ? 1 : 0)}%`;
  if (change.to === "operational") {
    return {
      subject: `Resolved: ${name} is back to normal`,
      title: `${name} is back to normal`,
      summary: `Requests to ${name} are answering normally again - ${pct} failed in the latest check. Nothing to do on your side; chats that failed can simply be sent again.`,
    };
  }
  if (change.to === "outage") {
    return {
      subject: `Outage: ${name} is failing requests`,
      title: `${name} is failing most requests`,
      summary: `${pct} of the last ${change.turns.toLocaleString("en-US")} requests to ${name} failed on our side. Pick another free model in ADCode for now; we will email you again when it is back to normal.`,
    };
  }
  return {
    subject: `Degraded: ${name} has elevated errors`,
    title: `${name} is having trouble`,
    summary: `${pct} of the last ${change.turns.toLocaleString("en-US")} requests to ${name} failed on our side - more than usual. Most still work; if a chat fails, send it again or switch models. We will email you when it is back to normal.`,
  };
}

export interface WatchDeps {
  store: {
    modelOutcomesSince(day: string): Promise<ModelOutcomeRow[]>;
    getTagflowConfig?(): Promise<TagflowConfigRecord | null>;
  };
  alerts: StatusAlertStore;
  siteOrigin: string;
  now: number;
}

/**
 * The scheduled check: read today's counts, compare with the last check, save, and queue an
 * alert for every model whose state changed. Returns what it queued, for the Worker's log.
 */
export async function runStatusWatch(deps: WatchDeps): Promise<{ models: number; changes: Array<{ model: string; from: WatchedLevel; to: WatchedLevel; queued: number }> }> {
  const day = utcDay(deps.now);
  const [outcomes, saved, previous] = await Promise.all([
    deps.store.modelOutcomesSince(day),
    deps.store.getTagflowConfig?.().catch(() => null) ?? Promise.resolve(null),
    deps.alerts.watchRows(),
  ]);
  const catalog = statusCatalog(saved);
  const byKey = new Map(previous.map((row) => [row.modelKey, row]));
  const rows: ModelWatchRow[] = [];
  const changes: Array<{ model: string; from: WatchedLevel; to: WatchedLevel; queued: number }> = [];

  for (const tally of tallyToday(outcomes, catalog, day)) {
    const { row, change } = evaluateModelHealth(byKey.get(tally.modelKey), tally, deps.now);
    rows.push(row);
    if (change === null) continue;
    const words = describeChange(tally.name, change);
    const queued = await deps.alerts.queueAlert({
      topic: "models",
      // One alert per model, per change, per check: a retry of the same check cannot send twice.
      ref: `${tally.modelKey}:${change.to}:${String(deps.now - (deps.now % 60_000))}`,
      subject: words.subject,
      payload: { title: words.title, summary: words.summary, status: change.to, url: `${deps.siteOrigin}/status#models`, errorPct: change.errorPct, model: tally.name },
      now: deps.now,
    });
    changes.push({ model: tally.name, from: change.from, to: change.to, queued });
  }
  if (rows.length > 0) await deps.alerts.saveWatchRows(rows);
  return { models: rows.length, changes };
}

/* ── Sending ─────────────────────────────────────────────────────────────── */

/** One Resend send from the status address. No reply-to: nobody reads noreply. */
export async function sendStatusEmail(fetcher: typeof fetch, apiKey: string, idempotencyKey: string, body: Record<string, unknown>): Promise<SendResult> {
  try {
    const response = await fetcher("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: "Bearer " + apiKey, "content-type": "application/json", "Idempotency-Key": idempotencyKey },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({ from: STATUS_ALERT_SENDER, ...body }),
    });
    if (response.ok) {
      const data = await response.json() as { id?: string };
      return typeof data.id === "string" ? { providerId: data.id } : { retry: true, code: "invalid-provider-response" };
    }
    return { retry: response.status === 429 || response.status >= 500, code: "provider-" + response.status };
  } catch {
    return { retry: true, code: "provider-timeout" };
  }
}

export function statusUnsubscribeUrl(origin: string, manageToken: string): string {
  return `${origin}/v1/status/unsubscribe?token=${encodeURIComponent(manageToken)}`;
}

export interface StatusAlertMailerOptions {
  alerts: StatusAlertStore;
  settings(): Promise<{ enabled: boolean; postalAddress: string | null; senderVerified: boolean }>;
  apiKey?: string;
  siteOrigin: string;
  render(job: StatusAlertJob, unsubscribeUrl: string, postalAddress: string): Promise<RenderedMail>;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/** A bounded batch, the same shape as the announcement sender; the database owns leases and the daily cap. */
export async function runStatusAlertBatch(options: StatusAlertMailerOptions): Promise<{ status: string; sent: number; failed: number }> {
  const settings = await options.settings();
  if (!settings.enabled) return { status: "disabled", sent: 0, failed: 0 };
  if (!options.apiKey || !settings.postalAddress || settings.postalAddress.trim().length < 10) return { status: "configuration-required", sent: 0, failed: 0 };
  if (!settings.senderVerified) return { status: "domain-not-verified", sent: 0, failed: 0 };
  const origin = new URL(options.siteOrigin);
  if (origin.protocol !== "https:") return { status: "https-required", sent: 0, failed: 0 };
  const fetcher = options.fetchImpl ?? fetch, now = options.now ?? Date.now;
  const jobs = await options.alerts.claimAlerts(now(), 10);
  let sent = 0, failed = 0;
  for (const job of jobs) {
    const unsubscribeUrl = statusUnsubscribeUrl(origin.origin, job.manageToken);
    const mail = await options.render(job, unsubscribeUrl, settings.postalAddress);
    const outcome = await sendStatusEmail(fetcher, options.apiKey, "status-alert/" + job.id, {
      to: [job.email], ...mail,
      headers: { "List-Unsubscribe": "<" + unsubscribeUrl + ">", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      tags: [{ name: "campaign", value: "status-" + job.topic }],
    });
    await options.alerts.finishAlert(job.id, outcome, now());
    if ("providerId" in outcome) sent += 1;
    else failed += 1;
    if (!("providerId" in outcome) && outcome.code === "provider-429") break;
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
  return { status: "complete", sent, failed };
}

/**
 * The confirmation email, sent at once from the request that asked for it. It is the only email
 * an unconfirmed address can ever receive, so it needs the verified sender but not the bulk
 * sending switch; the store has already applied every rate limit.
 */
export async function sendStatusConfirmation(
  options: { apiKey?: string; senderVerified: boolean; fetchImpl?: typeof fetch },
  input: { email: string; confirmToken: string; mail: RenderedMail },
): Promise<SendResult> {
  if (!options.apiKey) return { retry: false, code: "configuration-required" };
  if (!options.senderVerified) return { retry: false, code: "domain-not-verified" };
  return sendStatusEmail(options.fetchImpl ?? fetch, options.apiKey, "status-confirm/" + input.confirmToken + "/" + String(Math.floor(Date.now() / 120_000)), {
    to: [input.email], ...input.mail, tags: [{ name: "campaign", value: "status-confirm" }],
  });
}
