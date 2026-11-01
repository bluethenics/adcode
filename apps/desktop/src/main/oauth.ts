/**
 * Getting a Google or GitHub credential, without a secret in the source.
 *
 * §1 of the brief is explicit that a key shipped inside the binary can be extracted by
 * anyone. That constraint picks both flows:
 *
 *   Google  PKCE with a loopback redirect: a public client id, a per-attempt verifier,
 *           and a redirect to 127.0.0.1 on an ephemeral port. Google additionally insists
 *           on the client secret at the token exchange, so one is substituted into the
 *           build - see below. It is in no committed file.
 *
 *   GitHub  The device flow. GitHub's OAuth Apps do not support PKCE, and its web flow
 *           requires a client secret at the token exchange - which we cannot have. The
 *           device flow is the path GitHub provides for exactly this situation: the user
 *           is shown a short code, types it on github.com, and we poll.
 *
 * Both open the system browser rather than an Electron window. An in-app window asking
 * for a Google password is indistinguishable from a phishing page, and teaching people to
 * type credentials into an app's own chrome is a bad habit to spread.
 */
import { createServer, type ServerResponse } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { shell } from "electron";
import { resultPage, RESULT_PAGE_HEADERS } from "./oauthResultPage.ts";
import { browserGoogleFlow } from "./googleBrowserFlow.ts";

/*
 * ─────────────────────────────────────────────────────────────────────────────
 *  PASTE YOUR OAUTH CLIENT IDS HERE.  See docs/OAUTH-SETUP.md for how to get them.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * These are safe to commit. An OAuth client id for an installed app is a public
 * identifier, not a credential - Google's own guidance is that "installed apps are
 * distributed to individual devices, and it is assumed that these apps cannot keep
 * secrets", which is exactly why PKCE and the device flow exist. What must never be
 * committed is a client *secret*. Google's Desktop flow requires its client secret
 * at token exchange; GitHub's device flow does not.
 *
 * Environment variables override these, for anyone testing against their own clients.
 */
const GOOGLE_CLIENT_ID =
  process.env["ADCODE_GOOGLE_CLIENT_ID"] ??
  "345488063416-60i3dqfj1j8itg9bio2itshmcbq7e3mh.apps.googleusercontent.com";

const GITHUB_CLIENT_ID = process.env["ADCODE_GITHUB_CLIENT_ID"] ?? "Ov23lienZUTAiNKAM0UV";

/**
 * Required, despite the name, and despite PKCE.
 *
 * It is tempting to leave this out: PKCE already proves the exchange came from the client
 * that began it, and a secret in a shipped binary is not secret. That reasoning is right
 * about the security and wrong about Google. Asking its token endpoint without this
 * answers `"client_secret is missing."` and nothing signs in - PKCE is something Google
 * wants *as well as* client authentication for a Desktop client, not instead of it.
 *
 * Google's own position on installed apps is that the secret "is obviously not treated as
 * a secret", because the binary can be read by anyone holding it. So it ships in the built
 * application - but not in the source.
 *
 * It is not in this file, and it is not in this repository. GitHub's push protection
 * rejects a commit containing a Google client secret outright, and it is right to: whatever
 * Google's threat model says, a credential in a public repository is a credential
 * published. `electron.vite.config.ts` reads it from the environment or from a gitignored
 * `apps/desktop/.env` and substitutes it here at build time, so it reaches the installer
 * without ever reaching git. A build with no value produces an app that says Google
 * sign-in is not configured, which is honest.
 */
declare const __ADCODE_GOOGLE_CLIENT_SECRET__: string;

const GOOGLE_CLIENT_SECRET =
  // `typeof`, because only the build substitutes it: a test that imports this module has none.
  process.env["ADCODE_GOOGLE_CLIENT_SECRET"] ?? (typeof __ADCODE_GOOGLE_CLIENT_SECRET__ === "string" ? __ADCODE_GOOGLE_CLIENT_SECRET__ : "");

/** Whether sign-in can be offered at all. The UI hides the buttons when it cannot. */
export const oauthConfigured = {
  // A missing desktop secret uses the hosted, state-bound browser sign-in flow.
  google: () => GOOGLE_CLIENT_ID.length > 0,
  github: () => GITHUB_CLIENT_ID.length > 0,
};

