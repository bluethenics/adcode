/** Production assembly; only the API and scheduled Worker import this file. */
import { createSupabaseMailingStore } from "@adcode/api/adapters/supabaseMailingStore.ts";
import { runAnnouncementBatch, runMailingBatch, sendReportReply, resendEmail } from "@adcode/api/src/mailingDelivery.ts";
import { createAccountEmailProof, emailProofHash } from "@adcode/api/src/accountEmailProof.ts";
import { createAccountEmailProofStore } from "@adcode/api/adapters/accountEmailProofStore.ts";
import { createSupabaseStatusAlertStore } from "@adcode/api/adapters/supabaseStatusAlertStore.ts";
import { createSupabaseStore } from "@adcode/api/adapters/supabaseStore.ts";
import { runStatusAlertBatch, runStatusWatch, sendStatusConfirmation } from "@adcode/api/src/statusAlerts.ts";
import { createSupabaseAdvertiserWelcomeStore } from "@adcode/api/adapters/supabaseAdvertiserWelcomeStore.ts";
import { runAdvertiserWelcomeBatch } from "@adcode/api/src/advertiserWelcome.ts";
import { createSupabasePurchaseReceiptStore } from "@adcode/api/adapters/supabasePurchaseReceiptStore.ts";
import { runPurchaseReceiptBatch } from "@adcode/api/src/purchaseReceipts.ts";

export const mailingStore = createSupabaseMailingStore();
export const accountEmailProof = createAccountEmailProof({
  store: createAccountEmailProofStore(),
  origin: process.env["NEXT_PUBLIC_SITE_ORIGIN"] ?? "https://adcode.bluethenics.com",
  async send({email,token,url}) {
    const key=process.env["RESEND_API_KEY"];
    if (!key || !(await mailingStore.settings()).senderVerified || await mailingStore.undeliverable(email)) return false;
    const body={to:[email],subject:"Verify your email for ADCode",text:`Confirm your email address to use ADCode AI.\n\n${url}\n\nThis link expires in one hour. Open it and choose Verify my email. If you did not request this, ignore this email.\n\nThe ADCode team`,html:`<!doctype html><html lang="en"><meta charset="utf-8"><body style="font:16px/1.6 Arial,sans-serif;color:#25241f;background:#f1efea;padding:24px"><main style="max-width:560px;margin:auto;background:#fcfbf7;border-radius:16px;padding:28px"><h1 style="font-size:24px">Verify your email for ADCode</h1><p>Confirm your email address to start using ADCode AI.</p><p><a href="${url}" style="display:inline-block;background:#245b38;color:#fff;padding:13px 22px;border-radius:8px;text-decoration:none">Verify my email</a></p><p>This link expires in one hour. After opening it, choose <strong>Verify my email</strong>.</p><p>If you did not request this, ignore this email. Your account stays unchanged.</p><p>The ADCode team</p></main></body></html>`,tags:[{name:"campaign",value:"account-verification"}]};
    const idempotency="account-verification/"+emailProofHash(token);
    let result=await resendEmail(fetch,key,idempotency,body);
    if (!("providerId" in result) && result.retry) { await new Promise(resolve=>setTimeout(resolve,600)); result=await resendEmail(fetch,key,idempotency,body); }
    return "providerId" in result;
  },
});
export const statusAlertStore = createSupabaseStatusAlertStore();
const advertiserWelcomeStore = createSupabaseAdvertiserWelcomeStore();
const purchaseReceiptStore = createSupabasePurchaseReceiptStore();
// The watcher reads the same model counts as /status; its own client, created on first use.
const statusReadStore = createSupabaseStore();
const siteOrigin = (): string => process.env["NEXT_PUBLIC_SITE_ORIGIN"] ?? "https://adcode.bluethenics.com";
const keys = () => ({
  ...(process.env["RESEND_API_KEY"] ? { apiKey: process.env["RESEND_API_KEY"] } : {}),
  ...(process.env["RESEND_WEBHOOK_SECRET"] ? { webhookSecret: process.env["RESEND_WEBHOOK_SECRET"] } : {}),
});

