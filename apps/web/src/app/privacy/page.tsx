import type { Metadata } from "next";
import { renderMarkdown } from "@/lib/markdown";
import { JsonLd } from "@/components/JsonLd";
import { breadcrumbs } from "@/lib/schema";
import { pageMetadata } from "@/lib/seo";
import { PRIVACY_UPDATED } from "@/lib/legal";

export const metadata: Metadata = pageMetadata({
  path: "/privacy",
  title: "Privacy",
  socialTitle: "ADCode privacy: what the editor collects, and what it never sends",
  description:
    "What ADCode collects, what its ad service never receives, and what a selected AI provider may receive. Written against what the code actually does.",
});

const UPDATED = PRIVACY_UPDATED.iso;
/*
 * Written out rather than formatted, and kept beside the machine-readable date.
 *
 * These two had drifted: `dateTime` said the 28th while the words said "18 August". On a
 * document whose whole job is to record what was true and when, the date is the one field
 * that must not be able to disagree with itself.
 */
const UPDATED_LABEL = PRIVACY_UPDATED.label;

/*
 * Written against what the code does, not against a template.
 *
 * Every claim here is checkable in the repository: the tag vocabulary is a constant, the
 * serve request has no field for a filename, and the report payload is built in one
 * function. If the code changes, this page is wrong and has to change with it.
 */
