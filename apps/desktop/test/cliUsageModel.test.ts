import { describe, expect, it } from "vitest";
import type { CatalogueProvider } from "@adcode/ai";
import {
  cliPriceLookup,
  dedupeRecords,
  initialCodexState,
  parseClaudeLine,
  parseCodexLine,
  priceRecord,
  summarizeCliUsage,
  type CliUsageRecord,
} from "../src/main/cliUsageModel.ts";
import { cliUsageRoots } from "../src/main/cliUsage.ts";
import { formatCliCost, formatCliTokens, formatResetIn, limitWindowLabel } from "../src/shared/cliUsage.ts";

const catalogue: CatalogueProvider[] = [
  {
    id: "openrouter",
    name: "Reseller",
    env: [],
    doc: null,
    models: [{ id: "anthropic/claude-sonnet-4-5", name: "x", toolCall: true, reasoning: true, inputCostMicrosPerMillion: 9_000_000, outputCostMicrosPerMillion: 9_000_000 }],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    env: [],
    doc: null,
    models: [
      { id: "claude-sonnet-4-5", name: "Sonnet", toolCall: true, reasoning: true, inputCostMicrosPerMillion: 3_000_000, outputCostMicrosPerMillion: 15_000_000, cacheReadCostMicrosPerMillion: 300_000, cacheWriteCostMicrosPerMillion: 3_750_000 },
    ],
  },
  {
    id: "openai",
    name: "OpenAI",
    env: [],
    doc: null,
    models: [{ id: "gpt-5-codex", name: "Codex", toolCall: true, reasoning: true, inputCostMicrosPerMillion: 1_250_000, outputCostMicrosPerMillion: 10_000_000, cacheReadCostMicrosPerMillion: 125_000 }],
  },
];

function claudeLine(over: Record<string, unknown> = {}, usage: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "assistant",
    timestamp: "2026-11-20T10:00:00.000Z",
    sessionId: "s1",
    requestId: "req_1",
    message: { id: "msg_1", model: "claude-sonnet-4-5-20250929", usage: { input_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200, output_tokens: 50, ...usage } },
    ...over,
  });
}

describe("Claude Code history", () => {
  it("reads one request per assistant line, with each kind of token", () => {
    const [record] = parseClaudeLine(claudeLine());
    expect(record).toMatchObject({ provider: "claude-code", model: "claude-sonnet-4-5-20250929", sessionId: "s1", input: 10, cacheRead: 1000, cacheWrite: 200, output: 50, dedupeKey: "claude:msg_1:req_1" });
  });

  it("skips synthetic placeholders, user lines and broken JSON", () => {
    expect(parseClaudeLine(claudeLine({ message: { id: "m", model: "<synthetic>", usage: { input_tokens: 5, output_tokens: 5 } } }))).toEqual([]);
    expect(parseClaudeLine(JSON.stringify({ type: "user", message: { content: "hi" } }))).toEqual([]);
    expect(parseClaudeLine("{not json")).toEqual([]);
  });

  it("counts a repeated message once, at the largest figure for each kind of token", () => {
    const streamStart = parseClaudeLine(claudeLine({}, { output_tokens: 1 }));
    const final = parseClaudeLine(claudeLine({}, { output_tokens: 400 }));
    const copiedOnResume = parseClaudeLine(claudeLine({ sessionId: "s2" }, { output_tokens: 400 }));
    const once = dedupeRecords([...streamStart, ...final, ...copiedOnResume]);
    expect(once).toHaveLength(1);
    expect(once[0]!.output).toBe(400);
  });

  it("counts advisor calls as their own requests on their own model", () => {
    const records = parseClaudeLine(claudeLine({}, { iterations: [{ type: "advisor_message", model: "claude-opus-4-5", input_tokens: 7, output_tokens: 9 }, { type: "other" }] }));
    expect(records.map((record) => record.model)).toEqual(["claude-sonnet-4-5-20250929", "claude-opus-4-5"]);
    expect(records[1]).toMatchObject({ input: 7, output: 9, dedupeKey: "claude:msg_1:req_1:advisor:0" });
  });
});

