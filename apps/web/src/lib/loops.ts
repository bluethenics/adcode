/**
 * Every place ADCode asks somebody to bring somebody - the growth loops - as one list, so
 * Admin > Growth > Loops can say what each one is, where it lives, and what it brought.
 *
 * A loop is measured by the tag on the link it hands out. The editor and the dashboard add
 * `?from=<tag>` to invite links (the advertiser pitch says `?for=ads`), the invite page
 * reads that as the visit's source (`inviteLoopSource` in websiteAnalytics.ts), and the
 * analytics report counts invite-page visits by it (`invitePages`). A loop with no tags is
 * one whose result is counted somewhere else, and `measure` says where.
 *
 * Pure data and pure functions: the page renders what these return, and the tests pin that
 * every tag here is one something actually sends.
 */
export type LoopSurface = "editor" | "website" | "portal" | "admin";

export interface GrowthLoop {
  id: string;
  name: string;
  surface: LoopSurface;
  /** What the person sees and is asked, in a sentence. */
  ask: string;
  /** What the person who shares gets, if anything. */
  reward: string;
  /** Invite-page sources this loop's links carry. Empty: not measured by visits. */
  tags: string[];
  /** When `tags` is empty, where its result shows instead. */
  measure?: string;
  /** Where an operator acts on it, if anywhere. */
  manage?: { href: string; label: string };
  /** Editor loops reach people with the first desktop release after this version. */
  editorAfter?: string;
}

/** 2.1.1 is the last desktop release without invites. */
const EDITOR_AFTER = "2.1.1";
const INVITE_REWARD = "10% of what ADCode earns from the ads the invited person sees, for a year";
const ADVERTISER_REWARD = "5% of what the advertiser spends, for a year";

export const GROWTH_LOOPS: readonly GrowthLoop[] = [
  {
    id: "first-build",
    name: "After a first build",
    surface: "editor",
    ask: "The first time something ADCode built opens in a preview: \"Nice build. Know someone who'd like ADCode?\" with Copy my invite link.",
    reward: INVITE_REWARD,
    tags: ["build"],
    editorAfter: EDITOR_AFTER,
  },
  {
    id: "share-buttons",
    name: "Invite & earn share buttons",
    surface: "editor",
    ask: "Invite & earn in the editor posts the invite link to X or Threads, or opens an email with it.",
    reward: INVITE_REWARD,
    tags: ["x", "threads", "email"],
    editorAfter: EDITOR_AFTER,
  },
  {
    id: "readme",
    name: "Built with ADCode in a README",
    surface: "editor",
    ask: "One click adds a \"Built with ADCode\" line, carrying the invite link, to the project's README.",
    reward: INVITE_REWARD,
    tags: ["readme"],
    editorAfter: EDITOR_AFTER,
  },
  {
    id: "live-session",
    name: "Live session invite",
    surface: "editor",
    ask: "Copying join instructions for a newcomer to a live session includes the invite link, so a guest who installs is credited.",
    reward: INVITE_REWARD,
    tags: ["collab"],
    editorAfter: EDITOR_AFTER,
  },
  {
    id: "advertiser-pitch",
    name: "Pitch to a company",
    surface: "editor",
    ask: "Invite & earn copies a short pitch for a company that sells to developers, with the advertiser version of the invite page.",
    reward: ADVERTISER_REWARD,
    tags: ["advertiser-pitch"],
    editorAfter: EDITOR_AFTER,
  },
  {
    id: "dashboard",
    name: "Dashboard invites",
    surface: "website",
    ask: "Signed-in users get their invite link, share buttons and a ready-made post about their own progress on the dashboard.",
    reward: INVITE_REWARD,
    tags: ["dashboard"],
  },
  {
    id: "send-to-desktop",
    name: "Phone to computer",
    surface: "website",
    ask: "Someone reading an invite on a phone sends the invite itself to their computer, so the code survives the hop.",
    reward: INVITE_REWARD,
    tags: ["send-to-desktop"],
  },
  {
    id: "advertisers-invite",
    name: "Advertisers bring advertisers",
    surface: "portal",
    ask: "The advertiser portal offers each advertiser a link for another company that sells to developers.",
    reward: ADVERTISER_REWARD,
    tags: ["portal"],
  },
  {
    id: "campaign-links",
    name: "Your own posts",
    surface: "admin",
    ask: "A campaign link per post or ad you run, so each one gets a row of its own. Campaign links pay nobody.",
    reward: "Nothing - these are ADCode's own",
    tags: [],
    measure: "Each link's row in Links",
    manage: { href: "/admin/growth?tab=links", label: "Make a link" },
  },
  {
    id: "thank-you",
    name: "Thank-you for a report that ships",
    surface: "admin",
    ask: "The report form says confirmed bugs and ideas that get built can earn a thank-you. When one does, award its sender from Feedback.",
    reward: "An award you choose, up to $100, to their balance",
    tags: [],
    measure: "Awards in Feedback",
    manage: { href: "/admin/review?tab=feedback", label: "Open Feedback" },
  },
  {
    id: "store-rating",
    name: "Store rating ask",
    surface: "editor",
    ask: "Asked once and never rewarded: people who installed from the Microsoft Store, got something built and came back on three different days.",
    reward: "Nothing - it helps other developers find ADCode",
    tags: [],
    measure: "Ratings in Partner Center",
    editorAfter: EDITOR_AFTER,
  },
];

export const SURFACE_LABEL: Record<LoopSurface, string> = {
  editor: "Editor",
  website: "Website",
  portal: "Advertiser portal",
  admin: "You",
};

/** Invite-page visits for one loop, from the report's `invitePages` ranking. */
export function loopVisits(loop: GrowthLoop, invitePages: readonly { label: string; count: number }[] | undefined): number | null {
  if (loop.tags.length === 0 || invitePages === undefined) return null;
  return invitePages.filter((row) => loop.tags.includes(row.label)).reduce((sum, row) => sum + row.count, 0);
}

/** Visits to invite pages that no loop's tag accounts for: plain links, search, direct. */
export function untaggedVisits(invitePages: readonly { label: string; count: number }[] | undefined): number | null {
  if (invitePages === undefined) return null;
  const tagged = new Set(GROWTH_LOOPS.flatMap((loop) => loop.tags));
  return invitePages.filter((row) => !tagged.has(row.label)).reduce((sum, row) => sum + row.count, 0);
}
