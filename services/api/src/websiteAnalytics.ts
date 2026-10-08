/** Website-only telemetry. Never accepts account identifiers or free-form content. */
export const WEBSITE_EVENTS = ["page_view", "install_copy", "download_click", "send_to_desktop", "advertise_click", "sign_in", "sign_up", "advertiser_created", "campaign_created", "support_sent", "outbound_click", "scroll_50", "scroll_90", "engagement", "js_error", "LCP", "CLS", "INP", "FCP", "TTFB"] as const;
/** Page-speed metrics. CLS and INP can change during a visit, so a later report replaces an earlier one with the same id. */
export const WEB_VITALS: readonly string[] = ["LCP", "CLS", "INP", "FCP", "TTFB"];
export interface WebsiteEvent {
  id: string; session: string; name: string; path: string;
  source: string; campaign: string; device: string; value: number; receivedAt: number;
  /** When it happened: arrival minus the age the browser reported. Equal to `receivedAt` for rows older than the age field. */
  occurredAt: number;
  /** Which button on the page it came from ("hero", "closing"), or "" when it was not a button. */
  placement?: string;
}
export interface WebsiteAnalyticsStore {
  append(events: WebsiteEvent[]): Promise<void>;
  read(start: number, end: number): Promise<{ events: WebsiteEvent[]; truncated: boolean }>;
}
/** The oldest event a browser may still deliver: it retries a failed batch, but not for ever. */
export const MAX_EVENT_AGE_MS = 86_400_000;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const keys = new Set(["id", "session", "name", "path", "source", "campaign", "device", "value", "placement", "age"]);
export function parseWebsiteEvents(raw: unknown, now: number): WebsiteEvent[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 20) return null;
  const result: WebsiteEvent[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Object.keys(item).some((key) => !keys.has(key))) return null;
    const e = item as { [Key in keyof WebsiteEvent | "age"]?: unknown };
    if (typeof e.id !== "string" || !uuid.test(e.id) || typeof e.session !== "string" || !uuid.test(e.session) ||
        typeof e.name !== "string" || !(WEBSITE_EVENTS as readonly string[]).includes(e.name) ||
        typeof e.path !== "string" || e.path.length > 160 || !/^\/(?:[a-z0-9-]+\/?)*$/.test(e.path) || /^\/(admin|v1|assets)(\/|$)/.test(e.path) ||
        (/^\/portal\/campaigns\//.test(e.path) && !["/portal/campaigns/new", "/portal/campaigns/detail"].includes(e.path)) ||
        typeof e.source !== "string" || !/^[a-zA-Z0-9._-]{1,80}$/.test(e.source) ||
        typeof e.campaign !== "string" || !/^[a-zA-Z0-9._-]{0,80}$/.test(e.campaign) ||
        typeof e.device !== "string" || !["desktop", "mobile", "tablet"].includes(e.device) || typeof e.value !== "number" || !Number.isFinite(e.value) || e.value < 0 || e.value > 3600000 ||
        (e.placement !== undefined && (typeof e.placement !== "string" || !/^[a-z0-9-]{0,40}$/.test(e.placement))) ||
        (e.age !== undefined && (typeof e.age !== "number" || !Number.isFinite(e.age) || e.age < 0 || e.age > MAX_EVENT_AGE_MS))) return null;
    // A duration, not a timestamp, crosses the wire: a device clock that is hours wrong
    // still orders its own events correctly.
    const occurredAt = now - Math.round(typeof e.age === "number" ? e.age : 0);
    result.push({ id: e.id, session: e.session, name: e.name, path: e.path, source: e.source, campaign: e.campaign, device: String(e.device), value: e.value, receivedAt: now, occurredAt, placement: typeof e.placement === "string" ? e.placement : "" });
  }
  return result;
}

/** Automated browsers and crawlers: a setup check, a link preview or a bot is not a visitor. */
export function isAutomatedAgent(userAgent: string | null | undefined): boolean {
  // "Googlebot/2.1", "Slackbot-LinkExpanding", "bot;" - but not a phone called CUBOT.
  return /[a-z]bot[/;)-]|\bbot\b|crawl|spider|slurp|headless|lighthouse|pagespeed|facebookexternalhit|embedly|playwright|puppeteer|selenium|phantomjs/i.test(userAgent ?? "");
}

/**
 * One name per channel. A source is a `utm_source` or a referring hostname, so the same
 * place arrives under several spellings - X as `x`, `twitter`, `t.co`; Threads as `threads`
 * and `l.threads.com` - and a ranking that split them under-counted every one. Applied when
 * the report is built, so it also merges events recorded before this list existed.
 */