function codex(type: string, payload: Record<string, unknown>, timestamp = "2026-11-20T10:00:00.000Z"): string {
  return JSON.stringify({ type, timestamp, payload });
}

function tokenCount(last: Record<string, number> | null, total: Record<string, number> | null, timestamp = "2026-11-20T10:00:05.000Z", extra: Record<string, unknown> = {}): string {
  return codex("event_msg", { type: "token_count", info: last === null && total === null ? null : { last_token_usage: last, total_token_usage: total }, ...extra }, timestamp);
}

describe("Codex history", () => {
  it("bills each request's last usage, on the model from the latest turn context", () => {
    const state = initialCodexState();
    parseCodexLine(codex("session_meta", { id: "sess" }), state);
    parseCodexLine(codex("turn_context", { model: "gpt-5-codex" }), state);
    const [record] = parseCodexLine(tokenCount({ input_tokens: 1000, cached_input_tokens: 600, output_tokens: 80, reasoning_output_tokens: 30, total_tokens: 1080 }, { input_tokens: 1000, cached_input_tokens: 600, output_tokens: 80, reasoning_output_tokens: 30, total_tokens: 1080 }), state);
    // Codex's input includes the cached part: fresh input is the difference.
    expect(record).toMatchObject({ provider: "codex", model: "gpt-5-codex", sessionId: "sess", input: 400, cacheRead: 600, output: 80, reasoning: 30 });
  });

  it("ignores a snapshot whose running total did not move, and zero-token context reports", () => {
    const state = initialCodexState();
    parseCodexLine(codex("turn_context", { model: "gpt-5-codex" }), state);
    const usage = { input_tokens: 100, output_tokens: 10, total_tokens: 110 };
    expect(parseCodexLine(tokenCount(usage, usage), state)).toHaveLength(1);
    expect(parseCodexLine(tokenCount(usage, usage, "2026-11-20T10:00:06.000Z"), state)).toHaveLength(0);
    expect(parseCodexLine(tokenCount({ input_tokens: 0, output_tokens: 0, total_tokens: 5000 }, { input_tokens: 100, output_tokens: 10, total_tokens: 110 }), state)).toHaveLength(0);
    const next = { input_tokens: 50, output_tokens: 5, total_tokens: 55 };
    expect(parseCodexLine(tokenCount(next, { input_tokens: 150, output_tokens: 15, total_tokens: 165 }, "2026-11-20T10:01:00.000Z"), state)).toHaveLength(1);
  });

  it("skips the parent history a fork copies in, then counts the fork's own work", () => {
    const state = initialCodexState();
    parseCodexLine(codex("session_meta", { id: "child", forked_from_id: "parent" }, "2026-11-20T10:00:00.000Z"), state);
    parseCodexLine(codex("turn_context", { model: "gpt-5-codex" }, "2026-11-20T10:00:00.010Z"), state);
    const copied = parseCodexLine(tokenCount({ input_tokens: 900, output_tokens: 9, total_tokens: 909 }, { input_tokens: 900, output_tokens: 9, total_tokens: 909 }, "2026-11-20T10:00:00.020Z"), state);
    expect(copied).toEqual([]);
    const own = parseCodexLine(tokenCount({ input_tokens: 40, output_tokens: 4, total_tokens: 44 }, { input_tokens: 940, output_tokens: 13, total_tokens: 953 }, "2026-11-20T10:00:30.000Z"), state);
    expect(own).toHaveLength(1);
    expect(own[0]!.input).toBe(40);
  });

  it("keeps the newest rate-limit reading, with reset times in either form", () => {
    const state = initialCodexState();
    parseCodexLine(tokenCount(null, null, "2026-11-20T10:00:00.000Z", { rate_limits: { primary: { used_percent: 20, window_minutes: 300, resets_in_seconds: 3600 }, secondary: { used_percent: 55, window_minutes: 10080, resets_at: 1_795_000_000 }, plan_type: "plus" } }), state);
    expect(state.limits?.plan).toBe("plus");
    expect(state.limits?.windows[0]).toEqual({ windowMinutes: 300, usedPercent: 20, resetsAt: Date.parse("2026-11-20T11:00:00.000Z") });
    expect(state.limits?.windows[1]?.resetsAt).toBe(1_795_000_000_000);
    parseCodexLine(tokenCount(null, null, "2026-11-20T09:00:00.000Z", { rate_limits: { primary: { used_percent: 99, window_minutes: 300 } } }), state);
    expect(state.limits?.windows[0]?.usedPercent).toBe(20);
  });

  it("treats identified request records as authoritative over snapshots", () => {
    const state = initialCodexState();
    parseCodexLine(codex("session_meta", { id: "sess" }), state);
    parseCodexLine(codex("turn_context", { model: "gpt-5-codex" }), state);
    const ledger = parseCodexLine(codex("token_usage_record", { response_id: "resp_1", usage: { input_tokens: 70, output_tokens: 7 } }, "2026-11-20T10:00:03.000Z"), state);
    expect(ledger[0]).toMatchObject({ input: 70, dedupeKey: "codex:sess:resp_1" });
    expect(parseCodexLine(tokenCount({ input_tokens: 70, output_tokens: 7, total_tokens: 77 }, { input_tokens: 70, output_tokens: 7, total_tokens: 77 }), state)).toEqual([]);
  });
});

