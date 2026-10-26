/** Production assembly; only the API and scheduled Worker import this file. */
import { createSupabaseMailingStore } from "@adcode/api/adapters/supabaseMailingStore.ts";
import { runAnnouncementBatch, runMailingBatch, sendReportReply } from "@adcode/api/src/mailingDelivery.ts";
import { createSupabaseStatusAlertStore } from "@adcode/api/adapters/supabaseStatusAlertStore.ts";
import { createSupabaseStore } from "@adcode/api/adapters/supabaseStore.ts";
import { runStatusAlertBatch, runStatusWatch, sendStatusConfirmation } from "@adcode/api/src/statusAlerts.ts";

export const mailingStore = createSupabaseMailingStore();
export const statusAlertStore = createSupabaseStatusAlertStore();
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
 * The status page's quarter-hourly job: judge every included model on the turns since the last
 * check, queue an alert for each change, then send what is due. Each half fails on its own.
 */
export async function runScheduledStatus(now = Date.now()) {
  const watch = await runStatusWatch({ store: statusReadStore, alerts: statusAlertStore, siteOrigin: siteOrigin(), now })
    .catch((error: unknown) => ({ error: error instanceof Error ? error.message : "watch failed" }));
  const alerts = await runStatusAlertBatch({
    alerts: statusAlertStore,
    settings: () => mailingStore.settings(),
    ...keys(),
    siteOrigin: siteOrigin(),
    render: async (...args) => (await import("@/emails/StatusAlert")).renderStatusAlert(...args),
  }).catch((error: unknown) => ({ error: error instanceof Error ? error.message : "send failed" }));
  return { watch, alerts };
}

/** The one email an unconfirmed address can get, sent at once from noreply@. */
export async function sendStatusConfirmationEmail(input: { email: string; confirmToken: string; models: boolean; incidents: boolean }) {
  const settings = await mailingStore.settings();
  const confirmUrl = siteOrigin() + "/status/subscription?confirm=" + encodeURIComponent(input.confirmToken);
  const mail = await (await import("@/emails/StatusAlert")).renderStatusConfirm({ confirmUrl, models: input.models, incidents: input.incidents, postalAddress: settings.postalAddress });
  return sendStatusConfirmation({ ...keys(), senderVerified: settings.senderVerified }, { email: input.email, confirmToken: input.confirmToken, mail });
}
