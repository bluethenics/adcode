/**
 * Earnings review: accounts that look like ad farming are held for an administrator.
 *
 * Why this exists (2026-11-24). A Zeekend card pays $0.002, and its slot id cannot be checked
 * with Zeekend from here (networkImpressions.ts), so the per-account daily cap is what bounds
 * one account. The way past a per-account cap is more accounts: a custom domain with a
 * catch-all inbox mints as many confirmed addresses as anybody wants, and so do throwaway
 * inbox sites and Gmail's dots and plus signs. Each of those accounts earns its full cap and
 * turns it into AI credits or a payout.
 *
 * So the server looks at who is earning, and holds the ones that match a farming pattern:
 *
 *   - a throwaway inbox (`disposable-email`), held at once;
 *   - the same mailbox behind several accounts, written with dots or plus signs
 *     (`duplicate-mailbox`);
 *   - a custom domain - anything that is not a public mailbox like Gmail or Outlook - that
 *     several accounts share (`custom-domain-shared`), or whose account earns a large part
 *     of the daily cap in one day (`custom-domain-fast`);
 *   - cards claimed faster than one screen can show them, all day (`too-fast`): a script,
 *     or many tabs.
 *
 * Held means: no new card earns, and the balance cannot be converted to credits or withdrawn,
 * until an administrator looks (Admin > Earnings review). Nothing is taken away - clearing an
 * account lets it carry on exactly where it was, and the administrator can trust a whole
 * domain (a company or a university) so its people are not held again. Blocking keeps the
 * account held for good; banning it is still the separate account switch.
 *
 * An honest person with a Gmail address never meets any of this. A person at a company domain
 * meets it only when their domain looks like a farm, and then an administrator clears them.
 */
/** The part of an account this file reads. Not store.ts UserRecord: store.ts imports this file. */
interface AccountEmail { readonly email?: string | undefined }

export type EarningReviewStatus = "review" | "cleared" | "blocked";

export const REVIEW_REASONS = ["disposable-email", "duplicate-mailbox", "custom-domain-shared", "custom-domain-fast", "too-fast"] as const;
export type ReviewReason = (typeof REVIEW_REASONS)[number];

export interface EarningReviewRecord {
  readonly uid: string;
  readonly status: EarningReviewStatus;
  readonly reasons: readonly ReviewReason[];
  /** The address when it was flagged, so the queue reads without a second lookup. */
  readonly email: string | null;
  readonly domain: string | null;
  readonly flaggedAt: number;
  readonly decidedAt: number | null;
  readonly decidedBy: string | null;
  readonly note: string | null;
}

/** What the database knows about everybody else, for one address. */
export interface EarningReviewSignals {
  /** Accounts whose email is at this domain, this one included. */
  readonly domainAccounts: number;
  /** Accounts whose email is this mailbox once dots and plus signs are folded, this one included. */
  readonly mailboxAccounts: number;
}

export interface EarningReviewStore {
  get(uid: string): Promise<EarningReviewRecord | null>;
  /**
   * Puts an account in review, or adds reasons to one already there. A decision an
   * administrator made stands - `cleared` and `blocked` are left alone - unless `reopen` is
   * set, which only behaviour (`too-fast`) does: an identity an administrator has looked at
   * does not change, the way an account is used can.
   */
  flag(input: { uid: string; reasons: readonly ReviewReason[]; email: string | null; domain: string | null; now: number; reopen: boolean }): Promise<EarningReviewRecord>;
  decide(input: { uid: string; status: "cleared" | "blocked"; adminUid: string; note: string | null; now: number }): Promise<EarningReviewRecord | null>;
  list(status: EarningReviewStatus, limit: number): Promise<EarningReviewRecord[]>;
  signals(email: string): Promise<EarningReviewSignals>;
  trustDomain(domain: string, adminUid: string, now: number): Promise<void>;
  isTrustedDomain(domain: string): Promise<boolean>;
}

/* ── Who an address belongs to ──────────────────────────────────────────── */

/**
 * Public mailbox providers: anybody can have one, and one person rarely has many. A domain not
 * on this list is a custom domain - somebody's own, a company's, or a farm's catch-all.
 *
 * Whole domains, not names: `gmail.xyz` is anybody's for a few dollars and must not pass as
 * Gmail. The big providers' country domains (`hotmail.co.uk`, `yahoo.fr`) match a pattern that
 * only admits country-code endings, which those providers hold.
 */
