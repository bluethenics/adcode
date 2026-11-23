/**
 * Ads and earnings.
 *
 * The numbers and promises here are quoted from the brief and the marketing site
 * deliberately. This is the one area where an explanation that is friendlier than the
 * truth would be a lie, so these entries stay exact.
 */
import type { HelpEntry } from "../types.ts";

export const ADS_ENTRIES: readonly HelpEntry[] = [
  {
    id: "ads.networks",
    title: "Ad network connections",
    plain: "Administrators can connect an ad provider and choose what users earn for verified views or clicks.",
    why: "Provider inventory can fill an empty sponsored slot while keeping the existing ad controls and direct campaigns.",
    how: "Open Ad network settings on the website and sign in as an administrator. Add a Generic JSON API connection with the provider's documented serve and event-verification endpoints and field mappings. Save it disabled, save its API key, test the preview, then enable delivery. Choose Pay users per View, Click, or View and click, and set the dollar amount; the other event pays nothing. Keys are encrypted and never shown again. An API key alone is not enough: each provider must support the configured delivery and verification contract. Zeekend is ADCode's only ad partner: it fills the card under every AI reply, the sponsored notification when no direct campaign has one, and the card under replies on Phone link. In the Zeekend partner ads panel, paste the pub_live_ key Zeekend sent and press Save key and go live, which creates the connection if needed, encrypts the key and turns delivery on in one step. It refuses test keys (pub_test, pub_sandbox, pub_demo), whose placements earn nothing; save one of those from the connection's API key box to try it. People see Zeekend's cards only while sponsored cards under AI replies or partner notifications are on in Settings. Ask Zeekend to allow adcode.bluethenics.com as the key's origin; its dashboard's pacing (first turn, turn gap, per-session cap) applies on top of the person's Frequency, so leave those open for notifications to follow each other at the Frequency. Imprezia connections may stay saved in the panel, but ADCode no longer asks Imprezia for any card. The beehiiv connection previews newsletter offer content only; it cannot deliver desktop ads or generate earnings. Users keep control over sponsored messages and frequency.",
    group: "ads",
    settingIds: [],
    related: ["adcode.ads.enabled", "adcode.ads.frequency", "account.earnings"],
  },
  {
    id: "adcode.ads.enabled",
    title: "Sponsored messages",
    plain:
      "A small advert card appears in the corner sometimes, and you get paid a little each time one is shown.",
    why: "It is how ADCode is free. If you would rather not, turning this off costs you nothing else - no nag screens, no locked features.",
    how: "On by default. This switch is the final say on this machine: with it off, nothing is shown and nothing is earned, whatever the server says. Cards arrive while you work - that is how they are seen at all - but never during a debug session, never when the window is not in front, not for the first minute after launch, and never twice in a row without a gap. On a new install no card appears until the assistant has built something for you, or for the first 15 minutes, whichever comes first.",
    group: "ads",
    settingIds: ["adcode.ads.enabled"],
    related: ["adcode.ads.frequency", "account.earnings"],
  },
  {
    id: "adcode.ads.chatSponsored",
    title: "Sponsored cards under AI replies",
    plain: "A sponsored card chosen for the conversation can appear above the message box. It is on unless you turn it off, and ADCode tells you once when it turns it on.",
    why: "A card that matches what you are asking about is more useful than one picked from the language you have open, and it is worth more to advertisers. Choosing it does mean your message and the reply leave your computer for ADCode's ad partners, so ADCode says so once, with a Turn off button, and the switch stays in Settings.",
    how: "It is on from ADCode 2.5.1 unless you switched sponsored messages off; a one-time card says so, with Turn off. To change it, open Settings, choose Ads, and switch Sponsored cards under AI replies; it needs Sponsored messages on too. After each answer in the desktop app, ADCode asks Zeekend, its only ad partner, for one card. Zeekend receives your message (its first 2,000 characters) and the reply (4,000), which question of the conversation it is, an identifier for the conversation that is not your account, and your IP address and browser details; it uses Anthropic's models to match a product to the conversation. On Phone link, a card can appear under the computer's reply on your phone the same way. One card appears in a strip just above the message box and stays there while you work; when the next reply brings a new card it takes the old one's place only once it has arrived, so the strip is never empty in between, and a reply with no card leaves the last one where it is. It is a page from adcode.bluethenics.com walled off from the editor, so the ad partner cannot reach your files or the rest of ADCode. Clicking a card opens your browser. Nothing else from your project is sent. Turn it off in the same place and the next reply sends nothing. Not yet in the web version.",
    group: "ads",
    settingIds: ["adcode.ads.chatSponsored"],
    related: ["adcode.ads.enabled", "adcode.ads.frequency", "account.earnings"],
  },
  {
    id: "adcode.ads.partnerNotifications",
    title: "Sponsored notifications from ADCode's ad partner",
    plain: "Sponsored notifications from Zeekend, ADCode's ad partner, appear one after another at your chosen frequency when no ADCode advertiser has one for you. It is on unless you turn it off.",
    why: "Sponsored messages are what keep ADCode free, but on many days no ADCode advertiser has one that fits. This lets the ad partner fill that moment instead of leaving it empty, without showing you any more ads than you already agreed to: it uses the same schedule, daily limit and quiet times.",
    how: "It is on from ADCode 2.5.1 unless you switched sponsored messages off; the one-time card about sponsored cards mentions it too, with Turn off. To change it, open Settings, choose Ads, and switch Sponsored notifications from ADCode's ad partner; it needs Sponsored messages on too. When a sponsored message is due and no ADCode advertiser has one, the desktop app asks Zeekend instead, telling it only the names of the languages and frameworks you have open (like typescript, react, docker), which notification of this session it is, an identifier that changes every time ADCode starts, and your IP address and browser details. If Zeekend has a card, it slides in like any sponsored message, with a countdown that pauses while you read and a close button. The next one comes as soon as your Frequency allows (every 5 minutes on Max, 10 on Standard, 30 on Light), so cards follow each other without extra waiting. If Zeekend has nothing, nothing appears, the slot does not count toward your daily limit, and ADCode asks again about 20 seconds later. The card is a page from adcode.bluethenics.com walled off from the editor, so the ad partner cannot reach your files. Clicking it opens your browser. ADCode advertisers always come first. Each Zeekend card you are shown - here, under a reply or in the box above the message box - credits $0.002 to your earnings, once per card, up to 300 cards ($0.60) a day. Not in the web version.",
    group: "ads",
    settingIds: ["adcode.ads.partnerNotifications"],
    related: ["adcode.ads.enabled", "adcode.ads.frequency", "adcode.ads.chatSponsored"],
  },
  {
    id: "adcode.ads.frequency",
    title: "Frequency",
    plain: "How often a sponsored card is allowed to appear. Off, Light, Standard, or Max.",
    why: "Fewer cards means less interruption and less earned; more means the opposite. It is your trade to make.",
    how: "Standard by default - at most one every 10 minutes and 24 a day. Light is one every 30 minutes and 8 a day; Max is one every 5 minutes and 60 a day. Off stops every sponsored card, including the one above the message box and on a linked phone. These limits are counted on your machine, and the server is only ever allowed to make them stricter, never looser.",
    group: "ads",
    settingIds: ["adcode.ads.frequency"],
    related: ["adcode.ads.enabled", "account.earnings"],
  },
  {
    id: "ads.convertEarnings",
    title: "Convert earnings to AI credits",
    plain: "Turn the money you earned from sponsored cards into AI credits for paid models, in one click, without withdrawing it first.",
    why: "Withdrawing needs at least $50, payout details and a week-old account, and then you would pay again to buy credits. Converting works from 50 cents, takes a second, costs nothing, and the credits are ready for the next message.",
    how: "Open Earnings (the Earnings row in the Vibe sidebar, or Earnings: Convert to AI Credits in the command palette) and choose Convert to AI credits. The card shows the earnings you can convert, your AI credits now, and the rate: $1.00 of earnings becomes $1.00 of credits, with no fee. Type an amount or press All, check the line that says what you will get, and press the Convert button. A pop-up shows both balances before and after; press Convert there to confirm, or Back to change your mind - nothing moves until you confirm. While it converts, a coin runs from Earnings to AI credits; when it is done, coins land in your credits, both figures count to their new values, and a check mark appears. Press Done. Both balances update at once: the earnings card, the status bar, and the paid-credit meters in the chat and AI usage. If the connection drops, the pop-up says nothing was converted and offers Try again, which repeats the same request. The smallest conversion is $0.50, the largest $1,000 at a time and $1,000 a day in total; amounts are in whole cents. You need a signed-in account with a confirmed email, the same as for a withdrawal. The server sets the rate and checks your balance, and moves the money in one step, so it is never in both places or neither; a double click or a retry after a dropped connection converts once. It cannot be undone: credits stay credits. They never expire and pay for paid models at each model's listed price. Your lifetime earned figure keeps the converted money - you earned it. Each conversion appears in your earnings ledger on the website as Converted to AI credits, and in your credit activity as From ad earnings. While a free model promotion runs (for example $0.15 of DeepSeek for the first 300 verified accounts), your first request to that model claims your share automatically, or press Claim free usage under Paid models on the AI credits page; the chat's meter shows what is left. It is spent before your credits and only on that model, so it carries you while sponsored cards earn enough to convert.",
    group: "ads",
    settingIds: [],
    related: ["account.earnings", "ads.withdrawEarnings", "adcode.ads.enabled"],
  },
  {
    id: "ads.withdrawEarnings",
    title: "Withdraw earnings on the website",
    plain: "Earnings are paid out to you from the website. The Withdraw button in the earnings card takes you straight there.",
    why: "A payout needs your bank or payment details and some checks, which are kept on the website rather than in the editor.",
    how: "Open Earnings and press Withdraw on the website (or run Earnings: Withdraw on the Website from the command palette). Your browser opens adcode.bluethenics.com/dashboard at Payouts; sign in with the same account as the editor. The page lists what you need before a payout: at least $50 available, a confirmed email, an account at least 7 days old, confirming you are 18 or older, payout details on file, and no other request in progress. Enter the amount and send the request; it shows there until it is paid. Earnings you converted to AI credits are no longer available to withdraw.",
    group: "ads",
    settingIds: [],
    related: ["account.earnings", "ads.convertEarnings"],
  },
];
