/**
 * Linking the anonymous account to a real one.
 *
 * The editor signs you in anonymously on first launch and starts crediting earnings to
 * that UID (brief §8.4). Linking attaches Google, GitHub, or an email to **the same UID**,
 * so the balance carries over with no ledger merge - and so the web dashboard, signed in
 * as that account, shows the money this machine earned.
 *
 * Without this the two halves are separate accounts and the dashboard shows zero.
 */
import { join } from "node:path";
import { app, ipcMain, BrowserWindow } from "electron";
import {
  formatMicros,
  parseBalanceResponse,
  type FirebaseAuth,
  type Micros,
} from "@adcode/ads";
import { CHANNELS, type AccountState, type LinkOutcome } from "../shared/api.ts";
import { DiskFileStore, FetchHttpTransport, SystemClock } from "./adPorts.ts";
import { apiBaseUrl, backendAccount } from "./backend.ts";
import { linkWithGitHub, cancelSignIn, linkWithGoogle } from "./oauth.ts";

function account() {
  return backendAccount({
    http: new FetchHttpTransport([]),
    clock: new SystemClock(),
    store: new DiskFileStore(join(app.getPath("userData"), "ads")),
  });
}

function broadcast(state: AccountState): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(CHANNELS.accountChanged, state);
  }
}

const UNAVAILABLE: AccountState = { state: "unavailable" };

/** Short on purpose: somebody is watching a spinner while this runs. */
const BALANCE_TIMEOUT_MS = 4_000;

/** Long enough to read a sentence and decide; short enough that it is not left lying around. */
const PENDING_TTL_MS = 5 * 60_000;

/**
 * A credential that was good but named an account that already exists.
 *
 * Held so that answering "sign in as that account" does not mean a second trip through
 * the browser - the user already approved this one, seconds ago. Cleared as soon as it is
 * spent, and ignored once it is stale.
 */
type Held =
  | { readonly kind: "idp"; readonly provider: "google.com" | "github.com"; readonly credential: string }
  | { readonly kind: "password"; readonly email: string; readonly password: string };

let pending: { readonly held: Held; readonly at: number } | null = null;

/**
 * What signing in as somebody else would leave behind.
 *
 * Asked directly rather than through `AdClient` because this runs while a click is
 * waiting on the answer: the client's retry-and-backoff is right for a receipt that must
 * eventually land, and wrong for a question that stops being interesting after a few
 * seconds.
 *
 * Null means "could not find out", which is not the same as zero and must not be treated
 * as it. §9 says an unreachable backend may only make a feature quietly do nothing - it
 * may not make this machine quietly forfeit a balance.
 */
async function unclaimedMicros(auth: FirebaseAuth): Promise<Micros | null> {
  const token = await auth.getToken();
  if (!token.ok) return null;

  try {
    const response = await new FetchHttpTransport([]).request({
      method: "GET",
      url: `${apiBaseUrl()}/balance`,
      headers: { authorization: `Bearer ${token.value}` },
      timeoutMs: BALANCE_TIMEOUT_MS,
    });

    if (response.status < 200 || response.status >= 300) return null;

    const parsed = parseBalanceResponse(new TextDecoder().decode(response.body));
    return parsed.ok ? parsed.value.availableMicros : null;
  } catch {
    return null;
  }
}

export async function currentAccount(): Promise<AccountState> {
  const auth = account();
  if (auth === null) return UNAVAILABLE;

  /*
   * Read before the profile call, so an offline machine still reports who it is.
   *
   * `uid()` is local - it comes off the persisted identity - whereas `profile()` is a
   * round trip. Reporting the id even when the network is down is the point: "which
   * account is this editor" is exactly the question somebody asks when nothing is
   * arriving, which is also when the network is the prime suspect.
   */
  const uid = auth.uid();

  try {
    const profile = await auth.profile();
    if (!profile.ok) return uid === null ? { state: "anonymous" } : { state: "anonymous", uid };
    if (profile.value === null) {
      return uid === null ? { state: "anonymous" } : { state: "anonymous", uid };
    }

    return {
      state: "linked",
      email: profile.value.email,
      displayName: profile.value.displayName,
      photoUrl: profile.value.photoUrl,
      providers: [...profile.value.providers],
      ...(uid === null ? {} : { uid }),
    };
  } catch {
    // Offline is not "signed out" - saying so would invite someone to re-link an account
    // they already have.
    return uid === null ? { state: "anonymous" } : { state: "anonymous", uid };
  }
}

/** A link or sign-in that worked: drop the held credential, tell every window. */
async function succeed(): Promise<LinkOutcome> {
  pending = null;
  const state = await currentAccount();
  broadcast(state);
  return { ok: true, state };
}

/** Spend a credential as a sign-in rather than a link. The UID changes; that is the point. */
async function signInWith(auth: FirebaseAuth, held: Held): Promise<LinkOutcome> {
  const signed =
    held.kind === "password"
      ? await auth.signInPassword(held.email, held.password)
      : held.provider === "google.com"
        ? await auth.signInGoogle(held.credential)
        : await auth.signInGitHub(held.credential);

  if (!signed.ok) return { ok: false, message: signed.error.detail };
  return succeed();
}

