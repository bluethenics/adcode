/**
 * The banned-account state of this machine's account, for every window.
 *
 * Installs the `fetch` watch (accountBanWatch.ts) once, asks `GET /v1/me` shortly after launch,
 * every few minutes after that, every minute while banned, and whenever a window asks; pushes
 * each change to every window, where `renderer/accountBan.ts` covers the workbench with the
 * banned screen. The ad runtime asks `isAccountBanned()` before it serves or claims anything,
 * so sponsored-card earning stops on this side too - the server refuses it either way.
 *
 * Shared by the desktop and the web version's Web Worker host, both through `accountIpc.ts`.
 */
import { join } from "node:path";
import { app, ipcMain, BrowserWindow } from "electron";
import { CHANNELS } from "../shared/api.ts";
import { DiskFileStore, FetchHttpTransport, SystemClock } from "./adPorts.ts";
import { apiBaseUrl, apiOrigin, backendAccount } from "./backend.ts";
import { createBanWatch, isBanRefusal, sameOrigin, watchFetch, type AccountBanState, type BanWatch, type Standing } from "./accountBanWatch.ts";

/** While not banned: often enough that a ban shows within minutes on an idle machine. */
const HEARTBEAT_MS = 5 * 60_000;
const FIRST_CHECK_MS = 4_000;

let watch: BanWatch | null = null;

export function isAccountBanned(): boolean {
  return watch?.state().banned === true;
}

/** Call when the account on this machine changes, so a ban never follows a different person. */
export function noteAccountChangedForBan(): void {
  watch?.accountChanged();
}

function account() {
  return backendAccount({ http: new FetchHttpTransport([]), clock: new SystemClock(), store: new DiskFileStore(join(app.getPath("userData"), "ads")) });
}

async function standing(): Promise<Standing> {
  const auth = account();
  if (auth === null) return "unknown";
  const token = await auth.getToken();
  if (!token.ok) return "unknown";
  try {
    const response = await fetch(`${apiBaseUrl()}/me`, { headers: { authorization: `Bearer ${token.value}` }, signal: AbortSignal.timeout(10_000) });
    await response.body?.cancel().catch(() => undefined);
    if (isBanRefusal(response.status, response.headers)) return "banned";
    return response.ok ? "active" : "unknown";
  } catch {
    return "unknown";
  }
}

function publish(state: AccountBanState): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(CHANNELS.accountBanChanged, state);
  }
}

export function registerAccountBan(): void {
  if (watch !== null) return;
  const timer = (run: () => void, ms: number): (() => void) => {
    const handle = setTimeout(run, ms);
    (handle as { unref?: () => void }).unref?.();
    return () => clearTimeout(handle);
  };
  const created = createBanWatch({
    check: standing,
    publish,
    uid: () => { try { return account()?.uid() ?? null; } catch { return null; } },
    now: () => Date.now(),
    later: timer,
  });
  watch = created;

  const isApi = sameOrigin(apiOrigin());
  globalThis.fetch = watchFetch(globalThis.fetch.bind(globalThis), isApi, () => created.noteBanned());

  ipcMain.handle(CHANNELS.accountBan, async (_event, recheck: unknown): Promise<AccountBanState> =>
    recheck === true ? created.recheck() : created.state());

  timer(() => { void created.recheck(); }, FIRST_CHECK_MS);
  const beat = setInterval(() => { if (!created.state().banned) void created.recheck(); }, HEARTBEAT_MS);
  (beat as { unref?: () => void }).unref?.();
}
