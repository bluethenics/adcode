import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ directory: "", available: true }));
vi.mock("electron", () => ({
  app: { getPath: () => state.directory },
  safeStorage: {
    isEncryptionAvailable: () => state.available,
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`),
    decryptString: (value: Buffer) => value.toString().slice(10),
  },
}));
import { createKeychainStore } from "../src/main/keychain.ts";
beforeAll(async () => {
  state.directory = await mkdtemp(join(tmpdir(), "adcode-keys-"));
});
afterAll(async () => {
  await rm(state.directory, { recursive: true, force: true });
});
describe("named connection credentials", () => {
  it("preserves dynamic credentials across stores and concurrent writes", async () => {
    const first = createKeychainStore();
    await Promise.all([
      first.set("connection-a", "key-a"),
      first.set("connection-b", "key-b"),
      first.set("openrouter", "key-c"),
    ]);
    const reopened = createKeychainStore();
    expect(await reopened.get("connection-a")).toBe("key-a");
    expect(await reopened.get("connection-b")).toBe("key-b");
    expect(await reopened.get("openrouter")).toBe("key-c");
    await Promise.all([
      first.clear("connection-a"),
      reopened.set("connection-c", "key-d"),
    ]);
    expect(await reopened.has("connection-a")).toBe(false);
    expect(await reopened.get("connection-b")).toBe("key-b");
    expect(await reopened.get("connection-c")).toBe("key-d");
    expect(
      await readFile(join(state.directory, "provider-keys.json"), "utf8"),
    ).not.toContain("key-d");
  });
  it("fails closed and rejects prototype IDs", async () => {
    const store = createKeychainStore();
    state.available = false;
    await expect(store.set("connection-z", "secret")).rejects.toThrow(
      "unavailable",
    );
    state.available = true;
    expect(await store.has("connection-z")).toBe(false);
    await expect(store.set("__proto__", "secret")).rejects.toThrow("Invalid");
  });
});
