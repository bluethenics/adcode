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

/** Ad networks: Imprezia live on a sandbox key, one JSON API waiting on its key. */
const adNetworks = (data: AdminPreviewData): unknown => ({
  credentialsManageable: data !== "worst",
  // Cards seen per partner, for the traffic split; null is a database a migration behind.
  shown: data === "worst" ? null : { imprezia: { last1d: 1840, last7d: 11_205 }, zeekend: { last1d: 0, last7d: 9_312 } },
  networks: data === "empty" ? [] : [
    // Pay by country (2026-11-25): a few of the owner's sheet rows, with what a card earns for the margin.
    { id: "zeekend", name: "Zeekend", provider: "zeekend", enabled: true, priority: 5, viewPayoutMicros: "0", clickPayoutMicros: "0", keyConfigured: true, readiness: "ready", keyMode: "live", mix: { share: 40, places: ["banner", "notification", "reply"] },
      zeekend: { placementId: "chat-main", payPerCardMicros: "2000", paidCardsPerDay: 300, defaultEarnPerCardMicros: "3000", countryPay: [
        { country: "GB", payPerCardMicros: "4500", earnPerCardMicros: "10130" },
        { country: "US", payPerCardMicros: "4300", earnPerCardMicros: "9600" },
        { country: "DE", payPerCardMicros: "2000", earnPerCardMicros: "7090" },
        { country: "AE", payPerCardMicros: data === "worst" ? "2800" : "2000", earnPerCardMicros: "3060" },
        { country: "IN", payPerCardMicros: "1000", earnPerCardMicros: "3510", paidCardsPerDay: 200 },
        { country: "LT", payPerCardMicros: "900", earnPerCardMicros: "3020" },
        { country: "RU", payPerCardMicros: "0", earnPerCardMicros: "0" },
        ...(data === "worst" ? [{ country: "BR", payPerCardMicros: "2000" }] : []),
      ] } },
    { id: "imprezia", name: "Imprezia", provider: "imprezia", enabled: true, priority: 10, viewPayoutMicros: "2000", clickPayoutMicros: "0", imprezia: { kind: "chat", id: "editor_sponsored_card" }, keyConfigured: true, readiness: "ready", keyMode: "sandbox", mix: { share: 60, places: ["banner", "reply"] } },
    { id: "northwind-ads", name: "Northwind Ads", provider: "http-json", enabled: false, priority: 50, viewPayoutMicros: "1500", clickPayoutMicros: "40000", keyConfigured: false, readiness: "key-required",
      http: { serveUrl: "https://ads.northwind.example/v1/serve", verifyUrl: "https://ads.northwind.example/v1/verify", method: "POST", authHeader: "authorization", authPrefix: "Bearer ", requestTemplate: { tags: "{{tags}}" }, creativePath: "ad", fields: { id: "id", advertiser: "brand", headline: "title", body: "text", clickUrl: "url", logoLight: "logo", logoDark: "" }, verifyTemplate: { id: "{{eventId}}" }, verifiedPath: "ok", eventIdPath: "event" } },
  ],
});

/**
 * Free models (admin/tagflow): the catalogue as the page edits it. "worst" is the real shape of
 * the problem the page was rebuilt for - 59 models, long names, prices with many decimals,
 * hidden and paid ones mixed in.
 */
