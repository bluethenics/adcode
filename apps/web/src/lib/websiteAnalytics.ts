/** Only this small, explicit event vocabulary can leave the browser. */
export type WebsiteEventName = "page_view" | "install_copy" | "download_click" | "advertise_click" | "sign_in" | "sign_up" | "advertiser_created" | "campaign_created" | "support_sent" | "outbound_click" | "scroll_50" | "scroll_90" | "engagement" | "js_error" | "LCP" | "CLS" | "INP" | "FCP" | "TTFB";
export type AnalyticsChoice = "accepted" | "declined";
const consentKey = "adcode.website-analytics";
const sessionKey = "adcode.website-session";
interface Event { id: string; session: string; name: WebsiteEventName; path: string; source: string; campaign: string; device: string; value: number }
let queue: Event[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let volatileSession: { id: string; source: string; campaign: string; last: number } | undefined;
export function analyticsChoice(): AnalyticsChoice | null {
  if (typeof window === "undefined") return null;
  if (navigator.doNotTrack === "1" || (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl) return "declined";
  try { const value = localStorage.getItem(consentKey); return value === "accepted" || value === "declined" ? value : null; } catch { return null; }
}
export function setAnalyticsChoice(choice: AnalyticsChoice) {
  try { localStorage.setItem(consentKey, choice); } catch { /* Storage disabled: remain opted out. */ }
  if (choice === "declined") {
    queue = []; volatileSession = undefined;
    if (timer) clearTimeout(timer);
    timer = undefined;
    try { sessionStorage.removeItem(sessionKey); } catch { /* optional storage */ }
  }
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
function session() {
  const now = Date.now();
  if (!volatileSession) {
    try {
      const saved = JSON.parse(sessionStorage.getItem(sessionKey) ?? "null");
      if (saved && typeof saved.id === "string" && typeof saved.last === "number" && typeof saved.source === "string" && typeof saved.campaign === "string") volatileSession = saved;
    } catch { /* optional storage */ }
  }
  if (!volatileSession || now - volatileSession.last > 30 * 60000) {
    const query = new URLSearchParams(location.search);
    let source = token(query.get("utm_source"));
    if (!source) {
      try { const ref = new URL(document.referrer); source = ref.origin === location.origin ? "direct" : token(ref.hostname); } catch { /* direct visit */ }
    }
    volatileSession = { id: crypto.randomUUID(), source: source || "direct", campaign: token(query.get("utm_campaign")), last: now };
  }
  volatileSession.last = now;
  try { sessionStorage.setItem(sessionKey, JSON.stringify(volatileSession)); } catch { /* in-memory session works */ }
  return volatileSession;
}
export function flushWebsiteAnalytics() {
  if (timer) clearTimeout(timer);
  timer = undefined;
  if (analyticsChoice() !== "accepted") { queue = []; return; }
  const batch = queue.splice(0, 20);
  if (!batch.length) return;
  const body = JSON.stringify(batch);
  // No auth token, cookies, or unbounded retry queue. Telemetry cannot block the page.
  void fetch("/v1/website-events", { method: "POST", headers: { "content-type": "application/json" }, credentials: "omit", referrerPolicy: "no-referrer", body, keepalive: true }).catch(() => {});
}
export function trackWebsiteEvent(name: WebsiteEventName, value = 0, pathOverride?: string) {
  try {
    if (analyticsChoice() !== "accepted") return;
    const path = analyticsPath(pathOverride ?? location.pathname);
    if (!path || !Number.isFinite(value)) return;
    const visit = session();
    if (queue.length && queue[0]?.session !== visit.id) flushWebsiteAnalytics();
    const ua = navigator.userAgent;
    const device = /ipad|tablet/i.test(ua) ? "tablet" : /mobi|android/i.test(ua) ? "mobile" : "desktop";
    queue.push({ id: crypto.randomUUID(), session: visit.id, name, path, source: visit.source, campaign: visit.campaign, device, value: Math.max(0, Math.min(value, 3600000)) });
    if (queue.length >= 20) flushWebsiteAnalytics();
    else if (!timer) timer = setTimeout(flushWebsiteAnalytics, 3000);
  } catch { /* Analytics must never break an action. */ }
}

export interface WebsiteAnalyticsReport {
  start: number; end: number; truncated: boolean; totalEvents: number; pageViews: number; sessions: number; installSessions: number; errorCount: number; engagementSeconds: number;
  daily: { day: string; views: number; sessions: number }[];
  funnels: { label: string; steps: { label: string; sessions: number; lost: number }[] }[];
  pages: Ranking[]; sources: Ranking[]; campaigns: Ranking[]; devices: Ranking[]; events: Ranking[];
  metrics: { name: string; samples: number; p75: number | null }[];
}
export interface Ranking { label: string; count: number }
