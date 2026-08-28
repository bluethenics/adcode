export interface AiUsageLimit {
  readonly retryAt: number;
  readonly reason: string;
}

export interface AiUsageLimitReader {
  push(data: string, now: number): AiUsageLimit | null;
  reset(): void;
}

const LIMIT = /\b(?:usage limit|rate limit|quota (?:is )?(?:reached|exceeded)|hit your (?:usage )?limit)\b/i;
const DELAY = /(?:try again|retry)(?:\s+after|\s+in)?\s+(\d{1,5})\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)/i;
const MIN_DELAY = 60_000;
const MAX_DELAY = 24 * 60 * 60_000;

export function detectAiUsageLimit(text: string, now: number): AiUsageLimit | null {
  if (!Number.isSafeInteger(now) || now < 0 || !LIMIT.test(text)) return null;
  const delay = DELAY.exec(text);
  if (delay === null) return null;
  const amount = Number(delay[1]);
  const unit = delay[2]?.toLowerCase() ?? "minutes";
  const multiplier = unit.startsWith("s") ? 1_000 : unit.startsWith("h") ? 3_600_000 : 60_000;
  const milliseconds = amount * multiplier;
  return {
    retryAt: now + Math.min(MAX_DELAY, Math.max(MIN_DELAY, milliseconds)),
    reason: /rate limit/i.test(text) ? "Rate limit reached" : "Usage limit reached",
  };
}

const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]/g;

export function createAiUsageLimitReader(): AiUsageLimitReader {
  let partial = "";
  return {
    push(data, now) {
      const pieces = `${partial}${data.replace(ANSI, "")}`.replaceAll("\r", "\n").split("\n");
      partial = (pieces.pop() ?? "").slice(-1_000);
      let latest: AiUsageLimit | null = null;
      for (const line of [...pieces, partial]) {
        if (line.trim().length === 0) continue;
        latest = detectAiUsageLimit(line, now);
      }
      return latest;
    },
    reset() {
      partial = "";
    },
  };
}
