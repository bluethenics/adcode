import { createHmac, timingSafeEqual } from "node:crypto";
import {
  MAILING_CAMPAIGN, MAILING_REPLY_TO, MAILING_SENDER,
  type MailingStore, type EmailJob, type AnnouncementJob, type SendResult,
} from "./mailing.ts";

export function verifyMailingWebhook(body: string, headers: Record<string, string | undefined>, secret: string, now: number): boolean {
  const id = headers["svix-id"], timestamp = headers["svix-timestamp"], signature = headers["svix-signature"];
  if (!id || id.length > 200 || !timestamp || !signature || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  if (!secret.startsWith("whsec_") || secret.length < 20) return false;
  const expected = createHmac("sha256", Buffer.from(secret.slice(6), "base64"))
    .update(id + "." + timestamp + "." + body).digest();
  return signature.split(" ").some((item) => {
    const [version, value] = item.split(",");
    if (version !== "v1" || !value) return false;
    const offered = Buffer.from(value, "base64");
    return offered.length === expected.length && timingSafeEqual(offered, expected);
  });
}

export interface RenderedMail { subject: string; html: string; text: string }
export interface MailerOptions {
  store: MailingStore;
  apiKey?: string;
  webhookSecret?: string;
  siteOrigin: string;
  render(step: EmailJob["step"], unsubscribeUrl: string, postalAddress: string): Promise<RenderedMail>;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/** A bounded batch; the database owns leases, consent checks, ordering, and daily limits. */
export async function runMailingBatch(options: MailerOptions): Promise<{ status: string; sent: number; failed: number }> {
  const { store, apiKey, webhookSecret } = options;
  const settings = await store.settings();
  if (!settings.enabled) return { status: "disabled", sent: 0, failed: 0 };
  if (!apiKey || !webhookSecret || !settings.postalAddress || settings.postalAddress.trim().length < 10) {
    return { status: "configuration-required", sent: 0, failed: 0 };
  }
  const origin = new URL(options.siteOrigin);
  if (origin.protocol !== "https:") return { status: "https-required", sent: 0, failed: 0 };
  const fetcher = options.fetchImpl ?? fetch, now = options.now ?? Date.now;
  const headers = { authorization: "Bearer " + apiKey, "content-type": "application/json" };
  if (!settings.senderVerified) return { status: "domain-not-verified", sent: 0, failed: 0 };
  await store.prepare(now());
  const jobs = await store.claim(now(), 10);
  let sent = 0, failed = 0;
  for (const job of jobs) {
    if (!(await store.eligible(job.id, now()))) continue;
    const unsubscribeUrl = origin.origin + "/v1/email/unsubscribe?token=" + encodeURIComponent(job.unsubscribeToken);
    const mail = await options.render(job.step, unsubscribeUrl, settings.postalAddress);
    let outcome: { providerId: string } | { retry: boolean; code: string };
    try {
      const response = await fetcher("https://api.resend.com/emails", {
        method: "POST", headers: { ...headers, "Idempotency-Key": MAILING_CAMPAIGN + "/" + job.id },
        signal: AbortSignal.timeout(20_000),
        body: JSON.stringify({
          from: MAILING_SENDER, reply_to: MAILING_REPLY_TO, to: [job.email], ...mail,
          headers: { "List-Unsubscribe": "<" + unsubscribeUrl + ">", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
          tags: [{ name: "campaign", value: MAILING_CAMPAIGN }, { name: "step", value: String(job.step + 1) }],
        }),
      });
      if (response.ok) {
        const data = await response.json() as { id?: string };
        outcome = typeof data.id === "string" ? { providerId: data.id } : { retry: true, code: "invalid-provider-response" };
      } else {
        outcome = { retry: response.status === 429 || response.status >= 500, code: "provider-" + response.status };
      }
    } catch {
      outcome = { retry: true, code: "provider-timeout" };
    }
    // Keep persistence outside the network catch: an accepted email must never be
    // mistaken for a rejected one just because its acknowledgement write failed.
    await store.finish(job, outcome, now());
    if ("providerId" in outcome) sent += 1;
    else failed += 1;
    if (!("providerId" in outcome) && outcome.code === "provider-429") break;
    // Account send limits apply across all clients; keep this batch below two/second.
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
  return { status: "complete", sent, failed };
}

/** One Resend send. Retryable: rate limits, server errors and ambiguous network failures. */
export async function resendEmail(fetcher: typeof fetch, apiKey: string, idempotencyKey: string, body: Record<string, unknown>): Promise<SendResult> {
  try {
    const response = await fetcher("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: "Bearer " + apiKey, "content-type": "application/json", "Idempotency-Key": idempotencyKey },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({ from: MAILING_SENDER, reply_to: MAILING_REPLY_TO, ...body }),
    });
    if (response.ok) {
      const data = await response.json() as { id?: string };
      return typeof data.id === "string" ? { providerId: data.id } : { retry: true, code: "invalid-provider-response" };
    }
    if (response.status === 409) {
      // An earlier ambiguous send can still be running under this key. Retry only
      // that documented conflict; a changed/invalid payload must stop for review.
      let name: unknown;
      try { name = (await response.json() as { name?: unknown }).name; } catch { /* Unknown conflict stays permanent. */ }
      return name === "concurrent_idempotent_requests"
        ? { retry: true, code: "provider-idempotency-in-progress" }
        : { retry: false, code: "provider-409" };
    }
    return { retry: response.status === 429 || response.status >= 500, code: "provider-" + response.status };
  } catch {
    return { retry: true, code: "provider-timeout" };
  }
}

export interface AnnouncementMailerOptions {
  store: MailingStore;
  apiKey?: string;
  webhookSecret?: string;
  siteOrigin: string;
  render(job: AnnouncementJob, unsubscribeUrl: string, postalAddress: string): Promise<RenderedMail>;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/**
 * Announcements and status updates, in the same bounded way as the return campaign: the
 * database owns consent, suppressions, leases and the one daily budget all bulk mail shares, and
 * nothing goes out until sending is switched on with a postal address.
 */
export async function runAnnouncementBatch(options: AnnouncementMailerOptions): Promise<{ status: string; sent: number; failed: number }> {
  const { store, apiKey, webhookSecret } = options;
  const settings = await store.settings();
  if (!settings.enabled) return { status: "disabled", sent: 0, failed: 0 };
  if (!apiKey || !webhookSecret || !settings.postalAddress || settings.postalAddress.trim().length < 10) {
    return { status: "configuration-required", sent: 0, failed: 0 };
  }
  if (!settings.senderVerified) return { status: "domain-not-verified", sent: 0, failed: 0 };
  const origin = new URL(options.siteOrigin);
  if (origin.protocol !== "https:") return { status: "https-required", sent: 0, failed: 0 };
  const fetcher = options.fetchImpl ?? fetch, now = options.now ?? Date.now;
  const jobs = await store.claimAnnouncements(now(), 10);
  let sent = 0, failed = 0;
  for (const job of jobs) {
    // A status or model email's link stops only that kind; every other announcement's link stops all updates.
    const unsubscribeUrl = origin.origin + "/v1/email/unsubscribe?token=" + encodeURIComponent(job.unsubscribeToken) + (job.topic === "product" ? "" : "&topic=" + job.topic);
    const mail = await options.render(job, unsubscribeUrl, settings.postalAddress);
    const outcome = await resendEmail(fetcher, apiKey, "announce/" + job.id, {
      to: [job.email], ...mail,
      headers: { "List-Unsubscribe": "<" + unsubscribeUrl + ">", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      tags: [{ name: "campaign", value: job.topic === "product" ? "announcement" : job.topic }],
    });
    await store.finishAnnouncement(job.id, outcome, now());
    if ("providerId" in outcome) sent += 1;
    else failed += 1;
    if (!("providerId" in outcome) && outcome.code === "provider-429") break;
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
  return { status: "complete", sent, failed };
}

/**
 * A direct answer to one person's report. Not bulk mail and not marketing, so it does not wait
 * for the sending switch or the postal address - but it needs the verified sender, it never goes
 * to an address that bounced or complained, and the idempotency key makes a double click one email.
 */
export async function sendReportReply(options: { apiKey?: string; senderVerified: boolean; fetchImpl?: typeof fetch }, input: { replyId: string; to: string; mail: RenderedMail }): Promise<SendResult> {
  if (!options.apiKey) return { retry: false, code: "configuration-required" };
  if (!options.senderVerified) return { retry: false, code: "domain-not-verified" };
  return resendEmail(options.fetchImpl ?? fetch, options.apiKey, "report-reply/" + input.replyId, {
    to: [input.to], ...input.mail, tags: [{ name: "campaign", value: "report-reply" }],
  });
}

export interface CampaignMailerOptions {
  store: MailingStore;
  campaigns: import("./adminConsole.ts").AdminConsoleStore;
  apiKey?: string;
  webhookSecret?: string;
  siteOrigin: string;
  render(campaign: import("./adminConsole.ts").CampaignInput, recipient: { displayName: string | null }, unsubscribeUrl: string, postalAddress: string): Promise<RenderedMail>;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Per run. The schedule fires every 15 minutes; the database paces each campaign across the day. */
  limit?: number;
}

/**
 * Administrator-written campaigns. Same gates as every other bulk send - the switch, the
 * postal address, the verified sender - and the database decides who is due: the daily cap,
 * paced through the day, the total, suppressions and the three-day gap between campaign emails.
 */
export async function runCampaignBatch(options: CampaignMailerOptions): Promise<{ status: string; sent: number; failed: number }> {
  const { store, apiKey, webhookSecret } = options;
  const settings = await store.settings();
  if (!settings.enabled) return { status: "disabled", sent: 0, failed: 0 };
  if (!apiKey || !webhookSecret || !settings.postalAddress || settings.postalAddress.trim().length < 10) {
    return { status: "configuration-required", sent: 0, failed: 0 };
  }
  if (!settings.senderVerified) return { status: "domain-not-verified", sent: 0, failed: 0 };
  const origin = new URL(options.siteOrigin);
  if (origin.protocol !== "https:") return { status: "https-required", sent: 0, failed: 0 };
  const fetcher = options.fetchImpl ?? fetch, now = options.now ?? Date.now;
  const jobs = await options.campaigns.claimCampaignSends(now(), options.limit ?? 20);
  const content = new Map<string, import("./adminConsole.ts").CampaignRecord | null>();
  let sent = 0, failed = 0;
  for (const job of jobs) {
    if (!content.has(job.campaignId)) content.set(job.campaignId, await options.campaigns.getCampaign(job.campaignId));
    const campaign = content.get(job.campaignId) ?? null;
    if (campaign === null) {
      await options.campaigns.finishCampaignSend(job.id, { retry: false, code: "campaign-missing" }, now());
      failed += 1;
      continue;
    }
    const unsubscribeUrl = origin.origin + "/v1/email/unsubscribe?token=" + encodeURIComponent(job.unsubscribeToken);
    const mail = await options.render(campaign, { displayName: job.displayName }, unsubscribeUrl, settings.postalAddress);
    const outcome = await resendEmail(fetcher, apiKey, "campaign/" + job.id, {
      to: [job.email], ...mail,
      headers: { "List-Unsubscribe": "<" + unsubscribeUrl + ">", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      tags: [{ name: "campaign", value: "admin" }, { name: "campaign_id", value: campaign.id }],
    });
    await options.campaigns.finishCampaignSend(job.id, outcome, now());
    if ("providerId" in outcome) sent += 1;
    else failed += 1;
    if (!("providerId" in outcome) && outcome.code === "provider-429") break;
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
  return { status: "complete", sent, failed };
}
