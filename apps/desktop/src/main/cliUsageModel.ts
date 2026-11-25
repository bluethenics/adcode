/**
 * Coding CLI usage: the pure part. Lines from Claude Code's and Codex's history files go in,
 * requests come out, and a window's worth of requests becomes the view.
 *
 * The parsing rules are ported from T3 Code's usage readers (MIT License, Copyright (c) 2026
 * T3 Tools Inc.; apps/server/src/provider/Drivers/claudeUsage.ts and codexUsage.ts), kept to
 * the cases that change a total:
 *
 *  - **Claude Code** writes one line per assistant content block, repeating the message's
 *    usage on each, and a resumed session copies earlier lines into its new file. A request
 *    is `message.id` + `requestId`; it counts once, at the largest figure seen for each kind
 *    of token (a stream-start line can carry smaller numbers than the final one). Advisor
 *    calls in `usage.iterations` run on another model and count as their own requests.
 *    `<synthetic>` placeholders never reached the API and are skipped.
 *  - **Codex** reports `token_count` events with the request's `last_token_usage` and the
 *    session's `total_token_usage`, but no model: the model is carried from the latest
 *    `turn_context`. A snapshot whose running total did not move is a repeat. Zero-token
 *    snapshots report context size, not a request. A forked or sub-agent session starts by
 *    copying its parent's lines in a burst; those are already counted in the parent. Codex's
 *    `input_tokens` include the cached part, so fresh input is input minus cache.
 *    `token_usage_record` lines with a `response_id` are authoritative when present.
 *  - Codex also records the account's **rate limits** on its `token_count` events; the
 *    newest reading is the limit as of the last request.
 *
 * Prices come from ADCode's own model catalogue, so a CLI request and a chat request on the
 * same model are priced alike. Plain TypeScript: no fs, no Electron.
 */
import type { CatalogueProvider } from "@adcode/ai";
import { dayKey } from "../shared/aiUsage.ts";
import {
  limitWindowLabel,
  type CliUsageDay,
  type CliUsageLimits,
  type CliUsageModelRow,
  type CliUsageProvider,
  type CliUsageProviderRow,
  type CliUsageSource,
  type CliUsageView,
} from "../shared/cliUsage.ts";

export interface CliUsageRecord {
  readonly provider: CliUsageProvider;
  readonly at: number;
  readonly model: string;
  readonly sessionId: string;
  /** Fresh input, at the full input price. */
  readonly input: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  /** Of `cacheWrite`, the part written with a one-hour lifetime (priced higher). */
  readonly cacheWrite1h: number;
  readonly output: number;
  readonly reasoning: number;
  /** The cost the CLI itself recorded, when it did (older Claude Code versions). */
  readonly reportedCostUsd: number | null;
  /** The same key is the same request reported again. */
  readonly dedupeKey: string | null;
}

/** Synthetic placeholders and bare family names cannot be priced. */
const UNPRICEABLE = new Set(["<synthetic>", "synthetic", "opus", "sonnet", "haiku", "fable"]);
const CLAUDE_SYNTHETIC = "<synthetic>";

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function timeOf(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value > 10_000_000_000 ? value : value * 1000;
  if (typeof value !== "string" || value.length === 0) return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? at : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function parseJson(line: string): unknown {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return null;
  }
}

/* ── Claude Code ──────────────────────────────────────────────────────────────────────── */

function oneHourWrites(usage: Record<string, unknown>): number {
  return count(record(usage["cache_creation"])?.["ephemeral_1h_input_tokens"]);
}

