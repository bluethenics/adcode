/**
 * Who may see an artifact, and the code that lets a friend in.
 *
 * An artifact is either public - listed in Discover and open to every signed-in builder - or
 * private: unlisted, readable and remixable only by its owner and by whoever holds its share
 * code. The code is the invitation, the same way a live-session invite is.
 *
 * The functions here are pure so the Worker that stores the artifact, the desktop app that
 * shows the share dialog and the tests all answer "may this person read it?" identically.
 */

export type ArtifactVisibility = "public" | "private";

export const ARTIFACT_VISIBILITIES: readonly ArtifactVisibility[] = ["public", "private"];

export function parseArtifactVisibility(value: unknown): ArtifactVisibility | null {
  return value === "public" || value === "private" ? value : null;
}

export interface ArtifactAccessSubject {
  readonly ownerId: string;
  readonly visibility: ArtifactVisibility;
  readonly shareKey: string;
}

export type ArtifactAccess = "owner" | "viewer";

export const ARTIFACT_SHARE_PREFIX = "adartifact:";

const SHARE_KEY = /^[a-f0-9]{32,64}$/;
const SHARE_CODE = /^adartifact:([a-z0-9]{12,40}):([a-f0-9]{32,64})$/;

export interface ArtifactShareCode {
  readonly id: string;
  readonly key: string;
}

const sameSecret = (left: string, right: string): boolean => {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
};

export function newArtifactShareKey(random: Uint8Array): string {
  if (random.length < 16) throw new Error("An artifact share key needs at least 16 bytes of randomness.");
  let key = "";
  for (const byte of random.subarray(0, 16)) key += byte.toString(16).padStart(2, "0");
  return key;
}

export function isArtifactShareKey(value: unknown): value is string {
  return typeof value === "string" && SHARE_KEY.test(value);
}

export function encodeArtifactShare(id: string, key: string): string {
  if (!/^[a-z0-9]{12,40}$/.test(id)) throw new Error("That is not an artifact id.");
  if (!isArtifactShareKey(key)) throw new Error("That is not an artifact share key.");
  return `${ARTIFACT_SHARE_PREFIX}${id}:${key}`;
}

export function decodeArtifactShare(text: string): ArtifactShareCode | null {
  if (typeof text !== "string") return null;
  const match = SHARE_CODE.exec(text.trim());
  return match === null ? null : { id: match[1]!, key: match[2]! };
}

/**
 * Find an invite code in whatever a person pasted: the bare code, the code without its
 * `adartifact:` prefix, a code a chat app wrapped across lines or padded with spaces, or the
 * whole invitation message with the code somewhere inside it. People copy what they were
 * sent, not the one line we hoped they would pick out, so the page has to do the picking.
 */
export function findArtifactShare(text: string): ArtifactShareCode | null {
  if (typeof text !== "string") return null;
  const exact = decodeArtifactShare(text);
  if (exact !== null) return exact;
  const lower = text.toLowerCase();
  // The prefix wins when it is there, so a stray "word:hex" earlier in a message cannot.
  const prefixed = /adartifact\s*:\s*([a-z0-9]{12,40})\s*:\s*([a-f0-9]{32,64})(?![a-z0-9])/.exec(lower);
  if (prefixed !== null) return { id: prefixed[1]!, key: prefixed[2]! };
  const bare = /(?<![a-z0-9:/])([a-z0-9]{12,40})\s*:\s*([a-f0-9]{32,64})(?![a-z0-9])/.exec(lower);
  if (bare !== null) return { id: bare[1]!, key: bare[2]! };
  // Last, a code broken across lines: squeeze out the spaces just after the prefix. A key is
  // 32 or 64 characters, so the hex-looking word that follows it is not swallowed.
  const at = lower.indexOf("adartifact");
  if (at < 0) return null;
  const squeezed = lower.slice(at, at + 200).replace(/\s+/g, "");
  const wrapped = /^adartifact:([a-z0-9]{12,40}):([a-f0-9]{64}|[a-f0-9]{32})/.exec(squeezed);
  return wrapped === null ? null : { id: wrapped[1]!, key: wrapped[2]! };
}

export function artifactShareMessage(title: string, id: string, key: string): string {
  return [
    `Come and build "${title}" with me in ADCode.`,
    "",
    "1. Install ADCode (free): https://adcode.bluethenics.com",
    "2. Open Artifacts, find Join a friend, paste this invite code and press Join:",
    "",
    encodeArtifactShare(id, key),
    "",
    "A private project is unlisted. Only people with this code can see it, join it or make a copy.",
  ].join("\n");
}

export function artifactAccess(subject: ArtifactAccessSubject, uid: string | null, key: string | null = null): ArtifactAccess | null {
  if (uid !== null && uid === subject.ownerId) return "owner";
  if (subject.visibility === "public") return "viewer";
  if (uid === null || typeof key !== "string") return null;
  return sameSecret(key, subject.shareKey) ? "viewer" : null;
}

export function artifactIsListed(visibility: ArtifactVisibility): boolean {
  return visibility === "public";
}

export function artifactShareFor(subject: ArtifactAccessSubject & { readonly id: string }, access: ArtifactAccess | null): string | null {
  return access === "owner" ? encodeArtifactShare(subject.id, subject.shareKey) : null;
}
