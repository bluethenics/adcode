/**
 * Whether this build is allowed to update itself.
 *
 * Separate from `autoUpdate.ts` because that file imports Electron, and the interesting
 * part here is a decision with four inputs and one dangerous wrong answer: an installer
 * downloading a second copy of the app underneath a package manager that already owns it.
 *
 * Pure, so the cases can be enumerated rather than reproduced by installing three builds.
 */

export interface UpdateEnvironment {
  /** `app.isPackaged`. A dev run has no feed at all. */
  readonly packaged: boolean;
  /** `ADCODE_DISABLE_UPDATES=1`, the escape hatch for anyone repackaging ADCode. */
  readonly disabled: boolean;
  /**
   * `process.windowsStore` - Electron sets this inside an MSIX/AppX container.
   *
   * The Microsoft Store build is the reason this file exists. A Store app is updated by
   * the Store, and its install directory is read-only and virtualised, so electron-updater
   * cannot write there even if it wanted to. Left alone it would download every release
   * forever and fail to apply any of them - burning the user's bandwidth on a loop that
   * cannot terminate.
   */
  readonly windowsStore: boolean;
}

/**
 * True only when ADCode both can and should replace itself.
 *
 * The order is deliberate: unpackaged first because it is the common case while
 * developing, then the explicit opt-out, then the Store. Each one is a hard no.
 */
export function canSelfUpdate(environment: UpdateEnvironment): boolean {
  if (!environment.packaged) return false;
  if (environment.disabled) return false;
  if (environment.windowsStore) return false;
  return true;
}

/**
 * Read the Store flag off `process` without lying to TypeScript about it.
 *
 * `process.windowsStore` is Electron's, not Node's, so it is absent from the platform
 * types and absent at runtime everywhere except inside an AppX container - where it is
 * `true`. Anything else, including `undefined`, means this is not a Store build.
 */
export function runningFromWindowsStore(candidate: NodeJS.Process = process): boolean {
  return (candidate as NodeJS.Process & { windowsStore?: boolean }).windowsStore === true;
}

/**
 * Whether a cached blockmap describes the installer sitting beside it.
 *
 * electron-updater 6.8 reads the "old" blockmap for a differential download from its cache
 * (`current.blockmap`) before trying the release. The NSIS installer rewrites
 * `installer.exe` on every install but never that file, so after a manual install - or an
 * update that downloaded and was never applied - the two describe different builds, the
 * rebuilt installer fails its checksum, and every update falls back to the full download.
 * A blockmap's block sizes add up to the exact byte size of the file it maps, which makes
 * the mismatch cheap to see.
 */
export function blockMapFitsInstaller(blockMap: unknown, installerBytes: number): boolean {
  if (!Number.isInteger(installerBytes) || installerBytes <= 0) return false;
  if (typeof blockMap !== "object" || blockMap === null) return false;
  const files = (blockMap as { files?: unknown }).files;
  if (!Array.isArray(files) || files.length === 0) return false;

  let total = 0;
  for (const file of files) {
    const sizes = (file as { sizes?: unknown } | null)?.sizes;
    if (!Array.isArray(sizes)) return false;
    for (const size of sizes) {
      if (typeof size !== "number" || !Number.isInteger(size) || size < 0) return false;
      total += size;
    }
  }
  return total === installerBytes;
}
