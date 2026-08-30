/**
 * The IndexNow key, and the host it belongs to.
 *
 * IndexNow is the half of search submission that can be automated. Google Search Console
 * needs a signed-in account and a proven claim on the domain, so submitting a sitemap
 * there is a human step and always will be. Bing, Yandex, Seznam and Naver accept a POST
 * naming the URLs that changed, authenticated only by a key file served from the same
 * host - no account anywhere.
 *
 * Google does not consume IndexNow. They trialled it and did not adopt it, so this is a
 * complement to Search Console rather than a substitute for it.
 *
 * Its own module because two things in different trees must agree: this value, and the
 * file served at `apps/web/public/<key>.txt`. When they disagree the API still answers
 * 200 and the submission is discarded afterwards, so the failure is invisible from the
 * submitting end. `apps/desktop/test/indexnowKey.test.ts` makes it visible here instead.
 *
 * The key is public by design - it is served from the site - so there is nothing to leak.
 * The most a third party can do with it is ask Bing to recrawl pages that are already
 * public.
 */
export const INDEXNOW_KEY = "5b8b3929501cdbe5c76739794a48ae59";

/** Where the key must be readable for a submission to be honoured. */
export const indexNowKeyLocation = (origin: string): string =>
  `${origin.replace(/\/$/, "")}/${INDEXNOW_KEY}.txt`;

/** IndexNow accepts 8 to 128 hexadecimal characters and rejects anything else. */
export const isValidIndexNowKey = (key: string): boolean => /^[a-f0-9]{8,128}$/.test(key);