/** The requests one Claude Code history line reports: none, the reply, and any advisor calls. */
export function parseClaudeLine(line: string): readonly CliUsageRecord[] {
  const entry = record(parseJson(line));
  if (entry === null || entry["type"] !== "assistant") return [];
  const message = record(entry["message"]);
  const usage = message === null ? null : record(message["usage"]);
  if (message === null || usage === null) return [];
  const at = timeOf(entry["timestamp"]);
  if (at === null) return [];
  const model = typeof message["model"] === "string" ? message["model"] : "";
  if (model.length === 0 || model === CLAUDE_SYNTHETIC) return [];
  const messageId = typeof message["id"] === "string" ? message["id"] : null;
  const requestId = typeof entry["requestId"] === "string" ? entry["requestId"] : null;
  const dedupeKey = messageId === null && requestId === null ? null : `claude:${messageId ?? ""}:${requestId ?? ""}`;
  const cost = entry["costUSD"];
  const sessionId = typeof entry["sessionId"] === "string" ? entry["sessionId"] : "";
  const main: CliUsageRecord = {
    provider: "claude-code",
    at,
    model,
    sessionId,
    input: count(usage["input_tokens"]),
    cacheRead: count(usage["cache_read_input_tokens"]),
    cacheWrite: count(usage["cache_creation_input_tokens"]),
    cacheWrite1h: oneHourWrites(usage),
    output: count(usage["output_tokens"]),
    // Anthropic folds thinking into output and does not break it out.
    reasoning: 0,
    reportedCostUsd: typeof cost === "number" && Number.isFinite(cost) ? cost : null,
    dedupeKey,
  };
  const out: CliUsageRecord[] = [main];
  const iterations = Array.isArray(usage["iterations"]) ? (usage["iterations"] as unknown[]) : [];
  for (const [index, raw] of iterations.entries()) {
    const advisor = record(raw);
    if (advisor === null || advisor["type"] !== "advisor_message") continue;
    const advisorModel = typeof advisor["model"] === "string" ? advisor["model"] : "";
    if (advisorModel.length === 0 || advisorModel === CLAUDE_SYNTHETIC) continue;
    out.push({
      provider: "claude-code",
      at,
      model: advisorModel,
      sessionId,
      input: count(advisor["input_tokens"]),
      cacheRead: count(advisor["cache_read_input_tokens"]),
      cacheWrite: count(advisor["cache_creation_input_tokens"]),
      cacheWrite1h: oneHourWrites(advisor),
      output: count(advisor["output_tokens"]),
      reasoning: 0,
      reportedCostUsd: null,
      dedupeKey: dedupeKey === null ? null : `${dedupeKey}:advisor:${String(index)}`,
    });
  }
  return out;
}

/** Cheap byte test before a JSON parse: a Claude line without this never carries usage. */
export const CLAUDE_USAGE_MARKERS = ['"usage"'] as const;

/* ── Codex ────────────────────────────────────────────────────────────────────────────── */

interface CodexTokens {
  readonly input: number;
  readonly cached: number;
  readonly cacheWrite: number;
  readonly output: number;
  readonly reasoning: number;
  readonly total: number;
}

export interface CliLimitObservation {
  readonly provider: CliUsageProvider;
  readonly at: number;
  readonly plan: string | null;
  readonly windows: readonly { readonly windowMinutes: number | null; readonly usedPercent: number; readonly resetsAt: number | null }[];
}

/** What a Codex file has said so far; carried across lines, and across reads of a growing file. */
export interface CodexScanState {
  model: string;
  sessionId: string;
  lastTotal: CodexTokens | null;
  lastSignature: string | null;
  /** Identified per-request records are being written: snapshots only rebase. */
  ledgerActive: boolean;
  sawMeta: boolean;
  suppressingForkCopies: boolean;
  forkAnchor: number;
  limits: CliLimitObservation | null;
}

export function initialCodexState(): CodexScanState {
  return {
    model: "",
    sessionId: "",
    lastTotal: null,
    lastSignature: null,
    ledgerActive: false,
    sawMeta: false,
    suppressingForkCopies: false,
    forkAnchor: 0,
    limits: null,
  };
}

export function cloneCodexState(state: CodexScanState): CodexScanState {
  return { ...state };
}

export const CODEX_USAGE_MARKERS = ['"token_count"', '"token_usage_record"', '"turn_context"', '"session_meta"'] as const;

/** Forks copy parent history in a burst (tens of ms apart); real child usage follows a model turn. */
const FORK_COPY_MAX_GAP_MS = 1000;

function readCodexTokens(value: unknown): CodexTokens | null {
  const raw = record(value);
  if (raw === null) return null;
  const input = raw["input_tokens"];
  const output = raw["output_tokens"];
  if (typeof input !== "number" || typeof output !== "number" || input < 0 || output < 0) return null;
  const tokens: CodexTokens = {
    input: Math.floor(input),
    cached: count(raw["cached_input_tokens"]),
    cacheWrite: count(raw["cache_write_input_tokens"]),
    output: Math.floor(output),
    reasoning: count(raw["reasoning_output_tokens"]),
    total: typeof raw["total_tokens"] === "number" ? count(raw["total_tokens"]) : Math.floor(input + output),
  };
  if (tokens.cached + tokens.cacheWrite > tokens.input || tokens.reasoning > tokens.output) return null;
  return tokens;
}

