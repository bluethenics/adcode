/**
 * "Did you mean" for a person who typed close to the right thing.
 *
 * Damerau-style edit distance (one swap counts as one edit), so `staus` finds `status`
 * and `chta` finds `chat`, instead of everything that merely shares a first letter.
 */

export function editDistance(a: string, b: string): number {
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  if (left === right) return 0;
  if (left.length === 0) return right.length;
  if (right.length === 0) return left.length;
  const rows = left.length + 1;
  const cols = right.length + 1;
  const table: number[][] = Array.from({ length: rows }, (_, row) => Array.from({ length: cols }, (_, col) => (row === 0 ? col : col === 0 ? row : 0)));
  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const cost = left[row - 1] === right[col - 1] ? 0 : 1;
      let best = Math.min(table[row - 1]![col]! + 1, table[row]![col - 1]! + 1, table[row - 1]![col - 1]! + cost);
      if (row > 1 && col > 1 && left[row - 1] === right[col - 2] && left[row - 2] === right[col - 1]) {
        best = Math.min(best, table[row - 2]![col - 2]! + 1);
      }
      table[row]![col] = best;
    }
  }
  return table[left.length]![right.length]!;
}

/**
 * The candidates worth offering, closest first. A candidate qualifies when it is within
 * a third of the input's length in edits (at least one), or when the input is a prefix of it.
 */
export function closest(input: string, candidates: readonly string[], limit = 3): string[] {
  const query = input.trim().toLowerCase();
  if (query.length === 0) return [];
  const allowed = Math.max(1, Math.floor(query.length / 3));
  const scored: Array<{ name: string; score: number }> = [];
  const seen = new Set<string>();
  for (const name of candidates) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (key === query) continue;
    const distance = editDistance(query, key);
    const prefix = key.startsWith(query) && query.length >= 2;
    if (distance <= allowed || prefix) scored.push({ name, score: prefix ? Math.min(distance, 0.5) : distance });
  }
  scored.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
  return scored.slice(0, limit).map((entry) => entry.name);
}

/** "Did you mean status?" or "Did you mean chat or check?", or null when nothing is close. */
export function didYouMean(input: string, candidates: readonly string[], format: (name: string) => string = (name) => name): string | null {
  const near = closest(input, candidates);
  if (near.length === 0) return null;
  const names = near.map(format);
  const list = names.length === 1 ? names[0]! : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]!}`;
  return `Did you mean ${list}?`;
}
