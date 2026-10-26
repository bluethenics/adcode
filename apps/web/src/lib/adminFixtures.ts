/**
 * Made-up answers for the admin panel's preview mode (see `adminPreview.ts`). Development only:
 * `apiFetch` imports this behind a `NODE_ENV === "development"` check, so no build ships it.
 *
 * Three datasets through the same boundary the real data uses. `demo` is a calm, plausible day.
 * `worst` is what production eventually sends: a model name that does not fit, an incident title
 * at its 120-character limit, six-figure counts, every model state at once, an address with no
 * break opportunities. `empty` is a brand-new deployment.
 */
import { adminPreviewData, type AdminPreviewData } from "./adminPreview";

/** The subset of api.ts's ApiResult this answers with, declared here so the two files do not import each other. */
type PreviewResult<T> = { ok: true; value: T } | { ok: false; error: "server-error" };

const DAY = 86_400_000;
const now = (): number => Date.now();
const dayKey = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** A wave with some noise, so sparklines look like real traffic and not like a test pattern. */
function series(days: number, base: number, swing: number, trend: number, seed: number): number[] {
  return Array.from({ length: days }, (_, index) => {
    const wave = Math.sin((index + seed) / 2.3) * swing + Math.cos((index * seed) / 5) * swing * 0.4;
    return Math.max(0, Math.round(base + wave + trend * index));
  });
}

function growth(data: AdminPreviewData) {
  if (data === "empty") {
    return { developers: 0, accounts: 0, joined7d: 0, joined30d: 0, active1d: 0, active7d: 0, active30d: 0, returning1d: 0, returning7d: 0, adsShown: 0, adsShown7d: 0, adsShown30d: 0, clicks: 0, creditedMicros: "0", paidOutMicros: "0", asOf: now(), daily: [], cohorts: [], funnel: { base: 0, steps: [], journey: [] } };
  }
  const worst = data === "worst";
  const active = series(30, worst ? 41_800 : 31, worst ? 9_000 : 9, worst ? 380 : 0.4, 3);
  const joined = series(30, worst ? 6_100 : 9, worst ? 3_000 : 5, worst ? 90 : 0.1, 7);
  const ads = series(30, worst ? 912_000 : 210, worst ? 140_000 : 70, worst ? 4_000 : 2, 5);
  const daily = active.map((value, index) => ({ day: dayKey(now() - (29 - index) * DAY), active: value, joined: joined[index] ?? 0, adsShown: ads[index] ?? 0, returning: Math.round(value * 0.31) }));
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
  return {
    developers: worst ? 1_284_331 : 431, accounts: worst ? 2_004_118 : 647, joined7d: sum(joined.slice(-7)), joined30d: sum(joined),
    active1d: active.at(-1) ?? 0, active7d: worst ? 188_420 : 104, active30d: worst ? 604_002 : 324, returning1d: worst ? 12_004 : 9, returning7d: worst ? 61_220 : 33,
    adsShown: worst ? 98_420_771 : 9_812, adsShown7d: sum(ads.slice(-7)), adsShown30d: sum(ads), clicks: worst ? 1_440_219 : 211,
    creditedMicros: worst ? "12345678900000" : "48210000", paidOutMicros: worst ? "9876543210000" : "0", asOf: now(),
    daily, cohorts: [], funnel: { base: worst ? 6_100 : 41, steps: [], journey: [] },
  };
}

function overview(data: AdminPreviewData) {
  if (data === "empty") return { creativesWaiting: 0, withdrawalsPending: 0, reportsOpen: 0, advertisers: 0, noticesActive: 0, pendingWithdrawalMicros: "0" };
  if (data === "worst") return { creativesWaiting: 1_204, withdrawalsPending: 87, reportsOpen: 3_118, advertisers: 1, noticesActive: 12, pendingWithdrawalMicros: "128450990000" };
  return { creativesWaiting: 2, withdrawalsPending: 0, reportsOpen: 5, advertisers: 3, noticesActive: 1, pendingWithdrawalMicros: "0" };
}

