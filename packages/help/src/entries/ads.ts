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
    id: "adcode.ads.enabled",
    title: "Sponsored messages",
    plain:
      "A small advert card appears in the corner sometimes, and you get paid a little each time one is shown.",
    why: "It is how ADCode is free. If you would rather not, turning this off costs you nothing else - no nag screens, no locked features.",
    how: "On by default. This switch is the final say on this machine: with it off, nothing is shown and nothing is earned, whatever the server says. Cards arrive while you work - that is how they are seen at all - but never during a debug session, never when the window is not in front, not for the first minute after launch, and never twice in a row without a gap.",
    group: "ads",
    settingIds: ["adcode.ads.enabled"],
    related: ["adcode.ads.frequency", "account.earnings"],
  },
  {
    id: "adcode.ads.frequency",
    title: "Frequency",
    plain: "How often a sponsored card is allowed to appear. Off, Light, Standard, or Max.",
    why: "Fewer cards means less interruption and less earned; more means the opposite. It is your trade to make.",
    how: "Standard by default - at most one every 30 minutes and 8 a day. Light is one an hour and 4 a day; Max is one every 15 minutes and 20 a day. These limits are counted on your machine, and the server is only ever allowed to make them stricter, never looser.",
    group: "ads",
    settingIds: ["adcode.ads.frequency"],
    related: ["adcode.ads.enabled", "account.earnings"],
  },
];
