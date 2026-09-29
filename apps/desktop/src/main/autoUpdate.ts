/**
 * Keeping ADCode up to date.
 *
 * §9's rule for the ad module applies here too, for the same reason: the worst permitted
 * outcome of an update failing is that the user stays on the version they have. Nothing
 * in this file may throw into startup, and no failure here may show the user a dialog
 * they cannot act on - an editor that interrupts your work to say a download failed is
 * worse than one that quietly tries again later. Failures are recorded in the debug log,
 * which Help > Report a Problem carries, so "it never updates" has an answer.
 *
 * Downloads happen in the background. When an update is ready the window says so once and
 * offers Restart now; ADCode never quits on its own. Ignored, the update installs when you
 * next close ADCode.
 */
import { readFile, stat, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { app, ipcMain } from "electron";
import { CHANNELS, type UpdateStatus } from "../shared/api.ts";
import { recordDebug } from "./debugLog.ts";
import { draftWritesSettled } from "./draftWrites.ts";
import { blockMapFitsInstaller, canSelfUpdate, runningFromWindowsStore } from "./updatePolicy.ts";

/**
 * Soon enough that a short session still finishes the download, late enough to stay off
 * the path to first paint. It was 45 seconds, and a session that ended inside that minute
 * threw the whole download away.
 */
const FIRST_CHECK_DELAY_MS = 10_000;
const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const SIMULATED_STEP_MS = 150;

let status: UpdateStatus = { state: "idle" };
let listeners: ((next: UpdateStatus) => void)[] = [];
let initialization: Promise<void> | null = null;
let requestCheck: (() => Promise<void>) | null = null;
let installNow: (() => void) | null = null;
let restartRequested = false;
let announced: string | null = null;

/**
 * Where "Restart now" is offered. Windows' installer waits for this process to exit before
 * it reopens ADCode; an AppImage starts the new copy at once, straight into the
 * single-instance lock, so there it installs as ADCode closes instead.
 */
const restartOffered = (): boolean => process.platform === "win32";

function describe(message: unknown): string {
  return message instanceof Error ? (message.stack ?? message.message) : String(message);
}

/** electron-updater's logger interface, written into the debug log. */
const updaterLog = {
  info: (message?: unknown) => recordDebug("info", "updater", describe(message)),
  warn: (message?: unknown) => recordDebug("warn", "updater", describe(message)),
  error: (message?: unknown) => recordDebug("error", "updater", describe(message)),
};

function versionOf(value: UpdateStatus): string | undefined {
  return "version" in value ? value.version : undefined;
}

function setStatus(next: UpdateStatus): void {
  // State changes are worth a line; every download percentage is not.
  const changed = next.state !== status.state || (versionOf(next) !== undefined && versionOf(next) !== versionOf(status));
  status = next;
  if (changed) updaterLog.info(`status ${JSON.stringify(next)}`);
  for (const listener of listeners) {
    try {
      listener(next);
    } catch {
      // A renderer that has gone away must not stop the others being told.
    }
  }
}

export function onUpdateStatus(listener: (next: UpdateStatus) => void): () => void {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

export const currentUpdateStatus = (): UpdateStatus => status;

/**
 * Whether updates are even possible for this build.
 *
 * A dev run and an unpacked build have no update feed, and electron-updater throws
 * rather than no-ops in that case. Checking first keeps the log clean. The decision
 * itself lives in `updatePolicy.ts`, which has no Electron import and so can be tested
 * without one.
 */
function updatable(): boolean {
  return canSelfUpdate({
    packaged: app.isPackaged,
    disabled: process.env["ADCODE_DISABLE_UPDATES"] === "1",
    windowsStore: runningFromWindowsStore(),
    portable: process.env["PORTABLE_EXECUTABLE_DIR"] !== undefined,
  });
}

/** electron-updater's cache folder for an NSIS build, by its own rule (`getAppCacheDir`). */
async function updaterCacheDir(): Promise<string | null> {
  if (process.platform !== "win32" || typeof process.resourcesPath !== "string") return null;
  const yml = await readFile(join(process.resourcesPath, "app-update.yml"), "utf8");
  const name = /^updaterCacheDirName:\s*['"]?([^'"\r\n]+?)['"]?\s*$/m.exec(yml)?.[1];
  if (name === undefined) return null;
  return join(process.env["LOCALAPPDATA"] ?? join(homedir(), "AppData", "Local"), name);
}

/**
 * Put differential updates back on their feet. See `blockMapFitsInstaller`: a cached
 * blockmap that does not describe `installer.exe` is deleted, and electron-updater fetches
 * the right one from the release instead. Any failure leaves both files as they were.
 */
async function dropStaleBlockMap(): Promise<void> {
  try {
    const dir = await updaterCacheDir();
    if (dir === null) return;
    const blockMapPath = join(dir, "current.blockmap");
    const [raw, installer] = await Promise.all([readFile(blockMapPath), stat(join(dir, "installer.exe"))]);
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(gunzipSync(raw).toString("utf8"));
    } catch {
      parsed = null;
    }
    if (blockMapFitsInstaller(parsed, installer.size)) return;
    await unlink(blockMapPath);
    updaterLog.info(`removed a cached blockmap that does not describe installer.exe (${installer.size} bytes)`);
  } catch {
    // Either file missing is the normal case on a first install: nothing to reconcile.
  }
}

/**
 * The smoke run drives the whole visible flow without a network. Unpackaged only, so no
 * shipped build can be talked into pretending.
 */
function simulationRequested(): boolean {
  return !app.isPackaged && process.env["ADCODE_UPDATE_SIMULATE"] === "1";
}

function startSimulation(): void {
  const steps: UpdateStatus[] = [
    { state: "checking" },
    { state: "downloading", version: "9.9.9" },
    { state: "downloading", percent: 42 },
    { state: "downloading", percent: 100 },
    { state: "ready", version: "9.9.9", restartable: true },
  ];
  requestCheck = async () => {
    if (status.state === "ready") return;
    for (const step of steps) {
      await new Promise((resolve) => setTimeout(resolve, SIMULATED_STEP_MS));
      setStatus(step);
    }
  };
  installNow = () => updaterLog.info("simulated restart to update");
}

export function startAutoUpdate(enabled: () => boolean): Promise<void> {
  initialization = initializeAutoUpdate(enabled);
  return initialization;
}

async function initializeAutoUpdate(enabled: () => boolean): Promise<void> {
  if (simulationRequested()) {
    startSimulation();
    return;
  }

  if (!updatable()) {
    setStatus({ state: "unsupported" });
    return;
  }

  let updater;
  try {
    // Imported lazily so an unpackaged run never loads it at all.
    ({ autoUpdater: updater } = await import("electron-updater"));
  } catch (error) {
    updaterLog.error(error);
    setStatus({ state: "unsupported" });
    return;
  }

  updater.autoDownload = true;
  // Ignored, a downloaded update installs as the editor closes. It never closes the editor.
  updater.autoInstallOnAppQuit = true;
  updater.logger = updaterLog;

  updater.on("checking-for-update", () => setStatus({ state: "checking" }));
  updater.on("update-available", (info) => setStatus({ state: "downloading", version: info.version }));
  updater.on("update-not-available", () => setStatus({ state: "current" }));
  updater.on("download-progress", (progress) =>
    setStatus({ state: "downloading", percent: Math.round(progress.percent) }),
  );
  updater.on("update-downloaded", (info) =>
    setStatus({ state: "ready", version: info.version, restartable: restartOffered() }),
  );
  updater.on("error", (error) => {
    // No dialog: a failed check is not the user's problem to solve. The log keeps why.
    updaterLog.error(error);
    setStatus({ state: "failed" });
  });

  let activeCheck: Promise<void> | null = null;
  const check = (): Promise<void> => {
    if (status.state === "ready" || status.state === "downloading") return Promise.resolve();
    if (activeCheck !== null) return activeCheck;
    activeCheck = (async () => {
      try {
        await updater.checkForUpdates();
      } catch (error) {
        updaterLog.error(error);
        setStatus({ state: "failed" });
      } finally {
        activeCheck = null;
      }
    })();
    return activeCheck;
  };
  requestCheck = check;
  // Silent install, then ADCode reopens itself: the person asked for exactly this restart.
  installNow = () => updater.quitAndInstall(true, true);

  await dropStaleBlockMap();

  setTimeout(() => { if (enabled()) void check(); }, FIRST_CHECK_DELAY_MS);
  setInterval(() => { if (enabled()) void check(); }, RECHECK_INTERVAL_MS);
}

/** A menu request performs a check even when automatic checks are switched off. */
export async function checkForUpdatesNow(): Promise<UpdateStatus> {
  if (initialization !== null) await initialization;
  if (requestCheck !== null) await requestCheck();
  return status;
}

/**
 * Restart into the downloaded update, once every unsaved draft is on disk - and only once.
 *
 * A second quitAndInstall makes electron-updater clear its "already installing" flag, and
 * its quit handler then installs a second time; on an AppImage that second install deletes
 * the app it just put in place. So the first request wins and every later one only
 * reports the status.
 */
async function restartToUpdate(): Promise<UpdateStatus> {
  if (initialization !== null) await initialization;
  if (restartRequested || status.state !== "ready" || status.restartable !== true || installNow === null) return status;
  restartRequested = true;
  await draftWritesSettled();
  updaterLog.info(`restart to install ${status.version}`);
  installNow();
  return status;
}

/** Two windows can be open: the first to ask announces the version, the other stays quiet. */
function claimNotice(version: unknown): boolean {
  if (status.state !== "ready" || status.version !== version || announced === version) return false;
  announced = version;
  return true;
}

export function registerUpdateIpc(): void {
  ipcMain.handle(CHANNELS.updateStatus, () => currentUpdateStatus());
  ipcMain.handle(CHANNELS.updateCheck, () => checkForUpdatesNow());
  ipcMain.handle(CHANNELS.updateInstall, () => restartToUpdate());
  ipcMain.handle(CHANNELS.updateClaimNotice, (_event, version: unknown) => claimNotice(version));
}
