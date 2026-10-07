/**
 * The Invite & earn panel's words, from the server's view. Pure, so every sentence a person
 * reads here is pinned by a test.
 *
 * Two rules shape them. **People before pennies**: at today's volume an invite earns
 * fractions of a cent, so the panel leads with who joined and keeps money second. And
 * **never a rounded zero**: an amount is shown exactly as main formatted it, because a tiny
 * real number is honest and "$0.00" would be wrong.
 */
import type { InviteClaimResult, ReferralView } from "../../shared/api.ts";

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export function peopleLine(view: ReferralView): string {
  const { claimed, seen } = view.people;
  if (claimed === 0 && view.advertisers === 0) return "Nobody has used your link yet.";
  const parts: string[] = [];
  if (claimed > 0) {
    parts.push(`${plural(claimed, "person", "people")} joined with your link`);
    parts.push(`${seen} ${seen === 1 ? "is" : "are"} using ADCode`);
  }
  if (view.advertisers > 0) {
    parts.push(claimed > 0 ? plural(view.advertisers, "advertiser", "advertisers") : `${plural(view.advertisers, "advertiser", "advertisers")} joined with your link`);
  }
  return parts.join(" · ");
}

export function earnedLine(view: ReferralView): string | null {
  if (view.earnedMicros === "0") return null;
  const total = `${view.earnedLabel} earned from invites`;
  return view.last30Micros === "0" ? total : `${total} · ${view.last30Label} in the last 30 days`;
}

export function howItWorks(rates: ReferralView["rates"]): [string, string, string] {
  const span = rates.windowDays === 365 ? "a year" : `${rates.windowDays} days`;
  return [
    `You get ${rates.userPercent}% of what ADCode earns from the ads the people you invite see, for ${span}.`,
    `Bring an advertiser and you get ${rates.advertiserPercent}% of what they spend.`,
    "It comes out of ADCode's half. The people you invite keep every cent of theirs.",
  ];
}

export function invitedLine(view: ReferralView): string | null {
  if (!view.claimed) return null;
  return view.invitedBy === null ? "You joined with an invite" : `Invited by ${view.invitedBy}`;
}

const REFUSALS: Readonly<Record<Exclude<InviteClaimResult, { ok: true }>["error"], string>> = {
  "unknown-code": "That code isn't one we know. Check it and try again.",
  "own-code": "That's your own code - send it to someone else.",
  "too-late": "Codes can only be added in an account's first 14 days.",
  "already-claimed": "This account already has an invite.",
  invalid: "Paste the code or the whole invite link.",
  offline: "Couldn't reach ADCode. Check your connection and try again.",
  unavailable: "Invites aren't available right now. Try again later.",
};

export function claimMessage(result: InviteClaimResult): string {
  if (result.ok) return result.inviterName === null ? "Invite linked - you're connected." : `Invited by ${result.inviterName} - you're connected.`;
  return REFUSALS[result.error];
}

export function namePreview(view: ReferralView): string {
  return `Your invite page says: “${view.inviterPreview}”`;
}