/**
 * The fork every "that already exists" refusal reaches.
 *
 * The credential is good and names a real account, so signing in as it will work. What
 * it costs is this machine's anonymous UID and whatever is owed to it, so ask the server
 * what that is worth before deciding whether this is a question or a formality.
 */
async function offerSignIn(auth: FirebaseAuth, held: Held): Promise<LinkOutcome> {
  const micros = await unclaimedMicros(auth);

  // Nothing at stake, so there is no decision worth interrupting anyone for.
  if (micros === 0n) return signInWith(auth, held);

  pending = { held, at: Date.now() };

  const cost =
    micros === null
      ? "Its unclaimed earnings couldn't be checked just now, and signing in would leave any of them behind."
      : `The ${formatMicros(micros)} earned on this machine would stay with the anonymous account and would not come across.`;

  return {
    ok: false,
    decide: "sign-in-instead",
    unclaimed: micros === null ? "an unknown amount" : formatMicros(micros),
    message: `You already have an account here, and this machine can sign in as it instead of linking to it. ${cost}`,
  };
}

export function registerAccountIpc(): void {
  ipcMain.handle(CHANNELS.accountStatus, async (): Promise<AccountState> => currentAccount());

  ipcMain.handle(CHANNELS.accountLink, async (_event, provider: unknown): Promise<LinkOutcome> => {
    const auth = account();
    if (auth === null) {
      return { ok: false, message: "Sign-in isn't configured in this build." };
    }

    if (provider !== "google" && provider !== "github") {
      return { ok: false, message: "Unknown sign-in method." };
    }

    const flow =
      provider === "google"
        ? await linkWithGoogle()
        : await linkWithGitHub((code) => {
            // The device code has to reach the user while the poll is still running, so
            // it is pushed rather than returned.
            for (const window of BrowserWindow.getAllWindows()) {
              if (!window.isDestroyed()) window.webContents.send(CHANNELS.accountDeviceCode, code);
            }
          });

    if (!flow.ok) return { ok: false, message: flow.reason };

    const credential = flow.provider === "google.com" ? flow.idToken : flow.accessToken;

    const linked =
      flow.provider === "google.com"
        ? await auth.linkGoogle(flow.idToken)
        : await auth.linkGitHub(flow.accessToken);

    if (linked.ok) return succeed();

    /*
     * The refusal that used to be a dead end.
     *
     * Every link names this machine's anonymous account in an `idToken`, and that is
     * exactly what makes Firebase treat the call as a link and refuse it when the
     * credential already belongs to someone. The refusal then advised "sign in with it
     * instead" - which nothing in the app could do, because linking was the only path to
     * that endpoint. Signing in is now possible, but it leaves the anonymous UID and
     * anything owed to it behind, so what happens next depends on whether there is
     * anything to leave.
     */
    if (linked.error.reason !== "account-exists") {
      return { ok: false, message: linked.error.detail };
    }

    return offerSignIn(auth, { kind: "idp", provider: flow.provider, credential });
  });

  /**
   * "Yes, sign in as that account."
   *
   * The credential from the refused link is spent here rather than obtained again, so
   * saying yes costs no second trip through the browser.
   */
  ipcMain.handle(CHANNELS.accountSignInInstead, async (): Promise<LinkOutcome> => {
    const auth = account();
    if (auth === null) return { ok: false, message: "Sign-in isn't configured in this build." };

    const waiting = pending;
    pending = null;

    if (waiting === null || Date.now() - waiting.at > PENDING_TTL_MS) {
      return { ok: false, message: "That sign-in expired. Try again." };
    }

    return signInWith(auth, waiting.held);
  });

  /**
   * Forget the account on this machine.
   *
   * `reset()` clears the stored identity, so the next request starts a fresh anonymous one.
   * That is recoverable for a linked account - the provider returns the same UID, and the
   * balance with it - and permanent for one that was never linked. The renderer only offers
   * this once `linked` is true, and confirms first either way.
   */
  ipcMain.handle(CHANNELS.accountSignOut, async (): Promise<AccountState> => {
    const auth = account();
    if (auth !== null) await auth.reset();
    // Nothing held over from a refused link may outlive the account it was refused against.
    pending = null;
    const state = await currentAccount();
    broadcast(state);
    return state;
  });

  ipcMain.handle(CHANNELS.accountCancelLink, async (): Promise<boolean> => cancelSignIn());

  ipcMain.handle(
    CHANNELS.accountLinkEmail,
    async (_event, email: unknown, password: unknown): Promise<LinkOutcome> => {
      const auth = account();
      if (auth === null) return { ok: false, message: "Sign-in isn't configured in this build." };

      if (typeof email !== "string" || !email.includes("@")) {
        return { ok: false, message: "That email address doesn't look right." };
      }
      if (typeof password !== "string" || password.length < 6) {
        return { ok: false, message: "Use a password of at least six characters." };
      }

      const address = email.trim();

      const linked = await auth.linkPassword(address, password);
      if (linked.ok) return succeed();

      // `EMAIL_EXISTS` is the same dead end Google hits, reached a different way: the
      // address already has an account, so sign in as it rather than refuse.
      if (linked.error.reason !== "account-exists") {
        return { ok: false, message: linked.error.detail };
      }

      return offerSignIn(auth, { kind: "password", email: address, password });
    },
  );
}