describe("prices", () => {
  const price = cliPriceLookup(catalogue);

  it("prefers the model maker's own listing and finds dated and bracketed spellings", () => {
    expect(price("claude-sonnet-4-5-20250929")?.inputMicrosPerMillion).toBe(3_000_000);
    expect(price("claude-sonnet-4.5[1m]")?.inputMicrosPerMillion).toBe(3_000_000);
    expect(price("anthropic/claude-sonnet-4-5")?.inputMicrosPerMillion).toBe(3_000_000);
    expect(price("gpt-5-codex")?.cacheReadMicrosPerMillion).toBe(125_000);
  });

  it("refuses to guess for bare family names and unknown models", () => {
    expect(price("sonnet")).toBeNull();
    expect(price("my-local-model")).toBeNull();
  });

  it("prices each kind of token, one-hour cache writes at twice input", () => {
    const record: CliUsageRecord = { provider: "claude-code", at: 0, model: "claude-sonnet-4-5", sessionId: "", input: 1_000_000, cacheRead: 1_000_000, cacheWrite: 1_000_000, cacheWrite1h: 500_000, output: 1_000_000, reasoning: 0, reportedCostUsd: null, dedupeKey: null };
    // 3 + 0.3 + 0.5 * 3.75 + 0.5 * 6 + 15 = 23.175 dollars
    expect(priceRecord(record, price(record.model))).toBe(23_175_000);
    expect(priceRecord({ ...record, model: "unknown" }, price("unknown"))).toBeNull();
    expect(priceRecord({ ...record, reportedCostUsd: 1.5 }, null)).toBe(1_500_000);
  });
});

