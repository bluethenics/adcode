/**
 * What every ADCode server says to a banned account.
 *
 * One code, one status, one sentence, one header - wherever the refusal comes from (this API,
 * the included-AI relay, the web version's Worker, the projects relay). Clients key on the
 * header rather than the body, because the API answers in two body shapes (`{ error: code }`
 * and the relay's `{ error: { code, message } }`) and a client should not have to parse
 * either to know it must show the banned screen.
 *
 * 403, never 401: the sign-in is fine and the answer is still no. A client that treats 401 as
 * "sign in again" would put a banned person in a sign-in loop, which is exactly what they
 * must not see - they must see that the account is banned and how to appeal.
 *
 * What a banned account can still do, decided deliberately: nothing that needs the account.
 * Every authenticated route refuses it, reading included - balance, earnings, invites,
 * reports, the wallet - because a ban that still shows a withdrawable balance invites
 * "but I can see my money" support threads and leaks nothing worth leaking. The data is
 * kept untouched and comes back the moment the account is unbanned. Contact goes to the
 * support address, which needs no account; the terms already promise the reason on request.
 * Public routes (releases, status, the model catalogue) answer anyone, signed in or not.
 *
 * The client copy is `packages/help/src/accountBan.ts`; `apps/desktop/test/accountBan.test.ts` keeps the two
 * identical.
 */
export const ACCOUNT_BANNED = "account-banned";

/** Present, as `banned`, on every refusal of a banned account. Clients look only at this. */
export const ACCOUNT_HEADER = "x-adcode-account";

export const SUPPORT_EMAIL = "adcode.support@gmail.com";

export const BANNED_MESSAGE =
  `This ADCode account has been banned, so it can't use AI, earn from sponsored cards, withdraw or convert earnings, or open its account pages. If you think this is a mistake, email ${SUPPORT_EMAIL} from the address on the account to appeal or to ask why.`;

/**
 * The close code a banned account's WebSocket hears (Phone link, live rooms). A browser cannot
 * read the status of a refused upgrade, only a close code - 4401 already means "signed out".
 */
export const BANNED_CLOSE_CODE = 4403;

/** The body of a refusal on the plain `{ error }` routes. */
export function bannedBody(): { error: typeof ACCOUNT_BANNED; message: string; support: string } {
  return { error: ACCOUNT_BANNED, message: BANNED_MESSAGE, support: SUPPORT_EMAIL };
}

/** The headers every refusal carries, on top of whatever CORS the route adds. */
export const BANNED_HEADERS: Readonly<Record<string, string>> = { [ACCOUNT_HEADER]: "banned", "cache-control": "no-store" };

/** A complete refusal for fetch-style handlers. */
export function bannedResponse(extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(bannedBody()), {
    status: 403,
    headers: { "content-type": "application/json", ...extraHeaders, ...BANNED_HEADERS },
  });
}
