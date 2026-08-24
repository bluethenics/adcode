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
import { CHANNELS, type AccountState, type LinkOutcome } from "../shared/api.ts";
import { DiskFileStore, FetchHttpTransport, SystemClock } from "./adPorts.ts";
import { backendAccount } from "./backend.ts";
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

export async function currentAccount(): Promise<AccountState> {
  const auth = account();
  if (auth === null) return UNAVAILABLE;

  try {
    const profile = await auth.profile();
    if (!profile.ok) return { state: "anonymous" };
    if (profile.value === null) return { state: "anonymous" };

    return {
      state: "linked",
      email: profile.value.email,
      displayName: profile.value.displayName,
      photoUrl: profile.value.photoUrl,
      providers: [...profile.value.providers],
    };
  } catch {
    // Offline is not "signed out" - saying so would invite someone to re-link an account
    // they already have.
    return { state: "anonymous" };
  }
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

    const linked =
      flow.provider === "google.com"
        ? await auth.linkGoogle(flow.idToken)
        : await auth.linkGitHub(flow.accessToken);

    if (!linked.ok) return { ok: false, message: linked.error.detail };

    const state = await currentAccount();
    broadcast(state);
    return { ok: true, state };
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

      const linked = await auth.linkPassword(email.trim(), password);
      if (!linked.ok) return { ok: false, message: linked.error.detail };

      const state = await currentAccount();
      broadcast(state);
      return { ok: true, state };
    },
  );
}
