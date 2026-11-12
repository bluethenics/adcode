/**
 * Sleep, hibernate, shut down or lock the computer once the assistant's work is all done.
 *
 * The rules live in `powerAfterTasksModel.ts`; this file is the doing: a countdown every
 * window, the system notification and a connected phone can see and cancel, and the system's
 * own command at the end of it. Before a shutdown the windows are asked to save open files,
 * so a long night's work is not lost to an unsaved tab blocking the shutdown.
 *
 * In the web version's sandbox there is no computer of the person's to put to sleep, so the
 * feature reports itself unsupported and never starts.
 */
import { execFile } from "node:child_process";
import { BrowserWindow, Notification, ipcMain } from "electron";
import { CHANNELS, type PowerStateView } from "../shared/api.ts";
import { currentSettings, onSettingsChanged, writeSetting } from "./settings.ts";
import { recordDebug } from "./debugLog.ts";
import {
  POWER_REPEAT_SETTING,
  POWER_SETTING,
  actionLabel,
  actionVerb,
  afterFiring,
  isPowerAction,
  powerCommand,
  powerPlatform,
  readPowerPreferences,
  shouldStartCountdown,
  supportedActions,
  type PowerAction,
  type TurnEnding,
} from "./powerAfterTasksModel.ts";

const platform = powerPlatform(process.platform, process.env["ADCODE_PLATFORM"]);

/** Long enough for a renderer to save a few dozen files before the system takes the window. */
const SAVE_BEFORE_SHUTDOWN_MS = 2_500;

interface Countdown {
  readonly action: PowerAction;
  readonly startedAt: number;
  readonly deadline: number;
  readonly timer: ReturnType<typeof setTimeout>;
  readonly notice: Notification | null;
}

let countdown: Countdown | null = null;
let lastOutcome: PowerStateView["lastOutcome"] = null;
const listeners = new Set<(state: PowerStateView) => void>();

export function powerState(): PowerStateView {
  const preferences = readPowerPreferences(currentSettings());
  return {
    supported: platform !== "web" && platform !== "other",
    platform,
    action: preferences.action,
    repeat: preferences.repeat,
    graceSeconds: preferences.graceSeconds,
    actions: supportedActions(platform),
    countdown: countdown === null ? null : { action: countdown.action, startedAt: countdown.startedAt, deadline: countdown.deadline },
    lastOutcome,
  };
}

/** Somebody else who wants to know: the phone link tells a connected phone. */
export function onPowerChanged(listener: (state: PowerStateView) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function announce(): void {
  const state = powerState();
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(CHANNELS.powerChanged, state);
  }
  for (const listener of listeners) {
    try { listener(state); } catch { /* One listener failing never stops the others. */ }
  }
}

function showWindow(): void {
  const window = BrowserWindow.getAllWindows()[0];
  if (window === undefined || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

/**
 * Called by the chat engine whenever a turn ends, with how many conversations are still working.
 * Starts the countdown only when the model says so.
 */
export function powerTurnEnded(ended: TurnEnding, stillRunning: number): void {
  const preferences = readPowerPreferences(currentSettings());
  if (!shouldStartCountdown({ preferences, platform, ended, stillRunning, counting: countdown !== null })) return;
  start(preferences.action, preferences.graceSeconds * 1000);
}

/** A chat started working again: whatever was counting down is no longer "all done". */
export function powerTurnStarted(): void {
  if (countdown !== null) cancel("A chat started working again");
}

function start(action: PowerAction, graceMs: number): void {
  const startedAt = Date.now();
  let notice: Notification | null = null;
  if (Notification.isSupported()) {
    notice = new Notification({
      title: `Your computer will ${actionVerb(action)} in ${Math.round(graceMs / 1000)} seconds`,
      body: "Everything the assistant was working on is done. Open ADCode to cancel.",
      urgency: "critical",
      timeoutType: "never",
    });
    notice.on("click", showWindow);
    notice.show();
  }
  countdown = { action, startedAt, deadline: startedAt + graceMs, timer: setTimeout(() => void fire(), graceMs), notice };
  recordDebug("info", "power", `${actionLabel(action)} in ${Math.round(graceMs / 1000)} s after the last chat finished`);
  announce();
}

function clearCountdown(): Countdown | null {
  const current = countdown;
  if (current === null) return null;
  clearTimeout(current.timer);
  try { current.notice?.close(); } catch { /* Already gone. */ }
  countdown = null;
  return current;
}

export function cancel(reason = "Cancelled"): void {
  const current = clearCountdown();
  if (current === null) return;
  lastOutcome = { action: current.action, at: Date.now(), result: "cancelled", detail: reason };
  recordDebug("info", "power", `${actionLabel(current.action)} cancelled: ${reason}`);
  announce();
}

async function fire(): Promise<void> {
  const current = clearCountdown();
  if (current === null) return;
  const preferences = readPowerPreferences(currentSettings());
  const command = powerCommand(current.action, platform);
  if (command === null) {
    lastOutcome = { action: current.action, at: Date.now(), result: "failed", detail: "This computer has no way to do that." };
    announce();
    return;
  }
  // "Only the next time" disarms before acting, so waking the computer up never finds it armed.
  const next = afterFiring({ ...preferences, action: current.action });
  if (next !== preferences.action) await writeSetting(POWER_SETTING, next).catch(() => undefined);

  if (current.action === "shutdown" || current.action === "hibernate") {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(CHANNELS.powerSaveFiles);
    }
    await new Promise((resolve) => setTimeout(resolve, SAVE_BEFORE_SHUTDOWN_MS));
  }

  lastOutcome = { action: current.action, at: Date.now(), result: "done", detail: "" };
  announce();
  recordDebug("info", "power", `Running ${command.file} for ${actionLabel(current.action)}`);
  execFile(command.file, [...command.args], { windowsHide: true, timeout: 30_000 }, (error) => {
    if (error === null) return;
    lastOutcome = { action: current.action, at: Date.now(), result: "failed", detail: error.message.slice(0, 200) };
    recordDebug("warn", "power", `${actionLabel(current.action)} failed: ${error.message}`);
    announce();
  });
}

/** Do it now, skipping the rest of the countdown. Only while one is running. */
export async function fireNow(): Promise<void> {
  if (countdown !== null) await fire();
}

export async function setPowerPreference(action: unknown, repeat: unknown): Promise<PowerStateView> {
  if (!isPowerAction(action) || !supportedActions(platform).includes(action)) throw new Error("This computer cannot do that.");
  await writeSetting(POWER_SETTING, action);
  if (repeat === "once" || repeat === "always") await writeSetting(POWER_REPEAT_SETTING, repeat);
  if (action === "nothing") cancel("Turned off");
  announce();
  return powerState();
}

export function registerPowerIpc(): void {
  ipcMain.handle(CHANNELS.powerState, () => powerState());
  ipcMain.handle(CHANNELS.powerSet, (_event, action: unknown, repeat: unknown) => setPowerPreference(action, repeat));
  ipcMain.handle(CHANNELS.powerCancel, () => { cancel("Cancelled in ADCode"); return powerState(); });
  ipcMain.handle(CHANNELS.powerNow, async () => { await fireNow(); return powerState(); });
  // Changed in Settings rather than here: a countdown for an action nobody wants any more stops.
  let seen = JSON.stringify(readPowerPreferences(currentSettings()));
  onSettingsChanged((values) => {
    const preferences = readPowerPreferences(values);
    const now = JSON.stringify(preferences);
    if (now === seen) return;
    seen = now;
    if (countdown !== null && preferences.action !== countdown.action) cancel("Changed in Settings");
    else announce();
  });
}
