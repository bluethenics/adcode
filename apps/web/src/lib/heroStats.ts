/** Illustrative animation baseline, not a measured user count. */
export const DEMO_COUNT_START = 140_345;

const formatter = new Intl.NumberFormat("en-US");

export function formatCount(value: number): string {
  return formatter.format(Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0);
}
