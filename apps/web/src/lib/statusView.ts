/**
 * The status page's shapes and parser, kept apart from the server-only reader.
 *
 * `status.ts` can only be imported from server code because `readApi` reaches for
 * `next/cache`. The header's live status is a client component and needs the same
 * answer the status page renders, so the vocabulary lives here, with no imports at all.
 *
 * The API has already turned counts into levels and percentages. Nothing here recomputes
 * a threshold, so the page, the feed and the API cannot disagree about what "degraded" is.
 */

export interface StatusDay {
  /** ISO day, UTC. */
  day: string;
  level: string;
  turns: number;
  errors: number;
  avgMs: number | null;
}

export interface StatusModel {
  provider: string;
  /** The provider as a person reads it; one model id can arrive through two providers. */
  providerName: string;
  model: string;
  name: string;
  state: string;
  turns: number;
  ok: number;
  uptimePct: number | null;
  errorPct: number | null;
  avgMs: number | null;
  lastActiveDay: string | null;
  days: StatusDay[];
  candles?: StatusCandle[];
}

export interface StatusCandle {
  startAt: number;
  endAt: number;
  level: string;
  turns: number;
  errors: number;
  avgMs: number | null;
}

export interface StatusIncidentUpdate {
  updateId: string;
  status: string;
  body: string;
  createdAt: number;
}

export interface StatusIncident {
  incidentId: string;
  title: string;
  impact: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  resolvedAt: number | null;
  updates: StatusIncidentUpdate[];
}

export interface StatusView {
  asOf: number;
  windowDays: number;
  liveWindowMinutes?: number;
  overall: { state: string; title: string; activeIncidents: number };
  models: StatusModel[];
  incidents: StatusIncident[];
}

export const LEVEL_LABELS: Record<string, string> = {
  operational: "Operational",
  degraded: "Degraded performance",
  outage: "Outage",
  maintenance: "Maintenance",
  quiet: "No recent traffic",
};

/**
 * What the public page draws. A period with no requests had no failures either, so it is shown
 * as operational (green) rather than as a blank, colourless "no traffic" bar: the owner found a
 * page of grey gaps read as something wrong (23 Nov 2026). The API still reports `quiet`, and
 * the admin view and alerts keep telling no traffic apart from healthy traffic.
 */
export const shownLevel = (level: string): string => (level === "quiet" ? "operational" : level);

export const INCIDENT_STATUS_LABELS: Record<string, string> = {
  investigating: "Investigating",
  identified: "Identified",
  monitoring: "Monitoring",
  resolved: "Resolved",
};

export const IMPACT_LABELS: Record<string, string> = {
  none: "Informational",
  minor: "Minor",
  major: "Major",
  critical: "Critical",
  maintenance: "Maintenance",
};

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asString = (value: unknown): string | null => (typeof value === "string" ? value : null);
const asNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

function parseDay(raw: unknown): StatusDay | null {
  if (!record(raw)) return null;
  const day = asString(raw["day"]);
  const level = asString(raw["level"]);
  const turns = asNumber(raw["turns"]);
  const errors = asNumber(raw["errors"]);
  if (day === null || level === null || turns === null || errors === null) return null;
  return { day, level, turns, errors, avgMs: asNumber(raw["avgMs"]) };
}

function parseModel(raw: unknown): StatusModel | null {
  if (!record(raw)) return null;
  const provider = asString(raw["provider"]);
  const model = asString(raw["model"]);
  const name = asString(raw["name"]);
  const state = asString(raw["state"]);
  const turns = asNumber(raw["turns"]);
  const ok = asNumber(raw["ok"]);
  if (provider === null || model === null || name === null || state === null || turns === null || ok === null) {
    return null;
  }
  const days = Array.isArray(raw["days"])
    ? raw["days"].map(parseDay).filter((day): day is StatusDay => day !== null)
    : [];
  return {
    provider,
    providerName: asString(raw["providerName"]) ?? provider,
    model,
    name,
    state,
    turns,
    ok,
    uptimePct: asNumber(raw["uptimePct"]),
    errorPct: asNumber(raw["errorPct"]),
    avgMs: asNumber(raw["avgMs"]),
    lastActiveDay: asString(raw["lastActiveDay"]),
    days,
    ...(Array.isArray(raw["candles"]) ? { candles: raw["candles"].map(parseCandle).filter((candle): candle is StatusCandle => candle !== null) } : {}),
  };
}

function parseCandle(raw: unknown): StatusCandle | null {
  if (!record(raw)) return null;
  const startAt = asNumber(raw["startAt"]);
  const endAt = asNumber(raw["endAt"]);
  const level = asString(raw["level"]);
  const turns = asNumber(raw["turns"]);
  const errors = asNumber(raw["errors"]);
  if (startAt === null || endAt === null || endAt <= startAt || level === null || turns === null || errors === null) return null;
  return { startAt, endAt, level, turns, errors, avgMs: asNumber(raw["avgMs"]) };
}

function parseUpdate(raw: unknown): StatusIncidentUpdate | null {
  if (!record(raw)) return null;
  const updateId = asString(raw["updateId"]);
  const status = asString(raw["status"]);
  const body = asString(raw["body"]);
  const createdAt = asNumber(raw["createdAt"]);
  if (updateId === null || status === null || body === null || createdAt === null) return null;
  return { updateId, status, body, createdAt };
}

function parseIncident(raw: unknown): StatusIncident | null {
  if (!record(raw)) return null;
  const incidentId = asString(raw["incidentId"]);
  const title = asString(raw["title"]);
  const impact = asString(raw["impact"]);
  const status = asString(raw["status"]);
  const createdAt = asNumber(raw["createdAt"]);
  if (incidentId === null || title === null || impact === null || status === null || createdAt === null) {
    return null;
  }
  const updates = Array.isArray(raw["updates"])
    ? raw["updates"].map(parseUpdate).filter((update): update is StatusIncidentUpdate => update !== null)
    : [];
  return {
    incidentId,
    title,
    impact,
    status,
    createdAt,
    updatedAt: asNumber(raw["updatedAt"]) ?? createdAt,
    resolvedAt: asNumber(raw["resolvedAt"]),
    updates,
  };
}

/** Exported for the tests; the page never sees anything but `readStatus`'s answer. */
export function parseStatusView(raw: unknown): StatusView | null {
  if (!record(raw)) return null;
  const overallRaw = raw["overall"];
  if (!record(overallRaw)) return null;

  const state = asString(overallRaw["state"]);
  const title = asString(overallRaw["title"]);
  const activeIncidents = asNumber(overallRaw["activeIncidents"]);
  const asOf = asNumber(raw["asOf"]);
  const windowDays = asNumber(raw["windowDays"]);
  if (state === null || title === null || activeIncidents === null || asOf === null || windowDays === null) {
    return null;
  }

  const models = Array.isArray(raw["models"])
    ? raw["models"].map(parseModel).filter((model): model is StatusModel => model !== null)
    : [];
  const incidents = Array.isArray(raw["incidents"])
    ? raw["incidents"].map(parseIncident).filter((incident): incident is StatusIncident => incident !== null)
    : [];

  const liveWindowMinutes = asNumber(raw["liveWindowMinutes"]);
  return { asOf, windowDays, ...(liveWindowMinutes === null || liveWindowMinutes <= 0 ? {} : { liveWindowMinutes }), overall: { state, title, activeIncidents }, models, incidents };
}
