/**
 * Where the licence documents live, and reading them without ever failing.
 *
 * No Electron import, so this is testable in milliseconds. `licences.ts` supplies the real
 * paths and the real `readFile`.
 */
import { join } from "node:path";
import type { LicenceDocuments } from "../shared/api.ts";

export interface LicencePaths {
  readonly licence: string;
  readonly notice: string;
  readonly thirdParty: string;
}

export interface LicencePathInput {
  /** `app.isPackaged`. */
  readonly packaged: boolean;
  /** `process.resourcesPath`. */
  readonly resourcesPath: string;
  /** `app.getAppPath()`: `apps/desktop` in a source checkout. */
  readonly appPath: string;
}

export function licencePaths(input: LicencePathInput): LicencePaths {
  if (input.packaged) {
    // `extraResources` in electron-builder.yml puts build/licenses here.
    const dir = join(input.resourcesPath, "licenses");
    return {
      licence: join(dir, "LICENSE"),
      notice: join(dir, "NOTICE"),
      thirdParty: join(dir, "THIRD-PARTY-NOTICES.txt"),
    };
  }

  const root = join(input.appPath, "..", "..");
  return {
    licence: join(root, "LICENSE"),
    notice: join(root, "NOTICE"),
    // Only there once `scripts/third-party-notices.mjs` has run.
    thirdParty: join(root, "build", "licenses", "THIRD-PARTY-NOTICES.txt"),
  };
}

export async function readLicences(
  paths: LicencePaths,
  read: (path: string) => Promise<string>,
  packaged: boolean,
): Promise<LicenceDocuments> {
  const one = async (path: string): Promise<string | null> => {
    try {
      return await read(path);
    } catch {
      // A missing file is an answer the window can explain. A rejected IPC call is not.
      return null;
    }
  };

  const [licence, notice, thirdParty] = await Promise.all([
    one(paths.licence),
    one(paths.notice),
    one(paths.thirdParty),
  ]);
  return { licence, notice, thirdParty, packaged };
}
