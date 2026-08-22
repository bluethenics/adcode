/**
 * Cross-origin access, for the web portal and dashboard.
 *
 * An allowlist rather than `*`, because these endpoints carry a bearer token and return
 * one person's money. `*` would let any page a signed-in user visits read their balance
 * if it could get hold of a token.
 *
 * The desktop client is unaffected either way - it calls from the main process, where
 * there is no origin and no preflight.
 */

const DEFAULT_ORIGINS = [
  "https://adcode.bluethenics.com",
  // Firebase gives an App Hosting backend these before a custom domain is attached, and
  // the site is genuinely reachable at them - omitting them means sign-in works on the
  // custom domain and mysteriously fails on the one you are handed first.
  "https://adcode-idle.web.app",
  "https://adcode-idle.firebaseapp.com",
];

/** Extra origins for local development, comma-separated in `ADCODE_CORS_ORIGINS`. */
function allowed(): ReadonlySet<string> {
  const extra = (process.env["ADCODE_CORS_ORIGINS"] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return new Set([...DEFAULT_ORIGINS, ...extra]);
}

export function corsHeaders(origin: string | undefined): Record<string, string> {
  if (origin === undefined || !allowed().has(origin)) return {};

  return {
    "access-control-allow-origin": origin,
    // Echoing one origin means caches must key on it, or a response for the site origin could
    // be served to a different origin from a shared cache.
    vary: "Origin",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, PATCH, OPTIONS",
    "access-control-max-age": "600",
  };
}
