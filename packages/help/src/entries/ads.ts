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
    how: "Open Ad network settings on the website and sign in as an administrator. Add a Generic JSON API connection with the provider's documented serve and event-verification endpoints and field mappings. Save it disabled, save its API key, test the preview, then enable delivery. Set the user payout in dollars per view or click. Keys are encrypted and never shown again. An API key alone is not enough: each provider must support the configured delivery and verification contract. Imprezia supports non-billable Native Exchange previews with an Exchange-enabled key and a provisioned app bundle or domain. Live delivery stays disabled until its inventory, privacy, tracking and billing requirements are met. The beehiiv connection previews newsletter offer content only; it cannot deliver desktop ads or generate earnings. Users keep control over sponsored messages and frequency.",
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
