import { describe, expect, it } from "vitest";
import {
  authorizationServerUrls,
  authorizeUrl,
  codeExchangeBody,
  grantFromValues,
  grantToValues,
  needsRefresh,
  parseAuthorizationServer,
  parseProtectedResource,
  parseTokenResponse,
  protectedResourceUrls,
  refreshBody,
} from "../src/mcpOAuth.ts";

/** Gmail's MCP server's protected-resource document, as it answers on 27 October 2026. */
const GMAIL = {
  authorization_servers: ["https://accounts.google.com/"],
  bearer_methods_supported: ["header"],
  resource: "https://gmailmcp.googleapis.com/mcp/v1",
  scopes_supported: ["https://mail.google.com/", "https://www.googleapis.com/auth/gmail.readonly"],
};

describe("MCP OAuth discovery", () => {
  it("looks for the protected-resource document under the endpoint's path, then the root", () => {
    expect(protectedResourceUrls("https://gmailmcp.googleapis.com/mcp/v1")).toEqual([
      "https://gmailmcp.googleapis.com/.well-known/oauth-protected-resource/mcp/v1",
      "https://gmailmcp.googleapis.com/.well-known/oauth-protected-resource",
    ]);
    expect(protectedResourceUrls("https://example.com/")).toEqual(["https://example.com/.well-known/oauth-protected-resource"]);
  });

  it("reads Gmail's document: Google's accounts server and every scope it lists", () => {
    const found = parseProtectedResource(GMAIL, "https://gmailmcp.googleapis.com/mcp/v1");
    expect(found).toEqual({ resource: GMAIL.resource, authorizationServers: ["https://accounts.google.com/"], scopes: GMAIL.scopes_supported });
  });

  it("refuses a document with no usable authorization server or no header tokens", () => {
    expect(parseProtectedResource({ authorization_servers: [] }, "https://x.test/mcp")).toBeNull();
    expect(parseProtectedResource({ authorization_servers: ["http://evil.example/"] }, "https://x.test/mcp")).toBeNull();
    expect(parseProtectedResource({ ...GMAIL, bearer_methods_supported: ["body"] }, GMAIL.resource)).toBeNull();
    expect(parseProtectedResource("not json", GMAIL.resource)).toBeNull();
  });

  it("asks for the authorization server's metadata by RFC 8414 and OpenID discovery", () => {
    expect(authorizationServerUrls("https://accounts.google.com/")).toEqual([
      "https://accounts.google.com/.well-known/oauth-authorization-server",
      "https://accounts.google.com/.well-known/openid-configuration",
    ]);
    expect(authorizationServerUrls("https://auth.example.com/tenant")).toContain("https://auth.example.com/tenant/.well-known/openid-configuration");
  });

  it("refuses an authorization server that cannot do S256 PKCE", () => {
    const doc = { authorization_endpoint: "https://a.test/auth", token_endpoint: "https://a.test/token" };
    expect(parseAuthorizationServer(doc, "https://a.test")).toMatchObject({ registrationEndpoint: null });
    expect(parseAuthorizationServer({ ...doc, code_challenge_methods_supported: ["plain"] }, "https://a.test")).toBeNull();
  });
});

describe("MCP OAuth sign-in requests", () => {
  const google = { issuer: "https://accounts.google.com", authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth", tokenEndpoint: "https://oauth2.googleapis.com/token", registrationEndpoint: null, scopes: [] as string[] };
  const other = { issuer: "https://auth.example.com", authorizationEndpoint: "https://auth.example.com/authorize", tokenEndpoint: "https://auth.example.com/token", registrationEndpoint: "https://auth.example.com/register", scopes: [] as string[] };
  const base = { clientId: "client", redirectUri: "http://127.0.0.1:5000/callback", scopes: ["a", "b"], challenge: "c", state: "s", resource: "https://mcp.example.com/mcp" };

  it("asks Google for offline access, so the sign-in outlives the hour", () => {
    const url = new URL(authorizeUrl({ ...base, server: google }));
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toBe("a b");
    expect(url.searchParams.has("resource")).toBe(false);
  });

  it("names the resource for every other server (RFC 8707)", () => {
    const url = new URL(authorizeUrl({ ...base, server: other }));
    expect(url.searchParams.get("resource")).toBe(base.resource);
    expect(codeExchangeBody({ code: "x", verifier: "v", redirectUri: base.redirectUri, clientId: "client", clientSecret: null, resource: base.resource, google: false }).get("resource")).toBe(base.resource);
  });

  it("keeps the old refresh token when a refresh does not send a new one", () => {
    const tokens = parseTokenResponse({ access_token: "new", token_type: "Bearer", expires_in: 3600 }, 1_000, "old-refresh");
    expect(tokens).toEqual({ accessToken: "new", refreshToken: "old-refresh", expiresAt: 3_601_000 });
    expect(parseTokenResponse({ access_token: "x", token_type: "mac" }, 0)).toBeNull();
  });

  it("refreshes a minute before expiry, and round-trips through the encrypted store's flat values", () => {
    const grant = { accessToken: "a", refreshToken: "r", expiresAt: 100_000, tokenEndpoint: "https://oauth2.googleapis.com/token", clientId: "id", clientSecret: "s", resource: GMAIL.resource };
    expect(needsRefresh(grant, 30_000)).toBe(false);
    expect(needsRefresh(grant, 50_000)).toBe(true);
    expect(grantFromValues(grantToValues(grant))).toEqual(grant);
    expect(refreshBody(grant)?.get("grant_type")).toBe("refresh_token");
    expect(refreshBody({ ...grant, refreshToken: null })).toBeNull();
  });
});

describe("the scopes a sign-in asks for", () => {
  const resource = (scopes: string[]) => ({ resource: "https://r.test/mcp", authorizationServers: ["https://a.test"], scopes });
  const server = (scopes: string[]) => ({ issuer: "https://a.test", authorizationEndpoint: "https://a.test/authorize", tokenEndpoint: "https://a.test/token", registrationEndpoint: null, scopes });

  it("uses the server's sign-in scopes when the resource names none, as Composio's does", async () => {
    const { signInScopes, parseAuthorizationServer } = await import("../src/mcpOAuth.ts");
    // Composio's own document, as it answered on 10 November 2026: endpoints on a second host, four scopes.
    const composio = parseAuthorizationServer({ issuer: "https://connect.composio.dev", authorization_endpoint: "https://connect.composio.dev/oauth/authorize", token_endpoint: "https://login.composio.dev/oauth2/token", registration_endpoint: "https://login.composio.dev/oauth2/register", code_challenge_methods_supported: ["S256"], scopes_supported: ["openid", "profile", "email", "offline_access"] }, "https://connect.composio.dev")!;
    expect(composio.registrationEndpoint).toBe("https://login.composio.dev/oauth2/register");
    expect(signInScopes(resource([]), composio)).toEqual(["openid", "profile", "email", "offline_access"]);
    expect(signInScopes(resource([]), server(["read", "offline_access"]))).toEqual(["offline_access"]);
    expect(signInScopes(resource([]), server([]))).toEqual([]);
  });

  it("keeps a resource's own scopes, adding only what earns a refresh token", async () => {
    const { signInScopes } = await import("../src/mcpOAuth.ts");
    expect(signInScopes(resource(["mail.read"]), server(["mail.read", "offline_access"]))).toEqual(["mail.read", "offline_access"]);
    expect(signInScopes(resource(["mail.read"]), server(["mail.read"]))).toEqual(["mail.read"]);
    expect(signInScopes(resource(["a", "offline_access"]), server(["offline_access"]))).toEqual(["a", "offline_access"]);
  });
});
