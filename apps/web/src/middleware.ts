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

/**
 * Whether a request on the brand host arrived over plain http.
 *
 * Plain `http://` used to answer 200 with the whole site - a second copy of every page,
 * held together only by canonical tags. The Worker sees the scheme the visitor used in
 * `request.url` (Cloudflare's own HTTPS-redirect example reads exactly that), and OpenNext
 * builds `nextUrl` from it, so `http:` here means the visitor typed or followed http.
 *
 * Two guards, because the failure mode of a wrong answer is a redirect loop on every page.
 * Only the canonical host is considered - `localhost` in development is http and must stay
 * so. And a request whose `x-forwarded-proto` says https is never treated as insecure,
 * whatever its URL claims: if anything in front of the Worker ever rewrote the scheme,
 * this degrades to "no redirect", not to a loop.
 */
function arrivedInsecure(request: NextRequest, host: string): boolean {
  return (
    host === CANONICAL.host &&
    CANONICAL.protocol === "https:" &&
    request.nextUrl.protocol === "http:" &&
    request.headers.get("x-forwarded-proto") !== "https"
  );
}

export function middleware(request: NextRequest): NextResponse {
  const host = request.headers.get("host");
  if (host === null) return NextResponse.next();
  if (!LEGACY_HOSTS.has(host) && !arrivedInsecure(request, host)) return NextResponse.next();

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
