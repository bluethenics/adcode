const MICROS_PER_DOLLAR = 1_000_000n;
const MIN_BLOCK_BID_MICROS = MICROS_PER_DOLLAR;

export interface CampaignNumbers {
  bidPerBlockMicros: bigint;
  cpmMicros: bigint;
  budgetMicros: bigint;
  blocks: number;
  impressions: number;
}

export function dollarsToMicrosExact(value: string): bigint | null {
  const match = /^\s*\$?([0-9]+)(?:\.([0-9]{1,2}))?\s*$/.exec(value);
  if (match === null) return null;
  const whole = BigInt(match[1] ?? "0");
  const cents = BigInt((match[2] ?? "").padEnd(2, "0"));
  return whole * MICROS_PER_DOLLAR + cents * 10_000n;
}

export function campaignNumbers(bid: string, blockCount: string): CampaignNumbers | null {
  const bidPerBlockMicros = dollarsToMicrosExact(bid);
  if (bidPerBlockMicros === null || bidPerBlockMicros < MIN_BLOCK_BID_MICROS) return null;
  if (!/^[1-9][0-9]{0,5}$/.test(blockCount)) return null;
  const blocks = Number(blockCount);
  return {
    bidPerBlockMicros,
    // 500 impressions is half a CPM unit.
    cpmMicros: bidPerBlockMicros * 2n,
    budgetMicros: bidPerBlockMicros * BigInt(blocks),
    blocks,
    impressions: blocks * 500,
  };
}

export function formatUsdMicros(micros: bigint): string {
  const cents = micros / 10_000n;
  return `$${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}
