/**
 * Signing in to a remote MCP server, the way the MCP authorization spec lays it out.
 *
 * The server publishes a protected-resource document (RFC 9728) naming the authorization
 * server that issues its tokens and the scopes it understands. That authorization server
 * describes itself (RFC 8414, or OpenID discovery, which is what Google publishes), and the
 * app signs in with the authorization-code flow and PKCE in the system browser.
 *
 * Gmail's MCP server is the case that made this necessary: `initialize` and `tools/list`
 * answer without a token, and only the tool calls fail - so waiting for a 401 to start
 * sign-in would connect "fine" and then fail every call. Discovery happens on connect.
 *
 * Nothing here performs I/O: URLs and bodies go out, parsed documents come back.
 */

export interface ProtectedResource {
  readonly resource: string;
  readonly authorizationServers: readonly string[];
  readonly scopes: readonly string[];
}

export interface AuthorizationServer {
  readonly issuer: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  /** Dynamic client registration (RFC 7591), when the server offers it. */
  readonly registrationEndpoint: string | null;
  /** Scopes the server says it issues; used only when the resource names none of its own. */
  readonly scopes: readonly string[];
}

export interface McpOAuthTokens {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  /** Epoch milliseconds, or null when the server did not say. */
  readonly expiresAt: number | null;
}

/** What a stored sign-in needs to refresh itself later, without discovery again. */
export interface McpOAuthGrant extends McpOAuthTokens {
  readonly tokenEndpoint: string;
  readonly clientId: string;
  readonly clientSecret: string | null;
  readonly resource: string;
}

/** Connector values that name an OAuth client by hand, for servers with no registration. */
export const OAUTH_CLIENT_ID_KEY = "OAUTH_CLIENT_ID";
export const OAUTH_CLIENT_SECRET_KEY = "OAUTH_CLIENT_SECRET";

/** Refresh this long before a token says it expires, so a call never races the clock. */
const EXPIRY_MARGIN_MS = 60_000;

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** https everywhere, plain http only for a server on this machine. */
export function safeOAuthUrl(text: unknown): string | null {
  if (typeof text !== "string" || text.length > 2048) return null;
  try {
    const url = new URL(text);
    if (url.username || url.password || url.hash) return null;
    const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
    return url.protocol === "https:" || (url.protocol === "http:" && loopback) ? url.toString() : null;
  } catch {
    return null;
  }
}

const strings = (value: unknown, limit: number): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0 && item.length <= 512).slice(0, limit) : [];

/** Where the protected-resource document may live: under the endpoint's path first, then the root. */
export function protectedResourceUrls(endpoint: string): string[] {
  const url = new URL(endpoint);
  const path = url.pathname.replace(/\/+$/, "");
  const root = `${url.origin}/.well-known/oauth-protected-resource`;
  return path === "" ? [root] : [`${root}${path}`, root];
}

export function parseProtectedResource(json: unknown, endpoint: string): ProtectedResource | null {
  const doc = object(json);
  if (doc === null) return null;
  const servers = strings(doc["authorization_servers"], 8).map(safeOAuthUrl).filter((url): url is string => url !== null);
  if (servers.length === 0) return null;
  const methods = strings(doc["bearer_methods_supported"], 8);
  // A resource that only takes tokens in the body or the query is not one this client can call.
  if (methods.length > 0 && !methods.includes("header")) return null;
  return { resource: safeOAuthUrl(doc["resource"]) ?? endpoint, authorizationServers: servers, scopes: strings(doc["scopes_supported"], 64) };
}

/** RFC 8414's path-inserted address, then OpenID discovery both ways it is published. */
export function authorizationServerUrls(issuer: string): string[] {
  const url = new URL(issuer);
  const path = url.pathname.replace(/\/+$/, "");
  return [...new Set([
    `${url.origin}/.well-known/oauth-authorization-server${path}`,
    `${url.origin}/.well-known/openid-configuration${path}`,
    `${url.origin}${path}/.well-known/openid-configuration`,
  ])];
}

export function parseAuthorizationServer(json: unknown, issuer: string): AuthorizationServer | null {
  const doc = object(json);
  if (doc === null) return null;
  const authorizationEndpoint = safeOAuthUrl(doc["authorization_endpoint"]);
  const tokenEndpoint = safeOAuthUrl(doc["token_endpoint"]);
  if (authorizationEndpoint === null || tokenEndpoint === null) return null;
  const methods = strings(doc["code_challenge_methods_supported"], 8);
  // PKCE is not optional for a public client: a server that lists methods without S256 cannot be used.
  if (methods.length > 0 && !methods.includes("S256")) return null;
  return { issuer: safeOAuthUrl(doc["issuer"]) ?? issuer, authorizationEndpoint, tokenEndpoint, registrationEndpoint: safeOAuthUrl(doc["registration_endpoint"]), scopes: strings(doc["scopes_supported"], 64) };
}

/** The sign-in scopes every OpenID server understands; `offline_access` is what earns a refresh token. */
const IDENTITY_SCOPES = ["openid", "profile", "email", "offline_access"];

/**
 * The scopes to ask for. The resource's own list wins. A resource that names none (Composio's
 * does not) would otherwise be signed in with no scope at all: some servers refuse that
 * outright, and the rest issue a token with no refresh, so the connector drops out within the
 * hour. Then the server's standard sign-in scopes are asked for - and `offline_access` is
 * added to a resource's own list whenever the server offers it.
 */