function days(level: (index: number) => string, turns: number) {
  return Array.from({ length: 90 }, (_, index) => {
    const state = level(index);
    const count = state === "quiet" ? 0 : turns + ((index * 37) % 23);
    const errors = state === "outage" ? Math.round(count * 0.4) : state === "degraded" ? Math.round(count * 0.09) : Math.round(count * 0.01);
    return { day: dayKey(now() - (89 - index) * DAY), level: state, turns: count, errors, avgMs: state === "quiet" ? null : 2_400 + ((index * 131) % 1_900) };
  });
}

function model(name: string, id: string, state: string, uptime: number, turns: number, level: (index: number) => string, providerName = "Tagflow AI") {
  return { provider: "tagflow", providerName, model: id, name, state, turns, ok: Math.round((turns * uptime) / 100), uptimePct: uptime, errorPct: Math.round((100 - uptime) * 100) / 100, avgMs: 3_180, lastActiveDay: dayKey(now()), days: days(level, Math.max(1, Math.round(turns / 90))) };
}

function incidents(data: AdminPreviewData) {
  if (data === "empty") return [];
  const at = now();
  const open = {
    incidentId: "inc-1", title: data === "worst"
      ? "Elevated error rates and slow first tokens on Qwen3 Coder 480B A35B Instruct for people in South and Southeast Asia region"
      : "Slower answers on Qwen 3.8",
    impact: data === "worst" ? "critical" : "minor", status: "identified", createdAt: at - 3 * 3_600_000, updatedAt: at - 40 * 60_000, resolvedAt: null,
    updates: [
      { updateId: "u-2", status: "identified", body: data === "worst" ? "The upstream provider is rate limiting our account. We moved half the traffic to GLM 5.3 and requested a higher limit; answers should already be faster for most people.\n\nNext update within the hour." : "An upstream provider is rate limiting us. Traffic is moving to GLM while we wait.", createdAt: at - 40 * 60_000 },
      { updateId: "u-1", status: "investigating", body: "Some answers are taking more than a minute. We are looking now.", createdAt: at - 3 * 3_600_000 },
    ],
  };
  const resolved = {
    incidentId: "inc-0", title: "Database not responding", impact: "major", status: "resolved", createdAt: at - 2 * DAY, updatedAt: at - 2 * DAY + 5_400_000, resolvedAt: at - 2 * DAY + 5_400_000,
    updates: [
      { updateId: "u-0b", status: "resolved", body: "The database was restarted and every request since has answered.", createdAt: at - 2 * DAY + 5_400_000 },
      { updateId: "u-0a", status: "investigating", body: "Sign-in and ads are failing. We are restarting the database.", createdAt: at - 2 * DAY },
    ],
  };
  return data === "worst" ? [open, { ...open, incidentId: "inc-2", title: "Planned maintenance", impact: "maintenance", status: "monitoring" }, resolved] : [open, resolved];
}

function status(data: AdminPreviewData) {
  const fine = () => "operational";
  const models = data === "empty" ? [] : data === "worst"
    ? [
        model("Qwen3 Coder 480B A35B Instruct Turbo (Experimental, 262K context)", "qwen/qwen3-coder-480b-a35b-instruct-turbo", "outage", 61.42, 1_284_331, (i) => (i > 84 ? "outage" : i % 11 === 0 ? "degraded" : "operational"), "Heabsy Cloud Inference Partners International"),
        model("GLM 5.3", "glm-5.3", "degraded", 94.1, 902_114, (i) => (i > 87 ? "degraded" : "operational")),
        model("Kimi K2.7", "kimi-k2.7", "operational", 99.98, 12, fine),
        model("Gemma", "gemma", "quiet", 100, 3, (i) => (i < 80 ? "operational" : "quiet")),
      ]
    : [
        model("Tagflow Code 27B", "tagflow-code-27b", "operational", 99.71, 18_204, fine),
        model("Qwen 3.8", "qwen-3.8", "degraded", 97.3, 6_102, (i) => (i > 87 ? "degraded" : "operational")),
        model("GLM 5.3", "glm-5.3", "operational", 99.9, 2_870, (i) => (i === 40 ? "outage" : "operational")),
      ];
  const list = incidents(data);
  const active = list.filter((incident) => incident.status !== "resolved");
  return {
    asOf: now(), windowDays: 90,
    overall: active.length > 0
      ? { state: data === "worst" ? "outage" : "degraded", title: active[0]!.title, activeIncidents: active.length }
      : data === "empty" ? { state: "operational", title: "All systems operational", activeIncidents: 0 } : { state: "degraded", title: "Elevated error rates on some models", activeIncidents: 0 },
    models, incidents: list,
  };
}

