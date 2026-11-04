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
    how: "Open Ad network settings on the website and sign in as an administrator. Add a Generic JSON API connection with the provider's documented serve and event-verification endpoints and field mappings. Save it disabled, save its API key, test the preview, then enable delivery. Choose Pay users per View, Click, or View and click, and set the dollar amount; the other event pays nothing. Keys are encrypted and never shown again. An API key alone is not enough: each provider must support the configured delivery and verification contract. Imprezia Chat Ads works with just the publisher API key from Imprezia's API Keys page: Add Imprezia Chat Ads, paste the key, test, then enable delivery. Its ads fill the sponsored card when no direct campaign does, and only the project's language tags are sent. A sandbox key (api_pub_sandbox_) delivers Imprezia's test ads and never pays users. Imprezia's Exchange preview, with an app bundle or domain, stays test-only. The beehiiv connection previews newsletter offer content only; it cannot deliver desktop ads or generate earnings. Users keep control over sponsored messages and frequency.",
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
    plain: "If you turn it on, a sponsored card chosen for the conversation can appear under the assistant's reply. It is off unless you turn it on.",
    why: "A card that matches what you are asking about is more useful than one picked from the language you have open, and it is worth more to advertisers. But choosing it means your message and the reply leave your computer for ADCode's ad partner, so it is your choice, not a default.",
    how: "Open Settings, choose Ads, and turn on Sponsored cards under AI replies; it needs Sponsored messages on too. After each answer in the desktop app, your message and the reply (the first 4,000 characters of each), an identifier for that conversation, and your IP address and browser details go to Imprezia, which picks a card or none. The card appears under the reply, or nothing does. It is a page from adcode.bluethenics.com walled off from the editor, so the ad partner cannot reach your files or the rest of ADCode. Clicking a card opens your browser. Nothing else from your project is sent. Turn it off in the same place and the next reply sends nothing. Not yet in the web version.",
    group: "ads",
    settingIds: ["adcode.ads.chatSponsored"],
    related: ["adcode.ads.enabled", "adcode.ads.frequency", "account.earnings"],
  },
  {
    id: "adcode.ads.partnerNotifications",
    title: "Sponsored notifications from ADCode's ad partner",
    plain: "If you turn it on, a sponsored notification from Imprezia, ADCode's ad partner, can appear when no ADCode advertiser has one for you. It is off unless you turn it on.",
    why: "Sponsored messages are what keep ADCode free, but on many days no ADCode advertiser has one that fits. This lets the ad partner fill that moment instead of leaving it empty, without showing you any more ads than you already agreed to: it uses the same schedule, daily limit and quiet times.",
    how: "Open Settings, choose Ads, and turn on Sponsored notifications from ADCode's ad partner; it needs Sponsored messages on too. When a sponsored message is due and no ADCode advertiser has one, the desktop app asks Imprezia instead, telling it only the names of the languages and frameworks you have open (like typescript, react, docker), an identifier that changes every time ADCode starts, and your IP address and browser details. If Imprezia has a card, it slides in like any sponsored message, with a countdown that pauses while you read and a close button; if not, nothing appears and the slot does not count toward your daily limit. The card is a page from adcode.bluethenics.com walled off from the editor, so the ad partner cannot reach your files. Clicking it opens your browser. ADCode advertisers always come first. These notifications are not credited to your earnings yet. Not in the web version.",
    group: "ads",
    settingIds: ["adcode.ads.partnerNotifications"],
    related: ["adcode.ads.enabled", "adcode.ads.frequency", "adcode.ads.chatSponsored"],
  },
  {
    id: "adcode.ads.frequency",
    title: "Frequency",
    plain: "How often a sponsored card is allowed to appear. Off, Light, Standard, or Max.",
    why: "Fewer cards means less interruption and less earned; more means the opposite. It is your trade to make.",
    how: "Standard by default - at most one every 10 minutes and 24 a day. Light is one every 30 minutes and 8 a day; Max is one every 5 minutes and 60 a day. These limits are counted on your machine, and the server is only ever allowed to make them stricter, never looser.",
    group: "ads",
    settingIds: ["adcode.ads.frequency"],
    related: ["adcode.ads.enabled", "account.earnings"],
  },
];
