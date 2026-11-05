import type { CommunityMe } from "@adcode/community";

/**
 * The signed-in person's community profile. The main process answers a failure (most often
 * "Sign in to ADCode to do this") as a value rather than a rejection, because the tab badges
 * poll this signed out and Electron logs every rejected handler as an error. Thrown here, the
 * pages keep choosing the signed-out view by the error's words.
 */
export async function communityMe(): Promise<CommunityMe> {
  const result = (await window.adcode.community.me()) as CommunityMe | { communityError?: unknown };
  if ("communityError" in result && typeof result.communityError === "string") throw new Error(result.communityError);
  return result as CommunityMe;
}
