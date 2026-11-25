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
    plain: "Administrators can connect ad providers, divide the sponsored cards between them, and choose what users earn.",
    why: "Splitting cards between several ad partners keeps ADCode from depending on one network's traffic and fill, while each slot is still filled by whichever partner has a card, and the existing ad controls and direct campaigns stay as they are.",
    how: "Open Ad network settings on the website and sign in as an administrator. Add a Generic JSON API connection with the provider's documented serve and event-verification endpoints and field mappings. Save it disabled, save its API key, test the preview, then enable delivery. Choose Pay users per View, Click, or View and click, and set the dollar amount; the other event pays nothing. Keys are encrypted and never shown again. An API key alone is not enough: each provider must support the configured delivery and verification contract. Sponsored cards come from the chat partners, Zeekend and Imprezia: each partner has a go-live panel where you paste its production key (Zeekend's pub_live_, Imprezia's production publisher key) and press Save key and go live, which creates the connection if needed, encrypts the key and turns delivery on in one step; test and sandbox keys are refused there, and a connection holding one pays nobody for its cards. Traffic split, below the panels, divides the sponsored slots between the live partners: give each a share from 0 to 100 (60 and 40 send six slots in ten to the first and four to the second), tick where its cards may appear (the ad box above the chat, under AI replies, sponsored notifications), and press Save split. Each slot is offered to the partner it falls to first; if that partner has no card the next one fills it, so dividing the traffic never leaves a slot empty that one partner would have filled. A share of 0 keeps a partner as a backup only. Beside each partner the panel shows how many of its cards were seen in the last 24 hours and 7 days, so you can see whether the split is landing. Each partner's Edit form has User pay: what a person earns per card and how many cards a day pay, counted across all partners together. A partner card is offered once per finished reply; sponsored notifications ask no partner. The beehiiv connection previews newsletter offer content only; it cannot deliver desktop ads or generate earnings. Users keep control over sponsored messages and frequency.",
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
    how: "It is on from ADCode 2.5.1 unless you switched sponsored messages off; a one-time card says so, with Turn off. To change it, open Settings, choose Ads, and switch Sponsored cards under AI replies; it needs Sponsored messages on too. After each finished answer in the desktop app or the web version, ADCode offers that exchange to one of its ad partners, once: never again for the same exchange, and never with words you did not write. Which partner is asked first is set by ADCode's administrators; if it has no card, the next partner may fill the slot. Today the partner is Imprezia, whose card in the box above the message box is a small banner chosen without your message: it receives an identifier for the conversation that is not your account, the card's size and kind of device, and your IP address and browser details. A card under a reply also sends Imprezia your message and the reply. The privacy page lists the current partners and what each receives. On Phone link, a card can appear under the computer's reply on your phone the same way. One card appears in a strip just above the message box and stays there while you work; when the next reply brings a new card it takes the old one's place only once it has arrived, so the strip is never empty in between, and a reply with no card leaves the last one where it is. It is a page from adcode.bluethenics.com walled off from the editor, so the ad partner cannot reach your files or the rest of ADCode. Clicking a card opens your browser. Nothing else from your project is sent. Turn it off in the same place and the next reply sends nothing. Each partner card you are shown credits your earnings at the rate ADCode sets for partner cards, whichever partner filled it, at most three a minute; in the web version only the tab you are using earns, so cards in other tabs still show but more tabs do not earn more.",
    group: "ads",
    settingIds: ["adcode.ads.chatSponsored"],
    related: ["adcode.ads.enabled", "adcode.ads.frequency", "account.earnings"],
  },
  {
    id: "adcode.ads.partnerNotifications",
    title: "Sponsored notifications from ADCode's ad partner",
    plain: "This setting let an ad partner fill a sponsored notification when no ADCode advertiser had one. No partner is asked for notifications any more, so nothing reaches one; ADCode's own sponsored notifications are unchanged.",
    why: "A partner should only ever be asked about something you actually wrote. A notification has no conversation behind it, so ADCode no longer asks any partner to fill one.",
    how: "The switch is still in Settings > Ads (Sponsored notifications from ADCode's ad partner), but whichever way it is set, this version of ADCode asks no partner for a notification and sends nothing for one. Older versions (2.6.1 to 2.6.5) still send ADCode's card page a short question naming your open languages, and the page turns it away, so nothing reaches a partner. Sponsored notifications from ADCode's own advertisers follow your Frequency as before. Partner cards still appear in the box above the message box after a finished reply, under Sponsored cards under AI replies.",
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
    how: "Open Earnings (the Earnings row in the Vibe sidebar, or Earnings: Convert to AI Credits in the command palette) and choose Convert to AI credits. The card shows the earnings you can convert, your AI credits now, and the rate: $1.00 of earnings becomes $1.00 of credits, with no fee. Type an amount or press All, check the line that says what you will get, and press the Convert button. A pop-up shows both balances before and after; press Convert there to confirm, or Back to change your mind - nothing moves until you confirm. While it converts, a coin runs from Earnings to AI credits; when it is done, coins land in your credits, both figures count to their new values, and a check mark appears. Press Done. Both balances update at once: the earnings card, the status bar, and the paid-credit meters in the chat and AI usage. If the connection drops, the pop-up says nothing was converted and offers Try again, which repeats the same request. The smallest conversion is $0.50, the largest $1,000 at a time and $1,000 a day in total; amounts are in whole cents. You need a signed-in account with a confirmed email, the same as for a withdrawal. The server sets the rate and checks your balance, and moves the money in one step, so it is never in both places or neither; a double click or a retry after a dropped connection converts once. It cannot be undone: credits stay credits. They never expire and pay for paid models at each model's listed price. Your lifetime earned figure keeps the converted money - you earned it. Each conversion appears in your earnings ledger on the website as Converted to AI credits, and in your credit activity as From ad earnings. While a free model promotion runs (for example $0.15 of DeepSeek for the first 300 verified accounts), your first request to that model claims your share automatically, or press Claim free usage under Paid models on the AI credits page; the chat's meter shows what is left. It is spent before your credits and only on that model, so it carries you while sponsored cards earn enough to convert. Accounts that look like ad farming - a throwaway inbox, one mailbox behind several accounts written with dots or plus signs, a custom domain several accounts share or that earns very fast, or cards claimed faster than one screen shows them - are held for review: while held, new cards earn nothing and earnings cannot be converted or withdrawn, and the earnings card and the payouts page say so. Nothing is taken away; an administrator usually looks within a day, and a cleared account carries on where it was. Questions go to adcode.bluethenics.com/support.",
    group: "ads",
    settingIds: [],
    related: ["account.earnings", "ads.withdrawEarnings", "adcode.ads.enabled"],
  },
  {
    id: "ads.withdrawEarnings",
    title: "Withdraw earnings on the website",
    plain: "Earnings are paid out to you from the website. The Withdraw button in the earnings card takes you straight there.",
    why: "A payout needs your bank or payment details and some checks, which are kept on the website rather than in the editor.",
    how: "Open Earnings and press Withdraw on the website (or run Earnings: Withdraw on the Website from the command palette). Your browser opens adcode.bluethenics.com/dashboard at Payouts; sign in with the same account as the editor. The page lists what you need before a payout: at least $50 available, a confirmed email, an account at least 7 days old, confirming you are 18 or older, payout details on file, and no other request in progress. Enter the amount and send the request; it shows there until it is paid. Earnings you converted to AI credits are no longer available to withdraw. If your earnings are under review, the list shows Earnings review finished as the line still to clear. Accounts that look like ad farming - a throwaway inbox, one mailbox behind several accounts written with dots or plus signs, a custom domain several accounts share or that earns very fast, or cards claimed faster than one screen shows them - are held for review: while held, new cards earn nothing and earnings cannot be converted or withdrawn, and the earnings card and the payouts page say so. Nothing is taken away; an administrator usually looks within a day, and a cleared account carries on where it was. Questions go to adcode.bluethenics.com/support.",
    group: "ads",
    settingIds: [],
    related: ["account.earnings", "ads.convertEarnings"],
  },
  {
    id: "ads.payPerCard",
    title: "Pay per sponsored card, by country",
    plain: "Each sponsored card you are shown pays a small amount, and that amount depends on the country you are in. Earnings shows your own rate.",
    why: "Advertisers pay very different amounts for a card seen in different countries, so one flat rate would have to be set for the cheapest of them. Paying by country lets ADCode pay more where cards are worth more, and the rate you see is the one you are actually paid.",
    how: "Open Earnings (the Earnings row in the Vibe sidebar, or Earnings: Pay per Card Where I Am in the command palette). The Pay per card row says what one card pays you now and how many cards a day pay, for example \"$0.0045 a card in United Kingdom, up to 300 a day\". On the website and in the web version it is under your balance. The country is the one your internet connection comes from, as ADCode's server sees it: the app never sends it, and a country without its own rate pays the standard one. A rate applies to cards counted after it changes; cards already paid keep what they paid.",
    group: "ads",
    settingIds: [],
    related: ["account.earnings", "adcode.ads.chatSponsored", "adcode.ads.partnerNotifications"],
  },
];
