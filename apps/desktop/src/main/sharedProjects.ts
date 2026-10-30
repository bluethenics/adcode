import { app, BrowserWindow, ipcMain } from "electron";
import { basename, dirname, join } from "node:path";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { CHANNELS, type SharedProjectView } from "../shared/api.ts";
import { createBackendTokens } from "./backend.ts";
import { DiskFileStore, FetchHttpTransport, SystemClock } from "./adPorts.ts";
import { currentWorkspace, openWorkspaceAt } from "./workspace.ts";
import { scan, applyFiles, mergeFiles, type Files } from "./sharedProjectFiles.ts";
import { recordMilestone } from "./milestones.ts";
import { sharedProjectAccountKey } from "./sharedProjectIdentity.ts";

type Snapshot = SharedProjectView & { files: Files };
type Local = { id: string; root: string; revision: number; files: Files };
const ORIGIN = "https://collab.bluethenics.com";
let busy: Promise<unknown> = Promise.resolve();
let syncError: string | null = null;
const trackedRoots = new Set<string>();
const serial = <T>(work: () => Promise<T>): Promise<T> => { const next = busy.then(work, work); busy = next.catch(() => undefined); return next; };
const baseDir = () => join(app.getPath("userData"), "shared-projects");
async function identity(): Promise<{ token: string; uid: string }> {
  const tokens = createBackendTokens({ clock: new SystemClock(), http: new FetchHttpTransport([]), store: new DiskFileStore(join(app.getPath("userData"), "ads")) });
  const token = await tokens.getToken();
  if (!token.ok) throw Error("Sign in to use shared projects.");
  // Used only to separate local caches. The server independently verifies every request.
  const uid = sharedProjectAccountKey(token.value);
  if (!uid) throw Error("Sign in to use online projects.");
  return { token: token.value, uid };
}
async function request<T>(auth: { token: string }, path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(ORIGIN + path, { method, headers: { authorization: `Bearer ${auth.token}`, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(45_000) });
  const value = await response.json() as T & { error?: string };
  if (!response.ok) throw Error(value.error ?? "Shared project is unavailable. Your local files are safe.");
  return value;
}
const statePath = (uid: string) => join(baseDir(), uid, "state.json");
export function flushSharedProject(): Promise<void> | null {
  const root = currentWorkspace()?.root;
  if (!root || !trackedRoots.has(root)) return null;
  return serial(async () => {
    const auth = await identity(), all = await states(auth.uid), local = all.find(item => item.root === root);
    if (local) await sync(auth, local, all);
  });
}
async function states(uid: string): Promise<Local[]> {
  try { const value = JSON.parse(await readFile(statePath(uid), "utf8")) as Local[]; for (const item of value) trackedRoots.add(item.root); return value; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw Error("Shared project cache could not be read. Your local files were kept."); }
}
async function saveStates(uid: string, value: Local[]): Promise<void> {
  const path = statePath(uid); for (const item of value) trackedRoots.add(item.root); await mkdir(dirname(path), { recursive: true });
  await writeFile(path + ".tmp", JSON.stringify(value)); await rename(path + ".tmp", path);
}
async function sync(auth: { token: string; uid: string }, local: Local, all: Local[], resolution?: "local" | "online"): Promise<void> {
  const info = await request<SharedProjectView>(auth, `/projects/${local.id}`);
  const remote = info.revision === local.revision ? { ...info, files: local.files } : await request<Snapshot>(auth, `/projects/${local.id}/files`);
  const disk = await scan(local.root);
  const { files: merged, conflicts, backups } = mergeFiles(local.files, disk, remote.files, resolution);
  for (const backup of backups) for (const side of ["local", "online"] as const) {
    const content = backup[side]; if (content === undefined) continue;
    const path = join(baseDir(), auth.uid, "conflicts", local.id, String(Date.now()), side, ...backup.path.split("/"));
    await mkdir(dirname(path), { recursive: true }); await writeFile(path, Buffer.from(content, "base64"));
  }
  if (conflicts.length) throw Error(`Sync paused: both you and a friend edited ${conflicts.slice(0, 3).join(", ")}. Choose which version to keep. Both versions will be backed up.`);
  const changed = Object.keys(merged).length !== Object.keys(remote.files).length || Object.keys(merged).some(path => merged[path] !== remote.files[path]);
  // Publish first with a revision check; never apply stale remote files after a failed upload.
  const saved = changed ? await request<SharedProjectView>(auth, `/projects/${local.id}/files`, "PUT", { revision: remote.revision, files: merged }) : remote;
  await applyFiles(local.root, disk, merged);
  local.files = merged; local.revision = saved.revision; await saveStates(auth.uid, all); syncError = null;
}
export function registerSharedProjects(): void {
  ipcMain.handle(CHANNELS.sharedProjects, (_event, operation: unknown, input: unknown) => serial(async () => {
    if (typeof operation !== "string" || !["list", "publish", "join", "open", "sync", "delete", "rotate", "remove"].includes(operation)) throw Error("Invalid project action.");
    let auth: Awaited<ReturnType<typeof identity>>;
    try { auth = await identity(); }
    catch (error) {
      if (operation === "list") return { owned: [], joined: [], current: null, syncError: "Sign in to use online projects." };
      throw error;
    }
    const all = await states(auth.uid);
    const data = typeof input === "object" && input !== null ? input as Record<string, unknown> : {};
    if (operation === "publish") {
      const root = currentWorkspace()?.root;
      if (!root) throw Error("Create or open a project first.");
      const existing = all.find(item => item.root === root);
      if (existing) return request<SharedProjectView>(auth, `/projects/${existing.id}`);
      const files = await scan(root);
      const created = await request<SharedProjectView>(auth, "/projects", "POST", { name: basename(root).slice(0, 100) });
      try {
        const saved = await request<SharedProjectView>(auth, `/projects/${created.id}/files`, "PUT", { revision: created.revision, files });
        all.push({ id: saved.id, root, revision: saved.revision, files }); await saveStates(auth.uid, all); recordMilestone("collab_hosted"); return saved;
      } catch (error) { await request(auth, `/projects/${created.id}/delete`, "POST").catch(() => undefined); throw error; }
    }
    if (operation === "join") {
      const match = /^adproject:([a-f0-9-]{36}):([a-f0-9]{32})$/.exec(String(data["code"] ?? "").trim());
      if (!match) throw Error("Paste a shared project invite starting with adproject:.");
      await request(auth, `/projects/${match[1]}/join`, "POST", { key: match[2] });
      recordMilestone("collab_joined");
      data["id"] = match[1]; operation = "open";
    }
    if (operation === "list") {
      const projects = await request<{ owned: SharedProjectView[]; joined: SharedProjectView[] }>(auth, "/projects");
      const active = all.find(item => item.root === currentWorkspace()?.root);
      const current = active ? await request<SharedProjectView>(auth, `/projects/${active.id}`).catch(() => null) : null;
      return { ...projects, current, syncError };
    }
    const id = String(data["id"] ?? ""); if (!/^[a-f0-9-]{36}$/.test(id)) throw Error("Invalid project.");
    if (operation === "rotate" || operation === "remove") return request(auth, `/projects/${id}/members`, "POST", operation === "rotate" ? { rotate: true } : { remove: String(data["uid"] ?? "") });
    if (operation === "delete") { await request(auth, `/projects/${id}/delete`, "POST"); const old = all.find(item => item.id === id); if (old) trackedRoots.delete(old.root); await saveStates(auth.uid, all.filter(item => item.id !== id)); syncError = null; return { ok: true }; }
    let local = all.find(item => item.id === id);
    if (!local) {
      const remote = await request<Snapshot>(auth, `/projects/${id}/files`);
      const root = join(baseDir(), auth.uid, "projects", id, "Project - " + remote.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").replace(/[. ]+$/, "").slice(0, 70));
      await mkdir(root, { recursive: true });
      await applyFiles(root, {}, remote.files);
      local = { id, root, revision: remote.revision, files: remote.files }; all.push(local); await saveStates(auth.uid, all);
    }
    const resolution = data["resolution"] === "local" || data["resolution"] === "online" ? data["resolution"] : undefined;
    if (operation === "open") {
      const opened = openWorkspaceAt(local.root);
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send(CHANNELS.workspaceChanged, opened);
    }
    try { await sync(auth, local, all, resolution); }
    catch (error) { syncError = error instanceof Error ? error.message : "Project sync paused."; throw error; }
    return request<SharedProjectView>(auth, `/projects/${id}`);
  }));
  void readdir(baseDir(), { withFileTypes: true }).then(async entries => {
    for (const item of entries) if (item.isDirectory() && /^[a-f0-9]+$/.test(item.name)) await states(item.name).catch(() => undefined);
  }).catch(() => undefined);
  let tickPending = false;
  const timer = setInterval(() => {
    if (tickPending) return;
    tickPending = true;
    void serial(async () => {
      if (!trackedRoots.has(currentWorkspace()?.root ?? "")) return;
      const auth = await identity(); const all = await states(auth.uid), local = all.find(item => item.root === currentWorkspace()?.root);
      if (local) await sync(auth, local, all);
    }).catch(error => {
      const message = error instanceof Error ? error.message : "Project sync paused.";
      if (message !== syncError) { syncError = message; recordMilestone("collab_failed"); for (const window of BrowserWindow.getAllWindows()) window.webContents.send(CHANNELS.collabNotice, message); }
    }).finally(() => { tickPending = false; });
  }, 5000); timer.unref();
}
