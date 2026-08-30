import { NextResponse, type NextRequest } from "next/server";
import { SITE_ORIGIN } from "@/lib/site";

/**
 * One site, one host.
 *
 * The Worker answers on both `adcode.bluethenics01.workers.dev` and the brand domain, and
 * for a while every page served from the brand domain carried a canonical pointing at the
 * `workers.dev` one. That is worse than picking either: a search engine crawling the brand
 * domain was being told the real site was a shared platform subdomain, so every ranking
 * signal the brand earned was consolidated onto a host that cannot carry brand authority
 * and cannot be moved later without losing it again.
 *
 * A canonical tag is a hint. A redirect is not, which is why this exists as well.
 *
 * **`/v1` is never redirected.** Dodo's payment webhook POSTs to
 * `/v1/webhooks/dodo` at whatever URL is registered in their dashboard, which is the
 * `workers.dev` origin. A redirect there would, at best, depend on the sender following a
 * 308 with its body and signature intact, and at worst silently fail every payment
 * notification. Money paths do not move because of an SEO change.
 *
 * 308 rather than 301 so the method and body survive for anything else that is not a GET.
 */
const CANONICAL = new URL(SITE_ORIGIN);

/**
 * The hosts to move traffic off, named rather than inferred.
 *
 * "Redirect anything that is not canonical" is the obvious rule and it is wrong: in
 * development the host is `localhost:3000`, which is not canonical, so that rule sends
 * every developer to the production site the moment they run `next dev`. Listing the hosts
 * that should move means a host nobody anticipated is served rather than bounced, which is
 * the safer way to be wrong.
 */
const LEGACY_HOSTS = new Set(["adcode.bluethenics01.workers.dev"]);

export function middleware(request: NextRequest): NextResponse {
  const host = request.headers.get("host");
  if (host === null || !LEGACY_HOSTS.has(host)) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.protocol = CANONICAL.protocol;
  url.host = CANONICAL.host;
  url.port = CANONICAL.port;

  return NextResponse.redirect(url, 308);
}

export const config = {
  /*
   * Everything except the API, Next's own build output, and the files that are fetched by
   * exact URL rather than browsed to.
   *
   * `/v1` is the important exclusion and the reason for the comment above. The rest are
   * ordinary hygiene: rewriting a chunk request or a favicon costs a round trip and buys
   * no ranking signal, because none of them is a page a search engine indexes.
   */
  matcher: ["/((?!v1/|_next/|assets/|favicon\\.ico|icon\\.svg|.*\\.(?:png|jpg|svg|ico|txt|xml)).*)"],
};