const MODEL_NAMES = ["GLM 5.3 Flash Uncensored", "Qwen 3.8 27B Queen", "MiMo V2.6 Flash Uncensored", "DeepSeek V4.1 Flash", "Kimi K3 Thinking", "CyberHeabsy", "Claude Sonnet 5.5 (Heabsy partner)", "GPT-5 Codex", "Gemini 3 Pro Preview", "Llama 5 70B Instruct Turbo with an unusually long marketing name"];
function tagflowModels(data: AdminPreviewData) {
  const count = data === "empty" ? 0 : data === "worst" ? 59 : 12;
  return Array.from({ length: count }, (_, index) => {
    const name = `${MODEL_NAMES[index % MODEL_NAMES.length]}${index >= MODEL_NAMES.length ? ` r${Math.floor(index / MODEL_NAMES.length) + 1}` : ""}`;
    const wallet = index % 9 === 6;
    return { id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-$/, ""), name, ...(index % 3 === 0 ? { provider: "custom-heabsy" } : {}),
      contextWindow: 131_072, maxOutput: 32_768, inputPrice: Number((0.05 + index * 0.0137).toFixed(6)), outputPrice: Number((0.2 + index * 0.051).toFixed(6)),
      ...(wallet ? { billing: "wallet", cacheInputPrice: 0.0123456789 } : {}), ...(index % 7 === 0 && index > 0 ? { enabled: false } : {}) };
  });
}
function tagflow(data: AdminPreviewData) {
  const models = tagflowModels(data);
  return { keyConfigured: true, updatedAt: ago(DAY), updatedBy: "founder@example.com", keysManageable: true,
    connections: [{ id: "tagflow", configured: true }, { id: "custom-heabsy", configured: data !== "worst" }],
    config: { enabled: models.length > 0, baseUrl: "https://demo.tagflow-ai.com/v1", defaultModel: models[0]?.id ?? "", models,
      providers: [{ id: "custom-heabsy", name: "Heabsy", baseUrl: "https://api.heabsy.example/v1" }],
      limits: { dailyTokens: 2_200_000, dailyRequests: 1_000_000, dailyCostMicros: 1_100_000, requestsPerMinute: 1_000 }, maxInputTokens: 1_050_000, maxOutputTokens: 50_000,
      credits: { sessionCredits: 100, sessionHours: 5, weeklyCredits: 700 },
      paid: { enabled: true, accounting: "cost-v1", providers: ["custom-heabsy"], freeWeeklyTokens: 1_540_000, packs: [{ id: "starter", priceCents: 300, tokens: 16_500_000 }, { id: "50m", priceCents: 1000, tokens: 55_000_000 }] } } };
}
/** Provider reports: every model's figures, full enough for the detail view and the downloads. */
function modelReports(data: AdminPreviewData) {
  const today = Date.parse(dayKey(now())), from = today - 29 * DAY, to = now();
  const metrics = (scale: number) => ({ attempts: Math.round(4_200 * scale), providerCalls: Math.round(4_100 * scale), successes: Math.round(3_900 * scale), providerErrors: Math.round(120 * scale), relayErrors: 3, rejected: Math.round(80 * scale), cancelled: 12, unfinished: 2,
    activeUsers: Math.round(310 * scale), repeatUsers: Math.round(180 * scale), newUsers: Math.round(90 * scale), returningUsers: Math.round(220 * scale), inputTokens: Math.round(41_000_000 * scale), outputTokens: Math.round(3_100_000 * scale), costMicros: Math.round(9_400_000 * scale),
    estimatedRequests: 14, toolRequests: Math.round(2_800 * scale), toolCalls: Math.round(5_100 * scale), streamedRequests: Math.round(4_000 * scale), outputLimitStops: 21, refusals: 2, peakRpm: Math.round(48 * scale) + 1, peakTpm: Math.round(410_000 * scale), peakConcurrency: Math.round(19 * scale) + 1,
    latencySamples: Math.round(3_900 * scale), firstTokenSamples: Math.round(3_800 * scale), throughputSamples: Math.round(3_600 * scale), durationP50: 6_100, durationP95: 21_400, firstTokenP50: 980, firstTokenP95: 3_300, inputP50: 9_800, inputP95: 61_000, outputP50: 620, outputP95: 2_900, outputTpsP50: 74, outputTpsP95: 141,
    helpful: Math.round(40 * scale), notHelpful: Math.round(9 * scale), feedbackUsers: Math.round(31 * scale) });
  const models = tagflowModels(data).map((model, index) => {
    const scale = data === "worst" && index === 0 ? 93 : 1 / (index + 1);
    return { modelId: model.id, modelName: model.name, provider: model.provider ?? "tagflow", upstreamModel: model.id, current: metrics(scale), previous: metrics(scale * 0.8),
      daily: series(30, 140 * scale, 40 * scale, 1, index + 1).map((attempts, day) => ({ day: dayKey(from + day * DAY), attempts, successes: Math.round(attempts * 0.93), providerErrors: Math.round(attempts * 0.03), rejected: Math.round(attempts * 0.02), activeUsers: Math.round(attempts / 9), inputTokens: attempts * 9_800, outputTokens: attempts * 700, helpful: day % 3, notHelpful: day % 5 === 0 ? 1 : 0 })),
      errors: [{ outcome: "provider_error", code: "upstream-rate-limit", upstreamStatus: 429, count: Math.round(90 * scale) + 1, firstAt: from + DAY, lastAt: to - 3_600_000 }],
      sources: [{ source: "chat", requests: Math.round(3_100 * scale) }, { source: "agent", requests: Math.round(1_100 * scale) }],
      hourly: Array.from({ length: 24 }, (_, hour) => ({ hour, requests: Math.round((120 + Math.sin(hour / 3.8) * 90) * scale) + 1 })),
      inputBands: [{ band: "<8k", requests: Math.round(1_900 * scale) }, { band: "8k–32k", requests: Math.round(1_400 * scale) }, { band: "32k–64k", requests: Math.round(500 * scale) }],
      feedbackCategories: [{ category: "quality", helpful: 22, notHelpful: 4 }],
      sharedComments: data === "worst" ? [{ at: to - DAY, rating: "not-helpful", category: "quality", comment: "Stopped halfway through a refactor and lost the plan; a very long comment to check wrapping in the report table and the printable briefing." }] : [],
      sharedCommentCount: data === "worst" ? 1 : 0,
      audience: { countries: [{ value: "US", requests: 1_200, activeUsers: 90, successes: 1_100, providerErrors: 30, inputTokens: 12_000_000, outputTokens: 900_000, previousRequests: 1_000, previousActiveUsers: 80 }], userRoles: [], experienceLevels: [], aiPersonas: [], useCases: [], declaredUses: [], platforms: [] } };
  });
  return { collectionStartedAt: ago(40 * DAY), audienceStartedAt: ago(20 * DAY), builtAt: ago(42 * 60_000), scope: "summary", models,
    range: { from: dayKey(from), to: dayKey(today), fromAt: from, toAt: to, previousFromAt: from - (to - from), previousToAt: from },
    generatedAt: now(), definitions: { "Request demand": "Every attempt to use the model, counted once.", "Active accounts": "Distinct signed-in accounts that sent at least one request." } };
}

