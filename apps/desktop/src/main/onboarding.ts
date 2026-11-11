/**
 * Whether this machine has been welcomed yet.
 *
 * One boolean, in its own file in `userData`, following the same shape `releases.ts` uses
 * for "which versions has this person already been told about". A settings entry would
 * have been the other option and is worse: every setting appears as a row in the Settings
 * sheet, every setting needs a help entry or the build fails, and "onboarding completed"
 * is not a preference anybody wants to find in a list next to their font size.
 *
 * Failing to read it is treated as "already welcomed", not as "welcome them again". A
 * disk error on first paint should not produce a modal over an editor somebody is already
 * using, and the cost of that choice is one missed tour rather than a recurring one.
 */
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { app, ipcMain } from "electron";
import { CHANNELS } from "../shared/api.ts";

interface OnboardingFile {
  completed: boolean;
  at: number;
  /** Which welcome tour this person last saw. Absent in records written before the tour existed. */
  tour: number;
}

/**
 * The welcome tour's edition. Raising it shows the tour once more to everybody who was
 * already welcomed - used for 2.6, whose tour sets up things that did not exist before.
 */
export const WELCOME_TOUR = 2;

/** Who the tour is for right now. Pure, so the three cases are tested rather than observed. */
export function tourAudience(file: { readonly completed: boolean; readonly tour: number } | null): "new" | "returning" | "done" {
  if (file === null || !file.completed) return "new";
  return file.tour < WELCOME_TOUR ? "returning" : "done";
}

const filePath = (): string => join(app.getPath("userData"), "onboarding.json");

async function read(): Promise<OnboardingFile | null> {
  try {
    const raw = await readFile(filePath(), "utf8");
    const parsed: unknown = JSON.parse(raw);
    // Unreadable means "already welcomed, tour seen": a damaged record never costs anybody a modal.
    if (typeof parsed !== "object" || parsed === null || typeof (parsed as OnboardingFile).completed !== "boolean") return { completed: true, at: 0, tour: WELCOME_TOUR };
    const tour = (parsed as { tour?: unknown }).tour;
    return { completed: (parsed as OnboardingFile).completed === true, at: 0, tour: typeof tour === "number" && Number.isFinite(tour) ? tour : 1 };
  } catch (error) {
    // Only a missing file identifies a fresh install. An unreadable existing welcome
    // record should not make a returning user repeat setup.
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? null : { completed: true, at: 0, tour: WELCOME_TOUR };
  }
}

export function registerOnboardingIpc(): void {
  let completedThisSession = false;
  ipcMain.handle(CHANNELS.onboardingState, async (): Promise<boolean> => {
    if (completedThisSession) return true;
    const found = await read();
    return found?.completed ?? false;
  });

  ipcMain.handle(CHANNELS.onboardingTour, async (): Promise<"new" | "returning" | "done"> => {
    if (completedThisSession) return "done";
    return tourAudience(await read());
  });

  ipcMain.handle(CHANNELS.onboardingComplete, async (): Promise<void> => {
    completedThisSession = true;
    try {
      const path = filePath();
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.tmp`;
      await writeFile(temporary, JSON.stringify({ completed: true, at: Date.now(), tour: WELCOME_TOUR }), "utf8");
      await rename(temporary, path);
    } catch {
      // Retain completion for this session even if the disk cannot be written.
    }
  });
}
