/**
 * API keys, encrypted at rest by the OS.
 *
 * Brief §5.2: "Keys are stored in the OS keychain, never in settings JSON."
 *
 * Electron's `safeStorage` encrypts with the platform's own credential store - Keychain
 * on macOS, DPAPI on Windows, libsecret on Linux - so the ciphertext on disk is useless
 * to anything but this user on this machine. What lands in the file is a base64 blob, and
 * nothing here ever writes a key into settings.json, which is user-editable, synced by
 * some people, and included in bug reports.
 *
 * The store fails closed: if the OS cannot encrypt, no key is written at all rather than
 * being quietly persisted in the clear.
 */
import { readFile, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { app, safeStorage } from "electron";
import type { KeyStore, ProviderId } from "@adcode/ai";

const FILENAME = "provider-keys.json";
/**
 * Providers whose keys may live in the fallback file.
 *
 * The keychain itself takes any id - the catalogue grows without this app shipping - but
 * the fallback file is written by this process and read back into a typed shape, so it
 * keeps a known set rather than accepting anything a caller passes.
 */
const PROVIDERS: readonly string[] = ["anthropic", "openai", "google", "ollama", "custom"];

type Stored = Record<string, string>;

function filePath(): string {
  return join(app.getPath("userData"), FILENAME);
}

async function readAll(): Promise<Stored> {
  try {
    const parsed: unknown = JSON.parse(await readFile(filePath(), "utf8"));
    if (typeof parsed !== "object" || parsed === null) return {};

    const out: Stored = {};
    for (const provider of PROVIDERS) {
      const value = (parsed as Record<string, unknown>)[provider];
      if (typeof value === "string") out[provider] = value;
    }
    return out;
  } catch {
    return {};
  }
}

async function writeAll(values: Stored): Promise<void> {
  const target = filePath();
  const temporary = `${target}.tmp`;

  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(temporary, JSON.stringify(values, null, 2), "utf8");
  await rename(temporary, target);
}

export function createKeychainStore(): KeyStore {
  return {
    async get(provider: ProviderId): Promise<string | null> {
      const stored = (await readAll())[provider];
      if (stored === undefined) return null;
      if (!safeStorage.isEncryptionAvailable()) return null;

      try {
        return safeStorage.decryptString(Buffer.from(stored, "base64"));
      } catch {
        // A blob this machine cannot decrypt - copied from another profile, or written
        // before the OS credential store was reset. Treat it as absent.
        return null;
      }
    },

    async set(provider: ProviderId, key: string): Promise<void> {
      // Fail closed. Writing the key unencrypted because the OS store is unavailable
      // would quietly break the one promise §5.2 makes about it.
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error("The OS credential store is unavailable, so the key was not saved.");
      }

      const values = await readAll();
      values[provider] = safeStorage.encryptString(key).toString("base64");
      await writeAll(values);
    },

    async clear(provider: ProviderId): Promise<void> {
      const values = await readAll();
      delete values[provider];

      if (Object.keys(values).length === 0) {
        try {
          await unlink(filePath());
        } catch {
          // Nothing to remove.
        }
        return;
      }

      await writeAll(values);
    },

    async has(provider: ProviderId): Promise<boolean> {
      return (await readAll())[provider] !== undefined;
    },
  };
}