function subscribers(data: AdminPreviewData) {
  if (data === "empty") return { active: 0, models: 0, incidents: 0, pending: 0 };
  if (data === "worst") return { active: 1_048_576, models: 1_000_211, incidents: 1, pending: 99_999 };
  return { active: 38, models: 35, incidents: 21, pending: 4 };
}


/* ── Every other admin page ──────────────────────────────────────────────── */

const ago = (ms: number): number => now() - ms;
const HOUR = 3_600_000;
const pick = <T,>(data: AdminPreviewData, demo: T[], worst: T[]): T[] => (data === "empty" ? [] : data === "worst" ? worst : demo);

const LONG_EMAIL = "bartholomew.fitzgerald@northwind-industries-holdings.example.com";
const STACK = Array.from({ length: 14 }, (_, i) => `    at ${["renderChat", "streamTurn", "applyPatch", "readFile"][i % 4]} (app.asar/out/renderer/main.js:${String(1200 + i * 37)}:${String(9 + i)})`).join("\n");

function creatives(data: AdminPreviewData) {
  const one = { creativeId: "cr-1", campaignId: "camp-1", advertiser: "Northwind Tools", headline: "Ship faster with Northwind CI", body: "Free for open source. 2 minutes to set up.", clickUrl: "https://northwind.example.com/ci?utm_source=adcode", logoLight: "", logoDark: "", status: "pending" };
  return {
    creatives: pick(data, [one, { ...one, creativeId: "cr-2", advertiser: "Pip Hosting", headline: "Deploy a preview for every branch", body: null, clickUrl: "https://pip.example.com" }], [
      { ...one, advertiser: "Konstantin Oberhauser-Wettstein Developer Tooling GmbH", headline: "The fastest TypeScript build cache in the world, now with remote execution", clickUrl: "https://example.com/workspaces/acme/projects/q3-launch/docs/9f8e7d6c5b4a?tab=comments&filter=unresolved&utm_source=adcode&utm_medium=sponsored" },
      { ...one, creativeId: "cr-3", advertiser: "Jo", headline: "Hi", body: null },
    ]),
  };
}

function reports(data: AdminPreviewData) {
  const base = { reportId: "rep-1", uid: "u_8f2kd91mz0", kind: "bug", title: "Chat stops after the first answer", body: "I send a message, the first answer arrives, then nothing. Restarting fixes it for one more message.", appVersion: "2.4.0", platform: "win32", status: "open", createdAt: ago(2 * HOUR) };
  const rows = pick(data, [
    base,
    { ...base, reportId: "rep-2", kind: "feature", title: "Let me pin a model per project", body: "I use GLM for one repo and Qwen for another.", status: "triaged", createdAt: ago(26 * HOUR) },
    { ...base, reportId: "rep-3", kind: "help", title: "How do I withdraw earnings?", body: "Where is the payout button?", status: "closed", createdAt: ago(80 * HOUR) },
  ], [
    { ...base, title: "Uncaught TypeError: Cannot read properties of undefined (reading 'content') when switching between three projects with background chats running", body: `TypeError: Cannot read properties of undefined (reading 'content')\n${STACK}\n\nSteps: open three projects, start a background chat in each, switch quickly.`, uid: "9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f" },
    { ...base, reportId: "rep-2", kind: "other", title: "?", body: "x", status: "triaged", platform: "linux", appVersion: "2.3.2-beta.11+build.20261019" },
    { ...base, reportId: "rep-3", kind: "feature", title: "Benachrichtigungseinstellungen für jede Unterhaltung einzeln festlegen", body: "Bitte.", status: "open" },
  ]);
  return { rows, repliedAt: data === "empty" ? {} : { "rep-3": ago(70 * HOUR) } };
}

