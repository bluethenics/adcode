/**
 * Help > Open Source Licences: the main-process half.
 *
 * The documents are plain files beside the app, so this is one handler that reads three
 * files. The rules about where they are and what a missing one means live in
 * `licencePaths.ts`.
 */
import { readFile } from "node:fs/promises";
import { app, ipcMain } from "electron";
import { CHANNELS, type LicenceDocuments } from "../shared/api.ts";
import { licencePaths, readLicences } from "./licencePaths.ts";

export function registerLicenceIpc(): void {
  ipcMain.handle(CHANNELS.licencesRead, (): Promise<LicenceDocuments> =>
    readLicences(
      licencePaths({
        packaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
        appPath: app.getAppPath(),
      }),
      (path) => readFile(path, "utf8"),
      app.isPackaged,
    ),
  );
}
