/**
 * The admin console's calls: user search and actions, and email campaigns.
 *
 * `apiFetch` turns every refusal into one of a fixed set of codes, which is right for the
 * dashboard and wrong here: the console's endpoints answer with a sentence that says exactly
 * what to fix ("Pause the campaign before editing it"), and an administrator should read that
 * sentence rather than "That change isn't allowed from the current state."
 */
import { apiFetch, MESSAGES } from "./api";

export type ConsoleResult<T> = { ok: true; value: T } | { ok: false; message: string };

export async function consoleCall<T>(path: string, token: string | null, method: "GET" | "POST" = "GET", body?: unknown): Promise<ConsoleResult<T>> {
  // Preview mode answers from fixtures through apiFetch (development only).
  if (process.env["NODE_ENV"] === "development") {
    const { adminPreviewData } = await import("./adminPreview");
    if (adminPreviewData() !== null) {
      const result = await apiFetch<T>({ path, token, method, ...(body === undefined ? {} : { body }) });
      return result.ok ? result : { ok: false, message: MESSAGES[result.error] };
    }
  }
  if (token === null) return { ok: false, message: MESSAGES.unauthenticated };
  try {
    const response = await fetch(`/v1${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    let parsed: unknown = null;
    try { parsed = await response.json(); } catch { /* handled below */ }
    if (response.ok) return parsed === null ? { ok: false, message: MESSAGES["server-error"] } : { ok: true, value: parsed as T };
    const record = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
    const nested = typeof record["error"] === "object" && record["error"] !== null ? (record["error"] as Record<string, unknown>) : null;
    const message = typeof record["message"] === "string" ? record["message"] : typeof nested?.["message"] === "string" ? nested["message"] : null;
    if (message !== null) return { ok: false, message };
    return { ok: false, message: response.status === 401 ? MESSAGES.unauthenticated : response.status === 403 ? "Administrator access is required." : response.status === 404 ? MESSAGES["not-found"] : MESSAGES["server-error"] };
  } catch {
    return { ok: false, message: MESSAGES.offline };
  }
}

/* ── Shapes ──────────────────────────────────────────────────────────────── */

export interface UserHit {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoUrl: string | null;
  status: string;
  emailVerified: boolean | null;
  createdAt: number;
  lastActiveAt: number | null;
}

export interface UserProfile extends UserHit {
  linkedAt: number | null;
  isAdmin: boolean;
  activity: { lastActiveAt: number | null; firstSeenAt: number | null; daysActive: number; daysActive30: number; sessions30: number; activeMinutes30: number; acceptedEdits30: number } | null;
  ai: { requests30: number; inputTokens30: number; outputTokens30: number; costMicros30: string; lastDay: string | null } | null;
  subscription: { plan: string; status: string; endsAt: number | null; periodEnd: number | null; cancelAtPeriodEnd: boolean | null } | null;
  gift: { plan: string; endsAt: number; source: string } | null;
  wallet: { balanceMicros: string; reservedMicros: string } | null;
  earnings: { availableMicros: string; lifetimeMicros: string; pendingWithdrawalMicros: string } | null;
  aiBlocked: boolean;
  /** Named `mail` because `email` is the address. */
  mail: {
    productUpdates: boolean;
    statusUpdates: boolean;
    modelUpdates: boolean;
    suppressed: { reason: "unsubscribe" | "bounce" | "complaint"; at: number } | null;
    campaigns: { campaign: string; status: string; sentAt: number | null; openedAt: number | null; clickedAt: number | null }[];
  };
  invitedBy: { code: string; referrerUid: string | null; how: string; at: number } | null;
  invited: number;
  audit: { action: string; adminUid: string; at: number }[];
}

export type CampaignAudience = "everyone" | "subscribed";
export type CampaignStatus = "draft" | "running" | "paused" | "completed" | "cancelled";

export interface CampaignDraft {
  name: string;
  subject: string;
  preheader: string;
  heading: string;
  body: string;
  ctaLabel: string | null;
  ctaUrl: string | null;
  audience: CampaignAudience;
  inactiveDays: number | null;
  totalLimit: number;
  dailyLimit: number;
}

export interface CampaignStats {
  queued: number; sent: number; failed: number; delivered: number; opened: number; clicked: number;
  bounced: number; complained: number; returned: number; today: number; lastSentAt: number | null;
}

export interface CampaignView extends CampaignDraft {
  id: string;
  status: CampaignStatus;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  finishReason: string | null;
  stats: CampaignStats;
}

export interface CampaignSend {
  email: string; status: string; attempts: number; claimedAt: number; sentAt: number | null; deliveredAt: number | null;
  openedAt: number | null; clickedAt: number | null; bouncedAt: number | null; lastError: string | null;
}

export interface CampaignDetail extends CampaignView {
  sends: CampaignSend[];
}

/** The figures a campaign card leads with, derived the same way everywhere. */
export function campaignProgress(campaign: Pick<CampaignView, "totalLimit" | "dailyLimit" | "stats">): { done: number; share: number; daysLeft: number } {
  const done = campaign.stats.sent + campaign.stats.queued;
  return {
    done,
    share: campaign.totalLimit === 0 ? 0 : Math.min(1, done / campaign.totalLimit),
    daysLeft: Math.ceil(Math.max(0, campaign.totalLimit - done) / Math.max(1, campaign.dailyLimit)),
  };
}

export const rate = (part: number, whole: number): string => (whole === 0 ? "-" : `${((part / whole) * 100).toFixed(part / whole >= 0.1 ? 0 : 1)}%`);
