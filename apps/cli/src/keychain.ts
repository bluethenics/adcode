import { spawn } from "node:child_process";
import { createDecipheriv } from "node:crypto";
import { readFileSync } from "node:fs";
import { desktopPaths } from "./util/paths.ts";

/**
 * Provider keys the CLI did not ask the user to type again.
 *
 * The desktop app stores provider keys through Electron's `safeStorage`. On Windows that
 * is Chromium's `v10` envelope over a DPAPI-protected AES key in `Local State`, which a
 * plain Node process can open for the same user. Nothing is written, printed or cached to
 * disk here; the decrypted value lives in memory for the life of the command.
 *
 * On macOS and Linux the same envelope is keyed by the login keychain / libsecret rather
 * than a file, so this deliberately falls back to environment variables instead of
 * pretending it can read them.
 */

export interface KeyResult {
  readonly key: string;
  readonly source: "environment" | "desktop-keychain";
}

const cache = new Map<string, string | null>();
let osCryptKey: Buffer | null = null;

const COMMON_ENV: Readonly<Record<string, readonly string[]>> = {
  anthropic: ["ANTHROPIC_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  google: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  groq: ["GROQ_API_KEY"],
  xai: ["XAI_API_KEY"],
  deepseek: ["DEEPSEEK_API_KEY"],
  mistral: ["MISTRAL_API_KEY"],
  cerebras: ["CEREBRAS_API_KEY"],
  "fireworks-ai": ["FIREWORKS_API_KEY"],
  together: ["TOGETHER_API_KEY"],
  perplexity: ["PERPLEXITY_API_KEY"],
  cohere: ["COHERE_API_KEY"],
  nvidia: ["NVIDIA_API_KEY"],
};

export function envNamesFor(providerId: string, catalogueEnv: readonly string[] = []): readonly string[] {
  const derived = `${providerId.replace(/[^a-z0-9]+/gi, "_").toUpperCase()}_API_KEY`;
  return [...new Set([...catalogueEnv, ...(COMMON_ENV[providerId] ?? []), derived])];
}

export function environmentKey(providerId: string, envNames: readonly string[] = []): string | null {
  for (const name of [...envNames, ...(COMMON_ENV[providerId] ?? [])]) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

async function readOsCryptKey(): Promise<Buffer | null> {
  if (process.platform !== "win32") return null;
  if (osCryptKey !== null) return osCryptKey;
  try {
    const state = JSON.parse(readFileSync(desktopPaths.localState(), "utf8")) as Record<string, unknown>;
    const osCrypt = typeof state["os_crypt"] === "object" && state["os_crypt"] !== null
      ? (state["os_crypt"] as Record<string, unknown>)
      : {};
    const encoded = osCrypt["encrypted_key"];
    if (typeof encoded !== "string") return null;
    const envelope = Buffer.from(encoded, "base64");
    // "DPAPI" marks the length-prefixed Windows form; the rest is the protected blob.
    if (envelope.subarray(0, 5).toString("ascii") !== "DPAPI") return null;
    const decrypted = await unprotect(envelope.subarray(5));
    if (decrypted === null || decrypted.length !== 32) return null;
    osCryptKey = decrypted;
    return decrypted;
  } catch {
    return null;
  }
}

const DPAPI_SCRIPT = [
  "Add-Type -AssemblyName System.Security",
  "$b=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())",
  "$p=[System.Security.Cryptography.ProtectedData]::Unprotect($b,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)",
  "[Convert]::ToBase64String($p)",
].join("; ");

function unprotect(payload: Buffer): Promise<Buffer | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: Buffer | null): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    let child;
    try {
      child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", DPAPI_SCRIPT], {
        stdio: ["pipe", "pipe", "ignore"],
        windowsHide: true,
      });
    } catch {
      finish(null);
      return;
    }
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill();
      finish(null);
    }, 8_000);
    timer.unref?.();
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.once("error", () => {
      clearTimeout(timer);
      finish(null);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        finish(null);
        return;
      }
      try {
        const text = Buffer.concat(chunks).toString("utf8").trim();
        if (!/^[A-Za-z0-9+/=]+$/.test(text) || text.length === 0) {
          finish(null);
          return;
        }
        finish(Buffer.from(text, "base64"));
      } catch {
        finish(null);
      }
    });
    child.stdin.end(payload.toString("base64"));
  });
}

function decryptChromiumV10(blob: Buffer, key: Buffer): string | null {
  if (blob.length < 3 + 12 + 16) return null;
  if (blob.subarray(0, 3).toString("ascii") !== "v10") return null;
  const iv = blob.subarray(3, 15);
  const tag = blob.subarray(blob.length - 16);
  const ciphertext = blob.subarray(15, blob.length - 16);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const clear = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const text = clear.toString("utf8");
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

/** Every provider key the desktop app has stored, decrypted once, on demand. */
async function desktopKey(providerId: string): Promise<string | null> {
  if (cache.has(providerId)) return cache.get(providerId) ?? null;
  if (process.platform !== "win32") {
    cache.set(providerId, null);
    return null;
  }
  try {
    const stored = JSON.parse(readFileSync(desktopPaths.providerKeys(), "utf8")) as unknown;
    if (typeof stored !== "object" || stored === null) {
      cache.set(providerId, null);
      return null;
    }
    const blob = (stored as Record<string, unknown>)[providerId];
    if (typeof blob !== "string" || blob.length === 0) {
      cache.set(providerId, null);
      return null;
    }
    const key = await readOsCryptKey();
    if (key === null) {
      cache.set(providerId, null);
      return null;
    }
    const value = decryptChromiumV10(Buffer.from(blob, "base64"), key);
    cache.set(providerId, value);
    return value;
  } catch {
    cache.set(providerId, null);
    return null;
  }
}

export async function resolveProviderKey(
  providerId: string,
  options: { env?: NodeJS.ProcessEnv; envNames?: readonly string[]; allowDesktop?: boolean } = {},
): Promise<KeyResult | null> {
  const env = options.env ?? process.env;
  const names = [...(options.envNames ?? []), ...(COMMON_ENV[providerId] ?? []), `${providerId.replace(/[^a-z0-9]+/gi, "_").toUpperCase()}_API_KEY`];
  for (const name of new Set(names)) {
    const value = env[name];
    if (typeof value === "string" && value.trim().length > 0) return { key: value.trim(), source: "environment" };
  }
  if (options.allowDesktop ?? true) {
    const value = await desktopKey(providerId);
    if (value !== null) return { key: value, source: "desktop-keychain" };
  }
  return null;
}

/** Test seam: forget every decrypted value. */
export function clearKeyCache(): void {
  cache.clear();
  if (osCryptKey !== null) osCryptKey.fill(0);
  osCryptKey = null;
}

export function keychainSupported(): boolean {
  return process.platform === "win32";
}
