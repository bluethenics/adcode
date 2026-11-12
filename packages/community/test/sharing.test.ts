import { describe, expect, it } from "vitest";
import {
  ARTIFACT_SHARE_PREFIX, artifactAccess, artifactIsListed, artifactShareFor, artifactShareMessage, decodeArtifactShare,
  encodeArtifactShare, findArtifactShare, isArtifactShareKey, newArtifactShareKey, parseArtifactVisibility,
} from "@adcode/community";

const key = "0123456789abcdef0123456789abcdef";
const subject = { id: "abc123def456ghi789jk", ownerId: "ana", visibility: "private" as const, shareKey: key };

describe("artifact visibility", () => {
  it("accepts only the two modes", () => {
    expect(parseArtifactVisibility("public")).toBe("public");
    expect(parseArtifactVisibility("private")).toBe("private");
    expect(parseArtifactVisibility("unlisted")).toBeNull();
    expect(parseArtifactVisibility(null)).toBeNull();
    expect(artifactIsListed("public")).toBe(true);
    expect(artifactIsListed("private")).toBe(false);
  });
});

describe("artifact share codes", () => {
  it("round-trips a code and refuses everything else", () => {
    const code = encodeArtifactShare(subject.id, key);
    expect(code.startsWith(ARTIFACT_SHARE_PREFIX)).toBe(true);
    expect(decodeArtifactShare(code)).toEqual({ id: subject.id, key });
    expect(decodeArtifactShare(`  ${code}  `)).toEqual({ id: subject.id, key });
    for (const text of ["", "adartifact:", `adartifact:${subject.id}:`, `adartifact:${subject.id}:${"g".repeat(32)}`, `adartifact:../x:${key}`, code.replace(key, key.slice(0, 31))]) {
      expect(decodeArtifactShare(text)).toBeNull();
    }
  });

  it("builds a key from caller-supplied randomness and refuses a weak one", () => {
    const bytes = new Uint8Array(32).map((_, index) => index);
    expect(newArtifactShareKey(bytes)).toBe("000102030405060708090a0b0c0d0e0f");
    expect(isArtifactShareKey(newArtifactShareKey(bytes))).toBe(true);
    expect(() => newArtifactShareKey(new Uint8Array(4))).toThrow(/randomness/);
    expect(() => encodeArtifactShare(subject.id, "short")).toThrow(/share key/);
  });

  it("shares a message a friend can follow", () => {
    const message = artifactShareMessage("Todo app", subject.id, key);
    expect(message).toContain(`"Todo app"`);
    expect(message).toContain(encodeArtifactShare(subject.id, key));
    expect(message).toContain("unlisted");
    expect(message).toContain("Join a friend");
  });

  it("finds the invite code however it was pasted", () => {
    const code = encodeArtifactShare(subject.id, key);
    const want = { id: subject.id, key };
    expect(findArtifactShare(code)).toEqual(want);
    expect(findArtifactShare(`  ${code}\n`)).toEqual(want);
    expect(findArtifactShare(`${subject.id}:${key}`)).toEqual(want);
    expect(findArtifactShare(code.toUpperCase())).toEqual(want);
    expect(findArtifactShare(`adartifact: ${subject.id} : ${key}`)).toEqual(want);
    expect(findArtifactShare(`adartifact:${subject.id}:${key.slice(0, 20)}\n${key.slice(20)}`)).toEqual(want);
    // The whole invitation, where a hex-looking word follows the code.
    expect(findArtifactShare(artifactShareMessage("Todo app", subject.id, key))).toEqual(want);
    expect(findArtifactShare(`${code}\n\nA private project`)).toEqual(want);
    for (const text of ["", "hello", "https://adcode.bluethenics.com", `adartifact:${subject.id}:`, `${subject.id}:${key.slice(0, 31)}`]) {
      expect(findArtifactShare(text)).toBeNull();
    }
  });
});

describe("artifact access", () => {
  it("opens a public artifact to anyone, and a private one only with its code", () => {
    const open = { ...subject, visibility: "public" as const };
    expect(artifactAccess(open, "ben")).toBe("viewer");
    expect(artifactAccess(open, null)).toBe("viewer");
    expect(artifactAccess(open, "ana")).toBe("owner");
    expect(artifactAccess(subject, "ben")).toBeNull();
    expect(artifactAccess(subject, "ben", "f".repeat(32))).toBeNull();
    expect(artifactAccess(subject, "ben", key)).toBe("viewer");
    expect(artifactAccess(subject, "ana")).toBe("owner");
    expect(artifactAccess(subject, null, key)).toBeNull();
  });

  it("hands the share code to the owner only", () => {
    expect(artifactShareFor(subject, "owner")).toBe(encodeArtifactShare(subject.id, key));
    expect(artifactShareFor(subject, "viewer")).toBeNull();
    expect(artifactShareFor(subject, null)).toBeNull();
  });
});
