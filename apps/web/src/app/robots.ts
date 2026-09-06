import type { MetadataRoute } from "next";
import { url } from "@/lib/site";

/**
 * Crawling rules.
 *
 * Answer engines are allowed everywhere the public site is, and named explicitly so it
 * stays that way. Blocking them is a choice some sites make; for a product whose whole
 * pitch is "we tell you the real numbers", being quotable is the point.
 *
 * ## What this file cannot do on its own
 *
 * Cloudflare prepends a managed block to the served `/robots.txt` before this one, and on
 * a default account that block reads:
 *
 *     Content-Signal: search=yes,ai-train=no,use=reference
 *     User-agent: GPTBot          Disallow: /
 *     User-agent: ClaudeBot       Disallow: /
 *     User-agent: CCBot           Disallow: /
 *     User-agent: Google-Extended  Disallow: /
 *
 * - the exact agents allowed below. The result is not "the stricter one wins": it is one
 * file containing two contradictory groups for the same user-agent, which RFC 9309 says to
 * merge and which real crawlers resolve inconsistently, some taking the first match. A
 * deliberate allow and an inherited deny cancel into a coin toss.
 *
 * It is a dashboard setting, not a file, so it cannot be fixed from here - **Cloudflare →
 * the zone → AI Crawl Control**. SETUP.md step 20 is the click path, and
 * `scripts/seo-audit.mjs` fetches the live file and fails when the managed block is back,
 * because this is exactly the kind of change an account-wide default silently reapplies.
 */

/** Signed-in areas: nothing to index, and every URL under them redirects to a login. */
const PRIVATE = ["/portal/", "/dashboard/", "/admin/", "/support", "/api/"];

/**
 * The answer engines, named rather than left to the wildcard.
 *
 * `User-agent: *` already permits them, so this changes no crawler's behaviour today. It
 * is here because a wildcard-allow is also what a default-deny file looks like halfway
 * through being written: somebody adding one `Disallow` to it later would silently
 * withdraw this site from every assistant that quotes it. Naming them makes the intent
 * survive the next edit.
 */
const ANSWER_ENGINES = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-User",
  "anthropic-ai",
  "PerplexityBot",
  "Google-Extended",
  "Applebot-Extended",
  "CCBot",
  // Meta's crawler, added because Cloudflare's managed block disallows it by name and
  // this file previously did not mention it - so the deny stood unopposed.
  "meta-externalagent",
  "Bingbot",
  "DuckDuckBot",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: PRIVATE },
      { userAgent: ANSWER_ENGINES, allow: "/", disallow: PRIVATE },
    ],
    sitemap: url("/sitemap.xml"),
    host: url("/"),
  };
}
