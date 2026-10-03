/**
 * A new, empty project folder - so "build me X" never starts with "first, find a folder".
 *
 * The first-run checklist used to begin "1 · Open a project folder", which assumes the
 * person already has one. Most people trying an AI editor for the first time do not: they
 * have an idea. This makes the folder for them, in `Documents/ADCode Projects`, named after
 * the idea, and the caller opens it exactly as it opens a recent folder.
 *
 * Nothing is written inside it. The assistant creates the files; an empty folder is the
 * honest starting point, and it means deleting the project is deleting one folder.
 */
import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { app } from "electron";
import { projectFolderName } from "../shared/projectName.ts";

/**
 * The parent folder, shown to the person so they know where their work lives.
 *
 * `ADCODE_PROJECTS_HOME` moves it, for the smoke runs: a check that walks the first run
 * must not leave folders in the Documents of whoever ran it.
 */
export function projectsHome(): string {
  return process.env["ADCODE_PROJECTS_HOME"] ?? join(app.getPath("documents"), "ADCode Projects");
}

/** Creates the folder and returns its absolute path. Never reuses an existing folder. */
export async function createProjectFolder(idea: string): Promise<string> {
  const home = projectsHome();
  await mkdir(home, { recursive: true });

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const taken = new Set(await readdir(home).catch(() => [] as string[]));
    const path = join(home, projectFolderName(idea, taken));
    try {
      // `recursive: false` makes this fail if another window created the same name a moment
      // ago, rather than handing two projects one folder.
      await mkdir(path, { recursive: false });
      return path;
    } catch (error) {
      if ((error as NodeJS.ErrnoException | null)?.code !== "EEXIST") throw error;
    }
  }
  throw new Error("Could not find a free name for the new project folder.");
}