function sameTokens(a: CodexTokens, b: CodexTokens): boolean {
  return a.input === b.input && a.cached === b.cached && a.cacheWrite === b.cacheWrite && a.output === b.output && a.reasoning === b.reasoning && a.total === b.total;
}

function isForkedMeta(payload: Record<string, unknown>): boolean {
  if (typeof payload["forked_from_id"] === "string") return true;
  const spawn = record(record(record(payload["source"])?.["subagent"])?.["thread_spawn"]);
  return typeof spawn?.["parent_thread_id"] === "string";
}

function isForkCopy(state: CodexScanState, at: number): boolean {
  if (!state.suppressingForkCopies) return false;
  if (at - state.forkAnchor < FORK_COPY_MAX_GAP_MS) {
    state.forkAnchor = at;
    return true;
  }
  state.suppressingForkCopies = false;
  state.lastSignature = null;
  return false;
}

function codexRecord(state: CodexScanState, tokens: CodexTokens, at: number, dedupeKey: string | null): CliUsageRecord {
  return {
    provider: "codex",
    at,
    // Very old rollouts have no turn_context: keep the tokens, say the model is unknown.
    model: state.model.length > 0 ? state.model : "codex (model unknown)",
    sessionId: state.sessionId,
    input: Math.max(0, tokens.input - tokens.cached - tokens.cacheWrite),
    cacheRead: tokens.cached,
    cacheWrite: tokens.cacheWrite,
    cacheWrite1h: 0,
    output: tokens.output,
    reasoning: tokens.reasoning,
    reportedCostUsd: null,
    dedupeKey,
  };
}

function readCodexLimits(value: unknown, at: number): CliLimitObservation | null {
  const raw = record(value);
  if (raw === null) return null;
  const windows: CliLimitObservation["windows"][number][] = [];
  for (const key of ["primary", "secondary"]) {
    const window = record(raw[key]);
    if (window === null) continue;
    const used = window["used_percent"];
    if (typeof used !== "number" || !Number.isFinite(used)) continue;
    const minutes = typeof window["window_minutes"] === "number" && Number.isFinite(window["window_minutes"]) ? window["window_minutes"] : null;
    const resetsAtRaw = window["resets_at"];
    const resetsIn = window["resets_in_seconds"];
    const resetsAt = typeof resetsAtRaw === "number" && Number.isFinite(resetsAtRaw)
      ? (resetsAtRaw > 10_000_000_000 ? resetsAtRaw : resetsAtRaw * 1000)
      : typeof resetsAtRaw === "string" ? timeOf(resetsAtRaw)
        : typeof resetsIn === "number" && Number.isFinite(resetsIn) ? at + resetsIn * 1000 : null;
    windows.push({ windowMinutes: minutes, usedPercent: Math.max(0, Math.min(100, used)), resetsAt });
  }
  if (windows.length === 0) return null;
  const plan = typeof raw["plan_type"] === "string" && raw["plan_type"].length > 0 ? raw["plan_type"] : null;
  return { provider: "codex", at, plan, windows };
}

