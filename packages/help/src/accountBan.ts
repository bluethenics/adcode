/**
 * What the desktop app, the web version and the website show a banned account.
 *
 * The server's copy is `services/api/src/accountBan.ts`, which cannot import a package (the
 * dependency firewall keeps the API free of client code); `apps/desktop/test/accountBan.test.ts`
 * keeps the two identical. Clients recognise a ban by `header` on a 403 - the body differs
 * between the API's route families, the header never does.
 */
const SUPPORT = "adcode.support@gmail.com";

export const ACCOUNT_BANNED_COPY = {
  code: "account-banned",
  header: "x-adcode-account",
  support: SUPPORT,
  title: "This account has been banned",
  message: `This ADCode account has been banned, so it can't use AI, earn from sponsored cards, withdraw or convert earnings, or open its account pages. If you think this is a mistake, email ${SUPPORT} from the address on the account to appeal or to ask why.`,
  /** What happens to the account's things, said once so nobody has to ask. */
  kept: "Your projects on this computer are untouched. Your earnings and credits are kept while the ban is reviewed; credits earned legitimately stay yours if the ban is lifted.",
  appealSubject: "Appeal: banned ADCode account",
  checkAgain: "Check again",
  emailSupport: "Email support",
} as const;

/** A mailto link that tells support which account is asking - the id, never a token. */
export function appealMailto(uid: string | null): string {
  const body = `Hello,\n\nMy ADCode account has been banned and I'd like to appeal.\n\nAccount ID: ${uid ?? "(not shown)"}\n\nWhat happened:\n`;
  return `mailto:${SUPPORT}?subject=${encodeURIComponent(ACCOUNT_BANNED_COPY.appealSubject)}&body=${encodeURIComponent(body)}`;
}
