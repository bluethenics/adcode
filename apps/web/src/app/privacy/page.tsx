import type { Metadata } from "next";
import { renderMarkdown } from "@/lib/markdown";
import { JsonLd } from "@/components/JsonLd";
import { breadcrumbs } from "@/lib/schema";
import { url } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "What ADCode collects, what it never collects, and why. Your file contents, paths, and project names never leave your machine.",
  alternates: { canonical: url("/privacy") },
};

const UPDATED = "2026-08-18";

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

- Your **file contents, file paths, and project names never leave your machine.** Not hashed, not truncated, not sampled.
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

### When you send feedback

If you use the feedback button, we receive what you typed, the app version, and your operating system name. Nothing else about your machine or your work is attached.

### AI features

AI features send only what you explicitly ask them to send, to the provider whose key you configured. You supply your own API key, and that traffic goes to that provider under their terms, not through us.

## Identity

On first launch the editor creates an **anonymous account** through Firebase Authentication. It has no email address, no name, and no password. Its only purpose is to have somewhere to credit your earnings.

If you later choose to withdraw money, you can attach an email address to that same account. Your existing balance carries over because it is the same account, not a new one.

## What we store

- Your anonymous account identifier, and when it was created.
- Your ledger: one row per credit, reversal, adjustment, or withdrawal, with the amount and a short description.
- Records of ads served to you, kept briefly, so a receipt can be checked against a real serve.
- Feedback you send, if you send any.

## Cookies and analytics

This website sets **no cookies** and runs **no third-party analytics or advertising scripts**. Fonts are served from this site's own domain rather than a font CDN, so loading a page does not disclose your address to another company.

The signed-in areas — the dashboard, advertiser portal, and admin panel — use a session cookie strictly to keep you signed in.

## Sharing

We share personal data with nobody for advertising purposes.

Advertisers receive **aggregate** reporting: how many times their campaign was served, viewed, and clicked. They never receive your identifier, your tags, or anything that identifies you individually.

We use Google Cloud and Firebase to run the service, Dodo Payments to take payment from advertisers, and Wise to send withdrawals. Each receives only what it needs to do its part.

## Your choices

- **Turn ads off.** Settings has a cadence control with an off position. The editor is otherwise identical, with no reduced features and no prompts to turn it back on.
- **Ask for your data or its deletion.** Write to privacy@adcode.bluethenics.com. Deleting your account removes your identifier and your ledger. Records we must keep for accounting are retained where the law requires.

## Retention

Ledger rows are kept as long as the account exists, because they are the record of what you were paid. Serve records expire automatically within hours. Feedback is kept until it is resolved.

## Children

ADCode is not directed at children under 13, and we do not knowingly create accounts for them.

## Changes

If this policy changes in a way that affects what is collected, the date below changes and the change is described in the blog rather than made quietly.
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
              Last updated <time dateTime={UPDATED}>18 August 2026</time>
            </p>
          </header>

          <div className="prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(BODY) }} />
        </div>
      </section>
    </>
  );
}