/** The requests one Codex rollout line reports. Updates `state`, including the newest limits. */
export function parseCodexLine(line: string, state: CodexScanState): readonly CliUsageRecord[] {
  const entry = record(parseJson(line));
  const payload = entry === null ? null : record(entry["payload"]);
  if (entry === null || payload === null) return [];
  const at = timeOf(entry["timestamp"]);

  if (entry["type"] === "session_meta") {
    // Only the first meta names this session; copied ancestor metas would misattribute.
    if (state.sawMeta) return [];
    state.sawMeta = true;
    const id = payload["id"] ?? payload["session_id"];
    if (typeof id === "string") state.sessionId = id;
    if (typeof payload["model"] === "string" && state.model.length === 0) state.model = payload["model"];
    if (at !== null && isForkedMeta(payload)) {
      state.suppressingForkCopies = true;
      state.forkAnchor = at;
    }
    return [];
  }

  if (entry["type"] === "turn_context") {
    state.ledgerActive = false;
    if (typeof payload["model"] === "string" && payload["model"].length > 0) state.model = payload["model"];
    return [];
  }

  if (entry["type"] === "token_usage_record") {
    const tokens = readCodexTokens(payload["usage"]);
    const responseId = payload["response_id"];
    if (at === null || tokens === null || typeof responseId !== "string" || responseId.length === 0) return [];
    if (isForkCopy(state, at)) return [];
    state.ledgerActive = true;
    return [codexRecord(state, tokens, at, `codex:${state.sessionId}:${responseId}`)];
  }

  if (payload["type"] !== "token_count" || at === null) return [];
  const limits = readCodexLimits(payload["rate_limits"], at);
  if (limits !== null && (state.limits === null || limits.at >= state.limits.at)) state.limits = limits;

  const info = record(payload["info"]);
  if (info === null) return [];
  const last = readCodexTokens(info["last_token_usage"]);
  const hasTotal = info["total_token_usage"] !== undefined && info["total_token_usage"] !== null;
  const total = hasTotal ? readCodexTokens(info["total_token_usage"]) : null;

  if (isForkCopy(state, at)) {
    // Already counted in the parent; it still sets this session's baseline.
    if (total !== null) state.lastTotal = total;
    state.lastSignature = last === null ? null : JSON.stringify(last);
    return [];
  }
  // Snapshots can rewind on resume and miss compaction spending; identified records win.
  if (state.ledgerActive) {
    if (total !== null) state.lastTotal = total;
    return [];
  }
  const previous = state.lastTotal;
  if (total !== null) state.lastTotal = total;
  if (last === null) return [];
  // Zero-token snapshots report context size (and the post-compaction marker), not a request.
  if (last.input + last.output === 0) {
    state.lastSignature = null;
    return [];
  }
  if (total !== null && previous !== null && sameTokens(total, previous)) return [];
  const signature = JSON.stringify(last);
  if (total === null && signature === state.lastSignature) return [];
  state.lastSignature = signature;
  // Without a session id two rollouts cannot be told apart, so only same-file repeats are caught.
  const key = state.sessionId.length > 0 ? `codex:${state.sessionId}:${String(at)}:${signature}` : null;
  return [codexRecord(state, last, at, key)];
}

/* ── Prices ───────────────────────────────────────────────────────────────────────────── */

export interface CliPrice {
  readonly inputMicrosPerMillion: number;
  readonly outputMicrosPerMillion: number;
  readonly cacheReadMicrosPerMillion: number;
  readonly cacheWriteMicrosPerMillion: number;
}

/** The model makers' own listings: their price beats a reseller's for the same bare name. */
const FIRST_PARTY = ["anthropic", "openai"];

function normalModel(model: string): string {
  let key = model.trim().toLowerCase();
  const bracket = key.indexOf("[");
  if (bracket !== -1) key = key.slice(0, bracket);
  const slash = key.lastIndexOf("/");
  if (slash !== -1) key = key.slice(slash + 1);
  // Bedrock and Vertex spellings of the same model.
  key = key.replace(/^(?:us|eu|apac|global)\.anthropic\./, "").replace(/^anthropic\./, "").replace(/-v\d+(?::\d+)?$/, "").replace(/@\d{8}$/, "");
  return key;
}

/** The ways a CLI spells a catalogue id: dated, dotted (claude-opus-4.5) or dashed. */
function candidates(model: string): readonly string[] {
  const key = normalModel(model);
  const undated = key.replace(/-\d{8}$/, "");
  const out = new Set([key, undated, key.replace(/(\d)\.(\d)/g, "$1-$2"), undated.replace(/(\d)\.(\d)/g, "$1-$2"), undated.replace(/(\d)-(\d)(?!\d)/g, "$1.$2")]);
  return [...out];
}

/** A price lookup over the catalogue. Unknown and unpriceable models answer null. */
export function cliPriceLookup(catalogue: readonly CatalogueProvider[]): (model: string) => CliPrice | null {
  const table = new Map<string, CliPrice>();
  const ordered = [
    ...FIRST_PARTY.map((id) => catalogue.find((provider) => provider.id === id)).filter((provider): provider is CatalogueProvider => provider !== undefined),
    ...catalogue.filter((provider) => !FIRST_PARTY.includes(provider.id)),
  ];
  for (const provider of ordered) {
    for (const model of provider.models) {
      const input = model.inputCostMicrosPerMillion;
      const output = model.outputCostMicrosPerMillion;
      if (typeof input !== "number" || typeof output !== "number" || input <= 0 || output <= 0) continue;
      const key = normalModel(model.id);
      if (table.has(key)) continue;
      table.set(key, {
        inputMicrosPerMillion: input,
        outputMicrosPerMillion: output,
        cacheReadMicrosPerMillion: typeof model.cacheReadCostMicrosPerMillion === "number" ? model.cacheReadCostMicrosPerMillion : input,
        cacheWriteMicrosPerMillion: typeof model.cacheWriteCostMicrosPerMillion === "number" ? model.cacheWriteCostMicrosPerMillion : input,
      });
    }
  }
  const resolved = new Map<string, CliPrice | null>();
  return (model) => {
    const hit = resolved.get(model);
    if (hit !== undefined) return hit;
    const key = normalModel(model);
    let price: CliPrice | null = null;
    if (key.length > 0 && !UNPRICEABLE.has(key)) {
      for (const candidate of candidates(model)) {
        const found = table.get(candidate);
        if (found !== undefined) { price = found; break; }
      }
    }
    resolved.set(model, price);
    return price;
  };
}