const PUBLIC_MAILBOX = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "passport.com",
  "yahoo.com", "ymail.com", "rocketmail.com", "icloud.com", "me.com", "mac.com", "aol.com", "aim.com",
  "proton.me", "protonmail.com", "protonmail.ch", "pm.me", "gmx.com", "gmx.net", "gmx.de", "web.de",
  "mail.com", "email.com", "usa.com", "yandex.com", "yandex.ru", "ya.ru", "mail.ru", "bk.ru", "list.ru",
  "inbox.ru", "internet.ru", "rambler.ru", "ukr.net", "i.ua", "zoho.com", "zohomail.com", "zohomail.in",
  "qq.com", "foxmail.com", "163.com", "126.com", "yeah.net", "sina.com", "sina.cn", "sohu.com", "aliyun.com",
  "139.com", "naver.com", "daum.net", "hanmail.net", "kakao.com", "rediffmail.com", "libero.it", "virgilio.it",
  "tiscali.it", "alice.it", "orange.fr", "wanadoo.fr", "free.fr", "laposte.net", "sfr.fr", "t-online.de",
  "freenet.de", "seznam.cz", "wp.pl", "o2.pl", "interia.pl", "onet.pl", "op.pl", "tutanota.com", "tutanota.de",
  "tuta.io", "tuta.com", "tutamail.com", "fastmail.com", "fastmail.fm", "hey.com", "hushmail.com",
  "mailfence.com", "posteo.de", "posteo.net", "mailbox.org", "runbox.com", "duck.com", "comcast.net",
  "verizon.net", "att.net", "sbcglobal.net", "bellsouth.net", "charter.net", "cox.net", "earthlink.net",
  "optonline.net", "btinternet.com", "sky.com", "talktalk.net", "virginmedia.com", "ntlworld.com", "shaw.ca",
  "rogers.com", "sympatico.ca", "bigpond.com", "optusnet.com.au", "telstra.com", "xtra.co.nz", "uol.com.br",
  "bol.com.br", "terra.com.br", "ig.com.br",
]);

/** `hotmail.co.uk`, `yahoo.fr`, `outlook.com.au`, `gmx.at`: the big providers on country-code endings. */
const PUBLIC_REGIONAL = /^(?:hotmail|outlook|live|msn|yahoo|ymail|gmx|yandex|aol|icloud)\.(?:[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/;

/** Throwaway inbox services. Not exhaustive; the shared-domain rule catches the rest. */
const DISPOSABLE = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamail.net", "guerrillamail.org", "guerrillamailblock.com",
  "sharklasers.com", "grr.la", "pokemail.net", "spam4.me", "10minutemail.com", "10minutemail.net",
  "temp-mail.org", "temp-mail.io", "tempmail.com", "tempmail.net", "tempmailo.com", "tempail.com",
  "tempr.email", "tmpmail.org", "tmpmail.net", "tmail.ws", "yopmail.com", "yopmail.fr", "yopmail.net",
  "trashmail.com", "trashmail.de", "trashmail.net", "getnada.com", "nada.email", "dispostable.com",
  "maildrop.cc", "mailnesia.com", "mintemail.com", "throwawaymail.com", "fakeinbox.com", "emailondeck.com",
  "mohmal.com", "discard.email", "spamgourmet.com", "moakt.com", "mytemp.email", "burnermail.io",
  "mail.tm", "mail.gw", "emailfake.com", "fakemail.net", "getairmail.com", "inboxkitten.com", "harakirimail.com",
  "33mail.com", "mailcatch.com", "mailpoof.com", "dropmail.me", "1secmail.com", "1secmail.net", "1secmail.org",
  "byom.de", "trbvm.com", "kzccv.com", "emltmp.com", "linshiyouxiang.net", "teleworm.us", "armyspy.com",
  "cuvox.de", "dayrep.com", "einrot.com", "fleckens.hu", "gustr.com", "jourrapide.com", "rhyta.com",
  "superrito.com", "tempinbox.com", "spambox.us", "mailforspam.com", "anonaddy.me", "simplelogin.co",
  "tempmailaddress.com", "luxusmail.org", "minuteinbox.com", "correotemporal.org", "wegwerfmail.de",
]);

