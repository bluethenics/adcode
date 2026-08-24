/**
 * Getting a Google or GitHub credential, without shipping a secret.
 *
 * §1 of the brief is explicit that a key shipped inside the binary can be extracted by
 * anyone, so neither flow here uses a client secret. That constraint picks the flow:
 *
 *   Google  PKCE with a loopback redirect. A public client id, a per-attempt verifier,
 *           and a redirect to 127.0.0.1 on an ephemeral port. No secret exists to leak.
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
import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { shell } from "electron";

/*
 * ─────────────────────────────────────────────────────────────────────────────
 *  PASTE YOUR OAUTH CLIENT IDS HERE.  See docs/OAUTH-SETUP.md for how to get them.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * These are safe to commit. An OAuth client id for an installed app is a public
 * identifier, not a credential - Google's own guidance is that "installed apps are
 * distributed to individual devices, and it is assumed that these apps cannot keep
 * secrets", which is exactly why PKCE and the device flow exist. What must never be
 * committed is a client *secret*, and neither flow here needs one.
 *
 * Environment variables override these, for anyone testing against their own clients.
 */
const GOOGLE_CLIENT_ID =
  process.env["ADCODE_GOOGLE_CLIENT_ID"] ??
  "345488063416-60i3dqfj1j8itg9bio2itshmcbq7e3mh.apps.googleusercontent.com";

const GITHUB_CLIENT_ID = process.env["ADCODE_GITHUB_CLIENT_ID"] ?? "Ov23lienZUTAiNKAM0UV";

/**
 * Optional, and only for Google.
 *
 * Google marks `client_secret` optional on the token exchange when PKCE is used, and this
 * omits it. Some Desktop-type clients are issued one anyway; setting this covers that
 * case without making a secret a requirement.
 *
 * **The secret for this project's own client is deliberately not here.** Google issues one
 * with every Desktop client whether the flow needs it or not, and ours does not - PKCE is
 * what proves the exchange came from the same client that started it. Committing it would
 * put a credential in every installer for no gain, and would mean rotating it broke every
 * copy already installed.
 */
const GOOGLE_CLIENT_SECRET = process.env["ADCODE_GOOGLE_CLIENT_SECRET"] ?? "";

/** Whether sign-in can be offered at all. The UI hides the buttons when it cannot. */
export const oauthConfigured = {
  google: () => GOOGLE_CLIENT_ID.length > 0,
  github: () => GITHUB_CLIENT_ID.length > 0,
};

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

/**
 * The page the browser lands on when the flow is over.
 *
 * It is the last thing a person sees before coming back to the editor, and for a moment it
 * is the whole product - so it says what happened, and what to do next, rather than leaving
 * a blank tab and a question. Self-contained: no fonts, no images, nothing to fetch from a
 * local server that is about to close.
 */
