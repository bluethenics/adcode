/**
 * OAuth sign-in for remote (http/sse) MCP connectors: the I/O around `@adcode/connect`'s
 * mcpOAuth, which holds the rules.
 *
 * The flow is the Google one in `oauth.ts`: a loopback listener on an ephemeral port, PKCE, a
 * per-attempt state, the system browser rather than an app window. What differs is who the
 * client is. A server that offers client registration gets one registered per sign-in, for
 * the exact loopback address; Google offers none, so its servers use ADCode's desktop client;
 * anything else needs `OAUTH_CLIENT_ID` (and perhaps `OAUTH_CLIENT_SECRET`) saved on the
 * connector by hand.
 *
 * Tokens live in their own encrypted file, kept apart from the connector's values because
 * those are sent as headers. Every request then carries `Authorization: Bearer`, refreshed
 * shortly before it expires and once more on a 401 before the call is allowed to fail.
 */
import { createServer, type ServerResponse } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { shell } from "electron";
import {
  OAUTH_CLIENT_ID_KEY,
  OAUTH_CLIENT_SECRET_KEY,
  authorizationServerUrls,
  authorizeUrl,
  codeExchangeBody,
  grantFromValues,
  grantToValues,
  isGoogleIssuer,
  needsRefresh,
  parseAuthorizationServer,
  parseProtectedResource,
  parseRegistration,
  parseTokenResponse,
  protectedResourceUrls,
  refreshBody,
  registrationRequest,
  signInScopes,
  type AuthorizationServer,
  type McpOAuthGrant,
  type ProtectedResource,
} from "@adcode/connect";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import { createConnectorSecrets } from "./connectorSecrets.ts";
import { googleDesktopClient } from "./oauth.ts";
import { resultPage, RESULT_PAGE_HEADERS } from "./oauthResultPage.ts";

const tokens = createConnectorSecrets("connector-oauth.json");
const FLOW_TIMEOUT_MS = 3 * 60 * 1000;
const base64url = (buffer: Buffer): string => buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Thrown by connect when the server wants a sign-in this connector does not have yet. */
export class McpSignInRequired extends Error {
  readonly signInRequired = true;
  constructor(name: string) {
    super(`${name} needs you to sign in. Press Sign in on its card in Tools.`);
  }
}

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { headers: { accept: "application/json" }, redirect: "error", signal: AbortSignal.any([AbortSignal.timeout(6_000), ...(signal ? [signal] : [])]) });
  if (!response.ok) return null;
  return response.json().catch(() => null);
}

/** The server's protected-resource document, or null when it asks for no OAuth. */
export async function discoverProtectedResource(endpoint: string): Promise<ProtectedResource | null> {
  for (const url of protectedResourceUrls(endpoint)) {
    const found = parseProtectedResource(await getJson(url).catch(() => null), endpoint);
    if (found !== null) return found;
  }
  return null;
}

async function discoverAuthorizationServer(issuer: string): Promise<AuthorizationServer> {
  for (const url of authorizationServerUrls(issuer)) {
    const found = parseAuthorizationServer(await getJson(url).catch(() => null), issuer);
    if (found !== null) return found;
  }
  throw new Error(`Could not read the sign-in server's details at ${issuer}.`);
}

/** Who ADCode is to this authorization server. */
async function clientFor(server: AuthorizationServer, redirectUri: string, values: Readonly<Record<string, string>>): Promise<{ clientId: string; clientSecret: string | null }> {
  const byHand = values[OAUTH_CLIENT_ID_KEY];
  if (byHand) return { clientId: byHand, clientSecret: values[OAUTH_CLIENT_SECRET_KEY] || null };
  if (isGoogleIssuer(server.issuer)) {
    const google = googleDesktopClient();
    if (google === null) throw new Error("Google sign-in isn't configured in this build.");
    return google;
  }
  if (server.registrationEndpoint === null) {
    throw new Error(`This server's sign-in offers no client registration. Save its OAuth client ID as ${OAUTH_CLIENT_ID_KEY} on the connector, then sign in again.`);
  }
  const response = await fetch(server.registrationEndpoint, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(registrationRequest(redirectUri)),
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  const client = response.ok ? parseRegistration(await response.json().catch(() => null)) : null;
  if (client === null) throw new Error("The sign-in server would not register ADCode as a client.");
  return client;
}

async function postToken(endpoint: string, body: URLSearchParams, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body,
    redirect: "error",
    signal: AbortSignal.any([AbortSignal.timeout(20_000), ...(signal ? [signal] : [])]),
  });
  const json: unknown = await response.json().catch(() => null);
  if (response.ok) return json;
  const said = typeof json === "object" && json !== null ? (json as Record<string, unknown>)["error_description"] ?? (json as Record<string, unknown>)["error"] : null;
  throw new Error(typeof said === "string" && said.length > 0 ? `The sign-in server refused: ${said.slice(0, 300)}` : `The sign-in server refused (HTTP ${response.status.toString()}).`);
}

let active: (() => void) | null = null;

/**
 * Sign this connector in through the system browser and store the grant. Resolves when the
 * tokens are saved; rejects with a reason a person can act on.
 */
