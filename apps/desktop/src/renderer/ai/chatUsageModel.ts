/**
 * What the chat's own usage box says: this conversation's tokens, cost, cache, speed and
 * models, how full the context is, and today across every chat.
 *
 * The Usage dialog answers "how much have I used"; this answers "what is *this* chat costing
 * me, and is it running well" without leaving it. The numbers are the same rows the dialog
 * reads (`shared/usagePage.ts`, filtered to one chat), so the two never disagree.
 *
 * The tips are arithmetic on those numbers, never a guess: a full context, a model switch
 * that threw the cache away, requests that each re-read a long history.
 *
 * Pure: views in, words out. The popover in `chatUsagePopover.ts` draws it.
 */
import { formatTokens, formatUsageCost } from "../../shared/aiUsage.ts";
import { formatDuration } from "../../shared/usageInsights.ts";
import type { UsagePageView } from "../../shared/usagePage.ts";
import type { AiContextUsageView } from "../../shared/api.ts";

export type ChatUsageTone = "ok" | "warn" | "full" | "muted";

export interface ChatUsageRow {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly detail: string;
  /** 0-100 for a thin bar under the row; null draws none. */
  readonly percent: number | null;
  readonly tone: ChatUsageTone;
}

export interface ChatUsageModelRow {
  readonly name: string;
  readonly provider: string;
  readonly detail: string;
  /** Share of this chat's tokens, 0-100. */
  readonly share: number;
}

export interface ChatUsageModel {
  /** The chip in the chat header: short enough for a narrow panel. */
  readonly chip: string;
  readonly chipTitle: string;
  readonly empty: boolean;
  readonly rows: readonly ChatUsageRow[];
  readonly models: readonly ChatUsageModelRow[];
  readonly today: readonly ChatUsageRow[];
  readonly tips: readonly string[];
}

const PROVIDERS: Readonly<Record<string, string>> = {
  tagflow: "Included AI", anthropic: "Anthropic", openai: "OpenAI", google: "Google", openrouter: "OpenRouter", ollama: "Ollama",
  deepseek: "DeepSeek", mistral: "Mistral", xai: "xAI", groq: "Groq", custom: "Custom endpoint",
  "cli-claude": "Claude Code", "cli-codex": "Codex", "cli-opencode": "OpenCode", "cli-gemini": "Gemini CLI",
};

export function providerName(provider: string): string {
  return PROVIDERS[provider] ?? (provider.startsWith("cli-") ? `${provider.slice(4)} CLI` : provider.charAt(0).toUpperCase() + provider.slice(1));
}

const pct = (value: number): number => Math.max(0, Math.min(100, Math.round(value * 100)));
const tps = (value: number | null): string => (value === null ? "" : `${Math.round(value).toLocaleString("en-US")} tok/s`);

function contextRow(context: AiContextUsageView | null): ChatUsageRow | null {
  if (context === null || context.contextWindow <= 0) return null;
  const used = Math.min(100, Math.round((context.tokens / context.contextWindow) * 100));
  const threshold = Math.round(context.thresholdPercent);
  const tone: ChatUsageTone = used >= threshold ? "full" : used >= threshold - 15 ? "warn" : "ok";
  return {
    id: "context",
    label: "Context",
    value: `${String(used)}%`,
    detail: `${formatTokens(context.tokens)} of ${formatTokens(context.contextWindow)}${context.autoCompact ? ` · compacts at ${String(threshold)}%` : " · auto-compact off"}`,
    percent: used,
    tone,
  };
}

/**
 * `chat` is the Usage page filtered to this conversation over all time; `today` is the page for
 * today across everything. Either may be null while it loads or when it could not be read.
 */
