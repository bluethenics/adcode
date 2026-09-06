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