const FIXTURES: Record<string, (data: AdminPreviewData) => unknown> = {
  "/admin/tagflow": tagflow,
  "/admin/tagflow/usage": () => ({ rows: [] }),
  "/admin/tagflow/reports": modelReports,
  "/admin/ad-networks": adNetworks,
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
  const bare = path.split("?")[0] ?? path;
  const fixture = FIXTURES[path] ?? FIXTURES[bare] ?? (bare.startsWith("/admin/console/users/") ? consoleProfile
    : /^\/admin\/campaigns\/[0-9a-f-]{36}$/.test(bare) ? campaignDetail : undefined);
  return fixture === undefined ? { ok: false, error: "server-error" } : { ok: true, value: fixture(data) as T };
}

/* ── Admin console: user search and email campaigns ─────────────────────── */

const PEOPLE = [
  ["Maya Okafor", "maya.okafor@gmail.com"], ["Tomás Rivera", "tomas.rivera.dev@gmail.com"], ["Priya Natarajan", "priya.n@outlook.com"],
  ["Kenji Watanabe", "kenji.w@gmail.com"], [null, "lin.builds@proton.me"], ["Amara Mensah", "amara.mensah@gmail.com"],
  ["Jonas Lindqvist", "jonas@lindqvist.se"], [null, null], ["Fatima Zahra El Idrissi Benali-Fontaine", "fatima.zahra.elidrissi.benalifontaine.longaddress@gmail.com"],
] as const;

