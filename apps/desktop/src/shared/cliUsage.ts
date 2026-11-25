/**
 * Coding CLI usage, as the window shows it: what Claude Code and Codex used on this computer.
 *
 * Read from the history those tools keep on disk (`main/cliUsage.ts`), so it covers work done
 * in a terminal, in another editor, or in ADCode driving the CLI - everything the CLI saw.
 * Costs are API list prices for the same tokens: what the work would have cost on a key, not
 * the subscription bill. That framing is T3 Code's, and the honest one.
 *
 * Types and formatting only; no I/O, safe for the renderer bundle.
 */

export type CliUsageProvider = "claude-code" | "codex";

export const CLI_USAGE_PROVIDERS: Readonly<Record<CliUsageProvider, string>> = {
  "claude-code": "Claude Code",
  codex: "Codex",
};

/** The ranges the view offers, in days. History older than the longest is never read. */
export const CLI_USAGE_DAYS = [1, 7, 30, 90] as const;
export type CliUsageDays = (typeof CLI_USAGE_DAYS)[number];

export interface CliUsageTokens {
  /** Input read fresh, at the full input price. */
  readonly input: number;
  /** Input served from the provider's prompt cache. */
  readonly cacheRead: number;
  /** Input written to the prompt cache. */
  readonly cacheWrite: number;
  readonly output: number;
  /** Reasoning tokens; already inside `output`, shown for the mix. */
  readonly reasoning: number;
}

export interface CliUsageTotals extends CliUsageTokens {
  readonly requests: number;
  /** input + cacheRead + cacheWrite + output. */
  readonly tokens: number;
  /** Estimated cost in micro-dollars, for the requests that could be priced. */
  readonly costMicros: number;
  /** What reading from the cache saved against the full input price. */
  readonly cacheSavedMicros: number;
  /** Requests on a model with no known price: counted in tokens, not in cost. */
  readonly unpricedRequests: number;
}

export interface CliUsageProviderRow {
  readonly provider: CliUsageProvider;
  readonly requests: number;
  readonly tokens: number;
  readonly costMicros: number;
  readonly sessions: number;
}

export interface CliUsageModelRow extends CliUsageTokens {
  readonly provider: CliUsageProvider;
  readonly model: string;
  readonly requests: number;
  readonly costMicros: number;
  readonly cacheSavedMicros: number;
  /** False when the catalogue has no price for this model. */
  readonly priced: boolean;
}

export interface CliUsageDay {
  /** Local "YYYY-MM-DD". */
  readonly day: string;
  readonly tokens: number;
  readonly costMicros: number;
  readonly requests: number;
}

export interface CliUsageLimitWindow {
  /** "5-hour", "Weekly", or the window's length. */
  readonly label: string;
  readonly usedPercent: number;
  readonly windowMinutes: number | null;
  /** Epoch ms; null when the CLI did not say. */
  readonly resetsAt: number | null;
}

export interface CliUsageLimits {
  readonly provider: CliUsageProvider;
  /** The plan the CLI reported ("plus", "pro"), when it did. */
  readonly plan: string | null;
  readonly windows: readonly CliUsageLimitWindow[];
  /** When the CLI recorded this reading: a limit is only as fresh as the last request. */
  readonly observedAt: number;
}

export interface CliUsageSource {
  readonly provider: CliUsageProvider;
  /** Where it was read, as a person would type it (`~/.claude/projects`). */
  readonly location: string;
  readonly found: boolean;
  /** History files in the scanned window. */
  readonly files: number;
  /** Files that could not be read this time. */
  readonly failed: number;
}

export interface CliUsageView {
  readonly days: number;
  readonly scannedAt: number;
  readonly totals: CliUsageTotals;
  readonly providers: readonly CliUsageProviderRow[];
  readonly models: readonly CliUsageModelRow[];
  /** One entry per day of the range, oldest first, including empty days. */
  readonly daily: readonly CliUsageDay[];
  readonly limits: readonly CliUsageLimits[];
  readonly sources: readonly CliUsageSource[];
  readonly sessions: number;
}

/** Share of prompt input served from cache, 0-1; null with no input at all. */
export function cacheHitRate(tokens: Pick<CliUsageTokens, "input" | "cacheRead" | "cacheWrite">): number | null {
  const prompt = tokens.input + tokens.cacheRead + tokens.cacheWrite;
  return prompt <= 0 ? null : tokens.cacheRead / prompt;
}

/** "12.4M", "830K", "912". */
export function formatCliTokens(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return "0";
  if (count >= 1_000_000_000) return `${(count / 1_000_000_000).toFixed(count >= 10_000_000_000 ? 0 : 1)}B`;
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(count >= 10_000_000 ? 0 : 1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(count >= 10_000 ? 0 : 1)}K`;
  return String(Math.round(count));
}

/** "$1,234", "$12.40", "$0.03", "<$0.01". */
export function formatCliCost(micros: number): string {
  if (!Number.isFinite(micros) || micros <= 0) return "$0";
  const dollars = micros / 1_000_000;
  if (dollars < 0.01) return "<$0.01";
  if (dollars >= 1_000) return `$${Math.round(dollars).toLocaleString("en-US")}`;
  return `$${dollars.toFixed(2)}`;
}

/** "in 2h 14m", "in 3d 4h", "now". */
export function formatResetIn(resetsAt: number, now: number): string {
  const minutes = Math.round((resetsAt - now) / 60_000);
  if (minutes <= 0) return "now";
  if (minutes < 60) return `in ${String(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `in ${String(hours)}h ${String(minutes % 60)}m`;
  return `in ${String(Math.floor(hours / 24))}d ${String(hours % 24)}h`;
}

/** A window's name from its length: Codex reports 300 and 10080 minutes. */
export function limitWindowLabel(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes) || minutes <= 0) return "Window";
  if (minutes === 300) return "5-hour";
  if (minutes === 10_080) return "Weekly";
  if (minutes % 1_440 === 0) return `${String(minutes / 1_440)}-day`;
  if (minutes % 60 === 0) return `${String(minutes / 60)}-hour`;
  return `${String(minutes)}-minute`;
}