const BODY = `
This explains what ADCode collects, what it does not, and why. It covers the ADCode editor and this website.

## The short version

- ADCode's **advertising, earnings, and analytics services never receive file contents, file paths, or project names.**
- AI features may send source text and prompts to the provider you select. ADCode explains and limits that separate path below.
- Ads are targeted using a fixed list of **45 generic tags** describing the language or framework you have open.
- You are identified by an **anonymous account created automatically**, with no email, name, or password, unless you choose to add one.
- We do not sell personal data, and there are no third-party advertising trackers in the editor or on this site.

## What the editor sends

### To serve an ad

A request contains three things: the tags for what you have open, whether your theme is light or dark, and how many cards to return.

Tags come from a closed vocabulary compiled into the editor — values like \`lang:rust\`, \`fw:react\`, \`tool:docker\`, \`platform:backend\`. There are 45 of them. The server cannot add to the list, and any tag the editor does not recognise is never sent.

There is no field in this request for a filename, a path, a repository, a symbol, or a line of code.

### To record that you saw an ad

A receipt contains an identifier for the card, how long it was on screen, whether you clicked or dismissed it, and your theme. This is what your earnings are calculated from.

### Invites

When you open Invite & earn, the editor asks the service for your invite code, and the service makes one for your account the first time. The code is random and says nothing about you.

When ADCode first opens, and when you open Invite & earn on a new account, the editor looks at your clipboard once, on your computer, for an ADCode invite: exactly the line an invite page copies (\`ADCode invite:\` and a code) or an ADCode invite link. If the clipboard holds anything else, nothing is sent and nothing is kept. If it holds an invite, only the code is sent, to connect your account to whoever invited you.

With a claim, the editor also sends the identifiers of other ADCode accounts this computer has used, so that resetting the editor cannot be used to invite yourself. It keeps that list on your computer.

### When you send feedback

If you use the feedback button, we receive what you typed, the app version, and your operating system name. Nothing else about your machine or your work is attached.

### AI features

You choose included AI when available, a provider using your own API key, or a local model. Chat and agent tools can send your prompt, relevant source text, and tool results to the chosen provider so it can answer or edit your project. Automatic inline completion sends bounded text around the cursor (up to 6,000 characters before it and 2,000 after it), the language, and a small output allowance; it does not send the file path. You can turn inline completion off in Settings.

With your own key, AI traffic goes directly from the desktop app to the selected provider. With included AI, prompts, source context and tool results pass through ADCode's dedicated AI relay to the provider identified on the selected model (Tagflow AI, Heabsy, OpenAI, Gemini, Groq, OpenRouter, or another provider named on that model), under that provider's terms and privacy policy. This route uses a server-side provider key and requires a verified account. The relay stores daily request and token counts, estimated spending, reservations for active requests, and allowance settings by account so it can enforce shared limits. Administrators can view those counts and change allowances. It does not store prompts or replies in the server database, and AI content is not used by the advertising pipeline.

For included AI reporting, the relay also records the account identifier, request identifier, model and provider revision, request times, token counts, estimated cost, workload type, response speed, generated tool-call counts, outcome and a fixed error category. It does not record tool arguments, file paths or raw provider errors. Administrators use this metadata to prepare aggregate reports on demand, usage, reliability and performance for model providers. Those reports exclude account identifiers and conversation content.

Audience reports include the approximate country of an AI request's network connection, supplied by Cloudflare. This is not verified residence and can be affected by VPNs or proxies. This reporting system does not store IP addresses or precise location. The desktop also reports its operating system and a fixed assistant category (such as Reviewer or Tester), with custom agents grouped as Custom agent. Custom agent names, instructions and conversation text are not used to classify audience or purpose.

In AI usage → About your AI use, you can optionally provide your role, coding experience and main purpose for using included AI, and expressly choose to include these in aggregate provider reports. These fields are not inferred from your work. Your current choices classify your account in reports, including historical periods. You can update them or remove your profile in the same form; future generated reports then reflect the change. Copies already downloaded cannot be recalled. Missing information is reported as unknown.

You can voluntarily rate an included AI response and submit a category and comment. Feedback is linked to that response and your account so a rating can be updated or removed. Ratings contribute to aggregate statistics. Comments are shared in provider reports only when you explicitly check the sharing option; it is off by default. No conversation or project files are attached to model feedback. Avoid including private information in a comment you choose to share.

ADCode keeps task sandboxes, rollback checkpoints, schedules, and operational traces locally. Traces describe actions and outcomes rather than storing a provider's private reasoning, and common credential shapes are redacted. ADCode also skips inline completion for common credential files, but you should still review what you ask any AI provider to read. Clearing local AI usage history does not clear your server-enforced Tagflow allowance.

## Identity

On first launch the editor creates an **anonymous account** through Firebase Authentication. It has no email address, no name, and no password. Its only purpose is to have somewhere to credit your earnings.

If you later choose to withdraw money, you can attach an email address to that same account — an address the provider has confirmed, which is a condition of being paid. Your existing balance carries over because it is the same account, not a new one.

## What we store

- Your anonymous account identifier, and when it was created.
- Your ledger: one row per credit, reversal, adjustment, or withdrawal, with the amount and a short description.
- Records of ads served to you, kept briefly, so a receipt can be checked against a real serve.
- Feedback you send, if you send any.
- Included AI usage counts, account allowances and model-level operational metadata, if you use that service; no AI prompt or reply text is stored in its accounting or reporting tables.
- **If you use invites:** your invite code, which code you joined with and when, and who joined with yours - the record your invite earnings are worked out from. Your invite page shows your first name only if you allow it, which you can turn off in Invite & earn. People you invite see that name, if shown; you see how many people joined and used ADCode, never who they are.
- **If, and only if, you ask to be paid:** the payout details you enter — the full name on the receiving account, the country and currency, and either the email address on your Wise account or the bank details you give us. We store them so a person can make the transfer, and a copy is attached to each request so that editing your details later cannot redirect a payment already in progress. You can change or clear them at any time from the Payouts tab.

## The web version

ADCode on the web (web.bluethenics.com) runs the same assistant in a **private cloud workspace** for each signed-in person: a small Linux computer on Cloudflare that only your account can reach.

- **What it holds:** your projects, your conversations with the assistant, your ADCode settings, and any API keys you save. Saved keys and a GitHub connection are encrypted with a key that is unique to you and kept separately from your files.
- **When it sleeps:** a few minutes after you stop using it, your workspace is saved as one compressed archive in Cloudflare R2 storage and the computer stops. It is restored from that archive the next time you open the web version. We keep your three most recent archives.
- **Previews** of the apps you build are reachable only from your own signed-in browser.
- **Sign-in** uses the same Firebase account as the desktop app and this website: Google, GitHub, or email and password. The web version requires one; it does not create anonymous accounts.
- **Usage:** we record how many minutes your workspace runs each day, to apply the daily allowance, and an estimate of what running it costs us.
- **Download and delete:** the Cloud workspace panel downloads any project, and Delete my cloud workspace removes every project, conversation and archive straight away. Your account and earnings are not affected.

We do not read your projects or conversations, use them to train models, or show them to advertisers. The assistant's requests to an AI provider work as described under AI features above.

## Cookies and analytics

This website runs **no third-party analytics or advertising scripts**. Fonts are served from this site's own domain rather than a font CDN.

If you allow website analytics, we send measurements to our own service: page paths without query strings, traffic source or referring hostname, campaign labels, broad device category, page speed, visible engagement time, scroll milestones, browser error counts, and actions such as copying an install command, signing in, or creating a campaign. We do not collect form contents, passwords, payment details, account identifiers, error messages, or session recordings through analytics. Admin pages are excluded.

Your choice is saved in local storage. An anonymous session identifier and campaign attribution are saved in session storage, with a new session after 30 minutes of inactivity. Analytics sets no cookies. You can change your choice using **Analytics preferences** at the bottom of the site. Declining stops future collection and clears the session identifier; previously collected events are not linked to your account. We also respect Do Not Track and Global Privacy Control browser signals.

Website measurements are stored in our Supabase database and shown as aggregate reports to authorised administrators. Our hosting infrastructure necessarily receives network requests; the analytics event records do not contain IP addresses or full user-agent strings.

An invite page remembers its code in this browser's local storage for 30 days, so that signing in to the dashboard or signing up as an advertiser credits whoever invited you. It is removed once it has been used. It is not analytics and is not sent anywhere until you sign in or sign up.

The signed-in areas — the dashboard, advertiser portal, and admin panel — use a session cookie strictly to keep you signed in.

## Optional product emails

Product updates (new releases and new docs), project ideas, and reminders after time away are optional. So are status emails, which tell you when free AI has an outage and when it is fixed, and model emails, which tell you when a new free model arrives and how the included models have been performing. They are three separate checkboxes in [your dashboard](/dashboard#email-preferences), and all start unchecked. A verified account email is required, and creating an account does not subscribe you to any of them.

If you send a report from the app, a person on the team may answer it by email at your account's address. That reply is about your report only; it is not a newsletter and does not subscribe you to anything. Replies are recorded with the report.

For subscribers, we store the email preference, consent date and wording version, and the most recent account or editor activity time. We use those records to choose reminders and stop follow-ups when you return. We also keep delivery status and opt-out, bounce, or complaint records so that we can avoid unwanted email.

Resend delivers these messages. It receives the recipient email address and the email content and reports delivery events. We do not send Resend your source code, prompts, projects, or earnings details. Email open and click tracking are disabled; links can contain general campaign labels without an account identifier.

Every product email includes an unsubscribe link that works without signing in. You can also change your preference in the dashboard. Unsubscribing stops future product emails, reminders, status emails and model emails without changing your ADCode account or service notices. A status email's own link stops only status emails, and a model email's own link stops only model emails.

### Status alerts without an account

The [status page](/status#subscribe) lets anyone ask for email alerts, with no ADCode account: when an included AI model degrades, fails, or is back to normal, and incident updates if you choose them. We store the address, which of the two lists you chose, when you asked and confirmed, and a count of confirmation emails sent to it, so the form cannot be used to flood someone. Nothing but one confirmation email is sent until you click it; an unconfirmed address is never put on a list. A one-way hash of the network address that submitted the form counts attempts in ten-minute windows to limit repeats; it is not stored with the email address.

Alerts come from noreply@bluethenics.com through Resend, on the same terms as above, and each one has a one-click unsubscribe. Unsubscribing takes the address off both lists. A bounce or spam complaint does the same and adds the address to the suppression list.

When ADCode asks you to verify your email before using free AI, the verification link is sent by Firebase Authentication from the project's Firebase address, at most once an hour.

## Sharing

We share personal data with nobody for advertising purposes.

Advertisers receive **aggregate** reporting: how many times their campaign was served, viewed, and clicked. They never receive your identifier, your tags, or anything that identifies you individually.

We use Google Cloud and Firebase to run the service, Dodo Payments to take payment from advertisers, and Wise to send withdrawals. Each receives only what it needs to do its part — Wise receives your payout details and the amount, and nothing about how you earned it.

## Your choices

- **Turn ads off.** Settings has a cadence control with an off position. The editor is otherwise identical, with no reduced features and no prompts to turn it back on.
- **Ask for your data or its deletion.** Write to adcode.support@gmail.com. Deleting your account removes your identifier and your ledger. Records we must keep for accounting are retained where the law requires.

## Retention

Ledger rows are kept as long as the account exists, because they are the record of what you were paid. Serve records expire automatically within hours. General support feedback is kept until it is resolved. Included AI reporting metadata is retained for usage and reliability reporting; it has no automatic expiry at present. Model feedback remains until its rating is removed or you request its deletion. You can request deletion of included AI reporting metadata through the contact below. A web version workspace that nobody opens for 90 days is deleted, archives and all.

Email preference and delivery records are linked to the account and removed when the account is deleted. Suppression addresses are retained to honour opt-outs and avoid sending to addresses that bounce or complain. These email records currently have no automatic expiry.

## Children

ADCode is not directed at children under 13, and we do not knowingly create accounts for them. Earning or withdrawing money requires being 18 or older; see the [terms](/terms).

## Changes

If this policy changes in a way that affects what is collected, the date at the top of this page changes and the change is announced in the [release notes](/versions) rather than made quietly.

## Contact

For anything about your data - a copy of it, a correction, or its deletion - write to adcode.support@gmail.com.
`;

export default function PrivacyPage() {
  return (
    <>
      <JsonLd
        data={breadcrumbs([
          { name: "Home", path: "/" },
          { name: "Privacy", path: "/privacy" },
        ])}
      />

      <section className="band">
        <div className="wrap">
          <header className="page-header">
            <p className="eyebrow">Privacy</p>
            <h1 style={{ fontSize: "clamp(30px, 4.2vw, 46px)" }}>What we collect, and what we never do.</h1>
            <p className="mono" style={{ marginTop: 16, fontSize: 13, color: "var(--faint)" }}>
              Last updated <time dateTime={UPDATED}>{UPDATED_LABEL}</time>
            </p>
          </header>

          <div className="prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(BODY) }} />
        </div>
      </section>
    </>
  );
}