function withdrawals(data: AdminPreviewData) {
  const base = { withdrawalId: "wd-1", amountMicros: "25000000", status: "requested", currency: "USD", createdAt: ago(5 * HOUR), decidedAt: null, providerRef: null, note: null, uid: "u_8f2kd91mz0", email: "ana@example.com", displayName: "Ana Souza", destination: { method: "wise-email", country: "BR", currency: "BRL", accountHint: "••••@example.com" }, availableMicros: "31250000", lifetimeMicros: "61000000" };
  return {
    rows: pick(data, [base, { ...base, withdrawalId: "wd-2", amountMicros: "10000000", displayName: "Dev Patel", email: "dev@example.com", destination: { method: "bank", country: "IN", currency: "INR", accountHint: "••••7890" }, createdAt: ago(30 * HOUR) }], [
      { ...base, amountMicros: "98765430000", displayName: "Aleksandra Wiśniewska-Kowalczyk", email: LONG_EMAIL },
      { ...base, withdrawalId: "wd-2", displayName: null, email: null },
    ]),
  };
}

function advertisers(data: AdminPreviewData) {
  const base = { advertiserId: "adv-1", name: "Northwind Tools", status: "active", fundedMicros: "500000000", reservedMicros: "120000000", ownerUids: ["u_northwind01"], createdAt: ago(40 * 24 * HOUR) };
  return { advertisers: pick(data, [base, { ...base, advertiserId: "adv-2", name: "Pip Hosting", fundedMicros: "120000000" }, { ...base, advertiserId: "adv-3", name: "Spamco", status: "suspended", fundedMicros: "0" }], [
    { ...base, name: "Konstantin Oberhauser-Wettstein Developer Tooling GmbH & Co. KG", fundedMicros: "1234567890000000", ownerUids: ["9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f"] },
    { ...base, advertiserId: "adv-2", name: "J", ownerUids: [] },
  ]) };
}

function corridors(data: AdminPreviewData) {
  const base = { country: "IN", currency: "INR", requiredFields: ["accountNumber", "ifsc", "bankName"], enabled: true, sourceNote: "Tested with a real recipient on 2026-10-01.", verifiedAt: ago(20 * 24 * HOUR), updatedAt: ago(20 * 24 * HOUR), updatedBy: "admin" };
  return { corridors: pick(data, [base, { ...base, country: "BR", currency: "BRL", requiredFields: ["email"], enabled: false, verifiedAt: null }], [base]) };
}

function users(data: AdminPreviewData) {
  const base = { uid: "u_8f2kd91mz0", status: "active", createdAt: ago(3 * 24 * HOUR), email: "ana@example.com", displayName: "Ana Souza" };
  return {
    rows: pick(data, [base, { uid: "u_anon77x2", status: "active", createdAt: ago(9 * HOUR) }, { ...base, uid: "u_banned1", status: "banned", displayName: "Spam Bot", email: "bot@example.com" }], [
      { ...base, displayName: "Christopher Alexander Montgomery III", email: LONG_EMAIL },
      { uid: "9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f", status: "active", createdAt: ago(HOUR) },
      { ...base, uid: "u_jo", displayName: "Jo", email: "a@b.co" },
    ]),
    nextCursor: data === "worst" ? "next" : null,
  };
}

function admins(data: AdminPreviewData) {
  return { admins: data === "empty" ? [{ email: "founder@example.com", addedBy: "setup", addedAt: ago(90 * 24 * HOUR) }] : [
    { email: "founder@example.com", addedBy: "setup", addedAt: ago(90 * 24 * HOUR) },
    { email: data === "worst" ? LONG_EMAIL : "ops@example.com", addedBy: "founder@example.com", addedAt: ago(10 * 24 * HOUR) },
  ] };
}

function notices(data: AdminPreviewData) {
  const base = { noticeId: "n-1", severity: "warning", title: "Free AI is slow right now", body: "We are moving traffic to another model.", active: true, createdAt: ago(HOUR) };
  return { notices: pick(data, [base, { ...base, noticeId: "n-0", severity: "info", title: "Scheduled maintenance on Sunday", active: false, createdAt: ago(9 * 24 * HOUR) }], [
    { ...base, title: "Ads aren't loading right now for people in South and Southeast Asia because an upstream provider is rate limiting us" },
  ]) };
}