/** `alice@Example.COM ` -> `example.com`; null when it is not an address. */
export function emailDomain(email: string | null | undefined): string | null {
  if (typeof email !== "string") return null;
  const at = email.trim().toLowerCase().lastIndexOf("@");
  if (at <= 0) return null;
  const domain = email.trim().toLowerCase().slice(at + 1);
  return /^[a-z0-9.-]+\.[a-z0-9-]{2,}$/.test(domain) ? domain : null;
}

/**
 * The mailbox an address delivers to: plus tags dropped everywhere (almost every provider
 * ignores them), and dots dropped at Gmail, which ignores those too. `A.Lice+ad1@gmail.com`
 * and `alice@googlemail.com` are one mailbox.
 */
export function mailboxKey(email: string | null | undefined): string | null {
  const domain = emailDomain(email);
  if (domain === null || typeof email !== "string") return null;
  let local = email.trim().toLowerCase().slice(0, email.trim().lastIndexOf("@")).split("+")[0] ?? "";
  const gmail = domain === "gmail.com" || domain === "googlemail.com";
  if (gmail) local = local.replace(/\./g, "");
  return local === "" ? null : `${local}@${gmail ? "gmail.com" : domain}`;
}

export function isPublicMailbox(domain: string): boolean {
  return PUBLIC_MAILBOX.has(domain) || PUBLIC_REGIONAL.test(domain);
}

export function isDisposable(domain: string): boolean {
  if (DISPOSABLE.has(domain)) return true;
  // Subdomains of a throwaway service (`x.mailinator.com`) are the same service.
  for (const known of DISPOSABLE) if (domain.endsWith(`.${known}`)) return true;
  return false;
}

/** This many accounts on one custom domain is a farm until an administrator says otherwise. */
export const CUSTOM_DOMAIN_SHARED_ACCOUNTS = 3;
/** Paid cards in one UTC day, on a custom domain, at which the account is looked at. Half the default cap. */
export const CUSTOM_DOMAIN_FAST_CARDS = 150;
/** Cards refused for coming too fast, in one UTC day, before the account is held. */
export const TOO_FAST_PER_DAY = 40;

/**
 * Why this address should be looked at, from what is known about it. Pure.
 * `cardsToday` is the paid-card count for today, when the check runs at a card.
 */
export function assessIdentity(input: {
  readonly email: string | null | undefined;
  readonly signals: EarningReviewSignals;
  readonly trusted: boolean;
  readonly cardsToday?: number;
}): ReviewReason[] {
  const domain = emailDomain(input.email);
  // No address: an anonymous account. It cannot convert or be paid without a confirmed one.
  if (domain === null) return [];
  if (isDisposable(domain)) return ["disposable-email"];
  const reasons: ReviewReason[] = [];
  if (input.signals.mailboxAccounts >= 2) reasons.push("duplicate-mailbox");
  if (!input.trusted && !isPublicMailbox(domain)) {
    if (input.signals.domainAccounts >= CUSTOM_DOMAIN_SHARED_ACCOUNTS) reasons.push("custom-domain-shared");
    if ((input.cardsToday ?? 0) >= CUSTOM_DOMAIN_FAST_CARDS) reasons.push("custom-domain-fast");
  }
  return reasons;
}

/** Held: no new earnings, no conversion, no payout. */
export const isHeld = (record: EarningReviewRecord | null): boolean => record !== null && record.status !== "cleared";

/** The words a reason is shown in, to the administrator. */
export const REASON_LABEL: Record<ReviewReason, string> = {
  "disposable-email": "Throwaway email address",
  "duplicate-mailbox": "Same mailbox as another account (dots or + tags)",
  "custom-domain-shared": `${CUSTOM_DOMAIN_SHARED_ACCOUNTS}+ accounts on one custom domain`,
  "custom-domain-fast": `Custom domain earning ${CUSTOM_DOMAIN_FAST_CARDS}+ cards in a day`,
  "too-fast": "Cards claimed faster than one screen shows them",
};

/** What the account holder is told, wherever their earnings are refused. */
export const HELD_MESSAGE = "Your ad earnings are being reviewed, which usually takes a day. Nothing is lost: once it is cleared, everything you earned can be converted or withdrawn again. Questions: adcode.bluethenics.com/support.";

