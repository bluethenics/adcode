/**
 * The Electron half of local file history and crash recovery.
 *
 * `localHistory.ts` holds the disk behaviour and imports no Electron; this picks the
 * directory and applies the two §4 settings that govern it.
 */
import { app } from "electron";
import {
  createLocalHistory,
  type HistoryEntry,
  type LocalHistory,
  type RecoveredDraft,
} from "./localHistory.ts";
import { currentSettings } from "./settings.ts";

let store: LocalHistory | null = null;

function get(): LocalHistory {
  store ??= createLocalHistory(app.getPath("userData"));
  return store;
}

const historyOn = (): boolean => currentSettings()["adcode.session.localFileHistory"] !== false;
const recoveryOn = (): boolean => currentSettings()["adcode.session.crashRecovery"] !== false;

export async function recordSave(path: string, text: string): Promise<void> {
  if (historyOn()) await get().record(path, text);
  // Saving is what a draft was protecting against losing, so it is no longer needed.
  await get().clearDraft(path);
}

export const historyVersions = (path: string): Promise<HistoryEntry[]> =>
  historyOn() ? get().versions(path) : Promise.resolve([]);

export const historyRead = (path: string, id: string): Promise<string | null> =>
  get().read(path, id);

export const recordDraft = (path: string, text: string): Promise<void> =>
  recoveryOn() ? get().draft(path, text) : Promise.resolve();

export const clearDraft = (path: string): Promise<void> => get().clearDraft(path);

export const recoverableDrafts = (): Promise<RecoveredDraft[]> =>
  recoveryOn() ? get().drafts() : Promise.resolve([]);