function resultPage(heading: string, detail: string, ok: boolean): string {
  const accent = ok ? "#3ddc97" : "#ff6b6b";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ADCode</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    background: #0f1115; color: #e7e9ee;
    font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  .card {
    max-width: 26rem; padding: 2.5rem; text-align: center;
    border: 1px solid #262a33; border-radius: 14px; background: #151821;
  }
  .mark {
    width: 44px; height: 44px; margin: 0 auto 1.25rem; border-radius: 11px;
    display: grid; place-items: center; background: ${accent}1a; color: ${accent};
    font-size: 22px; font-weight: 700;
  }
  h1 { margin: 0 0 .5rem; font-size: 1.35rem; letter-spacing: -0.01em; }
  p  { margin: 0; color: #9aa2b1; }
  .hint { margin-top: 1.5rem; font-size: .875rem; color: #6b7280; }
</style></head>
<body><div class="card">
  <div class="mark">${ok ? "&check;" : "!"}</div>
  <h1>${heading}</h1>
  <p>${detail}</p>
  <p class="hint">You can close this tab.</p>
</div></body></html>`;
}

const base64url = (buffer: Buffer): string =>
  buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/* ── Google ─────────────────────────────────────────────────────────────── */

export async function linkWithGoogle(): Promise<OAuthResult> {
  const clientId = GOOGLE_CLIENT_ID;
  if (clientId.length === 0) {
    return { ok: false, reason: "Google sign-in isn't configured in this build." };
  }

  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const state = base64url(randomBytes(16));

  return new Promise<OAuthResult>((resolve) => {
    let settled = false;
    const finish = (result: OAuthResult): void => {
      if (settled) return;
      settled = true;
      cancelActive = null;
      clearTimeout(timer);
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

      // Google sends `error=access_denied` when the person declines. That is a decision,
      // not a fault, and it should not be described as one.
      const denied = url.searchParams.get("error");
      if (denied !== null) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(resultPage("Sign-in cancelled", "Nothing has changed. You can try again from ADCode.", false));
        finish({ ok: false, reason: "Sign-in was cancelled." });
        return;
      }

      // Compared before the code is used: without it, any page the user visits could
      // hand us a code from an attacker's account.
      if (url.searchParams.get("state") !== state) {
        res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
        res.end(resultPage("Couldn't verify that sign-in", "The response didn't match the request this app started. Try again from ADCode.", false));
        finish({ ok: false, reason: "The sign-in response could not be verified." });
        return;
      }

      const code = url.searchParams.get("code");
      if (code === null) {
        res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
        res.end(resultPage("Sign-in didn't finish", "Google didn't send anything to sign in with. Try again from ADCode.", false));
        finish({ ok: false, reason: "Sign-in was cancelled." });
        return;
      }

      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(resultPage("Signed in", "ADCode has your account. Go back to the editor to carry on.", true));

      void exchangeGoogleCode(clientId, code, verifier, port).then(finish);
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

      void shell.openExternal(authorize.toString());
    });

    server.on("error", () => finish({ ok: false, reason: "Could not start the sign-in listener." }));
  });
}

async function exchangeGoogleCode(
  clientId: string,
  code: string,
  verifier: string,
  port: number,
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
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) return { ok: false, reason: "Google refused the sign-in." };

    const body = (await response.json()) as { id_token?: unknown };
    return typeof body.id_token === "string"
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
  const clientId = GITHUB_CLIENT_ID;
  if (clientId.length === 0) {
    return { ok: false, reason: "GitHub sign-in isn't configured in this build." };
  }

  let deviceCode: string;
  let interval: number;

  try {
    const response = await fetch("https://github.com/login/device/code", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, scope: "read:user user:email" }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) return { ok: false, reason: "GitHub wouldn't start the sign-in." };

    const body = (await response.json()) as Record<string, unknown>;
    const user = body["user_code"];
    const uri = body["verification_uri"];
    const device = body["device_code"];

    if (typeof user !== "string" || typeof uri !== "string" || typeof device !== "string") {
      return { ok: false, reason: "GitHub's response was malformed." };
    }

    deviceCode = device;
    // GitHub asks for at least this gap between polls and rejects faster ones.
    interval = typeof body["interval"] === "number" ? body["interval"] : 5;
    onCode({ userCode: user, verificationUri: uri });
    void shell.openExternal(uri);
  } catch {
    return { ok: false, reason: "Couldn't reach GitHub. Check your connection." };
  }

  const deadline = Date.now() + FLOW_TIMEOUT_MS;

  // Cancellation has to interrupt the wait, not just the check after it: polling every five
  // seconds means pressing Cancel would otherwise appear to do nothing for five seconds.
  let cancelled = false;
  let wake: (() => void) | null = null;
  cancelActive = () => {
    cancelled = true;
    wake?.();
  };

  try {
    while (Date.now() < deadline) {
      await new Promise<void>((resolve) => {
        wake = resolve;
        setTimeout(resolve, interval * 1000);
      });
      if (cancelled) return { ok: false, reason: "Sign-in cancelled." };

      try {
        const response = await fetch("https://github.com/login/oauth/access_token", {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: clientId,
            device_code: deviceCode,
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          }),
          signal: AbortSignal.timeout(20_000),
        });

        const body = (await response.json()) as Record<string, unknown>;
        const token = body["access_token"];
        if (typeof token === "string") return { ok: true, provider: "github.com", accessToken: token };

        const error = body["error"];
        // `authorization_pending` is the normal state while the user is still typing.
        if (error === "slow_down") interval += 5;
        else if (error === "access_denied") return { ok: false, reason: "Sign-in was declined." };
        else if (error === "expired_token") return { ok: false, reason: "The code expired. Try again." };
        else if (error !== "authorization_pending") {
          return { ok: false, reason: "GitHub refused the sign-in." };
        }
      } catch {
        // A single failed poll is not a failed flow; keep waiting until the deadline.
      }
    }

    return { ok: false, reason: "Sign-in timed out. Try again." };
  } finally {
    cancelActive = null;
  }
}
