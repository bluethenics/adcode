import { campaignFor } from "./invite";
/** Only this small, explicit event vocabulary can leave the browser. */
export type WebsiteEventName = "page_view" | "install_copy" | "download_click" | "send_to_desktop" | "advertise_click" | "sign_in" | "sign_up" | "advertiser_created" | "campaign_created" | "support_sent" | "outbound_click" | "scroll_50" | "scroll_90" | "engagement" | "js_error" | "LCP" | "CLS" | "INP" | "FCP" | "TTFB";
export type WebVitalName = "LCP" | "CLS" | "INP" | "FCP" | "TTFB";
export type AnalyticsChoice = "accepted" | "declined";
const consentKey = "adcode.website-analytics";
const sessionKey = "adcode.website-session";
const outboxKey = "adcode.website-outbox";
const excludeKey = "adcode.website-analytics-exclude";
/** A visit ends after this long with nobody doing anything. */
const SESSION_MS = 30 * 60000;
/** Undelivered events kept for retry, across reloads of the tab. Bounded: telemetry never grows without limit. */
const MAX_PENDING = 100;
const MAX_ATTEMPTS = 4;
/** The service refuses events older than a day; so does the outbox. */
const MAX_AGE_MS = 86_400_000;
/**
 * Events that describe something already over - time spent, page speed, a script error. They
 * belong to the visit they measured: they never keep a visit alive or start a new one.
 */
const PASSIVE: ReadonlySet<WebsiteEventName> = new Set(["engagement", "js_error", "LCP", "CLS", "INP", "FCP", "TTFB"]);
interface QueuedEvent { id: string; session: string; name: WebsiteEventName; path: string; source: string; campaign: string; device: string; value: number; placement?: string; /** When it happened, by this device's clock. Only the age is sent. */ at: number }
interface Pending { event: QueuedEvent; attempts: number; sending: boolean }
interface Visit { id: string; source: string; campaign: string; last: number; /** Keys of events recorded once per visit. */ once?: string[] }
let pending: Pending[] = [];
let loaded = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let retryAt = 0;
let volatileSession: Visit | undefined;
/** Each Web Vital's metric id, and the event first sent for it. A later value re-sends that event. */
let vitals = new Map<string, QueuedEvent>();

export function analyticsChoice(): AnalyticsChoice | null {
  if (typeof window === "undefined") return null;
  if (navigator.doNotTrack === "1" || (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl) return "declined";
  try { const value = localStorage.getItem(consentKey); return value === "accepted" || value === "declined" ? value : null; } catch { return null; }
}

/**
 * Whether this browser is left out of the numbers whatever its consent: an automated browser
 * (a setup check, a smoke test, a crawler) or one an administrator excluded - their own visits
 * are not an audience.
 */
export function browserExcluded(): boolean {
  if (typeof window === "undefined") return true;
  if ((navigator as Navigator & { webdriver?: boolean }).webdriver === true) return true;
  if (/[a-z]bot[/;)-]|\bbot\b|crawl|spider|headless|lighthouse/i.test(navigator.userAgent ?? "")) return true;
  try { return localStorage.getItem(excludeKey) === "1"; } catch { return false; }
}

/** An explicit choice for this browser, from Admin > Analytics. */
export function setBrowserExcluded(excluded: boolean) {
  try { localStorage.setItem(excludeKey, excluded ? "1" : "0"); } catch { /* Storage disabled: nothing to remember. */ }
  if (excluded) forget();
  window.dispatchEvent(new Event("website-analytics-choice"));
}

/** Leaves an administrator's browser out unless somebody already chose for it - signing in again must not undo "count this browser". */
export function excludeBrowserByDefault() {
  try { if (localStorage.getItem(excludeKey) === null) setBrowserExcluded(true); } catch { /* Storage disabled: nothing to remember. */ }
}

const collecting = () => analyticsChoice() === "accepted" && !browserExcluded();

/** Drops everything queued and the visit itself. */
function forget() {
  pending = []; volatileSession = undefined; vitals = new Map();
  if (timer) clearTimeout(timer);
  timer = undefined;
  try { sessionStorage.removeItem(sessionKey); sessionStorage.removeItem(outboxKey); } catch { /* optional storage */ }
}