/* ── Running the checks ─────────────────────────────────────────────────── */

export interface ReviewDeps {
  readonly reviews: EarningReviewStore | undefined;
  readonly getUser: (uid: string) => Promise<AccountEmail | null>;
  readonly now: number;
}

/**
 * Looks at an account and holds it if it matches a pattern. Returns its review record, or
 * null when it is not (and was not) in review. Never throws: a failed check earns as before,
 * because a database hiccup must not hold honest people.
 */
export async function reviewAccount(deps: ReviewDeps, uid: string, extra: { cardsToday?: number; reasons?: readonly ReviewReason[] } = {}): Promise<EarningReviewRecord | null> {
  const reviews = deps.reviews;
  if (reviews === undefined) return null;
  try {
    const existing = await reviews.get(uid);
    const behaviour = extra.reasons ?? [];
    // An administrator's decision on identity stands; only behaviour reopens it.
    if (existing !== null && existing.status !== "review" && behaviour.length === 0) return existing;
    const user = await deps.getUser(uid);
    const email = user?.email ?? null;
    const domain = emailDomain(email);
    let reasons: ReviewReason[] = [...behaviour];
    if (domain !== null && (existing === null || existing.status === "review")) {
      const [signals, trusted] = await Promise.all([reviews.signals(email!), reviews.isTrustedDomain(domain)]);
      reasons = [...reasons, ...assessIdentity({ email, signals, trusted, ...(extra.cardsToday === undefined ? {} : { cardsToday: extra.cardsToday }) })];
    }
    const fresh = reasons.filter((reason) => !(existing?.status === "review" && existing.reasons.includes(reason)));
    if (fresh.length === 0) return existing;
    return await reviews.flag({ uid, reasons: [...new Set(reasons)], email, domain, now: deps.now, reopen: behaviour.length > 0 });
  } catch {
    return null;
  }
}

/** Whether the account is held right now. A failed lookup is not a hold. */
export async function earningsHeld(reviews: EarningReviewStore | undefined, uid: string): Promise<boolean> {
  if (reviews === undefined) return false;
  try { return isHeld(await reviews.get(uid)); } catch { return false; }
}

/* ── In memory, for tests and the local server ──────────────────────────── */

export function createMemoryEarningReviewStore(users: () => Iterable<AccountEmail>): EarningReviewStore & { reset(): void } {
  let rows = new Map<string, EarningReviewRecord>();
  let trusted = new Set<string>();
  return {
    reset() { rows = new Map(); trusted = new Set(); },
    async get(uid) { return rows.get(uid) ?? null; },
    async flag({ uid, reasons, email, domain, now, reopen }) {
      const existing = rows.get(uid);
      if (existing !== undefined && existing.status !== "review" && !reopen) return existing;
      const merged = [...new Set([...(existing?.status === "review" ? existing.reasons : []), ...reasons])];
      const record: EarningReviewRecord = {
        uid, status: "review", reasons: merged, email, domain,
        flaggedAt: existing?.status === "review" ? existing.flaggedAt : now,
        decidedAt: null, decidedBy: null, note: null,
      };
      rows.set(uid, record);
      return record;
    },
    async decide({ uid, status, adminUid, note, now }) {
      const existing = rows.get(uid);
      if (existing === undefined) return null;
      const record = { ...existing, status, decidedAt: now, decidedBy: adminUid, note };
      rows.set(uid, record);
      return record;
    },
    async list(status, limit) {
      return [...rows.values()].filter((row) => row.status === status).sort((a, b) => b.flaggedAt - a.flaggedAt).slice(0, limit);
    },
    async signals(email) {
      const domain = emailDomain(email), mailbox = mailboxKey(email);
      let domainAccounts = 0, mailboxAccounts = 0;
      for (const user of users()) {
        if (domain !== null && emailDomain(user.email) === domain) domainAccounts++;
        if (mailbox !== null && mailboxKey(user.email) === mailbox) mailboxAccounts++;
      }
      return { domainAccounts, mailboxAccounts };
    },
    async trustDomain(domain) { trusted.add(domain); },
    async isTrustedDomain(domain) { return trusted.has(domain); },
  };
}
