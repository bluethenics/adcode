import {
  createFirebaseAuth,
  type FirebaseAuth,
  type TokenProvider,
} from "../../../packages/ads/src/index.ts";
import type { FrequencyPreset } from "../../../packages/ads/src/types.ts";
import { readJsonFile, desktopPaths, cliDataDir } from "./util/paths.ts";
import { DiskFileStore } from "./platform/fsStore.ts";
import { FetchHttpTransport } from "./platform/http.ts";

export const DEFAULT_API_ORIGIN = "https://adcode.bluethenics.com";
export const DEFAULT_FIREBASE_API_KEY = "AIzaSyATZzX5Fw2HjR34VxB3UQWTmljprA5uXqE";
const IDENTITY_KEY = "ads/identity.json";

export interface AccountOptions {
  readonly dataDir?: string;
  readonly env?: NodeJS.ProcessEnv;
}

export interface Account {
  readonly auth: FirebaseAuth | null;
  readonly tokens: TokenProvider;
  readonly source: "desktop" | "cli" | "anonymous" | "dev";
  readonly store: DiskFileStore;
  readonly error: string | null;
  uid(): string | null;
  token(): Promise<string | null>;
  requireToken(): Promise<string>;
}

export function apiOrigin(env: NodeJS.ProcessEnv = process.env): string {
  return env["ADCODE_AD_SERVER"] ?? DEFAULT_API_ORIGIN;
}

export function apiBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return `${apiOrigin(env)}/v1`;
}

export function assetHostFor(env: NodeJS.ProcessEnv = process.env): string {
  const dev = env["ADCODE_AD_SERVER"];
  return env["ADCODE_ASSET_HOST"] ?? (dev === undefined ? new URL(apiOrigin(env)).hostname : "cdn.adcode.test");
}

function staticToken(value: string): TokenProvider {
  return {
    getToken: async () => ({ ok: true, value }),
    invalidate: () => undefined,
  };
}

function desktopIdentity(): { uid: string; refreshToken: string } | null {
  const raw = readJsonFile(desktopPaths.identity());
  if (typeof raw === "object" && raw !== null) {
    const record = raw as Record<string, unknown>;
    if (typeof record["uid"] === "string" && typeof record["refreshToken"] === "string") {
      return { uid: record["uid"], refreshToken: record["refreshToken"] };
    }
  }
  return null;
}

/**
 * One identity for the terminal.
 *
 * If the desktop app has signed in, its identity is seeded into the CLI store on first
 * run, so the terminal's Tagflow requests and ad balance belong to the same account. After
 * that the CLI owns its refresh token: the desktop keeps working, and a CLI-side refresh
 * cannot knock it offline.
 */
export async function createAccount(options: AccountOptions = {}): Promise<Account> {
  const env = options.env ?? process.env;
  const store = new DiskFileStore(options.dataDir ?? cliDataDir());
  const emulator = env["ADCODE_AUTH_EMULATOR"];
  const devServer = env["ADCODE_AD_SERVER"];

  if (devServer !== undefined && emulator === undefined) {
    const tokens = staticToken("dev-token");
    return {
      auth: null,
      tokens,
      source: "dev",
      store,
      error: null,
      uid: () => null,
      token: async () => "dev-token",
      requireToken: async () => "dev-token",
    };
  }

  const existing = await store.read(IDENTITY_KEY);
  let source: Account["source"] = existing === null ? "anonymous" : "cli";
  if (existing === null) {
    const desktop = desktopIdentity();
    if (desktop !== null) {
      await store.write(IDENTITY_KEY, new TextEncoder().encode(JSON.stringify(desktop)));
      source = "desktop";
    }
  }

  const apiKey = env["ADCODE_FIREBASE_API_KEY"] ?? DEFAULT_FIREBASE_API_KEY;
  const auth = createFirebaseAuth({
    http: new FetchHttpTransport(),
    clock: { now: () => Date.now() },
    store,
    apiKey,
    ...(emulator === undefined ? {} : { emulatorOrigin: emulator }),
  });

  try {
    await auth.load();
  } catch {
    // A corrupt identity is not fatal; the first token request signs up again.
  }

  const token = async (): Promise<string | null> => {
    const result = await auth.getToken();
    return result.ok ? result.value : null;
  };

  return {
    auth,
    tokens: auth,
    source,
    store,
    error: null,
    uid: () => auth.uid(),
    token,
    async requireToken(): Promise<string> {
      const result = await auth.getToken();
      if (!result.ok) throw new Error(result.error.detail);
      return result.value;
    },
  };
}

/** The frequency preset for an account that has never opened the desktop app. */
export function defaultPreset(): FrequencyPreset {
  return "standard";
}
