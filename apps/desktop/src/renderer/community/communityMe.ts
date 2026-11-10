import type { CommunityMe } from "@adcode/community";

/**
 * Removed shares this copy of ADCode has confirmed. A relay that has not been updated yet
 * can still return them from `me()`, which would put the Stop sharing button back after a
 * removal. Keeping the ids here makes removal stick on this machine even then.
 */
const REMOVED_KEY = "adcode.community.removed-artifacts.v1";

function removedArtifactIds(): Set<string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(REMOVED_KEY) ?? "[]") as unknown;
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function writeRemoved(ids: ReadonlySet<string>): void {
  try { localStorage.setItem(REMOVED_KEY, JSON.stringify([...ids].slice(-200))); } catch { /* Storage off: the row may return after a restart. */ }
}

/** Remember a share this person stopped, so an old relay cannot advertise it again. */
export function rememberArtifactRemoved(id: string): void {
  const ids = removedArtifactIds();
  ids.add(id);
  writeRemoved(ids);
}

/** The artifact was published again, so it is shared once more. */
export function forgetArtifactRemoved(id: string): void {
  const ids = removedArtifactIds();
  if (ids.delete(id)) writeRemoved(ids);
}

/** Drop removed shares from a profile, keeping the order of everything still shared. */
export function withoutRemovedArtifacts<T extends { readonly id: string }>(artifacts: readonly T[]): readonly T[] {
  const ids = removedArtifactIds();
  return ids.size === 0 ? artifacts : artifacts.filter((artifact) => !ids.has(artifact.id));
}

/**
 * The signed-in person's community profile. The main process answers a failure (most often
 * "Sign in to ADCode to do this") as a value rather than a rejection, because the tab badges
 * poll this signed out and Electron logs every rejected handler as an error. Thrown here, the
 * pages keep choosing the signed-out view by the error's words.
 */
export async function communityMe(): Promise<CommunityMe> {
  const result = (await window.adcode.community.me()) as CommunityMe | { communityError?: unknown };
  if ("communityError" in result && typeof result.communityError === "string") throw new Error(result.communityError);
  const profile = result as CommunityMe;
  return { ...profile, artifacts: withoutRemovedArtifacts(profile.artifacts) };
}
