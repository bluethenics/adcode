/** Website-only telemetry. Never accepts account identifiers or free-form content. */
export const WEBSITE_EVENTS = ["page_view", "install_copy", "download_click", "advertise_click", "sign_in", "sign_up", "advertiser_created", "campaign_created", "support_sent", "outbound_click", "scroll_50", "scroll_90", "engagement", "js_error", "LCP", "CLS", "INP", "FCP", "TTFB"] as const;
export interface WebsiteEvent {
  id: string; session: string; name: string; path: string;
  source: string; campaign: string; device: string; value: number; receivedAt: number;
}
export interface WebsiteAnalyticsStore {
  append(events: WebsiteEvent[]): Promise<void>;
  read(start: number, end: number): Promise<{ events: WebsiteEvent[]; truncated: boolean }>;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const keys = new Set(["id", "session", "name", "path", "source", "campaign", "device", "value"]);
export function parseWebsiteEvents(raw: unknown, now: number): WebsiteEvent[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 20) return null;
  const result: WebsiteEvent[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Object.keys(item).some((key) => !keys.has(key))) return null;
    const e = item as { [Key in keyof WebsiteEvent]?: unknown };
    if (typeof e.id !== "string" || !uuid.test(e.id) || typeof e.session !== "string" || !uuid.test(e.session) ||
        typeof e.name !== "string" || !(WEBSITE_EVENTS as readonly string[]).includes(e.name) ||
        typeof e.path !== "string" || e.path.length > 160 || !/^\/(?:[a-z0-9-]+\/?)*$/.test(e.path) || /^\/(admin|v1|assets)(\/|$)/.test(e.path) ||
        (/^\/portal\/campaigns\//.test(e.path) && !["/portal/campaigns/new", "/portal/campaigns/detail"].includes(e.path)) ||
        typeof e.source !== "string" || !/^[a-zA-Z0-9._-]{1,80}$/.test(e.source) ||
        typeof e.campaign !== "string" || !/^[a-zA-Z0-9._-]{0,80}$/.test(e.campaign) ||
        typeof e.device !== "string" || !["desktop", "mobile", "tablet"].includes(e.device) || typeof e.value !== "number" || !Number.isFinite(e.value) || e.value < 0 || e.value > 3600000) return null;
    result.push({ id: e.id, session: e.session, name: e.name, path: e.path, source: e.source, campaign: e.campaign, device: String(e.device), value: e.value, receivedAt: now });
  }
  return result;
}
export function summarizeWebsiteEvents(input: WebsiteEvent[], start: number, end: number, truncated: boolean) {
  const events = [...new Map(input.filter(e => e.receivedAt >= start && e.receivedAt < end).map(e => [e.id, e])).values()];
  const views = events.filter(e => e.name === "page_view");
  const sessions = (items: WebsiteEvent[]) => new Set(items.map(e => e.session)).size;
  const rank = (items: WebsiteEvent[], field: "path" | "source" | "campaign" | "device" | "name") => {
    const counts = new Map<string, number>();
    for (const e of items) { const key = e[field] || "(none)"; counts.set(key, (counts.get(key) ?? 0) + 1); }
    return [...counts].map(([label, count]) => ({ label, count })).sort((a,b) => b.count - a.count).slice(0, 20);
  };
  const daily = [];
  for (let t = start; t < end; t += 86400000) {
    const dayViews = views.filter(e => e.receivedAt >= t && e.receivedAt < t + 86400000);
    daily.push({ day: new Date(t).toISOString().slice(0, 10), views: dayViews.length, sessions: sessions(dayViews) });
  }
  const metrics = ["LCP", "CLS", "INP", "FCP", "TTFB"].map(name => {
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
        if (index > 0 && (previous === undefined || event.receivedAt < previous)) continue;
        next.set(event.session, Math.min(next.get(event.session) ?? Infinity, event.receivedAt));
      }
      const lost = index === 0 ? 0 : eligible.size - next.size;
      eligible = next;
      return { label: stage.label, sessions: next.size, lost };
    });
    return { label, steps };
  };
  const funnels = [
    funnel("Install journey", [{ label: "Visited website", matches: e => e.name === "page_view" }, { label: "Copied install or clicked download", matches: e => ["install_copy", "download_click"].includes(e.name) }]),
    funnel("Advertiser journey", [{ label: "Opened campaign builder", matches: e => e.name === "page_view" && e.path === "/portal/campaigns/new" }, { label: "Created campaign", matches: e => e.name === "campaign_created" }]),
  ];
  return { start, end, truncated, totalEvents: events.length, pageViews: views.length, sessions: sessions(views), installSessions,
    errorCount: events.filter(e => e.name === "js_error").length,
    engagementSeconds: Math.round(events.filter(e => e.name === "engagement").reduce((n,e) => n + e.value, 0) / 1000),
    daily, funnels, pages: rank(views, "path"), sources: rank(views, "source"), campaigns: rank(views, "campaign"), devices: rank(views, "device"), events: rank(events.filter(e => !["page_view", "engagement", "LCP", "CLS", "INP", "FCP", "TTFB"].includes(e.name)), "name"), metrics };
}