function releases(data: AdminPreviewData) {
  const base = { version: "2.4.0", title: "The assistant uses ADCode for you", body: "## What changed", highlights: ["Ask it to open settings"], announce: true, critical: false, status: "published", authoredBy: "human", authorUid: "admin", publishedAt: ago(8 * HOUR), updatedAt: ago(8 * HOUR) };
  return { releases: pick(data, [base, { ...base, version: "2.4.1", title: "Faster chats", status: "draft", authoredBy: "agent", publishedAt: null }, { ...base, version: "2.3.2", title: "Fixes for background chats", announce: false, publishedAt: ago(4 * 24 * HOUR) }], [
    { ...base, version: "2.10.0-beta.12+build.20261021", title: "Search is twice as fast, the debugger stops on exceptions, and terminal paste works everywhere including WSL" },
  ]) };
}

function posts(data: AdminPreviewData) {
  const base = { slug: "background-chats", title: "Run several chats at once", description: "", body: "", status: "published", surface: "docs", publishedAt: ago(5 * 24 * HOUR), updatedAt: ago(2 * 24 * HOUR) };
  return { posts: pick(data, [base, { ...base, slug: "earn-while-you-code", title: "Earn while you code", status: "draft", surface: "blog" }], [
    { ...base, slug: "a-very-long-web-address-that-someone-typed-for-search-engines-and-never-shortened", title: "How to set up ADCode with a self-hosted OpenAI-compatible model server behind a corporate proxy" },
  ]) };
}

const MORE_FIXTURES: Record<string, (data: AdminPreviewData) => unknown> = {
  "/admin/creatives": creatives,
  // Delivery merges this with the review queue, so it must not repeat those ids.
  "/admin/creatives?status=approved": (data) => ({ creatives: data === "empty" ? [] : [{ creativeId: "cr-live", campaignId: "camp-1", advertiser: "Northwind Tools", headline: "Northwind CI, now with caching", body: null, clickUrl: "https://northwind.example.com", logoLight: "", logoDark: "", status: "approved" }] }),
  "/admin/reports": reports,
  "/admin/withdrawals": withdrawals,
  "/admin/advertisers": advertisers,
  "/admin/payout-corridors": corridors,
  "/admin/users": users,
  "/admin/admins": admins,
  "/admin/notices": notices,
  "/admin/releases": releases,
  "/admin/posts": posts,
};


/* ── Analytics and Growth ────────────────────────────────────────────────── */

function websiteAnalytics(data: AdminPreviewData) {
  const worst = data === "worst";
  const empty = data === "empty";
  const views = series(30, worst ? 48_000 : 260, worst ? 9_000 : 60, 0, 4);
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
  const rank = (labels: string[], top: number) => (empty ? [] : labels.map((label, index) => ({ label, count: Math.round(top / (index + 1)) })));
  return {
    start: now() - 30 * DAY, end: now(), truncated: worst, totalEvents: empty ? 0 : worst ? 20_000 : 4_812,
    pageViews: empty ? 0 : sum(views), sessions: empty ? 0 : Math.round(sum(views) * 0.6), installSessions: empty ? 0 : worst ? 31_002 : 184, errorCount: empty ? 0 : worst ? 9_114 : 3, engagementSeconds: empty ? 0 : worst ? 9_400_000 : 61_000,
    daily: empty ? [] : views.map((value, index) => ({ day: dayKey(now() - (29 - index) * DAY), views: value, sessions: Math.round(value * 0.6) })),
    funnels: empty ? [] : [{ label: "Install journey", steps: [{ label: "Visited", sessions: 3_000, lost: 0 }, { label: "Saw install", sessions: 1_100, lost: 1_900 }, { label: "Copied command", sessions: 240, lost: 860 }] }],
    pages: rank(worst ? ["/docs/how-to-set-up-adcode-with-a-self-hosted-openai-compatible-model-server-behind-a-corporate-proxy", "/", "/status"] : ["/", "/docs", "/status", "/versions"], worst ? 120_000 : 900),
    sources: rank(["x", "google", "direct", "threads"], worst ? 80_000 : 400),
    campaigns: rank(["launch-video", "store-ad"], 120), devices: rank(["desktop", "mobile"], 700), events: rank(["install_copy", "download_click"], 200),
    placements: rank(["hero", "nav"], 120), invitePages: rank(["chat-share"], 30),
    metrics: empty ? [] : [{ name: "LCP", samples: 412, p75: 1_830 }, { name: "INP", samples: 300, p75: 140 }, { name: "CLS", samples: 410, p75: 0.04 }],
  };
}

