/**
 * The API, assembled for this deployment.
 *
 * `services/api` is transport-neutral and adapter-neutral by design: it takes a `Store`, a
 * `TokenVerifier` and a `PaymentProvider` and knows nothing about which ones it got. This
 * file is the single place where those choices are made for production, and it is
 * deliberately the only file in `apps/web` that reaches across into `services/`.
 *
 * **Why the API lives inside the site.** One deployment, one origin, one set of secrets.
 * `adcode.bluethenics.com` serves the marketing site and `adcode.bluethenics.com/v1/*`
 * serves the API, which means there is no CORS preflight on the common path, no second
 * host to keep alive, and no free-tier service that sleeps between requests.
 *
 * **Why these three adapters.** Supabase Postgres holds the data. Firebase still issues
 * the tokens, verified here with Web Crypto rather than `firebase-admin`, which cannot run
 * on Cloudflare's runtime. Dodo takes advertiser payments.
 *
 * Construction is cheap and safe at module load: the Supabase client and the Firebase key
 * set are both created on first use, so importing this during a build - where no secret is
 * set - does not throw.
 */
import { createFetchHandler } from "@adcode/api/src/fetchHandler.ts";
import { createSupabaseStore } from "@adcode/api/adapters/supabaseStore.ts";
import { createFirebaseJwksVerifier } from "@adcode/api/adapters/firebaseJwks.ts";
import { createDodoProvider } from "@adcode/api/adapters/dodoPayments.ts";
import { createWebsiteAnalyticsStore } from "@adcode/api/adapters/websiteAnalyticsStore.ts";
import { createFirebaseIdentity } from "@adcode/api/src/accountIdentity.ts";
import { mailingStore, sendReportReplyEmail, sendStatusConfirmationEmail, statusAlertStore } from "./mailing";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export const handleApiRequest = createFetchHandler({
  tagflow: {
    country: () => getCloudflareContext().cf?.country,
    // The project's public web API key - the one every browser that signs in already holds.
    identity: createFirebaseIdentity(() => (process.env["FIREBASE_WEB_API_KEY"] ?? process.env["NEXT_PUBLIC_FIREBASE_API_KEY"] ?? "").trim()),
  },
  websiteAnalytics: createWebsiteAnalyticsStore(),
  mailing: mailingStore,
  mailingWebhookSecret: () => process.env["RESEND_WEBHOOK_SECRET"],
  reportReplyMailer: sendReportReplyEmail,
  statusAlerts: statusAlertStore,
  statusConfirmationMailer: sendStatusConfirmationEmail,
  store: createSupabaseStore(),
  verifier: createFirebaseJwksVerifier(),
  payments: createDodoProvider(),
  siteOrigin: process.env["NEXT_PUBLIC_SITE_ORIGIN"] ?? "https://adcode.bluethenics.com",
});
