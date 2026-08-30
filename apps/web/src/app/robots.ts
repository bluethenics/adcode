import type { MetadataRoute } from "next";
import { url } from "@/lib/site";

/**
 * Crawling rules.
 *
 * Answer engines are allowed everywhere the public site is, and named explicitly so it
 * stays that way. Blocking them is a choice some sites make; for a product whose whole
 * pitch is "we tell you the real numbers", being quotable is the point.
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
