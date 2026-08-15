/**
 * Mirror the server balance, and format micros for display.
 *
 * Pure (brief §8). Every operation here is integer arithmetic on bigint: no `Number`,
 * no `toFixed`, no `toLocaleString`. §1 is explicit that "display formatting uses
 * integer arithmetic only", because binary floating point cannot represent decimal
 * currency exactly and rounding drift in a revenue-share ledger is a legal problem
 * rather than a rounding problem.
 *
 * This module never *computes* a monetary value. It mirrors what the server said and
 * renders it. The only arithmetic below splits one value into its whole and fractional
 * parts for display.
 */
import { MICROS_PER_USD, type Balance, type Micros } from "./types.ts";

/** Insert thousands separators into a run of digits, right to left. */
function group(digits: string): string {
  let out = "";
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ",";
    out += digits[i];
  }
  return out;
}

function split(value: Micros): { sign: string; whole: bigint; fraction: bigint } {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  return {
    sign: negative ? "-" : "",
    whole: magnitude / MICROS_PER_USD,
    fraction: magnitude % MICROS_PER_USD,
  };
}

/**
 * Full precision, trailing zeros trimmed to a minimum of two decimal places.
 *
 * A per-impression payout is routinely worth less than a cent, so truncating to cents
 * here would render most real values as `$0.00`.
 */
export function formatMicros(value: Micros): string {
  const { sign, whole, fraction } = split(value);

  let decimals = fraction.toString().padStart(6, "0");
  while (decimals.length > 2 && decimals.endsWith("0")) {
    decimals = decimals.slice(0, -1);
  }

  return `${sign}$${group(whole.toString())}.${decimals}`;
}

/**
 * Cents only, for dense surfaces such as the status bar.
 *
 * Truncates rather than rounds, so a displayed balance is never higher than the balance
 * actually is - the direction of the error matters when the number is money owed.
 */
export function formatMicrosCompact(value: Micros): string {
  const { sign, whole, fraction } = split(value);
  const cents = (fraction / 10_000n).toString().padStart(2, "0");
  return `${sign}$${group(whole.toString())}.${cents}`;
}

/**
 * The server owns the balance; this takes whatever it said.
 *
 * `previous` is accepted so callers can keep the mirror total rather than partial, and
 * so the signature stays stable if reconciliation ever needs the prior value.
 */
export function applyServerBalance(_previous: Balance | null, next: Balance): Balance {
  return next;
}