export async function signInToMcp(id: string, endpoint: string, values: Readonly<Record<string, string>>): Promise<void> {
  if (active !== null) throw new Error("Another connector sign-in is open. Finish or close it first.");
  const resource = await discoverProtectedResource(endpoint);
  if (resource === null) throw new Error("This server does not ask for an OAuth sign-in. Save its key as a value instead.");
  const server = await discoverAuthorizationServer(resource.authorizationServers[0]!);
  const google = isGoogleIssuer(server.issuer);
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const state = base64url(randomBytes(16));

  const grant = await new Promise<McpOAuthGrant>((resolve, reject) => {
    let settled = false;
    let answer: ServerResponse | null = null;
    const controller = new AbortController();
    const listener = createServer();
    const finish = (outcome: { grant: McpOAuthGrant } | { reason: string }): void => {
      if (settled) return;
      settled = true;
      active = null;
      clearTimeout(timer);
      controller.abort();
      const ok = "grant" in outcome;
      if (answer !== null && !answer.writableEnded) {
        answer.writeHead(ok ? 200 : 400, RESULT_PAGE_HEADERS);
        answer.end(resultPage(ok ? "Connector signed in" : "Sign-in didn't finish", ok ? "Return to ADCode: the connector is connecting now." : outcome.reason, ok, "your connector"));
      }
      listener.close();
      if (ok) resolve(outcome.grant);
      else reject(new Error(outcome.reason));
    };
    active = () => finish({ reason: "Sign-in cancelled." });
    const timer = setTimeout(() => finish({ reason: "Sign-in timed out. Try again." }), FLOW_TIMEOUT_MS);
    let redirectUri = "";
    let client: { clientId: string; clientSecret: string | null } | null = null;

    listener.on("request", (req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      // Only the redirect decides anything; the browser also asks for /favicon.ico.
      if (url.pathname !== "/callback") { res.writeHead(404).end(); return; }
      if (url.searchParams.get("state") !== state || client === null) {
        /*
         * Not ours: an older tab finishing a sign-in that was started again, a browser
         * prefetching the address, or something probing the port. It is told so and ignored.
         * It used to end the flow - so one stale tab made the real answer, arriving a moment
         * later, land on a closed listener and the connector report "could not be verified".
         */
        res.writeHead(400, RESULT_PAGE_HEADERS);
        res.end(resultPage("This sign-in page is out of date", "ADCode started a newer sign-in for this connector. Finish that one, or start again from ADCode.", false, "your connector"));
        return;
      }
      if (answer !== null) { res.writeHead(409).end(); return; }
      answer = res;
      const code = url.searchParams.get("code");
      if (code === null) { finish({ reason: url.searchParams.get("error") === "access_denied" ? "Sign-in was declined." : "Sign-in was cancelled." }); return; }
      const signedClient = client;
      void postToken(server.tokenEndpoint, codeExchangeBody({ code, verifier, redirectUri, clientId: signedClient.clientId, clientSecret: signedClient.clientSecret, resource: resource.resource, google }), controller.signal)
        .then((json) => {
          const parsed = parseTokenResponse(json, Date.now());
          if (parsed === null) throw new Error("The sign-in server's answer had no access token.");
          finish({ grant: { ...parsed, tokenEndpoint: server.tokenEndpoint, clientId: signedClient.clientId, clientSecret: signedClient.clientSecret, resource: resource.resource } });
        })
        .catch((error: unknown) => finish({ reason: error instanceof Error ? error.message : "Sign-in failed." }));
    });
    listener.on("error", () => finish({ reason: "Could not start the sign-in listener." }));
    listener.listen(0, "127.0.0.1", () => {
      const address = listener.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      redirectUri = `http://127.0.0.1:${port.toString()}/callback`;
      void clientFor(server, redirectUri, values)
        .then(async (chosen) => {
          client = chosen;
          const url = authorizeUrl({ server, clientId: chosen.clientId, redirectUri, scopes: signInScopes(resource, server), challenge, state, resource: resource.resource });
          await shell.openExternal(url);
        })
        .catch((error: unknown) => finish({ reason: error instanceof Error ? error.message : "Could not open your browser." }));
    });
  });
  await tokens.write(id, grantToValues(grant));
}

export function cancelMcpSignIn(): boolean {
  if (active === null) return false;
  active();
  return true;
}

export const forgetMcpSignIn = (id: string): Promise<void> => tokens.clear(id);

/**
 * A fetch that signs every request with this connector's token: refreshed when it is about
 * to expire, and once more when the server answers 401, before the request is let fail.
 */
export async function mcpAuthFetch(id: string): Promise<FetchLike | null> {
  let grant = grantFromValues(await tokens.read(id));
  if (grant === null) return null;
  let refreshing: Promise<boolean> | null = null;
  const refresh = (): Promise<boolean> => {
    refreshing ??= (async () => {
      const current = grant;
      const body = current === null ? null : refreshBody(current);
      if (current === null || body === null) return false;
      try {
        const parsed = parseTokenResponse(await postToken(current.tokenEndpoint, body), Date.now(), current.refreshToken);
        if (parsed === null) return false;
        grant = { ...current, ...parsed };
        await tokens.write(id, grantToValues(grant));
        return true;
      } catch {
        return false;
      }
    })().finally(() => { refreshing = null; });
    return refreshing;
  };
  const signed = (init: RequestInit | undefined): RequestInit => {
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${grant!.accessToken}`);
    return { ...init, headers };
  };
  return async (url, init) => {
    if (grant !== null && needsRefresh(grant, Date.now())) await refresh();
    const first = await fetch(url, signed(init));
    if (first.status !== 401) return first;
    if (!(await refresh())) return first;
    return fetch(url, signed(init));
  };
}
