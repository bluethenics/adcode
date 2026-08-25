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
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { app, ipcMain } from "electron";
import { CHANNELS } from "../shared/api.ts";

interface OnboardingFile {
  completed: boolean;
  at: number;
}

const filePath = (): string => join(app.getPath("userData"), "onboarding.json");

async function read(): Promise<OnboardingFile | null> {
  try {
    const raw = await readFile(filePath(), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    return { completed: (parsed as OnboardingFile).completed === true, at: 0 };
  } catch {
    // Missing on a fresh install, which is exactly when the tour should run.
    return null;
  }
}

export function registerOnboardingIpc(): void {
  ipcMain.handle(CHANNELS.onboardingState, async (): Promise<boolean> => {
    const found = await read();
    return found?.completed ?? false;
  });

  ipcMain.handle(CHANNELS.onboardingComplete, async (): Promise<void> => {
    try {
      const path = filePath();
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify({ completed: true, at: Date.now() }), "utf8");
    } catch {
      // §9: the worst permitted outcome is that a feature quietly does nothing. Here that
      // means the tour offers itself again next launch, which is survivable; throwing
      // would take out the click that dismissed it.
    }
  });
}