describe("the view", () => {
  const now = new Date(2026, 10, 24, 15, 0, 0).getTime();
  const base: Omit<CliUsageRecord, "at" | "model" | "provider"> = { sessionId: "a", input: 100, cacheRead: 900, cacheWrite: 0, cacheWrite1h: 0, output: 50, reasoning: 0, reportedCostUsd: null, dedupeKey: null };

  it("totals the range, splits by provider, model and day, and leaves unpriced models out of cost", () => {
    const records: CliUsageRecord[] = [
      { ...base, provider: "claude-code", model: "claude-sonnet-4-5", at: now - 3_600_000 },
      { ...base, provider: "codex", model: "gpt-5-codex", at: new Date(2026, 10, 22, 12).getTime(), sessionId: "b" },
      { ...base, provider: "codex", model: "mystery", at: new Date(2026, 10, 22, 13).getTime(), sessionId: "b" },
      { ...base, provider: "codex", model: "gpt-5-codex", at: new Date(2026, 9, 1).getTime() },
    ];
    const view = summarizeCliUsage({ records, limits: [], sources: [], days: 7, now, price: cliPriceLookup(catalogue) });
    expect(view.totals.requests).toBe(3);
    expect(view.totals.unpricedRequests).toBe(1);
    expect(view.sessions).toBe(2);
    expect(view.daily).toHaveLength(7);
    expect(view.daily.at(-1)?.day).toBe("2026-11-24");
    expect(view.daily.find((day) => day.day === "2026-11-22")?.requests).toBe(2);
    expect(view.providers.map((row) => row.provider).sort()).toEqual(["claude-code", "codex"]);
    expect(view.models.find((row) => row.model === "mystery")?.priced).toBe(false);
    expect(view.totals.cacheSavedMicros).toBeGreaterThan(0);
  });

  it("'today' starts at midnight", () => {
    const records: CliUsageRecord[] = [
      { ...base, provider: "codex", model: "gpt-5-codex", at: new Date(2026, 10, 24, 0, 30).getTime() },
      { ...base, provider: "codex", model: "gpt-5-codex", at: new Date(2026, 10, 23, 23, 30).getTime() },
    ];
    expect(summarizeCliUsage({ records, limits: [], sources: [], days: 1, now, price: () => null }).totals.requests).toBe(1);
  });

  it("shows only the newest limit reading per provider, with readable window names", () => {
    const view = summarizeCliUsage({
      records: [],
      limits: [
        { provider: "codex", at: 1, plan: "plus", windows: [{ windowMinutes: 300, usedPercent: 90, resetsAt: null }] },
        { provider: "codex", at: 2, plan: "pro", windows: [{ windowMinutes: 10_080, usedPercent: 10, resetsAt: null }] },
      ],
      sources: [],
      days: 7,
      now,
      price: () => null,
    });
    expect(view.limits).toHaveLength(1);
    expect(view.limits[0]).toMatchObject({ plan: "pro", windows: [{ label: "Weekly", usedPercent: 10 }] });
  });
});

describe("where history is read", () => {
  it("honours CLAUDE_CONFIG_DIR and CODEX_HOME", () => {
    const roots = cliUsageRoots({ CLAUDE_CONFIG_DIR: "/x/claude-a,/x/claude-b", CODEX_HOME: "/x/codex" }, "/home/me");
    expect(roots.filter((root) => root.provider === "claude-code").map((root) => root.dir.replace(/\\/g, "/"))).toEqual(["/x/claude-a/projects", "/x/claude-b/projects"]);
    expect(roots.filter((root) => root.provider === "codex").map((root) => root.dir.replace(/\\/g, "/"))).toEqual(["/x/codex/sessions", "/x/codex/archived_sessions"]);
  });

  it("defaults to the home folder and shows paths the way people type them", () => {
    const roots = cliUsageRoots({}, "/home/me");
    expect(roots.map((root) => root.location)).toEqual(["~/.claude/projects", "~/.config/claude/projects", "~/.codex/sessions", "~/.codex/archived_sessions"]);
  });
});

describe("formatting", () => {
  it("formats tokens, costs, resets and window names", () => {
    expect(formatCliTokens(12_400_000)).toBe("12M");
    expect(formatCliTokens(1_250)).toBe("1.3K");
    expect(formatCliCost(12_400_000)).toBe("$12.40");
    expect(formatCliCost(4_000)).toBe("<$0.01");
    expect(formatCliCost(1_234_000_000)).toBe("$1,234");
    expect(formatResetIn(10 * 60_000 + 134 * 60_000, 10 * 60_000)).toBe("in 2h 14m");
    expect(limitWindowLabel(300)).toBe("5-hour");
    expect(limitWindowLabel(10_080)).toBe("Weekly");
    expect(limitWindowLabel(1_440)).toBe("1-day");
  });
});