/** Micro-dollars for one request; null when it cannot be priced. */
export function priceRecord(entry: CliUsageRecord, price: CliPrice | null): number | null {
  if (price === null) return entry.reportedCostUsd === null ? null : Math.round(entry.reportedCostUsd * 1_000_000);
  if (entry.reportedCostUsd !== null) return Math.round(entry.reportedCostUsd * 1_000_000);
  const oneHour = Math.min(entry.cacheWrite1h, entry.cacheWrite);
  // A one-hour cache write is listed at twice the input price; the catalogue lists the five-minute rate.
  const micros =
    entry.input * price.inputMicrosPerMillion +
    entry.cacheRead * price.cacheReadMicrosPerMillion +
    (entry.cacheWrite - oneHour) * price.cacheWriteMicrosPerMillion +
    oneHour * price.inputMicrosPerMillion * 2 +
    entry.output * price.outputMicrosPerMillion;
  return Math.round(micros / 1_000_000);
}

function savedRecord(entry: CliUsageRecord, price: CliPrice | null): number {
  if (price === null) return 0;
  return Math.round((entry.cacheRead * Math.max(0, price.inputMicrosPerMillion - price.cacheReadMicrosPerMillion)) / 1_000_000);
}

/* ── The view ─────────────────────────────────────────────────────────────────────────── */

/**
 * One copy of each request: a repeated key keeps the largest figure for each kind of token.
 * Records without a key are all kept.
 */
export function dedupeRecords(records: readonly CliUsageRecord[]): CliUsageRecord[] {
  const byKey = new Map<string, CliUsageRecord>();
  const out: CliUsageRecord[] = [];
  for (const entry of records) {
    if (entry.dedupeKey === null) { out.push(entry); continue; }
    const held = byKey.get(entry.dedupeKey);
    if (held === undefined) { byKey.set(entry.dedupeKey, entry); continue; }
    byKey.set(entry.dedupeKey, {
      ...held,
      input: Math.max(held.input, entry.input),
      cacheRead: Math.max(held.cacheRead, entry.cacheRead),
      cacheWrite: Math.max(held.cacheWrite, entry.cacheWrite),
      cacheWrite1h: Math.max(held.cacheWrite1h, entry.cacheWrite1h),
      output: Math.max(held.output, entry.output),
      reasoning: Math.max(held.reasoning, entry.reasoning),
      reportedCostUsd: held.reportedCostUsd === null ? entry.reportedCostUsd : entry.reportedCostUsd === null ? held.reportedCostUsd : Math.max(held.reportedCostUsd, entry.reportedCostUsd),
    });
  }
  out.push(...byKey.values());
  return out;
}

export interface SummarizeCliUsageInput {
  readonly records: readonly CliUsageRecord[];
  readonly limits: readonly CliLimitObservation[];
  readonly sources: readonly CliUsageSource[];
  readonly days: number;
  readonly now: number;
  readonly price: (model: string) => CliPrice | null;
}

