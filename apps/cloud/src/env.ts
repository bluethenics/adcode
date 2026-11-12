/**
 * The Worker's bindings and settings. Values live in `wrangler.jsonc` (public) and in Wrangler
 * secrets (`PREVIEW_COOKIE_KEY`). Numbers arrive as strings, as every Worker var does.
 */
/*
 * The Durable Objects' methods as the Worker calls them. Described here rather than imported
 * from the classes, which import this file - so the bindings and the classes never form a cycle.
 */
export interface BudgetRpc extends Rpc.DurableObjectBranded {
  admit(uid: string): Promise<{ ok: true } | { ok: false; reason: "full" | "busy" }>;
  /** Accounts for elapsed runtime and tells an existing sandbox when the month is full. */
  charge(uid: string, minutes: number): Promise<{ full: boolean } | void>;
  release(uid: string): Promise<void>;
  stats(): Promise<{ month: string; spentUsd: number; capUsd: number; running: number; maxInstances: number }>;
}

export interface PreviewRouteRpc extends Rpc.DurableObjectBranded {
  set(uid: string): Promise<void>;
  owner(): Promise<string | null>;
  mint(): Promise<string>;
  consume(nonce: string): Promise<boolean>;
}

export interface Env {
  /** UserSession: reached only through `fetch`. */
  readonly USER: DurableObjectNamespace;
  /** Lightweight chat history and GitHub access; never starts a container. */
  readonly BROWSER: DurableObjectNamespace;
  readonly BUDGET: DurableObjectNamespace<BudgetRpc>;
  readonly PREVIEW: DurableObjectNamespace<PreviewRouteRpc>;
  readonly HOMES: R2Bucket;
  readonly ASSETS: Fetcher;
  /** Existing account API, reached without starting a coding sandbox. */
  readonly ACCOUNT_API: Fetcher;

  readonly APP_HOST: string;
  readonly PREVIEW_SUFFIX: string;
  readonly ALLOWED_ORIGINS: string;
  readonly FIREBASE_PROJECT_ID: string;
  readonly FIREBASE_AUTH_DOMAIN: string;
  readonly ADMIN_UIDS: string;
  /** Phone link's relay (apps/collab-relay); the /phone page connects to it. */
  readonly PHONE_RELAY_ORIGIN?: string;
  /** Where adcode-host sends `/v1` calls (ads, earnings, included AI). */
  readonly ADCODE_API_BASE: string;

  /** Running minutes per session window. */
  readonly SESSION_ALLOWANCE_MIN?: string;
  /** Length of a session window, in hours. */
  readonly SESSION_HOURS?: string;
  /** The allowance's name before session windows; read only when SESSION_ALLOWANCE_MIN is unset. */
  readonly DAILY_ALLOWANCE_MIN?: string;
  readonly IDLE_SLEEP_MIN: string;
  readonly UNTOUCHED_TAB_MIN: string;
  readonly SNAPSHOT_EVERY_MIN: string;
  readonly MONTHLY_CAP_USD: string;
  readonly MAX_INSTANCES: string;
  /** Container instance type: "standard-1" unless measured otherwise. */
  readonly INSTANCE_TYPE: string;
  /** Public GitHub OAuth app ID; defaults to ADCode's existing device-flow app. */
  readonly GITHUB_CLIENT_ID?: string;

  /** Secret. Signs preview cookies. */
  readonly PREVIEW_COOKIE_KEY: string;
  /** Local development only: accept the token "dev" as a fixed test user. Never set in production. */
  readonly ALLOW_DEV_TOKEN?: string;
}

export function numberVar(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
