import { dirname, join, relative, resolve } from "node:path";
import { lstat, mkdir, readFile, readdir, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import ignore from "ignore";
import { isInsideWorkspace } from "./pathSafety.ts";
export type Files = Record<string, string>;
const valueAt = (files: Files, path: string): string | undefined => Object.hasOwn(files, path) ? files[path] : undefined;
export function mergeFiles(base: Files, disk: Files, remote: Files, resolution?: "local" | "online"): { files: Files; conflicts: string[]; backups: { path: string; local?: string; online?: string }[] } {
  const files: Files = Object.create(null) as Files, conflicts: string[] = [], backups: { path: string; local?: string; online?: string }[] = [];
  for (const path of new Set([...Object.keys(base), ...Object.keys(disk), ...Object.keys(remote)])) {
    const previous = valueAt(base, path), mine = valueAt(disk, path), online = valueAt(remote, path);
    let result = mine === previous ? online : online === previous || mine === online ? mine : undefined;
    if (mine !== previous && online !== previous && mine !== online) {
      if (!resolution) { conflicts.push(path); continue; }
      backups.push({ path, ...(mine === undefined ? {} : { local: mine }), ...(online === undefined ? {} : { online }) });
      result = resolution === "local" ? mine : online;
    }
    if (result !== undefined) files[path] = result;
  }
  return { files, conflicts, backups };
}
const excluded = /^(?:\.git|\.adcode.*|.*\.adcode-sync-.*|\.worktrees|\.open-next|\.wrangler|target|\.env(?:\..*)?|\.ssh|\.aws|\.npmrc|\.pypirc|node_modules|dist|build|out|output|release|coverage|\.next|\.venv|venv|\.cache|credentials.*|.*\.(?:pem|key|p12|pfx))$/i;
const pathOK = (path: string): boolean => path.length > 0 && path.length <= 500 && !/[\\:\x00-\x1f]/.test(path) && path.split("/").every(p => p && p !== "." && p !== ".." && !/[. ]$/.test(p) && !/^(?:con|prn|aux|nul|com\d|lpt\d)(?:\.|$)/i.test(p) && !excluded.test(p));
export async function scan(root: string): Promise<Files> {
  const files: Files = Object.create(null) as Files; let size = 0;
  if ((await lstat(root)).isSymbolicLink()) throw Error("Choose a project folder, not a link.");
  const walk = async (dir: string, parents: { root: string; rules: ReturnType<typeof ignore> }[]): Promise<void> => {
    let rules = parents;
    try {
      const path = join(dir, ".gitignore");
      if (!(await lstat(path)).isSymbolicLink()) rules = [...parents, { root: dir, rules: ignore().add(await readFile(path, "utf8")) }];
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    for (const item of await readdir(dir, { withFileTypes: true })) {
      if (excluded.test(item.name) || item.isSymbolicLink()) continue;
      const absolute = join(dir, item.name), name = relative(root, absolute).replaceAll("\\", "/");
      if (!pathOK(name)) continue;
      if (rules.some(layer => layer.rules.ignores(relative(layer.root, absolute).replaceAll("\\", "/") + (item.isDirectory() ? "/" : "")))) continue;
      if (item.isDirectory()) { await walk(absolute, rules); continue; }
      if (!item.isFile()) continue;
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) continue;
      if (info.size > 1024 * 1024) throw Error(`Sharing supports files up to 1 MB. Move ${name} out of this project before sharing.`);
      await safeTarget(root, name);
      const data = (await readFile(absolute)).toString("base64");
      size += data.length; if (size > 16 * 1024 * 1024 || Object.keys(files).length >= 4000) throw Error("Sharing supports up to 4,000 files and 16 MB. Generated files and private configuration are excluded.");
      files[name] = data;
    }
  };
  await walk(root, []); return files;
}
async function safeTarget(root: string, path: string): Promise<string> {
  if (!pathOK(path)) throw Error("The online project contains an unsafe path.");
  const target = resolve(root, path);
  if (!isInsideWorkspace(root, target)) throw Error("Invalid project path.");
  let current = root;
  for (const part of ["", ...path.split("/")]) {
    current = join(current, part);
    try { if ((await lstat(current)).isSymbolicLink()) throw Error("A link blocks synchronization. Local files were kept."); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  return target;
}
export async function applyFiles(root: string, before: Files, after: Files): Promise<void> {
  const paths = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort((a, b) => Number(valueAt(after, a) !== undefined) - Number(valueAt(after, b) !== undefined) || b.length - a.length);
  for (const path of paths) {
    const previous = valueAt(before, path), next = valueAt(after, path);
    if (previous === next) continue;
    const target = await safeTarget(root, path);
    let current: string | undefined;
    try { current = (await readFile(target)).toString("base64"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (current !== previous && current !== next) throw Error(`A file changed while syncing: ${path}. Sync again after saving.`);
    if (next === undefined) {
      await unlink(target).catch(error => { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; });
      let parent = dirname(target);
      while (parent !== root && isInsideWorkspace(root, parent)) {
        try { await rmdir(parent); } catch { break; }
        parent = dirname(parent);
      }
      continue;
    }
    await mkdir(dirname(target), { recursive: true });
    const temporary = target + ".adcode-sync-" + crypto.randomUUID();
    await writeFile(temporary, Buffer.from(next, "base64"), { flag: "wx" }); await rename(temporary, target);
  }
}