function startOfDay(at: number): number {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function summarizeCliUsage(input: SummarizeCliUsageInput): CliUsageView {
  const days = Math.max(1, Math.min(90, Math.floor(input.days)));
  // "Today" is since midnight; longer ranges are whole days ending today.
  const since = startOfDay(input.now) - (days - 1) * 86_400_000;
  const inRange = dedupeRecords(input.records).filter((entry) => entry.at >= since && entry.at <= input.now + 60_000);

  const models = new Map<string, { -readonly [K in keyof CliUsageModelRow]: CliUsageModelRow[K] }>();
  const providers = new Map<CliUsageProvider, { requests: number; tokens: number; costMicros: number; sessions: Set<string> }>();
  const daily = new Map<string, { tokens: number; costMicros: number; requests: number }>();
  const sessions = new Set<string>();
  const totals = { requests: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0, tokens: 0, costMicros: 0, cacheSavedMicros: 0, unpricedRequests: 0 };

  for (const entry of inRange) {
    const price = input.price(entry.model);
    const cost = priceRecord(entry, price);
    const saved = savedRecord(entry, price);
    const tokens = entry.input + entry.cacheRead + entry.cacheWrite + entry.output;
    totals.requests += 1;
    totals.input += entry.input;
    totals.cacheRead += entry.cacheRead;
    totals.cacheWrite += entry.cacheWrite;
    totals.output += entry.output;
    totals.reasoning += entry.reasoning;
    totals.tokens += tokens;
    totals.costMicros += cost ?? 0;
    totals.cacheSavedMicros += saved;
    if (cost === null) totals.unpricedRequests += 1;
    if (entry.sessionId.length > 0) sessions.add(`${entry.provider}:${entry.sessionId}`);

    const modelKey = `${entry.provider}\u0000${entry.model}`;
    const row = models.get(modelKey) ?? { provider: entry.provider, model: entry.model, requests: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0, costMicros: 0, cacheSavedMicros: 0, priced: cost !== null };
    row.requests += 1;
    row.input += entry.input;
    row.cacheRead += entry.cacheRead;
    row.cacheWrite += entry.cacheWrite;
    row.output += entry.output;
    row.reasoning += entry.reasoning;
    row.costMicros += cost ?? 0;
    row.cacheSavedMicros += saved;
    row.priced = row.priced || cost !== null;
    models.set(modelKey, row);

    const provider = providers.get(entry.provider) ?? { requests: 0, tokens: 0, costMicros: 0, sessions: new Set<string>() };
    provider.requests += 1;
    provider.tokens += tokens;
    provider.costMicros += cost ?? 0;
    if (entry.sessionId.length > 0) provider.sessions.add(entry.sessionId);
    providers.set(entry.provider, provider);

    const day = dayKey(entry.at);
    const bucket = daily.get(day) ?? { tokens: 0, costMicros: 0, requests: 0 };
    bucket.tokens += tokens;
    bucket.costMicros += cost ?? 0;
    bucket.requests += 1;
    daily.set(day, bucket);
  }

  const dayRows: CliUsageDay[] = [];
  for (let index = days - 1; index >= 0; index -= 1) {
    // Noon avoids a daylight-saving hour moving the key onto the wrong date.
    const day = dayKey(startOfDay(input.now) - index * 86_400_000 + 12 * 3_600_000);
    const bucket = daily.get(day);
    dayRows.push({ day, tokens: bucket?.tokens ?? 0, costMicros: bucket?.costMicros ?? 0, requests: bucket?.requests ?? 0 });
  }

  const providerRows: CliUsageProviderRow[] = [...providers].map(([provider, row]) => ({ provider, requests: row.requests, tokens: row.tokens, costMicros: row.costMicros, sessions: row.sessions.size }))
    .sort((a, b) => b.costMicros - a.costMicros || b.tokens - a.tokens);
  const modelRows = [...models.values()].sort((a, b) => b.costMicros - a.costMicros || (b.input + b.cacheRead + b.output) - (a.input + a.cacheRead + a.output));

  // The newest reading per provider: an older file's limit is history, not the limit now.
  const newest = new Map<CliUsageProvider, CliLimitObservation>();
  for (const observation of input.limits) {
    const held = newest.get(observation.provider);
    if (held === undefined || observation.at > held.at) newest.set(observation.provider, observation);
  }
  const limits: CliUsageLimits[] = [...newest.values()].map((observation) => ({
    provider: observation.provider,
    plan: observation.plan,
    observedAt: observation.at,
    windows: observation.windows.map((window) => ({
      label: limitWindowLabel(window.windowMinutes),
      usedPercent: window.usedPercent,
      windowMinutes: window.windowMinutes,
      // A reset already in the past refilled the window; the reading no longer applies to it.
      resetsAt: window.resetsAt,
    })),
  }));

  return {
    days,
    scannedAt: input.now,
    totals,
    providers: providerRows,
    models: modelRows,
    daily: dayRows,
    limits,
    sources: input.sources,
    sessions: sessions.size,
  };
}