function consoleHits(data: AdminPreviewData) {
  if (data === "empty") return { rows: [] };
  return { rows: PEOPLE.map(([name, email], index) => ({
    uid: `u${(7_381_224 + index * 9_137).toString(36)}Xk2${index}qPz9Lm`, email, displayName: name, photoUrl: null,
    status: index === 6 ? "banned" : "active", emailVerified: email !== null, createdAt: now() - (index + 2) * 9 * DAY, lastActiveAt: index % 3 === 2 ? null : now() - index * 37 * 3_600_000,
  })) };
}

function consoleProfile(data: AdminPreviewData) {
  const worst = data === "worst";
  return {
    uid: "u4k9fXk20qPz9Lm", email: worst ? "fatima.zahra.elidrissi.benalifontaine.longaddress@gmail.com" : "maya.okafor@gmail.com",
    displayName: worst ? "Fatima Zahra El Idrissi Benali-Fontaine" : "Maya Okafor", photoUrl: null, status: "active", emailVerified: true,
    createdAt: now() - 74 * DAY, linkedAt: now() - 73 * DAY, isAdmin: false,
    activity: { lastActiveAt: now() - 19 * DAY, firstSeenAt: now() - 74 * DAY, daysActive: 23, daysActive30: 4, sessions30: 7, activeMinutes30: 212, acceptedEdits30: 58 },
    ai: { requests30: worst ? 184_220 : 1_432, inputTokens30: 3_200_000, outputTokens30: 410_000, costMicros30: worst ? "182340000" : "4812000", lastDay: dayKey(now() - 19 * DAY) },
    subscription: { plan: "pro", status: "active", endsAt: now() + 11 * DAY, periodEnd: now() + 11 * DAY, cancelAtPeriodEnd: worst },
    gift: null, wallet: { balanceMicros: "12480000", reservedMicros: worst ? "310000" : "0" },
    earnings: { availableMicros: "3170000", lifetimeMicros: "9840000", pendingWithdrawalMicros: "0" }, aiBlocked: worst,
    mail: { productUpdates: false, statusUpdates: true, modelUpdates: false, suppressed: worst ? { reason: "unsubscribe", at: now() - 3 * DAY } : null,
      campaigns: [{ campaign: "Come back to ADCode", status: "sent", sentAt: now() - 2 * DAY, openedAt: now() - 2 * DAY + 3_600_000, clickedAt: null }] },
    invitedBy: { code: "MAYA-7Q", referrerUid: "u1r8kXp", how: "link", at: now() - 74 * DAY }, invited: 3,
    audit: [{ action: "gift-ai-plan", adminUid: "admin1", at: now() - 40 * DAY }, { action: "read-user-profile", adminUid: "admin1", at: now() - 3_600_000 }],
  };
}

const CAMPAIGN_STATS = { queued: 3, sent: 287, failed: 2, delivered: 279, opened: 104, clicked: 31, bounced: 4, complained: 0, returned: 22, today: 19, lastSentAt: 0 };
function baseCampaign() {
  return {
    id: "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f", name: "Come back to ADCode", subject: "{{name}}, your workspace is still here",
    preheader: "Free AI, a focused editor, and your projects where you left them.", heading: "Pick up where you left off.",
    body: "Hi {{name}},\n\nIt has been a while since you opened ADCode. Faster free models, agents that work through a task with you, and a cleaner editor.\n\nYour projects are where you left them.",
    ctaLabel: "Open ADCode", ctaUrl: "https://adcode.bluethenics.com/", audience: "everyone", inactiveDays: 14 as number | null, totalLimit: 1000, dailyLimit: 50,
    status: "running", createdBy: "admin1", createdAt: now() - 6 * DAY, updatedAt: now() - 6 * DAY, startedAt: now() - 6 * DAY as number | null,
    finishedAt: null as number | null, finishReason: null as string | null,
    stats: { ...CAMPAIGN_STATS, lastSentAt: now() - 11 * 60_000 as number | null },
  };
}

