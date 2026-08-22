/**
 * Formatting money for the screen.
 *
 * The API sends micros as decimal strings and this never turns them into a JS number -
 * above 2^53 that has already lost precision, and a balance is exactly the thing you must
 * not round by accident. Everything here is string and BigInt arithmetic.
 */

/** "$12.34". Two places, for figures people compare at a glance. */
export function money(micros: string): string {
  const value = BigInt(micros || "0");
  const negative = value < 0n;
  const abs = negative ? -value : value;

  const whole = abs / 1_000_000n;
  const cents = (abs % 1_000_000n) / 10_000n;

  return `${negative ? "-" : ""}$${whole.toLocaleString("en-US")}.${cents.toString().padStart(2, "0")}`;
}

/** "$0.004000". Six places, for per-impression amounts that two places would show as zero. */
export function moneyExact(micros: string): string {
  const value = BigInt(micros || "0");
  const negative = value < 0n;
  const abs = negative ? -value : value;

  const whole = abs / 1_000_000n;
  const frac = (abs % 1_000_000n).toString().padStart(6, "0");

  return `${negative ? "-" : ""}$${whole.toLocaleString("en-US")}.${frac}`;
}

/** Micros are a millionth; a CPM quoted in dollars is what advertisers actually think in. */
export function dollarsToMicros(dollars: string): string | null {
  const match = /^\s*\$?\s*([0-9]+)(?:\.([0-9]{1,6}))?\s*$/.exec(dollars);
  if (match === null) return null;

  const whole = BigInt(match[1] as string);
  const frac = BigInt(((match[2] ?? "").padEnd(6, "0")).slice(0, 6));

  return (whole * 1_000_000n + frac).toString();
}

export function when(ms: number): string {
  return new Date(ms).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Status to the pill's tone. Unknown statuses get the neutral pill rather than none. */
export function tone(status: string): string {
  switch (status) {
    case "active":
    case "approved":
      return "live";
    case "paused":
      return "paused";
    case "ended":
    case "rejected":
    case "banned":
      return "ended";
    case "pending":
      return "pending";
    default:
      return "neutral";
  }
}

/** What an advertiser calls the state, rather than what the database calls it. */
export function statusLabel(status: string): string {
  switch (status) {
    case "active":
      return "Live";
    case "paused":
      return "Paused";
    case "ended":
      return "Ended";
    case "approved":
      return "Approved";
    case "pending":
      return "In review";
    case "rejected":
      return "Rejected";
    default:
      return status;
  }
}
