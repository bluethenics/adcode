/**
 * Invites on the website: the code from an `/i/<code>` link, carried to where it is used.
 *
 * The Microsoft Store installer drops a link's query string, so a code has three ways to
 * survive the trip to an account, and this module serves all of them:
 *
 * - **The clipboard.** The download button copies `inviteLine(code)` as it starts the
 *   download, and the editor's welcome screen looks for exactly that line.
 * - **This browser.** `rememberRef` keeps the code for 30 days, for signing in to the
 *   dashboard (a person claims it there) and for the advertiser portal (a company signing up
 *   is attributed to whoever sent it).
 * - **Analytics.** An invite page visit is counted against `ref.<code>`, so the admin's
 *   Sources table can say how many visits each code brought.
 *
 * The service checks every code again; nothing here decides who earns what.
 */

export const REF_KEY = "adcode_ref";
export const REF_TTL_MS = 30 * 86_400_000;

const CODE = /^[a-z0-9][a-z0-9-]{2,31}$/;
const INVITE_PATH = /^\/i\/([a-z0-9][a-z0-9-]{2,31})\/?$/;

export function isInviteCode(value: string): boolean {
  return CODE.test(value);
}

/** Exactly what the editor's welcome looks for on the clipboard. */
export function inviteLine(code: string): string {
  return `ADCode invite: ${code}`;
}

export function rememberRef(storage: Storage, code: string, now: number): void {
  if (!isInviteCode(code)) return;
  try {
    storage.setItem(REF_KEY, JSON.stringify({ code, at: now }));
  } catch {
    // Storage blocked: the clipboard and the paste box still carry the code.
  }
}

export function readRef(storage: Storage, now: number): string | null {
  try {
    const raw = storage.getItem(REF_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as { code?: unknown; at?: unknown };
    if (typeof parsed.code !== "string" || typeof parsed.at !== "number") return null;
    if (!isInviteCode(parsed.code) || now - parsed.at >= REF_TTL_MS) return null;
    return parsed.code;
  } catch {
    return null;
  }
}

export function clearRef(storage: Storage): void {
  try {
    storage.removeItem(REF_KEY);
  } catch {
    // Nothing to clear from storage that cannot be read.
  }
}

/**
 * The campaign a visit counts against. An explicit `utm_campaign` wins - a campaign link that
 * happens to land on an invite page is still that campaign - and otherwise an invite page
 * counts for its own code.
 */
export function campaignFor(path: string, utmCampaign: string): string {
  if (utmCampaign !== "") return utmCampaign;
  const code = INVITE_PATH.exec(path)?.[1];
  return code === undefined ? "" : `ref.${code}`;
}

export interface InviteLookup {
  valid: boolean;
  inviterName: string | null;
  kind: "user" | "campaign" | null;
}

/** The headline an invite page leads with, or null for the ordinary hero. */
export function inviteHeadline(lookup: InviteLookup | null): string | null {
  if (lookup === null || !lookup.valid) return null;
  if (lookup.kind === "campaign") return "You're invited to ADCode";
  return `${lookup.inviterName ?? "A developer"} invited you to ADCode`;
}

/**
 * The code an advertiser signing up came with: a `?ref=` on the page they are on, else the
 * invite this browser remembers. The service re-checks it and never fails a sign-up for it.
 */
export function refForSignup(search: string, storage: Storage, now: number): string | null {
  const fromPage = new URLSearchParams(search).get("ref")?.trim().toLowerCase() ?? "";
  return isInviteCode(fromPage) ? fromPage : readRef(storage, now);
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** Who joined with a link, before any money - the same words the editor's panel uses. */
export function invitePeopleLine(view: { people: { claimed: number; seen: number; cameBack: number }; advertisers: number }): string {
  const { claimed, seen } = view.people;
  if (claimed === 0 && view.advertisers === 0) return "Nobody has used your link yet.";
  const parts: string[] = [];
  if (claimed > 0) {
    parts.push(`${plural(claimed, "person", "people")} joined with your link`);
    parts.push(`${seen} ${seen === 1 ? "is" : "are"} using ADCode`);
  }
  if (view.advertisers > 0) {
    const advertisers = plural(view.advertisers, "advertiser", "advertisers");
    parts.push(claimed > 0 ? advertisers : `${advertisers} joined with your link`);
  }
  return parts.join(" · ");
}

export function inviteTerms(rates: { userPercent: number; advertiserPercent: number; windowDays: number }): [string, string, string] {
  const span = rates.windowDays === 365 ? "a year" : `${rates.windowDays} days`;
  return [
    `You get ${rates.userPercent}% of what ADCode earns from the ads the people you invite see, for ${span}.`,
    `Bring an advertiser and you get ${rates.advertiserPercent}% of what they spend.`,
    "It comes out of ADCode's half. The people you invite keep every cent of theirs.",
  ];
}

/** The editor's share line, so a link reads the same wherever it was shared from. */
export const SHARE_TEXT = "I code in ADCode - the AI is free and the ads pay me. Here's my invite:";

export function inviteShareLinks(link: string): { x: string; threads: string; email: string } {
  const post = encodeURIComponent(`${SHARE_TEXT} ${link}`);
  return {
    x: `https://x.com/intent/post?text=${post}`,
    threads: `https://www.threads.com/intent/post?text=${post}`,
    email: `mailto:?subject=${encodeURIComponent("Try ADCode with me")}&body=${encodeURIComponent(`${SHARE_TEXT}\n\n${link}`)}`,
  };
}

/** `{ ref }` for an advertiser sign-up body in the browser, or `{}` - never a throw. */
export function signupRefBody(): { ref?: string } {
  try {
    const ref = refForSignup(window.location.search, window.localStorage, Date.now());
    return ref === null ? {} : { ref };
  } catch {
    return {};
  }
}

/**
 * A ready-to-post line about what ADCode has done for this person this month, with their
 * invite link - or null when there is not yet an hour of coding to mention.
 *
 * Money appears only from $1: "it's paid me $0.04" undersells the product, and an honest
 * small number is better left out than rounded up.
 */
export function progressPost(input: { activeMs: number; lifetimeMicros: string; link: string }): string | null {
  const hours = Math.floor(input.activeMs / 3_600_000);
  if (hours < 1) return null;
  const coded = `I've coded ${hours} ${hours === 1 ? "hour" : "hours"} in ADCode this month`;
  let micros = 0n;
  try {
    micros = BigInt(input.lifetimeMicros || "0");
  } catch {
    micros = 0n;
  }
  const paid = micros >= 1_000_000n
    ? ` and it's paid me $${(micros / 1_000_000n).toString()}.${((micros % 1_000_000n) / 10_000n).toString().padStart(2, "0")} so far`
    : "";
  return `${coded}${paid}. The AI is free and the ads pay me. Try it: ${input.link}`;
}

/** The eyebrow over the advertiser section when it was reached from `/i/<code>?for=ads`. */
export function adsHeadline(lookup: InviteLookup | null): string {
  if (lookup === null || !lookup.valid || lookup.kind !== "user") return "Advertise on ADCode";
  return lookup.inviterName === null ? "A developer who uses ADCode sent you this" : `${lookup.inviterName} thinks you should advertise on ADCode`;
}
