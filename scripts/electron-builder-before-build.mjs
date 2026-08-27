/**
 * Keep Electron Builder from collecting dependencies through the shared root lockfile.
 *
 * Returning false is Builder's supported signal that node_modules are handled outside
 * its dependency installer/collector. electron-builder.yml then copies the two runtime
 * package trees the bundled desktop application actually needs.
 */
export default async function desktopDependenciesAreStaged() {
  return false;
}
