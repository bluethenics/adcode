import { describe, it, expect } from "vitest";
import { createFetchHandler } from "../src/fetchHandler.ts";
import { createMemoryStore } from "../src/memoryStore.ts";
import type { TokenVerifier } from "../src/auth.ts";

/**
 * Image bytes, all the way through the transport production actually uses.
 *
 * `server.test.ts` covers `/assets/:key` over `node:http`. This covers it over
 * `createFetchHandler`, which is the one that runs on Cloudflare - and the two can disagree,
 * because the fetch transport collects the response through a hand-written shim whose body
 * was typed `string`. A `Buffer` passed through it happened to work; nothing proved it did,
 * and "the images are subtly corrupted" is not a failure anyone would attribute to a shim.
 */
const verifier: TokenVerifier = {
  async verify(token) {
    return token === "good" ? { uid: "u-1", claims: {} } : null;
  },
};

/** A real 1x1 PNG. Every byte matters: this is the assertion. */
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89,
]);

describe("GET /assets/:key through the fetch transport", () => {
  it("returns the bytes unchanged, not a stringified buffer", async () => {
    const store = createMemoryStore();
    await store.putAsset("cr-1-light.png", { contentType: "image/png", bytes: PNG });

    const handle = createFetchHandler({ store, verifier });
    const response = await handle(new Request("https://adcode.test/assets/cr-1-light.png"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");

    const received = new Uint8Array(await response.arrayBuffer());
    // Byte-for-byte. A UTF-8 round trip through a string would mangle 0x89 and 0xc4 and
    // leave a file that is still "a PNG" to anything that only checks the first four bytes.
    expect(received).toEqual(PNG);
    expect(received.byteLength).toBe(PNG.byteLength);
  });

  it("needs no bearer token, because the editor's image fetch carries none", async () => {
    const store = createMemoryStore();
    await store.putAsset("cr-1-light.png", { contentType: "image/png", bytes: PNG });

    const handle = createFetchHandler({ store, verifier });
    const response = await handle(new Request("https://adcode.test/assets/cr-1-light.png"));

    expect(response.status).toBe(200);
  });

  it("404s a key that is not there", async () => {
    const handle = createFetchHandler({ store: createMemoryStore(), verifier });
    const response = await handle(new Request("https://adcode.test/assets/nope-light.png"));

    expect(response.status).toBe(404);
  });

  it("still answers json elsewhere, so widening the body broke nothing", async () => {
    const handle = createFetchHandler({ store: createMemoryStore(), verifier });
    const response = await handle(
      new Request("https://adcode.test/v1/config", {
        headers: { authorization: "Bearer good" },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toHaveProperty("killSwitch");
  });
});