export function chatUsageModel(chat: UsagePageView | null, context: AiContextUsageView | null, today: UsagePageView | null): ChatUsageModel {
  const rows: ChatUsageRow[] = [];
  const tips: string[] = [];
  const ctx = contextRow(context);
  if (ctx !== null) rows.push(ctx);

  const totals = chat?.totals ?? null;
  const empty = totals === null || totals.requests === 0;
  if (totals !== null && !empty) {
    const est = totals.estimated ? "≈ " : "";
    rows.push({
      id: "tokens",
      label: "Tokens",
      value: `${est}${formatTokens(totals.processedTokens)}`,
      detail: `${formatTokens(totals.uncachedTokens)} in · ${formatTokens(totals.cachedTokens)} cached · ${formatTokens(totals.outputTokens)} out`,
      percent: null,
      tone: "ok",
    });
    rows.push({
      id: "cost",
      label: "Cost",
      value: totals.costMicros === null ? "No price" : `${totals.costPartial ? "≥ " : ""}${formatUsageCost(totals.costMicros)}`,
      detail: totals.costMicros === null
        ? "This model's price is not in the catalogue"
        : `${formatUsageCost(chat?.perRequest.costMicros ?? null)} a request, at list price`,
      percent: null,
      tone: totals.costMicros === null ? "muted" : "ok",
    });
    const hit = pct(totals.cacheHitRate);
    rows.push({
      id: "cache",
      label: "Cache",
      value: `${String(hit)}%`,
      detail: totals.cacheSavedMicros === null ? "of input read from the prompt cache" : `of input from cache · saved ${formatUsageCost(totals.cacheSavedMicros)}`,
      percent: hit,
      tone: hit >= 50 ? "ok" : hit >= 20 ? "warn" : "muted",
    });
    const timed = (chat?.models ?? []).filter((model) => model.timedRequests > 0);
    if (timed.length > 0) {
      const count = timed.reduce((sum, model) => sum + model.timedRequests, 0);
      const avg = timed.reduce((sum, model) => sum + (model.averageResponseMs ?? 0) * model.timedRequests, 0) / count;
      const rate = timed.filter((model) => model.tokensPerSecond !== null);
      const speed = rate.length === 0 ? null : rate.reduce((sum, model) => sum + (model.tokensPerSecond ?? 0) * model.timedRequests, 0) / rate.reduce((sum, model) => sum + model.timedRequests, 0);
      rows.push({ id: "speed", label: "Speed", value: formatDuration(avg), detail: [`average answer`, tps(speed)].filter(Boolean).join(" · "), percent: null, tone: "ok" });
    }
    rows.push({
      id: "requests",
      label: "Requests",
      value: totals.requests.toLocaleString("en-US"),
      detail: `${formatTokens(chat?.perRequest.tokens ?? 0)} tokens each`,
      percent: null,
      tone: "ok",
    });

    if ((chat?.models.length ?? 0) > 1) tips.push(`This chat used ${String(chat?.models.length ?? 0)} models. Each switch re-reads the whole conversation without the cache, so staying on one model is cheaper and faster.`);
    if ((chat?.perRequest.tokens ?? 0) >= 60_000) tips.push(`Every request reads about ${formatTokens(chat?.perRequest.tokens ?? 0)} tokens of history. For an unrelated task, a new chat starts small and answers sooner.`);
    if (totals.requests >= 4 && hit < 20 && totals.inputTokens > 20_000) tips.push("Little of this chat came from the prompt cache. A model whose provider caches prompts bills the repeated history at a fraction of the price.");
  }
  if (ctx !== null && ctx.tone !== "ok") tips.unshift(ctx.tone === "full" ? "The context is full: the next request compacts it. Compact now to choose when." : "The context is filling up. Compacting soon keeps answers quick and cheap.");

  const models: ChatUsageModelRow[] = (chat?.models ?? []).slice(0, 4).map((model) => ({
    name: model.model,
    provider: providerName(model.provider),
    detail: [`${formatTokens(model.tokens)} tokens`, model.costMicros === null ? "" : formatUsageCost(model.costMicros), tps(model.tokensPerSecond)].filter(Boolean).join(" · "),
    share: pct(model.tokenShare),
  }));

  const day = today?.totals ?? null;
  const todayRows: ChatUsageRow[] = day === null ? [] : [
    { id: "today-tokens", label: "Tokens", value: formatTokens(day.processedTokens), detail: `${day.chats.toLocaleString("en-US")} chat${day.chats === 1 ? "" : "s"} · ${day.agentRequests.toLocaleString("en-US")} agent requests`, percent: null, tone: "ok" },
    { id: "today-cost", label: "Cost", value: day.costMicros === null ? "No price" : formatUsageCost(day.costMicros), detail: `${day.requests.toLocaleString("en-US")} requests`, percent: null, tone: day.costMicros === null ? "muted" : "ok" },
  ];

  const chipParts = empty ? [] : [formatTokens(totals?.processedTokens ?? 0), totals?.costMicros === null || totals?.costMicros === undefined ? "" : formatUsageCost(totals.costMicros)].filter(Boolean);
  const chip = ctx !== null ? [`${ctx.value}`, ...chipParts].join(" · ") : chipParts.length > 0 ? chipParts.join(" · ") : "Usage";
  const chipTitle = empty
    ? "This chat's usage: nothing yet. Open for context and today's totals."
    : `This chat: ${formatTokens(totals?.processedTokens ?? 0)} tokens over ${String(totals?.requests ?? 0)} requests${totals?.costMicros === null || totals?.costMicros === undefined ? "" : `, ${formatUsageCost(totals.costMicros)}`}. Open for the breakdown.`;

  return { chip, chipTitle, empty, rows, models, today: todayRows, tips: tips.slice(0, 2) };
}