export function setAnalyticsChoice(choice: AnalyticsChoice) {
  try { localStorage.setItem(consentKey, choice); } catch { /* Storage disabled: remain opted out. */ }
  if (choice === "declined") forget();
  window.dispatchEvent(new Event("website-analytics-choice"));
}
export function analyticsPath(path: string): string | null {
  const clean = path.split(/[?#]/)[0] ?? "/";
  if (/^\/(admin|v1|assets)(\/|$)/.test(clean)) return null;
  if (/^\/portal\/campaigns\//.test(clean) && clean !== "/portal/campaigns/new") return "/portal/campaigns/detail";
  if (clean.length > 160 || !/^\/(?:[a-z0-9-]+\/?)*$/.test(clean)) return null;
  return clean;
}
const token = (value: string | null) => value && /^[a-zA-Z0-9._-]{1,80}$/.test(value) ? value : "";

/**
 * Which growth loop an invite link came from. The editor tags each place it hands out a
 * link (`?from=build`, `readme`, `collab`, `x`...), the dashboard tags its own, and the
 * advertiser pitch says `?for=ads`. Read only on invite pages, where those parameters
 * mean that, and ahead of the referrer: a README link opened from github.com is the README
 * loop working, not GitHub sending traffic. Admin > Growth > Loops counts visits by it.
 */
export function inviteLoopSource(pathname: string, query: URLSearchParams): string {
  if (!/^\/i\/[a-z0-9-]+\/?$/i.test(pathname)) return "";
  return token(query.get("from")) || (query.get("for") === "ads" ? "advertiser-pitch" : "");
}

function attribution(): { source: string; campaign: string } {
  const query = new URLSearchParams(location.search);
  let source = token(query.get("utm_source")) || inviteLoopSource(location.pathname, query);
  if (!source) {
    try { const ref = new URL(document.referrer); source = ref.origin === location.origin ? "" : token(ref.hostname); } catch { /* direct visit */ }
  }
  // An invite page counts for its own code unless a utm_campaign says otherwise.
  return { source: source || "direct", campaign: campaignFor(location.pathname, token(query.get("utm_campaign"))) };
}
/**
 * Where this page load came from, read as the page opens. It stays in memory - nothing is
 * stored or sent until analytics is allowed - but it outlives navigation: somebody who arrived
 * from a tagged post and clicked around before answering the consent banner used to be counted
 * as "direct", because by then the address bar no longer carried the tag.
 */
let landing: { source: string; campaign: string } | undefined;
try { if (typeof window !== "undefined") landing = attribution(); } catch { /* attribution is optional */ }

function loadSession(): Visit | undefined {
  if (!volatileSession) {
    try {
      const saved = JSON.parse(sessionStorage.getItem(sessionKey) ?? "null");
      if (saved && typeof saved.id === "string" && typeof saved.last === "number" && typeof saved.source === "string" && typeof saved.campaign === "string") volatileSession = saved;
    } catch { /* optional storage */ }
  }
  return volatileSession;
}
function saveSession() {
  try { sessionStorage.setItem(sessionKey, JSON.stringify(volatileSession)); } catch { /* in-memory session works */ }
}
/**
 * The visit an event belongs to. Something a person did keeps the visit alive, and after 30
 * idle minutes starts a new one; a passive measurement joins whichever visit it measured.
 */
function session(now: number, active: boolean): { visit: Visit; started: boolean } {
  const current = loadSession();
  if (current && (!active || now - current.last <= SESSION_MS)) {
    if (active) { current.last = now; saveSession(); }
    return { visit: current, started: false };
  }
  const from = landing ?? attribution();
  volatileSession = { id: crypto.randomUUID(), source: from.source, campaign: from.campaign, last: now };
  saveSession();
  return { visit: volatileSession, started: true };
}

/** Somebody is still here - a scroll, a click, a key - so the visit is not idle, though nothing was recorded. */
export function touchWebsiteSession() {
  try {
    if (!collecting()) return;
    const current = loadSession(), now = Date.now();
    // At most every 15 seconds: this runs on scroll and pointer movement.
    if (current && now - current.last <= SESSION_MS && now - current.last > 15000) { current.last = now; saveSession(); }
  } catch { /* Analytics must never break an action. */ }
}

function load() {
  if (loaded) return;
  loaded = true;
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(outboxKey) ?? "[]");
    if (!Array.isArray(saved)) return;
    for (const item of saved as { event?: QueuedEvent; attempts?: number }[]) {
      if (item?.event && typeof item.event.id === "string" && typeof item.event.at === "number" && typeof item.attempts === "number") pending.push({ event: item.event, attempts: item.attempts, sending: false });
    }
  } catch { /* optional storage */ }
}
/**
 * The outbox outlives the page, so a batch still in flight when the tab reloads or navigates
 * is sent again from the next page. The service keeps the first copy of each event id, so a
 * batch that did arrive is not counted twice.
 */
function persist() {
  try {
    if (pending.length) sessionStorage.setItem(outboxKey, JSON.stringify(pending.map(({ event, attempts }) => ({ event, attempts }))));
    else sessionStorage.removeItem(outboxKey);
  } catch { /* in-memory queue works */ }
}
function schedule(ms: number) {
  if (!timer) timer = setTimeout(flushWebsiteAnalytics, ms);
}
function enqueue(event: QueuedEvent) {
  load();
  pending.push({ event, attempts: 0, sending: false });
  // Oldest first out when the bound is hit: a long outage loses its earliest events, not its latest.
  if (pending.length > MAX_PENDING) pending = pending.slice(-MAX_PENDING);
}
function settle(batch: Pending[], delivered: boolean) {
  if (delivered) {
    pending = pending.filter((item) => !batch.includes(item));
    retryAt = 0;
  } else {
    for (const item of batch) { item.sending = false; item.attempts += 1; }
    pending = pending.filter((item) => item.attempts < MAX_ATTEMPTS);
    const attempts = Math.max(...batch.map((item) => item.attempts));
    retryAt = Date.now() + Math.min(60000, 2000 * 3 ** attempts);
    if (pending.some((item) => !item.sending)) schedule(retryAt - Date.now());
  }
  persist();
}
function send(batch: Pending[], now: number) {
  for (const item of batch) item.sending = true;
  // An age, not a timestamp: the service subtracts it from its own clock, so a device clock
  // that is hours wrong still puts its events in the right order.
  const body = JSON.stringify(batch.map(({ event: { at, ...event } }) => ({ ...event, age: Math.max(0, Math.min(now - at, MAX_AGE_MS)) })));
  // No auth token or cookies. Telemetry cannot block the page.
  void fetch("/v1/website-events", { method: "POST", headers: { "content-type": "application/json" }, credentials: "omit", referrerPolicy: "no-referrer", body, keepalive: true })
    // Delivered, or refused for good (a malformed batch will not improve by resending it).
    // Network failures, rate limits and server errors are retried with backoff.
    .then((response) => settle(batch, response.ok || (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429)))
    .catch(() => settle(batch, false));
}
export function flushWebsiteAnalytics() {
  if (timer) clearTimeout(timer);
  timer = undefined;
  try {
    if (!collecting()) { pending = []; persist(); return; }
    load();
    const now = Date.now();
    pending = pending.filter((item) => item.sending || now - item.event.at < MAX_AGE_MS);
    if (now < retryAt) { schedule(retryAt - now); return; }
    // A batch is one visit (the service refuses mixed ones) and at most twenty events. Up to
    // five go at once, which empties the queue when the page is being left.
    for (let sent = 0; sent < 5; sent += 1) {
      const ready = pending.filter((item) => !item.sending);
      const first = ready[0];
      if (first === undefined) break;
      send(ready.filter((item) => item.event.session === first.event.session).slice(0, 20), now);
    }
    persist();
  } catch { /* Analytics must never break an action. */ }
}

function build(visit: Visit, name: WebsiteEventName, path: string, value: number, at: number, placement?: string): QueuedEvent {
  const ua = navigator.userAgent;
  const device = /ipad|tablet/i.test(ua) ? "tablet" : /mobi|android/i.test(ua) ? "mobile" : "desktop";
  const where = placement !== undefined && /^[a-z0-9-]{1,40}$/.test(placement) ? { placement } : {};
  return { id: crypto.randomUUID(), session: visit.id, name, path, source: visit.source, campaign: visit.campaign, device, value: Math.max(0, Math.min(value, 3600000)), ...where, at };
}
function record(name: WebsiteEventName, value: number, pathOverride: string | undefined, placement: string | undefined, once?: string): QueuedEvent | undefined {
  if (!collecting()) return undefined;
  const path = analyticsPath(pathOverride ?? location.pathname);
  if (!path || !Number.isFinite(value)) return undefined;
  const now = Date.now();
  const { visit, started } = session(now, !PASSIVE.has(name));
  if (once !== undefined && visit.once?.includes(once)) return undefined;
  // Every session starts with a page view. A visit that resumed after half an hour idle is a
  // new session, and without one the install or campaign that resumed it was invisible to
  // every funnel - each of which starts from a page view or an entry.
  if (started && name !== "page_view" && !PASSIVE.has(name)) {
    const here = analyticsPath(location.pathname);
    if (here) enqueue(build(visit, "page_view", here, 0, now));
  }
  const event = build(visit, name, path, value, now, placement);
  enqueue(event);
  if (once !== undefined) { visit.once = [...(visit.once ?? []), once].slice(-20); saveSession(); }
  if (pending.filter((item) => !item.sending).length >= 20) flushWebsiteAnalytics();
  else schedule(3000);
  return event;
}

/** `placement` names the button an action came from ("hero", "closing"), so each install button is measured on its own. */
export function trackWebsiteEvent(name: WebsiteEventName, value = 0, pathOverride?: string, placement?: string) {
  try { record(name, value, pathOverride, placement); } catch { /* Analytics must never break an action. */ }
}

/**
 * Records `name` once per visit under `key` - an entry step that a long form passes through
 * many times, say. A new visit (after 30 idle minutes, or new consent) records it again, so the
 * step that follows always has its entry in the same session.
 */
export function trackWebsiteEventOnce(key: string, name: WebsiteEventName, placement?: string) {
  try { record(name, 0, undefined, placement, key); } catch { /* Analytics must never break an action. */ }
}

/**
 * A Web Vital, keyed by the metric's own id. CLS and INP can change after their first report
 * (a late layout shift, a slower interaction); a later value is sent again under the first
 * event's id and replaces it, so the report describes the whole visit rather than its start.
 */
export function trackWebsiteVital(name: WebVitalName, value: number, path: string, metricId: string) {
  try {
    if (!collecting() || !Number.isFinite(value)) return;
    const clamped = Math.max(0, Math.min(value, 3600000));
    const previous = vitals.get(metricId);
    if (previous === undefined) {
      const event = record(name, value, path, undefined);
      if (event) vitals.set(metricId, event);
      return;
    }
    if (previous.value === clamped) return;
    const update = { ...previous, value: clamped, at: Date.now() };
    vitals.set(metricId, update);
    load();
    const queued = pending.find((item) => item.event.id === previous.id && !item.sending);
    if (queued) queued.event = update;
    else enqueue(update);
    persist();
    schedule(3000);
  } catch { /* Analytics must never break an action. */ }
}

// Events a previous page in this tab could not confirm are sent again.
try {
  if (typeof window !== "undefined" && collecting()) {
    load();
    if (pending.length) schedule(1000);
  }
} catch { /* optional storage */ }

export interface WebsiteAnalyticsReport {
  start: number; end: number; truncated: boolean; totalEvents: number; pageViews: number; sessions: number; installSessions: number; errorCount: number; engagementSeconds: number;
  daily: { day: string; views: number; sessions: number }[];
  funnels: { label: string; steps: { label: string; sessions: number; lost: number }[] }[];
  pages: Ranking[]; sources: Ranking[]; campaigns: Ranking[]; devices: Ranking[]; events: Ranking[];
  /** Install actions by the button they came from. Absent from a server older than the placement change. */
  placements?: Ranking[];
  /** Invite-page visits by the loop that sent them (`?from=`). Absent from a server older than Growth > Loops. */
  invitePages?: Ranking[];
  metrics: { name: string; samples: number; p75: number | null }[];
}
export interface Ranking { label: string; count: number }
