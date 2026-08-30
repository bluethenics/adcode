import type { Metadata } from "next";
import { renderMarkdown } from "@/lib/markdown";
import { JsonLd } from "@/components/JsonLd";
import { breadcrumbs } from "@/lib/schema";
import { url } from "@/lib/site";

export const metadata: Metadata = {
  title: "Terms",
  description:
    "The terms for using ADCode: what you get, how earnings work, who can withdraw, what counts as abuse, and what happens to your balance.",
  alternates: { canonical: url("/terms") },
};

const UPDATED = "2026-08-30";
const UPDATED_LABEL = "30 August 2026";

/*
 * These terms describe what the software actually does.
 *
 * Every factual claim below is checkable against the code: the $50 minimum and the five
 * withdrawal conditions are in `services/api`, the revenue share and the CPM come from
 * `lib/site.ts`, and "only verified views earn" is true because a receipt only pays when it
 * matches a card the server itself served. Terms that describe a different product than the
 * one shipped are worse than no terms, because they are evidence of what was promised.
 *
 * Fairness here is not decoration. Unfair-terms law in most places - India's included -
 * looks at whether a clause is clear, disclosed, and reasonable. A one-sided clause that
 * gets struck takes the surrounding protection with it, so the limits below are the ones
 * likely to survive being read out in a courtroom rather than the widest ones imaginable.
 *
 * `docs/legal/LEGAL-REVIEW.md` lists the clauses a lawyer should look at first and why.
 */