const CHANNELS: [RegExp, string][] = [
  [/^(x|twitter|x\.com|twitter\.com|mobile\.twitter\.com|mobile\.x\.com|t\.co|tweetdeck\.twitter\.com|pro\.x\.com)$/, "x"],
  [/^(threads|threads\.net|threads\.com|l\.threads\.net|l\.threads\.com)$/, "threads"],
  [/^(facebook|fb|facebook\.com|m\.facebook\.com|l\.facebook\.com|lm\.facebook\.com|web\.facebook\.com|fb\.me)$/, "facebook"],
  [/^(instagram|ig|instagram\.com|l\.instagram\.com)$/, "instagram"],
  [/^(linkedin|linkedin\.com|lnkd\.in)$/, "linkedin"],
  [/^(reddit|reddit\.com|old\.reddit\.com|out\.reddit\.com|new\.reddit\.com)$/, "reddit"],
  [/^(hn|hackernews|hacker-news|news\.ycombinator\.com)$/, "hacker-news"],
  [/^(youtube|youtube\.com|m\.youtube\.com|youtu\.be)$/, "youtube"],
  [/^(github|github\.com)$/, "github"],
  [/^(google|google\.[a-z.]+|[a-z]+\.google\.[a-z.]+)$/, "google"],
  [/^(bing|bing\.com|cn\.bing\.com)$/, "bing"],
  [/^(duckduckgo|duckduckgo\.com)$/, "duckduckgo"],
  [/^(microsoft-store|apps\.microsoft\.com|microsoft\.com)$/, "microsoft-store"],
];
export function channel(source: string): string {
  const clean = source.toLowerCase().replace(/^(www\.|m\.)(?=[a-z0-9-]+\.)/, "");
  for (const [pattern, name] of CHANNELS) if (pattern.test(clean)) return name;
  return clean || "direct";
}

export function summarizeWebsiteEvents(input: WebsiteEvent[], start: number, end: number, truncated: boolean) {
  // Periods and order are by when an event happened; rows from before the age field have only an arrival time.
  const at = (e: WebsiteEvent) => e.occurredAt ?? e.receivedAt;
  const events = [...new Map(input.filter(e => at(e) >= start && at(e) < end).map(e => [e.id, e])).values()];
  const views = events.filter(e => e.name === "page_view");
  const sessions = (items: WebsiteEvent[]) => new Set(items.map(e => e.session)).size;
  const rank = (items: WebsiteEvent[], field: "path" | "source" | "campaign" | "device" | "name" | "placement") => {
    const counts = new Map<string, number>();
    for (const e of items) { const key = (field === "source" ? channel(e.source) : e[field]) || "(none)"; counts.set(key, (counts.get(key) ?? 0) + 1); }
    return [...counts].map(([label, count]) => ({ label, count })).sort((a,b) => b.count - a.count).slice(0, 20);
  };
  const daily = [];
  for (let t = start; t < end; t += 86400000) {
    const dayViews = views.filter(e => at(e) >= t && at(e) < t + 86400000);
    daily.push({ day: new Date(t).toISOString().slice(0, 10), views: dayViews.length, sessions: sessions(dayViews) });
  }
  const metrics = WEB_VITALS.map(name => {
    const values = events.filter(e => e.name === name).map(e => e.value).sort((a,b) => a-b);
    return { name, samples: values.length, p75: values.length ? values[Math.ceil(values.length * .75) - 1]! : null };
  });
  const sessionViews = new Set(views.map(e => e.session));
  const installSessions = sessions(events.filter(e => ["install_copy", "download_click"].includes(e.name) && sessionViews.has(e.session)));
  const funnel = (label: string, stages: { label: string; matches: (event: WebsiteEvent) => boolean }[]) => {
    let eligible = new Map<string, number>();
    const steps = stages.map((stage, index) => {
      const next = new Map<string, number>();
      for (const event of events) {
        if (!stage.matches(event)) continue;
        const previous = eligible.get(event.session);
        if (index > 0 && (previous === undefined || at(event) < previous)) continue;
        next.set(event.session, Math.min(next.get(event.session) ?? Infinity, at(event)));
      }
      const lost = index === 0 ? 0 : eligible.size - next.size;
      eligible = next;
      return { label: stage.label, sessions: next.size, lost };
    });
    return { label, steps };
  };
  const funnels = [
    funnel("Install journey", [{ label: "Visited website", matches: e => e.name === "page_view" }, { label: "Copied install or clicked download", matches: e => ["install_copy", "download_click"].includes(e.name) }]),
    funnel("Advertiser journey", [{ label: "Entered advertiser flow", matches: e => e.name === "advertise_click" || (e.name === "page_view" && ["/portal", "/portal/campaigns/new"].includes(e.path)) }, { label: "Created campaign", matches: e => e.name === "campaign_created" }]),
    funnel("Installation pages", [{ label: "Viewed install page or installation guide", matches: e => e.name === "page_view" && ["/versions", "/docs/installing-adcode"].includes(e.path) }, { label: "Copied install or clicked download", matches: e => ["install_copy", "download_click"].includes(e.name) }]),
  ];
  return { start, end, truncated, totalEvents: events.length, pageViews: views.length, sessions: sessions(views), installSessions,
    errorCount: events.filter(e => e.name === "js_error").length,
    engagementSeconds: Math.round(events.filter(e => e.name === "engagement").reduce((n,e) => n + e.value, 0) / 1000),
    daily, funnels, pages: rank(views, "path"), sources: rank(views, "source"), campaigns: rank(views, "campaign"), devices: rank(views, "device"), events: rank(events.filter(e => !["page_view", "engagement", ...WEB_VITALS].includes(e.name)), "name"), metrics,
    // Install actions by the button they came from: each install button judged on its own.
    placements: rank(events.filter(e => ["download_click", "install_copy", "send_to_desktop"].includes(e.name)), "placement"),
    // Invite-page visits by the loop that handed the link out (the page reads `?from=` as the source).
    invitePages: rank(views.filter(e => /^\/i\/[^/]+\/?$/.test(e.path)), "source") };
}