function campaigns(data: AdminPreviewData) {
  if (data === "empty") return { campaigns: [] };
  const base = baseCampaign();
  const zero = { queued: 0, sent: 0, failed: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0, complained: 0, returned: 0, today: 0, lastSentAt: null };
  const list = [
    base,
    { ...base, id: "7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d", name: "New free models, November", subject: "Two new free models in ADCode", status: "draft", startedAt: null, audience: "subscribed", inactiveDays: null, totalLimit: 500, dailyLimit: 100, stats: zero },
    { ...base, id: "0d9c8b7a-6f5e-4d4c-9b3a-2f1e0d9c8b7a", name: "October win-back", status: "completed", finishReason: "total-reached", totalLimit: 300, dailyLimit: 30, finishedAt: now() - 12 * DAY,
      stats: { queued: 0, sent: 300, failed: 0, delivered: 296, opened: 121, clicked: 44, bounced: 4, complained: 1, returned: 37, today: 0, lastSentAt: now() - 12 * DAY } },
  ];
  if (data === "worst") list.push({ ...base, id: "11111111-2222-4333-8444-555555555555", name: "A campaign whose administrator gave it a very long name that does not fit on one line at all", status: "paused", totalLimit: 100000, dailyLimit: 5000,
    stats: { ...base.stats, sent: 48_211, returned: 4_102 } });
  return { campaigns: list };
}

function campaignDetail() {
  return { ...baseCampaign(), sends: PEOPLE.filter(([, email]) => email !== null).map(([, email], index) => ({
    email, status: index === 3 ? "failed" : "sent", attempts: 1, claimedAt: now() - index * 47 * 60_000, sentAt: index === 3 ? null : now() - index * 47 * 60_000,
    deliveredAt: index === 3 ? null : now() - index * 47 * 60_000 + 4_000, openedAt: index % 2 === 0 ? now() - index * 40 * 60_000 : null,
    clickedAt: index === 0 ? now() - 30 * 60_000 : null, bouncedAt: index === 5 ? now() : null, lastError: index === 3 ? "provider-422" : null,
  })) };
}

Object.assign(FIXTURES, {
  "/admin/console/users": consoleHits,
  "/admin/campaigns": campaigns,
  "/admin/campaigns/audience": (data: AdminPreviewData) => ({ count: data === "empty" ? 0 : 14_773 }),
});

/* ── Retention ─────────────────────────────────────────────────────────── */

function retentionSummary(data: AdminPreviewData) {
  const empty = data === "empty", k = data === "worst" ? 140 : 1;
  const weekMonday = (ago: number) => { const d = new Date(now() - ago * 7 * DAY); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return dayKey(d.getTime()); };
  const cohorts = Array.from({ length: 12 }, (_, index) => {
    const age = 11 - index, users = empty ? 0 : Math.round((38 + index * 4 + (index % 3) * 7) * k);
    const point = (n: number, rate: number) => (age * 7 + 3 < n ? { eligible: 0, retained: 0 } : { eligible: users, retained: Math.round(users * rate) });
    return { weekStart: weekMonday(age), users, d1: point(1, 0.31 + (index % 4) * 0.02), d7: point(7, 0.14 + (index % 3) * 0.015), d30: point(30, 0.07) };
  });
  const base = empty ? 0 : 612 * k;
  const steps = [["first_launch", 1], ["signed_in", 0.58], ["project_opened", 0.71], ["ai_message", 0.52], ["ai_turn_ok", 0.39], ["edit_applied", 0.27], ["preview_opened", 0.16], ["returned_day1", 0.3], ["returned_day7", 0.13]] as const;
  const churned = empty ? 0 : 388 * k;
  const reasons = [["no_project", 0.24], ["first_turn_failed", 0.16], ["hit_limit", 0.13], ["no_ai_message", 0.11], ["faded", 0.1], ["sign_in_dead_end", 0.08], ["no_api_key", 0.06], ["ai_failing", 0.04], ["slow_answers", 0.03], ["crashed", 0.02], ["gave_up_waiting", 0.02], ["no_edit", 0.01], ["update_failed", 0]] as const;
  return {
    builtAt: now() - 23 * 60_000, silentDays: 7,
    totals: { users: empty ? 0 : 1_204 * k, newInstalls: base, active1d: empty ? 0 : 141 * k, active7d: empty ? 0 : 402 * k, active30d: empty ? 0 : 816 * k, churned },
    cohorts,
    funnel: { base, steps: steps.map(([step, rate]) => ({ step, users: Math.round(base * rate) })) },
    reasons: reasons.map(([reason, rate]) => ({ reason, users: Math.round(churned * rate) })),
    friction: empty ? [] : [
      { name: "turn_failed", churned: 104 * k, users: 233 * k, topCodes: [{ code: "auth", churned: 41 * k }, { code: "rate_limit", churned: 27 * k }, { code: "network", churned: 19 * k }] },
      { name: "limit_reached", churned: 61 * k, users: 172 * k, topCodes: [{ code: "daily", churned: 52 * k }, { code: "tokens", churned: 9 * k }] },
      { name: "sign_in_needed", churned: 44 * k, users: 120 * k, topCodes: [] },
      { name: "cli_failed", churned: 29 * k, users: 58 * k, topCodes: [{ code: "opencode.stopped_part_way", churned: 17 * k }, { code: "claude.signed_out", churned: 8 * k }] },
      { name: "slow_first_answer", churned: 22 * k, users: 97 * k, topCodes: [] },
      { name: "renderer_gone", churned: 6 * k, users: 9 * k, topCodes: [{ code: "oom", churned: 5 * k }] },
    ],
  };
}

