/**
 * Keeping ADCode up to date.
 *
 * §9's rule for the ad module applies here too, for the same reason: the worst permitted
 * outcome of an update failing is that the user stays on the version they have. Nothing
 * in this file may throw into startup, and no failure here may show the user a dialog
 * they cannot act on - an editor that interrupts your work to say a download failed is
 * worse than one that quietly tries again tomorrow.
 *
 * Downloads happen in the background and apply on the next restart. There is no "restart
 * now?" prompt: you decide when to close your editor, not us.
 */
import { app, ipcMain } from "electron";
import { CHANNELS, type UpdateStatus } from "../shared/api.ts";

/** Long enough that a laptop opened for ten minutes does not spend it downloading. */
const FIRST_CHECK_DELAY_MS = 45_000;
const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

let status: UpdateStatus = { state: "idle" };
let listeners: ((next: UpdateStatus) => void)[] = [];

function setStatus(next: UpdateStatus): void {
  status = next;
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
 * rather than no-ops in that case. Checking first keeps the log clean.
 */
function updatable(): boolean {
  if (!app.isPackaged) return false;
  if (process.env["ADCODE_DISABLE_UPDATES"] === "1") return false;
  return true;
}

export async function startAutoUpdate(enabled: () => boolean): Promise<void> {
  if (!updatable()) {
    setStatus({ state: "unsupported" });
    return;
  }

  let updater;
  try {
    // Imported lazily so an unpackaged run never loads it at all.
    ({ autoUpdater: updater } = await import("electron-updater"));
  } catch {
    setStatus({ state: "unsupported" });
    return;
  }

  updater.autoDownload = true;
  // The user closes the editor when they are ready; we never quit it for them.
  updater.autoInstallOnAppQuit = true;
  updater.logger = null;

  updater.on("checking-for-update", () => setStatus({ state: "checking" }));
  updater.on("update-available", (info) => setStatus({ state: "downloading", version: info.version }));
  updater.on("update-not-available", () => setStatus({ state: "current" }));
  updater.on("download-progress", (progress) =>
    setStatus({ state: "downloading", percent: Math.round(progress.percent) }),
  );
  updater.on("update-downloaded", (info) => setStatus({ state: "ready", version: info.version }));
  updater.on("error", () => {
    // Deliberately no detail and no dialog. A failed check is not the user's problem to
    // solve, and the next one is six hours away.
    setStatus({ state: "failed" });
  });

  const check = async (): Promise<void> => {
    if (!enabled()) return;
    try {
      await updater.checkForUpdates();
    } catch {
      setStatus({ state: "failed" });
    }
  };

  setTimeout(() => void check(), FIRST_CHECK_DELAY_MS);
  setInterval(() => void check(), RECHECK_INTERVAL_MS);
}

export function registerUpdateIpc(): void {
  ipcMain.handle(CHANNELS.updateStatus, () => currentUpdateStatus());
}