const BODY = `
These are the terms for using the ADCode editor, this website, and the advertising marketplace. They are written to be read, and every number in them matches what the software actually does.

## Who these terms are between

"ADCode", "we" and "us" mean the operator of the ADCode editor and this website, operating from India. "You" means the person using it.

They cover three different relationships, and which parts apply depends on which you are in:

- Anyone who uses the editor is covered by everything except **Advertisers**.
- Anyone who earns or withdraws money is additionally covered by **Earnings** and **Withdrawals**.
- Anyone who buys advertising is additionally covered by **Advertisers**.

## Agreeing to them

Installing or using ADCode means you accept these terms. If you do not accept them, do not use it — and if you have already installed it, uninstalling is enough; there is nothing to cancel.

## Who can use ADCode

You may use the editor at any age, subject to your own local law.

**You must be 18 or older to earn or withdraw money.** By holding an account that accrues a balance, and by requesting a payout, you confirm that you are. This is not caution for its own sake: paying money to a minor creates tax, consent and banking obligations that neither of us wants to discover after the fact.

We do not currently ask your date of birth, so this is a condition you meet rather than a check we run. If we learn that an account earning or withdrawing is held by someone under 18, we will suspend it and decline the payout.

You also confirm that you are not on, and not acting for anyone on, a sanctions list that applies to us or to our payment providers, and that you are not in a country those providers cannot serve. We cannot pay where the law or the provider forbids it, and we will tell you if that is why a payout cannot be made.

## Using the editor

We give you a personal, worldwide, non-exclusive, revocable licence to install and use ADCode for personal or commercial work, including work you are paid for. There is no seat limit and no separate commercial tier.

You may not:

- redistribute modified builds as though they were official, or use the ADCode name or mark to imply we endorse something;
- remove, disable or work around the parts that show sponsored cards or record receipts, while also holding an account that earns;
- resell or sublicense the editor as a product of your own;
- attack the service, or attempt to reach accounts or data that are not yours.

ADCode includes open-source components under their own licences. Those licences govern those components and nothing here narrows the rights they give you.

## Your code stays yours

We claim no ownership of, and no licence to, anything you write in the editor. Your files are yours.

Three things are worth being explicit about, because they involve your code leaving your machine and each one only happens because you asked for it:

- **AI providers.** If you connect an AI provider, the code and prompts you send it go to that provider under **their** terms and privacy policy, not ours. We pass the request along; we do not store your code, and we cannot control what they do with it. Choosing the provider is choosing whose terms apply.
- **Live sessions.** Sharing a live session puts the shared documents on your local network for whoever you invite. Who you invite is your decision.
- **Project memory.** What the editor records to project memory stays on your machine unless you enable the MCP server, which lets tools you point at it read the same memory.

What the editor does send us, and what it never sends, is set out in the [privacy policy](/privacy).

## Your account

On first launch an anonymous account is created for you automatically. You are responsible for what happens through it, including by anyone you let use your machine.

You may attach an email address later, which is required before withdrawing money. **One person may hold one account.**

## Earnings

When a sponsored card is shown to you and the resulting receipt is verified, your account is credited. The rate is the advertiser's clearing price multiplied by the published revenue share. Both figures are on this site and in the editor.

A few things follow from that:

- **Only verified views earn.** A receipt that does not match a card the server actually sent you earns nothing.
- **Earnings can be reversed.** If a credit is found to be fraudulent or mistaken, a reversal is recorded against it. The original entry stays visible; we do not delete history.
- **Rates can change.** If the clearing price or the revenue share changes, the change applies to views after the change, never retroactively to what you have already earned.
- **Balances are an amount we owe you, not money held for you.** Until a withdrawal completes, your balance is a debt we owe, not funds segregated in your name. If we became insolvent you would be an ordinary creditor. We would rather say this plainly than have you assume otherwise.
- **Earnings are not wages.** Using ADCode does not make you an employee, contractor, agent or partner of ours.

## What is not allowed

Do not try to manufacture views. Concretely: automating the editor to generate impressions, running it purely to accrue credit, submitting receipts for cards that were not shown, or operating multiple accounts to multiply earnings.

We can detect most of this because a receipt only pays when it matches a card the server itself served. Where we find it, we reverse the affected credits and may suspend the account.

Also, obviously: do not use ADCode to break the law, and do not attack the service.

## Withdrawals

You can request a payout of your available balance once it reaches **$50.00**. Six conditions apply, and your dashboard shows each of them with whether you meet it: the minimum balance, a confirmed email address, an account at least seven days old, your confirmation that you are 18 or older, payout details for a currently enabled country and currency, and no request already in progress.

Requesting moves the amount out of your available balance and holds it while we review. A person must approve each request before a transfer is made. Country and currency availability can change, and a route may be disabled when the transfer provider or the law does not permit it. Balances are held in US dollars; conversion and timing depend on the transfer actually offered at payout time.

We may decline a request — for a name that does not match the receiving account, for a balance under review, or where the law requires identity verification we have not completed. If we decline, we tell you why and the money returns to your available balance immediately. You can also cancel your own request at any time before it is sent.

Where the law requires it, we may need tax information from you before paying, and may have to withhold an amount and remit it to a tax authority. **You are responsible for any tax you owe on what you receive**, and for declaring it where you live.

## Dormant accounts

If an account has not been used for 24 months and has a balance below the payout minimum, we may close it and the remaining balance lapses. We will email the address on the account first, if there is one, and a single sign-in resets the clock. Anything at or above the payout minimum stays payable; we will not close an account to keep money that could have been withdrawn.

## Advertisers

Advertisers pay for verified views only. Campaign budgets are enforced by the server, and a campaign stops serving when its budget is spent. Payment is taken through Dodo Payments, whose own terms apply to the payment itself.

If you buy advertising, you confirm that:

- you own or are licensed to use everything in the creative — the images, the text, the marks, the claims;
- the creative is truthful, is not misleading, does not impersonate anyone, and complies with the advertising and consumer law that applies to it and to the people who will see it;
- it contains no adult content, gambling, malware, or anything unlawful.

We review creatives before delivery and can refuse or remove one. If we remove a creative, we refund the unspent budget. Reviewing is not approving: our review is a filter, not advice, and it does not transfer responsibility for the creative to us.

**You cover us for your creative.** If someone brings a claim against us because of a creative you supplied — an intellectual property claim, an advertising-standards complaint, a consumer claim about what it said — you will cover our reasonable costs and any award, provided we tell you about it promptly and let you take part in the defence.

Delivery volumes and timing are not guaranteed. We serve what the auction and the available audience produce.

## The service can change

We add and remove features. Where a change removes something you were relying on, we will say so in the release notes rather than let you find out. Sponsored cards, their frequency, and the earnings model can change; changes apply from when they are made.

## Suspension and ending

We may suspend an account that breaks these terms. If we suspend yours, you can write to the address at the bottom of this page and we will tell you the reason.

If we suspend an account for abuse, credits arising from that abuse are reversed. Credits earned legitimately are not, and remain withdrawable once any review is finished.

You can stop using ADCode at any time and ask for your account to be deleted. Deleting it forfeits any balance below the payout minimum, so withdraw first if you can.

We may discontinue the service. If we do, we will give notice and settle outstanding balances above the payout minimum.

## What we do not promise

ADCode is provided **as it is**, without warranties of any kind, express or implied, including any implied warranty of merchantability, fitness for a particular purpose, or non-infringement.

We try hard to make it correct — there is an extensive automated test suite and every release is smoke-tested against a real project — but we do not warrant that it is free of defects, that it will run uninterrupted, or that it will not lose work. **Commit often, as you would with any editor.**

We do not warrant any particular level of earnings. What you earn depends on live advertiser demand, which we do not control.

Nothing here removes rights you have under consumer law that cannot be excluded by agreement. Where such a right applies, it applies.

## Limits on what we owe you

To the extent the law allows:

- We are not liable for lost profits, lost revenue, lost data, lost work, or indirect or consequential loss.
- Our total liability to you for everything arising out of these terms is capped at the **greater of US$100 or the total amount credited to your account in the twelve months before the claim**.

Two things are **not** capped or excluded, because they cannot be: liability for death or personal injury caused by our negligence, and liability for fraud or fraudulent misrepresentation. Neither is anything else the law does not permit us to limit.

## When you cover us

If a claim is brought against us because of how you used ADCode — content you created with it, a creative you supplied, or a breach of these terms — you will cover our reasonable costs and any award, provided we tell you about the claim promptly and let you take part in the defence. Nothing in this paragraph applies to a claim caused by our own breach.

## Law and disputes

These terms are governed by the law of India. The courts of India have exclusive jurisdiction over any dispute arising out of them, and both of us submit to that jurisdiction.

If you live somewhere whose law gives you the right to bring a claim locally, that right is unaffected.

Before going to court, please write to us. Most disputes about a balance, a reversal or a suspension are a misunderstanding about what the ledger records, and the ledger is append-only precisely so that it can be read back to settle exactly this kind of question.

## Changes to these terms

If these terms change materially, the date at the top of this page changes and the change is announced in the [release notes](/versions). Continuing to use ADCode after a change means accepting it. If you do not accept a change, stop using ADCode and withdraw any balance you are eligible to withdraw.

We will not apply a change retroactively to earnings already credited.

## Odds and ends

- **Severability.** If a court finds one part of these terms unenforceable, the rest still stands, and that part is read as narrowly as it needs to be to work.
- **No waiver.** If we do not enforce something immediately, we have not given up the right to enforce it later.
- **Assignment.** You may not transfer your account or your rights under these terms. We may transfer ours to a successor if the service changes hands, and will say so if it happens.
- **Whole agreement.** These terms and the privacy policy are the whole agreement between us about ADCode, and replace anything said earlier.
- **Events outside our control.** Neither of us is liable for a failure caused by something genuinely outside our control — an outage at a provider, a change in the law, a natural disaster — for as long as that lasts.
- **Notices.** We reach you at the email on your account, or by a notice in the editor if there is none. You reach us at the address below.

## Contact

adcode.support@gmail.com
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
          <header className="page-header">
            <p className="eyebrow">Terms</p>
            <h1 style={{ fontSize: "clamp(30px, 4.2vw, 46px)" }}>The deal, in plain terms.</h1>
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