function retentionPerson(index: number) {
  const reasons = ["no_project", "first_turn_failed", "hit_limit", "sign_in_dead_end", "crashed", "faded"];
  const reason = reasons[index % reasons.length]!;
  return {
    uid: index === 2 ? "anonymous-account-with-an-identifier-that-goes-on-and-on-7Hq2" : `u${(91_381 + index * 7_717).toString(36)}Kp${index}Lm2x`,
    firstSeenAt: now() - (20 + index) * DAY, lastSeenAt: now() - (8 + index) * DAY, activeDays: 1 + (index % 4), newInstall: index % 5 !== 0,
    furthestStep: reason === "no_project" ? "first_launch" : reason === "first_turn_failed" ? "ai_message" : "edit_applied", reason,
    lastError: reason === "first_turn_failed" ? { name: "turn_failed", code: "auth", at: now() - (8 + index) * DAY } : reason === "crashed" ? { name: "renderer_gone", code: "oom", at: now() - (8 + index) * DAY } : null,
    lastSession: { code: reason === "crashed" ? "unclean" : "quit", ms: 240_000 + index * 91_000, at: now() - (8 + index) * DAY }, version: "2.6.3",
  };
}

Object.assign(FIXTURES, {
  "/admin/retention": retentionSummary,
  "/admin/retention/churned": (data: AdminPreviewData) => (data === "empty" ? { total: 0, users: [] } : { total: data === "worst" ? 54_320 : 388, users: Array.from({ length: 25 }, (_, index) => retentionPerson(index)) }),
  "/admin/retention/user": (data: AdminPreviewData) => (data === "empty" ? { user: null, daily: [], events: [] } : {
    user: { ...retentionPerson(1), counts: { turn_failed: 3, "turn_failed:auth": 3 } },
    daily: [{ day: dayKey(now() - 9 * DAY), events: 14, counts: { ai_message: 1 } }],
    events: [
      { name: "session_end", code: "quit", ms: 331_000, at: now() - 9 * DAY },
      { name: "turn_failed", code: "auth", ms: null, at: now() - 9 * DAY - 60_000 },
      { name: "turn_failed", code: "auth", ms: null, at: now() - 9 * DAY - 120_000 },
      { name: "no_api_key", code: "key", ms: null, at: now() - 9 * DAY - 180_000 },
      { name: "ai_message", code: null, ms: null, at: now() - 9 * DAY - 200_000 },
      { name: "project_opened", code: null, ms: null, at: now() - 9 * DAY - 260_000 },
      { name: "day_active", code: null, ms: null, at: now() - 9 * DAY - 300_000 },
      { name: "session_start", code: "2.6.3", ms: null, at: now() - 9 * DAY - 300_000 },
      { name: "first_launch", code: null, ms: null, at: now() - 9 * DAY - 300_000 },
    ],
  }),
});
