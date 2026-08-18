import type { Metadata } from "next";
import { renderMarkdown } from "@/lib/markdown";
import { JsonLd } from "@/components/JsonLd";
import { breadcrumbs } from "@/lib/schema";
import { url } from "@/lib/site";

export const metadata: Metadata = {
  title: "Terms",
  description:
    "The terms for using ADCode: what you get, how earnings work, what counts as abuse, and what happens to your balance.",
  alternates: { canonical: url("/terms") },
};

const UPDATED = "2026-08-18";

const BODY = `
These are the terms for using the ADCode editor and this website. They are written to be read.

**These terms are a template and have not been reviewed by a lawyer.** Before ADCode takes money from advertisers or pays money to users, they should be.

## Using ADCode

ADCode is free. You may use it for personal or commercial work. You may not redistribute modified builds as though they were official, or use the ADCode name or mark to imply endorsement.

The editor is provided as it is. We try hard to make it correct — it has an extensive automated test suite — but we do not warrant that it is free of defects, and we are not liable for lost work. Commit often, as you would with any editor.

## Your account

On first launch an anonymous account is created for you automatically. You are responsible for anything done through it.

You may attach an email address later, which is required before withdrawing money. One person may hold one account.

## Earnings

When a sponsored card is shown to you and the resulting receipt is verified, your account is credited. The rate is the advertiser's CPM multiplied by the revenue share, both published on this site and in the editor.

A few things follow from that:

- **Only verified views earn.** A receipt that does not match a card the server actually sent you earns nothing.
- **Earnings can be reversed.** If a credit is found to be fraudulent or mistaken, a reversal is recorded against it. The original entry stays visible; we do not delete history.
- **Rates can change.** If the CPM or the revenue share changes, the change applies to views after the change, never retroactively to what you have already earned.
- **Balances are in your account, not in escrow.** Until a withdrawal completes, your balance is an amount we owe you, not money held separately on your behalf.

## What is not allowed

Do not try to manufacture views. Concretely: automating the editor to generate impressions, running it purely to accrue credit, submitting receipts for cards that were not shown, or operating multiple accounts to multiply earnings.

We can detect most of this because a receipt only pays when it matches a card the server itself served. Where we find it, we reverse the affected credits and may suspend the account.

Also, obviously: do not use ADCode to break the law, and do not attack the service.

## Withdrawals

Once withdrawals are available, you will be able to request a payout of your available balance above a minimum amount. Payouts are sent through Wise. You are responsible for any tax you owe on what you receive.

We may require identity verification before sending money, where the law requires it.

## Advertisers

Advertisers pay for verified views only. Campaign budgets are enforced by the server, and a campaign stops serving when its budget is spent.

Creatives must be truthful, must not impersonate anyone, and must not contain adult content, gambling, or malware. We can refuse or remove a creative, and we will refund unspent budget if we do.

Payment is taken through Dodo Payments.

## Suspension

We may suspend an account that breaks these terms. If we suspend yours, you can write to support@adcode.dev, and we will tell you the reason.

If we suspend an account for abuse, credits arising from that abuse are reversed. Credits earned legitimately are not.

## Ending

You can stop using ADCode at any time and ask for your account to be deleted. We may discontinue the service, and if we do, we will give notice and settle outstanding balances above the payout minimum.

## Changes

If these terms change materially, the date below changes and the change is described in the blog.

## Contact

support@adcode.dev
`;

export default function TermsPage() {
  return (
    <>
      <JsonLd
        data={breadcrumbs([
          { name: "Home", path: "/" },
          { name: "Terms", path: "/terms" },
        ])}
      />

      <section className="band">
        <div className="wrap">
          <header style={{ marginBottom: 30, maxWidth: "68ch" }}>
            <p className="eyebrow">Terms</p>
            <h1 style={{ fontSize: "clamp(30px, 4.2vw, 46px)" }}>The deal, in plain terms.</h1>
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