/**
 * ADCode's Google desktop client, for a connector whose server signs in with Google (Gmail's
 * MCP server does). Google offers no client registration, so this client is the only way in;
 * the scopes the connector asks for must be enabled on its consent screen.
 */
export function googleDesktopClient(): { clientId: string; clientSecret: string } | null {
  return GOOGLE_CLIENT_ID.length > 0 && GOOGLE_CLIENT_SECRET.length > 0 ? { clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET } : null;
}

export type OAuthResult =
  | { ok: true; provider: "google.com"; idToken: string }
  | { ok: true; provider: "github.com"; accessToken: string }
  | { ok: false; reason: string };

/** How long a user gets to finish in the browser before we stop waiting. */
const FLOW_TIMEOUT_MS = 3 * 60 * 1000;

/**
 * Cancels whichever sign-in is running, if one is.
 *
 * There is at most one at a time, because both flows are started from a button that
 * disables itself. Without this a flow could only be escaped by waiting three minutes or
 * quitting the app - and a person who closed the browser tab by accident had no way to
 * start again, which is a bad enough dead end to be worth a whole mechanism.
 */
let cancelActive: (() => void) | null = null;

export function cancelSignIn(): boolean {
  if (cancelActive === null) return false;
  cancelActive();
  return true;
}

const base64url = (buffer: Buffer): string =>
  buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/* ── Google ─────────────────────────────────────────────────────────────── */

export async function linkWithGoogle(): Promise<OAuthResult> {
  if (cancelActive !== null) return { ok: false, reason: "Another sign-in is open. Finish or cancel it first." };
  const clientId = GOOGLE_CLIENT_ID;
  if (clientId.length === 0) {
    return { ok: false, reason: "Google sign-in isn't configured in this build." };
  }
  if (!GOOGLE_CLIENT_SECRET) return browserGoogleFlow({ origin: "https://adcode.bluethenics.com", open: url => shell.openExternal(url), cancellation: cancel => { cancelActive = cancel; } });

  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const state = base64url(randomBytes(16));

  return new Promise<OAuthResult>((resolve) => {
    let settled = false;
    let callbackResponse: ServerResponse | null = null;
    const controller = new AbortController();
    const finish = (result: OAuthResult): void => {
      if (settled) return;
      settled = true;
      cancelActive = null;
      clearTimeout(timer);
      controller.abort();
      if (callbackResponse !== null && !callbackResponse.writableEnded) {
        callbackResponse.writeHead(result.ok ? 200 : 400, RESULT_PAGE_HEADERS);
        callbackResponse.end(resultPage(result.ok ? "Sign-in approved" : "Sign-in didn't finish", result.ok ? "Google approved your sign-in. Return to ADCode to finish connecting your account." : result.reason, result.ok));
      }
      server.close();
      resolve(result);
    };

    cancelActive = () => finish({ ok: false, reason: "Sign-in cancelled." });

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");

      /*
       * Only the redirect itself may decide anything.
       *
       * The browser asks this server for more than the callback - Chrome requests
       * `/favicon.ico` the moment the page renders. That request carries no `state`, so
       * treating every request as the callback failed the check and resolved the whole
       * flow as "could not be verified" - while the token exchange from the *real*
       * callback was still in flight. A successful sign-in reported itself as a forgery,
       * and only sometimes, because it was a race.
       */
      if (url.pathname !== "/") {
        res.writeHead(404).end();
        return;
      }

      // Compared before the code is used: without it, any page the user visits could
      // hand us a code from an attacker's account.
      if (url.searchParams.get("state") !== state) {
        res.writeHead(400, RESULT_PAGE_HEADERS);
        res.end(resultPage("Couldn't verify that sign-in", "The response didn't match the request this app started. Try again from ADCode.", false));
        finish({ ok: false, reason: "The sign-in response could not be verified." });
        return;
      }

      if (callbackResponse !== null) {
        res.writeHead(409, RESULT_PAGE_HEADERS);
        res.end(resultPage("Sign-in is finishing", "Return to ADCode to check your connection.", false));
        return;
      }

      // Cancellation callbacks must match the request too.
      const denied = url.searchParams.get("error");
      if (denied !== null) {
        res.writeHead(200, RESULT_PAGE_HEADERS);
        res.end(resultPage("Sign-in cancelled", "Nothing has changed. You can try again from ADCode.", false));
        finish({ ok: false, reason: "Sign-in was cancelled." });
        return;
      }

      const code = url.searchParams.get("code");
      if (code === null) {
        res.writeHead(400, RESULT_PAGE_HEADERS);
        res.end(resultPage("Sign-in didn't finish", "Google didn't send anything to sign in with. Try again from ADCode.", false));
        finish({ ok: false, reason: "Sign-in was cancelled." });
        return;
      }

      // Wait for the token exchange before claiming the provider approved sign-in.
      callbackResponse = res;
      void exchangeGoogleCode(clientId, code, verifier, port, controller.signal).then(finish);
    });

    const timer = setTimeout(
      () => finish({ ok: false, reason: "Sign-in timed out. Try again." }),
      FLOW_TIMEOUT_MS,
    );

    let port = 0;
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      port = typeof address === "object" && address !== null ? address.port : 0;

      const authorize = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      authorize.searchParams.set("client_id", clientId);
      authorize.searchParams.set("redirect_uri", `http://127.0.0.1:${port}`);
      authorize.searchParams.set("response_type", "code");
      authorize.searchParams.set("scope", "openid email profile");
      authorize.searchParams.set("code_challenge", challenge);
      authorize.searchParams.set("code_challenge_method", "S256");
      authorize.searchParams.set("state", state);

      void shell.openExternal(authorize.toString()).catch(() => finish({ ok: false, reason: "Could not open your browser. Try again from ADCode." }));
    });

    server.on("error", () => finish({ ok: false, reason: "Could not start the sign-in listener." }));
  });
}

