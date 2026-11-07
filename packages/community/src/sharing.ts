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

export function artifactShareMessage(title: string, id: string, key: string): string {
  return [
    `Open "${title}" in ADCode.`,
    "",
    "1. Install ADCode (free): https://adcode.bluethenics.com",
    "2. Open Artifacts, choose Open a shared artifact, and paste:",
    "",
    encodeArtifactShare(id, key),
    "",
    "A private artifact is unlisted. Only people with this code can see or remix it.",
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
