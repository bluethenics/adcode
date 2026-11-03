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
}

const filePath = (): string => join(app.getPath("userData"), "onboarding.json");

async function read(): Promise<OnboardingFile | null> {
  try {
    const raw = await readFile(filePath(), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || typeof (parsed as OnboardingFile).completed !== "boolean") return { completed: true, at: 0 };
    return { completed: (parsed as OnboardingFile).completed === true, at: 0 };
  } catch (error) {
    // Only a missing file identifies a fresh install. An unreadable existing welcome
    // record should not make a returning user repeat setup.
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? null : { completed: true, at: 0 };
  }
}

export function registerOnboardingIpc(): void {
  let completedThisSession = false;
  ipcMain.handle(CHANNELS.onboardingState, async (): Promise<boolean> => {
    if (completedThisSession) return true;
    const found = await read();
    return found?.completed ?? false;
  });

  ipcMain.handle(CHANNELS.onboardingComplete, async (): Promise<void> => {
    completedThisSession = true;
    try {
      const path = filePath();
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.tmp`;
      await writeFile(temporary, JSON.stringify({ completed: true, at: Date.now() }), "utf8");
      await rename(temporary, path);
    } catch {
      // Retain completion for this session even if the disk cannot be written.
    }
  });
}