async function exchangeGoogleCode(
  clientId: string,
  code: string,
  verifier: string,
  port: number,
  signal: AbortSignal,
): Promise<OAuthResult> {
  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        code,
        code_verifier: verifier,
        grant_type: "authorization_code",
        redirect_uri: `http://127.0.0.1:${port}`,
        ...(GOOGLE_CLIENT_SECRET.length > 0 ? { client_secret: GOOGLE_CLIENT_SECRET } : {}),
      }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
    });

    if (!response.ok) {
      /*
       * Say which refusal it was.
       *
       * "Google refused the sign-in." is true of a missing client secret, an expired code,
       * a redirect that does not match, and a client id from another project - and it is
       * useless for all four. Google names the cause in `error_description`; passing it
       * through turns a dead end into something someone can act on.
       */
      const detail = (await response.json().catch(() => null)) as { error_description?: unknown } | null;
      const said = typeof detail?.error_description === "string" ? detail.error_description : "";
      return {
        ok: false,
        reason: said.length > 0 ? `Google refused the sign-in: ${said}` : "Google refused the sign-in.",
      };
    }

    const body = (await response.json()) as { id_token?: unknown };
  return typeof body.id_token === "string" && body.id_token.trim().length > 0
      ? { ok: true, provider: "google.com", idToken: body.id_token }
      : { ok: false, reason: "Google's response was missing an identity token." };
  } catch {
    return { ok: false, reason: "Couldn't reach Google. Check your connection." };
  }
}

/* ── GitHub ─────────────────────────────────────────────────────────────── */

export interface DeviceCode {
  userCode: string;
  verificationUri: string;
}

/**
 * Start GitHub's device flow.
 *
 * Two steps rather than one, because the user has to be shown the code before the poll
 * begins. `onCode` fires as soon as GitHub issues it.
 */