/** The hourly schedule: the return campaign, then announcements and status updates, each bounded. */
export async function runScheduledMailing() {
  const campaign = await runMailingBatch({
    store: mailingStore,
    ...keys(),
    siteOrigin: siteOrigin(),
    // Keep the email renderer out of ordinary website request startup.
    render: async (...args) => (await import("@/emails/Reengagement")).renderReengagement(...args),
  });
  const announcements = await runAnnouncementBatch({
    store: mailingStore,
    ...keys(),
    siteOrigin: siteOrigin(),
    render: async (...args) => (await import("@/emails/Announcement")).renderAnnouncement(...args),
  });
  return { campaign, announcements };
}

/** An administrator's reply to a report: rendered here, sent at once through Resend. */
export async function sendReportReplyEmail(input: { replyId: string; to: string; reportTitle: string; reportedAt: number; message: string }) {
  const mail = await (await import("@/emails/ReportReply")).renderReportReply({ reportTitle: input.reportTitle, reportedAt: input.reportedAt, message: input.message });
  const settings = await mailingStore.settings();
  return sendReportReply({ ...keys(), senderVerified: settings.senderVerified }, { replyId: input.replyId, to: input.to, mail });
}

/**
 * The status page's quarter-hourly job: welcome new advertisers, send purchase
 * receipts, judge every included model on the turns since the last check, queue an
 * alert for each change, then send what is due. Each part fails on its own.
 */
export async function runScheduledStatus(now = Date.now()) {
  const advertiserWelcomes = await runAdvertiserWelcomeBatch({
    store: advertiserWelcomeStore, settings: () => mailingStore.settings(), ...keys(), siteOrigin: siteOrigin(),
    render: async (...args) => (await import("@/emails/AdvertiserWelcome")).renderAdvertiserWelcome(...args),
  }).catch((error: unknown) => ({ error: error instanceof Error ? error.message : "welcome failed" }));
  const purchaseReceipts = await runPurchaseReceiptBatch({
    store: purchaseReceiptStore, settings: () => mailingStore.settings(), ...keys(), siteOrigin: siteOrigin(),
    render: async (...args) => (await import("@/emails/PurchaseReceipt")).renderPurchaseReceipt(...args),
  }).catch((error: unknown) => ({ error: error instanceof Error ? error.message : "receipts failed" }));
  const watch = await runStatusWatch({ store: statusReadStore, alerts: statusAlertStore, siteOrigin: siteOrigin(), now })
    .catch((error: unknown) => ({ error: error instanceof Error ? error.message : "watch failed" }));
  const alerts = await runStatusAlertBatch({
    alerts: statusAlertStore,
    settings: () => mailingStore.settings(),
    ...keys(),
    siteOrigin: siteOrigin(),
    render: async (...args) => (await import("@/emails/StatusAlert")).renderStatusAlert(...args),
  }).catch((error: unknown) => ({ error: error instanceof Error ? error.message : "send failed" }));
  return { watch, alerts, advertiserWelcomes, purchaseReceipts };
}

/** The one email an unconfirmed address can get, sent at once from noreply@. */
export async function sendStatusConfirmationEmail(input: { email: string; confirmToken: string; models: boolean; incidents: boolean }) {
  const settings = await mailingStore.settings();
  const confirmUrl = siteOrigin() + "/status/subscription?confirm=" + encodeURIComponent(input.confirmToken);
  const mail = await (await import("@/emails/StatusAlert")).renderStatusConfirm({ confirmUrl, models: input.models, incidents: input.incidents, postalAddress: settings.postalAddress });
  return sendStatusConfirmation({ ...keys(), senderVerified: settings.senderVerified }, { email: input.email, confirmToken: input.confirmToken, mail });
}
