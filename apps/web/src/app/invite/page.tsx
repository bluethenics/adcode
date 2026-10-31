import type { Metadata } from "next";
import Link from "@/components/IntentLink";
import { JsonLd } from "@/components/JsonLd";
import { renderMarkdown } from "@/lib/markdown";
import { breadcrumbs } from "@/lib/schema";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  path: "/invite",
  title: "Invite & earn",
  socialTitle: "Invite & earn: get a share of what ADCode makes from the people you bring",
  description:
    "Invite people to ADCode and earn for a year: 10% of the cost of paid views from invited users and 5% of invited advertisers' spend. See how referrals work.",
});

/*
 * The programme in plain words, for anyone who saw a "Built with ADCode" line, a friend's
 * post, or the card in the editor and wants to know what it is before trusting it. The
 * numbers here are the published terms (`/terms#invites`); the live ones are in the editor.
 */
const BODY = `
## How it works

1. **Get your link.** In ADCode, open **Invite & earn** - from the Invite friends row in the Vibe sidebar, from the Earnings panel, or by typing "invite" in the command palette. Signed in on this site? It is on your [dashboard](/dashboard#invites) too.
2. **Send it.** Copy it, or post it on X or Threads, or email it, from the same panel.
3. **They install ADCode.** The invite page copies your invite as their download starts, and ADCode picks it up by itself the first time it opens. If it asks, they paste the code shown on the page.
4. **You earn for a year.** For 365 days you get **10% of the cost of every paid view they see**, paid out of ADCode's half — the person you invited keeps their own 50% in full. It lands in your balance the day after, like your own ad earnings, and you withdraw it the same way.

## Bring an advertiser

Know a company that sells to developers? Send them your link. If they sign up to advertise through it, you get **5% of what they spend** for a year.

## What it costs the people you invite

Nothing. Your share comes out of ADCode's half of the ad revenue. They keep every cent of theirs, the AI is just as free, and nothing about ADCode is different for them.

## The fine print, briefly

- A code has to be added within 14 days of an account being made, and each account can only have one.
- Test views, ADCode's own adverts, and accounts that are suspended earn no share.
- Inviting yourself - with a second account or a reset editor - does not pay; we reverse it.
- Your invite page can show your first name, or not. You choose in Invite & earn.

The full terms are in [Terms, under Invites](/terms). What invites read and store is in the [privacy policy](/privacy).
`;

export default function InvitePage() {
  return (
    <>
      <JsonLd
        data={breadcrumbs([
          { name: "Home", path: "/" },
          { name: "Invite & earn", path: "/invite" },
        ])}
      />
      <section className="band">
        <div className="wrap">
          <header className="page-header">
            <p className="eyebrow">Invite &amp; earn</p>
            <h1 style={{ fontSize: "clamp(30px, 4.2vw, 46px)" }}>Bring people to ADCode. Earn from what they bring in.</h1>
            <p style={{ marginTop: 16 }}>
              Haven&apos;t got ADCode yet? <Link href="/versions">Install it</Link> - your invite link is waiting inside.
            </p>
          </header>
          <div className="prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(BODY) }} />
        </div>
      </section>
    </>
  );
}