export async function linkWithGitHub(onCode: (code: DeviceCode) => void): Promise<OAuthResult> {
  if (cancelActive !== null) return { ok: false, reason: "Another sign-in is open. Finish or cancel it first." };
  const clientId = GITHUB_CLIENT_ID;
  if (clientId.length === 0) {
    return { ok: false, reason: "GitHub sign-in isn't configured in this build." };
  }

  let deviceCode: string;
  let interval: number;
  let expiresIn = FLOW_TIMEOUT_MS;
  const controller = new AbortController();
  let wake: (() => void) | null = null;
  const cancel = () => { controller.abort(); wake?.(); };
  cancelActive = cancel;

  try {
    try {
      const response = await fetch("https://github.com/login/device/code", {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: clientId, scope: "read:user user:email" }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
      });

      if (!response.ok) return { ok: false, reason: "GitHub wouldn't start the sign-in." };

      const body = (await response.json()) as Record<string, unknown>;
      const user = body["user_code"];
      const uri = body["verification_uri"];
      const device = body["device_code"];

      if (typeof user !== "string" || !user.trim() || typeof uri !== "string" || typeof device !== "string" || !device.trim()) {
        return { ok: false, reason: "GitHub's response was malformed." };
      }

      const verification = new URL(uri);
      if (verification.protocol !== "https:" || verification.hostname !== "github.com" || verification.port || verification.username || verification.password || verification.pathname !== "/login/device" || verification.search || verification.hash) {
        return { ok: false, reason: "GitHub's verification address was unexpected. Try again." };
      }

      deviceCode = device;
      // GitHub asks for at least this gap between polls and rejects faster ones.
      interval = typeof body["interval"] === "number" ? body["interval"] : 5;
      if (!Number.isSafeInteger(interval) || interval < 1 || interval > 60) return { ok: false, reason: "GitHub's response was malformed." };
      if (typeof body["expires_in"] === "number") {
        if (!Number.isSafeInteger(body["expires_in"]) || body["expires_in"] < 1) return { ok: false, reason: "GitHub's response was malformed." };
        expiresIn = Math.min(FLOW_TIMEOUT_MS, body["expires_in"] * 1000);
      }
      if (controller.signal.aborted) return { ok: false, reason: "Sign-in cancelled." };
      onCode({ userCode: user, verificationUri: uri });
      try { await shell.openExternal(uri); }
      catch { return { ok: false, reason: "Could not open your browser. Try again from ADCode." }; }
    } catch {
      return { ok: false, reason: controller.signal.aborted ? "Sign-in cancelled." : "Couldn't reach GitHub. Check your connection." };
    }

    const deadline = Date.now() + expiresIn;

    // Cancellation has to interrupt the wait, not just the check after it: polling every five
    // seconds means pressing Cancel would otherwise appear to do nothing for five seconds.
    while (Date.now() < deadline) {
      if (controller.signal.aborted) return { ok: false, reason: "Sign-in cancelled." };
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, Math.min(interval * 1000, deadline - Date.now()));
        wake = () => { clearTimeout(timer); resolve(); };
      });
      wake = null;
      if (controller.signal.aborted) return { ok: false, reason: "Sign-in cancelled." };
      if (Date.now() >= deadline) break;

      try {
        const response = await fetch("https://github.com/login/oauth/access_token", {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: clientId,
            device_code: deviceCode,
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          }),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
        });

        const body = (await response.json()) as Record<string, unknown>;
        if (controller.signal.aborted) return { ok: false, reason: "Sign-in cancelled." };
        const token = body["access_token"];
        if (response.ok && typeof token === "string" && token.trim().length > 0) return { ok: true, provider: "github.com", accessToken: token };

        const error = body["error"];
        // `authorization_pending` is the normal state while the user is still typing.
        if (error === "slow_down") interval += 5;
        else if (error === "access_denied") return { ok: false, reason: "Sign-in was declined." };
        else if (error === "expired_token") return { ok: false, reason: "The code expired. Try again." };
        else if (error !== "authorization_pending") {
          return { ok: false, reason: "GitHub refused the sign-in." };
        }
      } catch {
        if (controller.signal.aborted) return { ok: false, reason: "Sign-in cancelled." };
        // A single failed poll is not a failed flow; keep waiting until the deadline.
      }
    }

    return { ok: false, reason: "Sign-in timed out. Try again." };
  } finally {
    if (cancelActive === cancel) cancelActive = null;
  }
}

/** A completion page for GitHub's device flow, after ADCode linked the account. */
export function openGitHubCompletionPage(): Promise<void> {
  return new Promise(resolve => {
    const server = createServer((request, response) => {
      if (request.method !== "GET" || request.url !== "/") { response.writeHead(404).end(); return; }
      response.writeHead(200, RESULT_PAGE_HEADERS);
      response.end(resultPage("You're connected", "Your GitHub account is connected. Return to ADCode to carry on.", true, "GitHub"));
    });
    const timer = setTimeout(() => { server.closeAllConnections(); server.close(); }, 60_000);
    timer.unref();
    server.unref();
    const failed = () => { clearTimeout(timer); server.close(); resolve(); };
    server.on("error", failed);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") { failed(); return; }
      void shell.openExternal(`http://127.0.0.1:${address.port}/`).then(() => resolve(), failed);
    });
  });
}
