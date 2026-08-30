#!/usr/bin/env node
/**
 * Tell the search engines that will listen without an account.
 *
 * Google Search Console needs a signed-in Google account and a proven claim on the
 * domain, so submitting a sitemap there is a human step and always will be. IndexNow is
 * the part that can be automated: Bing, Yandex, Seznam and Naver accept a POST naming the
 * URLs that changed, authenticated only by a key file served from the same host.
 *
 * Google does not consume IndexNow - they trialled it and did not adopt it - so this is a
 * complement to Search Console, never a replacement for it. Roughly a tenth of search,
 * for the cost of one request.
 *
 * The URL list comes from the live sitemap rather than a hardcoded array, so a page added
 * to the site is submitted without anybody remembering to add it here too.
 *
 *   node scripts/submit-indexnow.mjs                 # submit every URL in the sitemap
 *   node scripts/submit-indexnow.mjs --dry-run       # print what would be sent
 *   node scripts/submit-indexnow.mjs https://…/docs  # submit specific URLs
 */
import process from "node:process";
import { INDEXNOW_KEY, indexNowKeyLocation } from "../packages/release/src/indexnow.ts";

/** Mirrors NEXT_PUBLIC_SITE_ORIGIN; see apps/web/src/lib/site.ts. */
const SITE_ORIGIN = process.env["NEXT_PUBLIC_SITE_ORIGIN"] ?? "https://adcode.bluethenics.com";

const ENDPOINT = "https://api.indexnow.org/indexnow";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const explicit = args.filter((arg) => arg.startsWith("http"));

const host = new URL(SITE_ORIGIN).host;
const keyLocation = indexNowKeyLocation(SITE_ORIGIN);

/** Every `<loc>` in the deployed sitemap. */
async function urlsFromSitemap() {
  const response = await fetch(`${SITE_ORIGIN}/sitemap.xml`);
  if (!response.ok) {
    throw new Error(`Could not read ${SITE_ORIGIN}/sitemap.xml (${String(response.status)})`);
  }

  const xml = await response.text();
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
}

/*
 * The key file has to be readable before the submission is worth making.
 *
 * IndexNow authenticates by fetching `https://<host>/<key>.txt` and comparing it to the
 * key in the payload. A deploy that has not shipped the file yet produces a 200 from the
 * API and a silent rejection afterwards, which is the least useful possible outcome.
 */
async function keyIsLive() {
  try {
    const response = await fetch(keyLocation);
    return response.ok && (await response.text()).trim() === INDEXNOW_KEY;
  } catch {
    return false;
  }
}

const urls = explicit.length > 0 ? explicit : await urlsFromSitemap();

if (urls.length === 0) {
  process.stderr.write("No URLs to submit.\n");
  process.exit(1);
}

process.stdout.write(`${String(urls.length)} URL(s) for ${host}\n`);
process.stdout.write(`Key file: ${keyLocation}\n`);

if (dryRun) {
  for (const url of urls.slice(0, 10)) process.stdout.write(`  ${url}\n`);
  if (urls.length > 10) process.stdout.write(`  … and ${String(urls.length - 10)} more\n`);
  process.stdout.write("\nDry run; nothing submitted.\n");
  process.exit(0);
}

if (!(await keyIsLive())) {
  process.stderr.write(
    `\nThe key file is not readable at ${keyLocation}.\n` +
      `Deploy the site first - IndexNow verifies the key by fetching it, and a submission\n` +
      `made before it is live is accepted and then silently discarded.\n`,
  );
  process.exit(1);
}

const response = await fetch(ENDPOINT, {
  method: "POST",
  headers: { "content-type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host, key: INDEXNOW_KEY, keyLocation, urlList: urls }),
});

// 200 and 202 both mean accepted; 202 means the key is still being verified.
if (response.status === 200 || response.status === 202) {
  process.stdout.write(`\nSubmitted. IndexNow returned ${String(response.status)}.\n`);
  process.stdout.write("Bing, Yandex, Seznam and Naver take it from here.\n");
  process.stdout.write("Google does not use IndexNow - submit the sitemap in Search Console.\n");
  process.exit(0);
}

process.stderr.write(`\nIndexNow returned ${String(response.status)}.\n`);
process.stderr.write(`${await response.text()}\n`);
process.exit(1);
