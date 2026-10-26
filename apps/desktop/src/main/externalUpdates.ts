import { parseReleaseList } from "@adcode/release";

export const STORE_UPDATE_URL = "ms-windows-store://pdp/?ProductId=9MSW2N027GJX";
export const MANUAL_UPDATE_URL = "https://adcode.bluethenics.com/#download";

/** Stable releases only; a prerelease must not nudge ordinary installs into a beta. */
export function newestPublishedVersion(versions: readonly string[], current: string): string | null {
  const parts = (value: string): number[] | null => {
    const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value);
    if (!match) return null;
    const numbers = match.slice(1).map(Number);
    return numbers.every(Number.isSafeInteger) ? numbers : null;
  };
  const base = parts(current);
  if (!base) return null;
  const compare = (a: number[], b: number[]): number => {
    for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return a[index]! - b[index]!;
    return 0;
  };
  let selected: { version: string; parts: number[] } | null = null;
  for (const version of versions) {
    const candidate = parts(version);
    if (candidate && compare(candidate, base) > 0 && (!selected || compare(candidate, selected.parts) > 0)) selected = { version, parts: candidate };
  }
  return selected?.version ?? null;
}

/** Published notes establish a new release, not whether a Store rollout has reached this machine. */
export async function fetchPublishedUpdate(baseUrl: string, current: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const response = await fetchImpl(`${baseUrl}/releases`, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`Update release check failed: ${response.status}`);
  const raw = await response.json() as { releases?: unknown };
  return newestPublishedVersion(parseReleaseList(raw.releases).filter(release => release.publishedAt !== null).map(release => release.version), current);
}
