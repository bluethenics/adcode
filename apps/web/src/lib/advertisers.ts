/**
 * What the `/advertisers` page says, kept apart from its markup so the numbers it quotes
 * come from the same constants the marketplace bills by.
 *
 * Every figure here is either derived from `ECONOMICS` or read live from `/v1/stats`. The
 * page never states a reach number of its own: advertisers buy on numbers, and one typed
 * into a file goes stale the day it ships. `/v1/impressions` is deliberately not used -
 * it is a composite activity score, not billable ad views, and quoting it to somebody
 * buying ad views would overstate what they get.
 */
import { ECONOMICS, blockMicrosToCpmMicros } from "./site";
import { meetsPublicStatsThreshold, parsePublicStats, type PublicStats } from "./publicStats";
import { readApi } from "./apiRead";

/** Whole dollars from micros, with cents only when there are any. */
export function dollars(micros: bigint): string {
  const cents = Number(micros / 10_000n);
  return cents % 100 === 0 ? `$${(cents / 100).toLocaleString("en-US")}` : `$${(cents / 100).toFixed(2)}`;
}

/** The floor price of one 500-view block, and the CPM it works out to. */
export const FLOOR = {
  block: dollars(ECONOMICS.floorBlockMicros),
  cpm: dollars(blockMicrosToCpmMicros(ECONOMICS.floorBlockMicros)),
  views: Number(ECONOMICS.impressionsPerBlock),
} as const;

/** Budgets an advertiser might start with, and the verified views each buys at the floor. */
export function budgetExamples(budgets: readonly number[] = [25, 100, 500]): { budget: string; views: number }[] {
  return budgets.map((budget) => {
    const blocks = (BigInt(budget) * 1_000_000n) / ECONOMICS.floorBlockMicros;
    return { budget: `$${budget.toLocaleString("en-US")}`, views: Number(blocks * ECONOMICS.impressionsPerBlock) };
  });
}

/**
 * The live network figures, or null when they are unavailable or still too small to be
 * worth showing - the same gate the homepage counter uses, so the two never disagree.
 */
export function publishable(stats: PublicStats | null): PublicStats | null {
  return stats !== null && meetsPublicStatsThreshold(stats) ? stats : null;
}

/** Server-side first paint of the live figures; the client refreshes them every minute. */
export async function readNetworkStats(): Promise<PublicStats | null> {
  try {
    const response = await readApi("/v1/stats", 60);
    return response.ok ? publishable(parsePublicStats(await response.json())) : null;
  } catch {
    return null;
  }
}

/** The developer contexts a campaign can target, as the campaign builder groups them. */
export const TARGETING: readonly { group: string; tags: readonly string[] }[] = [
  { group: "Languages", tags: ["TypeScript", "JavaScript", "Python", "Rust", "Go", "Java", "C#", "C++", "Kotlin", "Swift", "PHP", "Ruby", "SQL", "Shell", "Lua", "C"] },
  { group: "Frameworks", tags: ["React", "Next.js", "Vue", "Nuxt", "Svelte", "Angular", "Django", "Rails", "Laravel", "Express", "Spring"] },
  { group: "Tools", tags: ["Docker", "Kubernetes", "Terraform", "npm", "Vite", "Webpack", "Cargo", "Gradle", "Maven"] },
  { group: "Platforms", tags: ["Web", "Backend", "Mobile", "Desktop"] },
];

export const ADVERTISER_FAQ: readonly { q: string; a: string }[] = [
  {
    q: "What exactly am I paying for?",
    a: `Verified views, sold in blocks of ${FLOOR.views}. A view counts only after your card has been on screen for at least four seconds while the editor window is focused, and the receipt has synced to our servers. Fetches, hidden windows and expired cards never bill.`,
  },
  {
    q: "How much does it cost?",
    a: `Bids start at ${FLOOR.block} per ${FLOOR.views} verified views, which is a ${FLOOR.cpm} CPM. Each slot runs a second-price auction, so when you win you pay just enough to beat the next bid, never more than your maximum.`,
  },
  {
    q: "Who will see my ad?",
    a: "Developers writing code in ADCode, on the desktop app and in the browser. Target everyone, or pick from 45 contexts (languages, frameworks, tools and platforms) and your card serves only to developers working in them.",
  },
  {
    q: "Does targeting read anyone's code?",
    a: "No. The editor matches a small, fixed vocabulary of tags (such as lang:rust or fw:next) on the device. No source code, file names or personal data reach the ad server, so there is nothing about a developer to sell.",
  },
  {
    q: "How fast can a campaign go live?",
    a: "Minutes. One screen takes your logo, your line and your budget. Cards pass automated checks (https links, image-only logos, length limits) on submit, so a funded campaign starts serving right away. You can pause it at any time.",
  },
  {
    q: "Is there a minimum spend or a contract?",
    a: `No contract. The smallest campaign is one block at ${FLOOR.block}. Credits you do not spend stay in your balance for the next campaign.`,
  },
  {
    q: "Why would developers welcome an ad?",
    a: "Because they are paid for it. Half of every verified view's revenue is credited to the developer who saw it. Ads are what keep the editor and its AI free, and developers can see that in their own earnings.",
  },
];