export function signInScopes(resource: ProtectedResource, server: AuthorizationServer): string[] {
  if (resource.scopes.length === 0) return IDENTITY_SCOPES.filter((scope) => server.scopes.includes(scope));
  return server.scopes.includes("offline_access") && !resource.scopes.includes("offline_access") ? [...resource.scopes, "offline_access"] : [...resource.scopes];
}

/** Google's accounts server: no client registration, a desktop client instead, and its own consent knobs. */
export function isGoogleIssuer(issuer: string): boolean {
  try { return new URL(issuer).hostname === "accounts.google.com"; } catch { return false; }
}

export interface AuthorizeInput {
  readonly server: AuthorizationServer;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly scopes: readonly string[];
  readonly challenge: string;
  readonly state: string;
  readonly resource: string;
}

export function authorizeUrl(input: AuthorizeInput): string {
  const url = new URL(input.server.authorizationEndpoint);
  const google = isGoogleIssuer(input.server.issuer);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("code_challenge", input.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", input.state);
  if (input.scopes.length > 0) url.searchParams.set("scope", input.scopes.join(" "));
  if (google) {
    // Without both, Google issues no refresh token and the sign-in lasts an hour.
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("include_granted_scopes", "true");
  } else {
    // RFC 8707, which the MCP spec requires, so a token is minted for this server alone.
    url.searchParams.set("resource", input.resource);
  }
  return url.toString();
}

export function codeExchangeBody(input: { code: string; verifier: string; redirectUri: string; clientId: string; clientSecret: string | null; resource: string; google: boolean }): URLSearchParams {
  const body = new URLSearchParams({ grant_type: "authorization_code", code: input.code, code_verifier: input.verifier, redirect_uri: input.redirectUri, client_id: input.clientId });
  if (input.clientSecret !== null) body.set("client_secret", input.clientSecret);
  if (!input.google) body.set("resource", input.resource);
  return body;
}

export function refreshBody(grant: McpOAuthGrant): URLSearchParams | null {
  if (grant.refreshToken === null) return null;
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: grant.refreshToken, client_id: grant.clientId });
  if (grant.clientSecret !== null) body.set("client_secret", grant.clientSecret);
  if (!grant.tokenEndpoint.startsWith("https://oauth2.googleapis.com/")) body.set("resource", grant.resource);
  return body;
}

/** A token response, or null. A refresh may omit the refresh token; the old one then still stands. */
export function parseTokenResponse(json: unknown, now: number, previousRefresh: string | null = null): McpOAuthTokens | null {
  const doc = object(json);
  if (doc === null) return null;
  const accessToken = doc["access_token"];
  if (typeof accessToken !== "string" || accessToken.trim() === "" || accessToken.length > 4096) return null;
  const type = doc["token_type"];
  if (typeof type === "string" && type.toLowerCase() !== "bearer") return null;
  const refresh = doc["refresh_token"];
  const expires = doc["expires_in"];
  return {
    accessToken,
    refreshToken: typeof refresh === "string" && refresh.length > 0 && refresh.length <= 4096 ? refresh : previousRefresh,
    expiresAt: typeof expires === "number" && Number.isFinite(expires) && expires > 0 ? now + expires * 1000 : null,
  };
}

export function needsRefresh(grant: McpOAuthTokens, now: number): boolean {
  return grant.expiresAt !== null && grant.expiresAt - EXPIRY_MARGIN_MS <= now;
}

/** RFC 7591: a public native client with one exact loopback redirect. */
export function registrationRequest(redirectUri: string): Record<string, unknown> {
  return {
    client_name: "ADCode",
    redirect_uris: [redirectUri],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    application_type: "native",
  };
}

export function parseRegistration(json: unknown): { clientId: string; clientSecret: string | null } | null {
  const doc = object(json);
  const id = doc?.["client_id"];
  if (typeof id !== "string" || id.trim() === "" || id.length > 512) return null;
  const secret = doc?.["client_secret"];
  return { clientId: id, clientSecret: typeof secret === "string" && secret.length > 0 && secret.length <= 1024 ? secret : null };
}

/** The grant as flat strings for the encrypted connector store, and back. */
export function grantToValues(grant: McpOAuthGrant): Record<string, string> {
  const out: Record<string, string> = {
    access_token: grant.accessToken,
    token_endpoint: grant.tokenEndpoint,
    client_id: grant.clientId,
    resource: grant.resource,
  };
  if (grant.refreshToken !== null) out["refresh_token"] = grant.refreshToken;
  if (grant.expiresAt !== null) out["expires_at"] = String(grant.expiresAt);
  if (grant.clientSecret !== null) out["client_secret"] = grant.clientSecret;
  return out;
}

export function grantFromValues(values: Readonly<Record<string, string>>): McpOAuthGrant | null {
  const accessToken = values["access_token"];
  const tokenEndpoint = safeOAuthUrl(values["token_endpoint"]);
  const clientId = values["client_id"];
  if (!accessToken || tokenEndpoint === null || !clientId) return null;
  const expires = Number(values["expires_at"]);
  return {
    accessToken,
    refreshToken: values["refresh_token"] || null,
    expiresAt: Number.isFinite(expires) && expires > 0 ? expires : null,
    tokenEndpoint,
    clientId,
    clientSecret: values["client_secret"] || null,
    resource: values["resource"] ?? "",
  };
}
