/**
 * The Microsoft Store rating ask, wired to Electron. The rule is `shared/ratingAsk.ts`.
 *
 * Each launch records the day. A couple of minutes in - never at launch, when the person
 * is trying to get to work - the rule is checked once, and if it says ask, one editor window
 * shows a card. Marked asked when it is offered, so it is never offered twice.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { app, BrowserWindow, ipcMain, shell } from "electron";
import { CHANNELS } from "../shared/api.ts";
import { recordActiveDay, shouldAskForRating, STORE_REVIEW_URL } from "../shared/ratingAsk.ts";
import { isAgentBrowserWindow } from "./agentBrowser.ts";
import { firstValueAt } from "./milestones.ts";

const CHECK_AFTER_MS = 2 * 60_000;

interface RatingFile {
  activeDays: string[];
  asked: boolean;
}

const filePath = (): string => join(app.getPath("userData"), "rating.json");

async function load(): Promise<RatingFile> {
  try {
    const parsed = JSON.parse(await readFile(filePath(), "utf8")) as Partial<RatingFile>;
    return {
      activeDays: Array.isArray(parsed.activeDays) ? parsed.activeDays.filter((d): d is string => typeof d === "string") : [],
      asked: parsed.asked === true,
    };
  } catch {
    return { activeDays: [], asked: false };
  }
}

async function save(file: RatingFile): Promise<void> {
  try {
    await mkdir(dirname(filePath()), { recursive: true });
    await writeFile(filePath(), JSON.stringify(file), "utf8");
  } catch {
    // Unsaved costs at most one day's count.
  }
}

async function check(): Promise<void> {
  const file = await load();
  const ask = shouldAskForRating({
    // Set by Electron in an MSIX package from the Microsoft Store, and only there.
    fromStore: process.windowsStore === true,
    activeDays: file.activeDays,
    firstValueAt: await firstValueAt(),
    asked: file.asked,
  });
  if (!ask) return;
  const target = BrowserWindow.getAllWindows().find((window) => !window.isDestroyed() && !isAgentBrowserWindow(window));
  if (target === undefined) return;
  await save({ ...file, asked: true });
  target.webContents.send(CHANNELS.ratingAsk);
}

export function registerRatingIpc(): void {
  ipcMain.handle(CHANNELS.ratingOpen, () => shell.openExternal(STORE_REVIEW_URL));
  void (async () => {
    const file = await load();
    await save({ ...file, activeDays: recordActiveDay(file.activeDays, new Date().toISOString().slice(0, 10)) });
  })();
  setTimeout(() => void check().catch(() => undefined), CHECK_AFTER_MS).unref?.();
}