function sources(data: AdminPreviewData) {
  const row = { key: "campaign:launch", kind: "campaign", code: "launch", label: "Launch video", visits: 1_204, people: 88, realUsers: 41, cameBack: 12, adRevenueMicros: "4120000", advertisers: 1, advertiserSpendMicros: "50000000", paidMicros: "0", keptMicros: "2060000" };
  return {
    days: 30, asOf: now(),
    rows: pick(data, [row, { ...row, key: "users", kind: "users", code: null, label: "Invited by people", visits: null, people: 31, realUsers: 19 }, { ...row, key: "unknown", kind: "unknown", code: null, label: "No code", visits: null, people: 402, realUsers: 160 }], [
      { ...row, label: "A post on X about earning while you code, with the 30-second Blip reel and a pinned reply", people: 1_284_331, adRevenueMicros: "98765430000" },
    ]),
    topReferrers: data === "empty" ? [] : [{ referrerUid: "u_8f2kd91mz0", code: "wps95q9", visits: 40, people: 9, realUsers: 6, cameBack: 2, adRevenueMicros: "310000", advertisers: 0, advertiserSpendMicros: "0", paidMicros: "31000", keptMicros: "279000" }],
    coverage: { attributedRealUsers: data === "empty" ? 0 : 60, realUsers: data === "empty" ? 0 : 220 },
  };
}

function refCodes(data: AdminPreviewData) {
  const code = { code: "launch", label: "Launch video", active: true, createdAt: ago(9 * DAY), link: "https://adcode.bluethenics.com/i/launch" };
  return { codes: pick(data, [code, { ...code, code: "store-ad", label: "Microsoft Store ad", active: false, link: "https://adcode.bluethenics.com/i/store-ad" }], [{ ...code, label: "A post on X about earning while you code, with the 30-second Blip reel", code: "x-blip-reel-2026-10-launch-week" }]) };
}

const GROWTH_FIXTURES: Record<string, (data: AdminPreviewData) => unknown> = {
  "/admin/website-analytics": websiteAnalytics,
  "/admin/sources": sources,
  "/admin/ref-codes": refCodes,
  "/admin/referral-config": () => ({ userPercent: "10", advertiserPercent: "5", windowDays: 365, claimDays: 14, houseAdvertiserIds: [] }),
};

const FIXTURES: Record<string, (data: AdminPreviewData) => unknown> = {
  ...MORE_FIXTURES,
  ...GROWTH_FIXTURES,
  // BYOK models: the built-in catalogue is in the page; this is only the saved curation and health.
  "/admin/models": (data) => ({ overrides: { recommended: {}, hidden: data === "empty" ? [] : ["openai:gpt-4o-mini"], featured: [], notes: {}, added: [] }, updatedAt: ago(2 * DAY), updatedBy: "founder@example.com" }),
  "/admin/model-health": (data) => ({ models: data === "empty" ? [] : [
    { provider: "openai", model: "gpt-5", turns: data === "worst" ? 1_284_331 : 412, ok: data === "worst" ? 902_114 : 405, okAvgMs: 4_100, outcomes: { ok: 405, server: 7 } },
    { provider: "anthropic", model: "claude-sonnet-5-5", turns: 96, ok: 70, okAvgMs: 6_200, outcomes: { ok: 70, rate_limit: 26 } },
  ] }),
  "/admin/overview": overview,
  "/admin/growth": growth,
  "/status": status,
  "/admin/status": (data) => ({ incidents: incidents(data) }),
  "/admin/status/subscribers": subscribers,
};

/** Null when preview mode is off; otherwise a fixture, a pretend success for a write, or an error. */
export function previewResponse<T>(path: string, method: string): PreviewResult<T> | null {
  const data = adminPreviewData();
  if (data === null) return null;
  if (method !== "GET") return { ok: true, value: { queued: 0, sendingEnabled: false } as T };
  const fixture = FIXTURES[path] ?? FIXTURES[path.split("?")[0] ?? path];
  return fixture === undefined ? { ok: false, error: "server-error" } : { ok: true, value: fixture(data) as T };
}
