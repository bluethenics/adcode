/**
 * The Web Crypto Firebase verifier.
 *
 * These tests sign real tokens with a real RSA keypair generated in the test, and serve
 * the matching public key through an injected `fetch`. Nothing is stubbed at the crypto
 * boundary, because a verifier tested against a stubbed signature check is a verifier
 * that has not been tested at all - the whole job of this file is to reject things.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { createFirebaseJwksVerifier } from "../adapters/firebaseJwks.ts";

const PROJECT = "adcode-idle";
const KID = "test-key-1";
const NOW_MS = 1_800_000_000_000;
const NOW_SECONDS = Math.floor(NOW_MS / 1000);

/** Declared locally: `CryptoKeyPair` is not a global under this repo's `types: ["node"]`. */
interface KeyPair {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
}

let keypair: KeyPair;
let jwks: { keys: unknown[] };

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function encodeSegment(value: unknown): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

/** A signed token. Overrides let each test break exactly one thing. */
async function mintToken(
  claims: Record<string, unknown> = {},
  header: Record<string, unknown> = {},
): Promise<string> {
  const fullHeader = { alg: "RS256", kid: KID, typ: "JWT", ...header };
  const fullClaims = {
    aud: PROJECT,
    iss: `https://securetoken.google.com/${PROJECT}`,
    sub: "uid-123",
    iat: NOW_SECONDS - 10,
    exp: NOW_SECONDS + 3600,
    ...claims,
  };

  const signingInput = `${encodeSegment(fullHeader)}.${encodeSegment(fullClaims)}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    keypair.privateKey,
    new TextEncoder().encode(signingInput),
  );

  return `${signingInput}.${toBase64Url(new Uint8Array(signature))}`;
}

function jwksResponse(cacheControl = "public, max-age=3600"): Response {
  return new Response(JSON.stringify(jwks), {
    status: 200,
    headers: { "cache-control": cacheControl, "content-type": "application/json" },
  });
}

/** A verifier plus a count of how many times it went to the network. */
function makeVerifier(respond: () => Response = jwksResponse) {
  let fetches = 0;
  const verifier = createFirebaseJwksVerifier({
    projectId: PROJECT,
    now: () => NOW_MS,
    fetchImpl: async () => {
      fetches += 1;
      return respond();
    },
  });
  return { verifier, fetches: () => fetches };
}

beforeAll(async () => {
  keypair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as KeyPair;

  const publicJwk = await crypto.subtle.exportKey("jwk", keypair.publicKey);
  jwks = { keys: [{ ...publicJwk, kid: KID, use: "sig", alg: "RS256" }] };
});

describe("a good token", () => {
  it("verifies and yields the uid from `sub`", async () => {
    const { verifier } = makeVerifier();
    const result = await verifier.verify(await mintToken());
    expect(result?.uid).toBe("uid-123");
  });

  it("carries the claims through, so an admin claim survives to the caller", async () => {
    const { verifier } = makeVerifier();
    const result = await verifier.verify(await mintToken({ admin: true }));
    expect(result?.claims["admin"]).toBe(true);
  });

  it("fetches the key set once across many verifications", async () => {
    const { verifier, fetches } = makeVerifier();
    await verifier.verify(await mintToken());
    await verifier.verify(await mintToken());
    await verifier.verify(await mintToken());
    expect(fetches()).toBe(1);
  });
});

describe("a token that must be refused", () => {
  it("refuses a tampered payload", async () => {
    const { verifier } = makeVerifier();
    const token = await mintToken();
    const [header, , signature] = token.split(".") as [string, string, string];
    // Same signature, different claims: exactly what an attacker would try.
    const forged = `${header}.${encodeSegment({ aud: PROJECT, sub: "somebody-else" })}.${signature}`;
    expect(await verifier.verify(forged)).toBeNull();
  });

  it("refuses `alg: none`, rather than believing a token that says it needs no signature", async () => {
    const { verifier } = makeVerifier();
    const unsigned = `${encodeSegment({ alg: "none", kid: KID })}.${encodeSegment({
      aud: PROJECT,
      iss: `https://securetoken.google.com/${PROJECT}`,
      sub: "uid-123",
      iat: NOW_SECONDS,
      exp: NOW_SECONDS + 3600,
    })}.`;
    expect(await verifier.verify(unsigned)).toBeNull();
  });

  it("refuses a token minted for a different Firebase project", async () => {
    const { verifier } = makeVerifier();
    expect(await verifier.verify(await mintToken({ aud: "someone-elses-project" }))).toBeNull();
  });

  it("refuses a token whose issuer is not Google's securetoken service", async () => {
    const { verifier } = makeVerifier();
    expect(await verifier.verify(await mintToken({ iss: "https://evil.example/" }))).toBeNull();
  });

  it("refuses an expired token, allowing only the clock-skew window", async () => {
    const { verifier } = makeVerifier();
    expect(await verifier.verify(await mintToken({ exp: NOW_SECONDS - 3600 }))).toBeNull();
  });

  it("accepts a token that expired within the skew window", async () => {
    const { verifier } = makeVerifier();
    expect(await verifier.verify(await mintToken({ exp: NOW_SECONDS - 5 }))).not.toBeNull();
  });

  it("refuses a token issued in the future beyond the skew window", async () => {
    const { verifier } = makeVerifier();
    expect(await verifier.verify(await mintToken({ iat: NOW_SECONDS + 3600 }))).toBeNull();
  });

  it("refuses a token with no subject, because the subject becomes the uid that owns money", async () => {
    const { verifier } = makeVerifier();
    expect(await verifier.verify(await mintToken({ sub: "" }))).toBeNull();
  });

  it("refuses a token signed by a key that is not in the published set", async () => {
    const other = (await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    )) as KeyPair;

    const signingInput = `${encodeSegment({ alg: "RS256", kid: KID })}.${encodeSegment({
      aud: PROJECT,
      iss: `https://securetoken.google.com/${PROJECT}`,
      sub: "uid-123",
      iat: NOW_SECONDS,
      exp: NOW_SECONDS + 3600,
    })}`;
    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      other.privateKey,
      new TextEncoder().encode(signingInput),
    );

    const { verifier } = makeVerifier();
    expect(await verifier.verify(`${signingInput}.${toBase64Url(new Uint8Array(signature))}`)).toBeNull();
  });

  it("refuses garbage that is not a JWT at all", async () => {
    const { verifier } = makeVerifier();
    expect(await verifier.verify("not-a-token")).toBeNull();
    expect(await verifier.verify("")).toBeNull();
  });

  it("refuses rather than throws when the key set cannot be fetched", async () => {
    const { verifier } = makeVerifier(() => new Response("nope", { status: 500 }));
    // A 401 is the right answer to "we cannot currently verify anything". A thrown error
    // here would become a 500 and tell the client to retry a request that cannot succeed.
    expect(await verifier.verify(await mintToken())).toBeNull();
  });
});

describe("key rotation", () => {
  it("refetches once when a token arrives with an unknown kid, then gives up", async () => {
    const { verifier, fetches } = makeVerifier();
    await verifier.verify(await mintToken());
    expect(fetches()).toBe(1);

    // An unknown kid is what a rotation looks like from here, so one more fetch is
    // warranted - but only one, or a bogus kid becomes a fetch per request.
    expect(await verifier.verify(await mintToken({}, { kid: "unknown-kid" }))).toBeNull();
    expect(fetches()).toBe(2);
  });
});
