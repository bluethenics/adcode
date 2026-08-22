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

export type OAuthResult =
  | { ok: true; provider: "google.com"; idToken: string }
  | { ok: true; provider: "github.com"; accessToken: string }
  | { ok: false; reason: string };

/** How long a user gets to finish in the browser before we stop waiting. */
const FLOW_TIMEOUT_MS = 3 * 60 * 1000;

const base64url = (buffer: Buffer): string =>
  buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/* ── Google ─────────────────────────────────────────────────────────────── */

export async function linkWithGoogle(): Promise<OAuthResult> {
  const clientId = process.env["ADCODE_GOOGLE_CLIENT_ID"];
  if (clientId === undefined) {
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
      clearTimeout(timer);
      server.close();
      resolve(result);
    };

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const code = url.searchParams.get("code");

      // Compared before the code is used: without it, any page the user visits could
      // hand us a code from an attacker's account.
      if (url.searchParams.get("state") !== state) {
        res.writeHead(400, { "content-type": "text/plain" });
        res.end("Sign-in could not be verified. Close this tab and try again.");
        finish({ ok: false, reason: "The sign-in response could not be verified." });
        return;
      }

      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<!doctype html><title>ADCode</title><body style=\"font:16px system-ui;padding:3rem\">Signed in. You can close this tab and go back to ADCode.</body>");

      if (code === null) {
        finish({ ok: false, reason: "Sign-in was cancelled." });
        return;
      }

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
  const clientId = process.env["ADCODE_GITHUB_CLIENT_ID"];
  if (clientId === undefined) {
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

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, interval * 1000));

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
}
