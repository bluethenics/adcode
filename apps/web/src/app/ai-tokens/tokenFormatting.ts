/** Compact token counts shared by the customer and admin views. */
export function formatTokens(tokens: number): string {
  const n = Math.max(0, tokens);
  if (n >= 1_000_000) return `${Number((n / 1_000_000).toFixed(2))}M`;
  if (n >= 1_000) return `${Number((n / 1_000).toFixed(1))}K`;
  return String(Math.round(n));
}

export const dollars = (cents: number): string => `$${Number.isInteger(cents / 100) ? cents / 100 : (cents / 100).toFixed(2)}`;
