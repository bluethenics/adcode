/** `node:fs/promises` in the browser host: the synchronous operations in vfs.ts, settled as promises. */
import * as vfs from "./vfs.ts";

const later = <A extends unknown[], T>(run: (...args: A) => T) => async (...args: A): Promise<T> => run(...args);

export const constants = { F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1, COPYFILE_EXCL: 1 };
export const readFile = later(vfs.readFileSync);
export const writeFile = later(vfs.writeFileSync);
export const appendFile = later(vfs.appendFileSync);
export const mkdir = later(vfs.mkdirSync);
export const mkdtemp = later(vfs.mkdtempSync);
export const readdir = later(vfs.readdirSync) as {
  (path: string, options: { withFileTypes: true }): Promise<vfs.Dirent[]>;
  (path: string, options?: unknown): Promise<string[]>;
};
export const stat = later((path: string) => vfs.statSync(path) as vfs.Stats);
export const lstat = stat;
export const rm = later(vfs.rmSync);
export const rmdir = later(vfs.rmdirSync);
export const unlink = later(vfs.unlinkSync);
export const rename = later(vfs.renameSync);
export const copyFile = later(vfs.copyFileSync);
export const access = later(vfs.accessSync);
export const realpath = later(vfs.realpathSync);
export const chmod = async (): Promise<void> => {};
export const utimes = async (): Promise<void> => {};
export async function cp(from: string, to: string, options?: { recursive?: boolean }): Promise<void> {
  const source = vfs.normalizePath(from);
  const target = vfs.normalizePath(to);
  if (vfs.statSync(source)?.isFile() === true) return vfs.copyFileSync(source, target);
  if (options?.recursive !== true) throw vfs.fsError("EISDIR", "cp", source);
  vfs.mkdirSync(target, { recursive: true });
  for (const file of vfs.listFiles(source)) {
    const destination = target + file.slice(source.length);
    vfs.mkdirSync(vfs.dirnameOf(destination), { recursive: true });
    vfs.copyFileSync(file, destination);
  }
}
export async function open(path: string): Promise<never> {
  throw vfs.fsError("ENOSYS", "open", vfs.normalizePath(path));
}

export const promises = { constants, readFile, writeFile, appendFile, mkdir, mkdtemp, readdir, stat, lstat, rm, rmdir, unlink, rename, copyFile, access, realpath, chmod, utimes, cp, open };
export default promises;
