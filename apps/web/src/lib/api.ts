/**
 * Talking to `services/api` from the browser.
 *
 * Every call carries a Firebase ID token, which the API turns into a UID. Nothing here
 * ever sends an identifier for *whose* data to fetch - the server reads that from the
 * token - so there is no request this client can craft to read someone else's account.
 *
 * Errors come back as values rather than exceptions. A dashboard that throws on a 402
 * shows a blank screen; one that receives `{ ok: false, error: "insufficient-funds" }`
 * can say what went wrong and what to do about it.
 */
import { API_ORIGIN } from "./site";

/**
 * Where to send an API call from.
 *
 * Empty in the browser, which makes the call same-origin - correct by construction, because
 * the API is this same deployment at `/v1/*`. `API_ORIGIN` is a `NEXT_PUBLIC_` value and so
 * is frozen into the bundle at build time; using it here would pin the running page to
 * whatever hostname was configured when it was built. That is not hypothetical: the first
 * deployment answered on `workers.dev` while the bundle pointed every dashboard request at
 * the custom domain, which did not resolve yet, and every call failed as "offline".
 *
 * On the server there is no origin to be relative to, so the absolute value is used - and
 * must be non-empty, or static generation hangs rather than failing.
 */
const apiBase = (): string => (typeof window === "undefined" ? API_ORIGIN : "");

export type ApiError =
  | "unauthenticated"
  | "no-advertiser"
  | "already-advertiser"
  | "suspended"
  | "not-found"
  | "insufficient-funds"
  | "no-approved-creative"
  | "invalid-state"
  | "rate-limited"
  | "provider-unavailable"
  | "offline"
  | "bad-request"
  | "server-error";

export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: ApiError };

/** Server refusal strings to the client's vocabulary. Anything unmapped is a server error. */
const KNOWN: ReadonlySet<string> = new Set<ApiError>([
  "no-advertiser",
  "already-advertiser",
  "suspended",
  "not-found",
  "insufficient-funds",
  "no-approved-creative",
  "invalid-state",
  "rate-limited",
]);

function classify(status: number, body: unknown): ApiError {
  const raw = typeof body === "object" && body !== null ? (body as Record<string, unknown>)["error"] : null;
  if (typeof raw === "string" && KNOWN.has(raw)) return raw as ApiError;

  if (status === 401) return "unauthenticated";
  if (status === 402) return "insufficient-funds";
  if (status === 404) return "not-found";
  if (status === 409) return "invalid-state";
  if (status === 429) return "rate-limited";
  if (status === 502 || status === 503) return "provider-unavailable";
  if (status >= 400 && status < 500) return "bad-request";
  return "server-error";
}

/** Sentences for people, not error codes. Used wherever a refusal reaches the screen. */
export const MESSAGES: Record<ApiError, string> = {
  unauthenticated: "Your session expired. Sign in again.",
  "no-advertiser": "You don't have an advertiser account yet.",
  "already-advertiser": "You already have an advertiser account.",
  suspended: "This account is suspended. Email support@adcode.bluethenics.com.",
  "not-found": "That doesn't exist, or it isn't yours.",
  "insufficient-funds": "Not enough funded balance to cover this budget. Add funds first.",
  "no-approved-creative": "Add a creative and wait for it to be approved before going live.",
  "invalid-state": "That change isn't allowed from the current state.",
  "rate-limited": "Too many requests. Wait a moment and try again.",
  "provider-unavailable": "The payment provider didn't respond. Try again shortly.",
  offline: "Couldn't reach the server. Check your connection.",
  "bad-request": "Something in that form wasn't accepted. Check the fields and retry.",
  "server-error": "Something went wrong on our side. Try again shortly.",
};

export interface ApiCall {
  path: string;
  token: string | null;
  method?: "GET" | "POST";
  body?: unknown;
}

export async function apiFetch<T>({ path, token, method = "GET", body }: ApiCall): Promise<ApiResult<T>> {
  if (token === null) return { ok: false, error: "unauthenticated" };

  try {
    const response = await fetch(`${apiBase()}/v1${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    let parsed: unknown = null;
    try {
      parsed = await response.json();
    } catch {
      // A body that is not JSON is only a problem if the status said it succeeded.
      if (response.ok) return { ok: false, error: "server-error" };
    }

    if (!response.ok) return { ok: false, error: classify(response.status, parsed) };
    return { ok: true, value: parsed as T };
  } catch {
    return { ok: false, error: "offline" };
  }
}

/* ── Shapes the API returns ─────────────────────────────────────────────── */

export interface AdvertiserView {
  advertiserId: string;
  name: string;
  status: string;
  fundedMicros: string;
  reservedMicros: string;
  availableMicros: string;
}

export interface CampaignView {
  campaignId: string;
  name: string;
  status: string;
  cpmMicros: string;
  budgetMicros: string;
  spentMicros: string;
  targetTags: string[];
  createdAt: number;
  serves: number;
  impressions: number;
  clicks: number;
}

export interface CreativeView {
  creativeId: string;
  campaignId: string;
  advertiser: string;
  headline: string;
  body: string | null;
  clickUrl: string;
  logoLight: string;
  logoDark: string;
  status: string;
}

export interface BalanceView {
  availableMicros: string;
  lifetimeMicros: string;
}

export interface LedgerRowView {
  entryId: string;
  kind: string;
  micros: string;
  description: string;
  createdAt: number;
  refId: string | null;
}

export interface LedgerPageView {
  rows: LedgerRowView[];
  nextCursor: string | null;
}

export interface CheckoutView {
  paymentId: string;
  paymentLink: string;
}
