/**
 * The community hub, main-process side: talking to the directory, installing plugins on
 * disk, and turning the open project into an artifact - or an artifact into a project.
 *
 * Installed plugins live in `~/.adcode/plugins/community-<id>/`, beside plugins installed
 * from Claude Code, so their skills are found by the same skill discovery the assistant
 * already uses (`assistantSkills.ts`). The folder holds the manifest, one SKILL.md per
 * skill, and `.state.json`: whether it is on, and the setting values it replaced, so
 * turning it off puts them back.
 *
 * A project linked to an artifact keeps `.adcode/remix.json` and `.adcode/remix-base.json`:
 * which artifact and version it is linked to, and that version's files. `.adcode` is never
 * published, so neither file ever leaves the machine.
 */
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { app, BrowserWindow, ipcMain } from "electron";
import {
  ARTIFACT_LIMITS, PLUGIN_FILE, REMIX_BASE, REMIX_RECORD, STARTER_PLUGINS, applyChanges, artifactFileVerdict, artifactFolderAllowed,
  changeStats, checkSnapshot, compareVersions, diffSnapshots, findSecrets, gitignoreMatcher, isSafeArtifactPath, notAProjectReason,
  fillOptions, optionDisplay, optionValues, parsePluginManifest, parseRemixRecord, remixFolderName, skillMarkdown, type ArtifactFile, type ArtifactSnapshot, type PluginAddon,
  type PluginManifest, type RemixRecord,
} from "@adcode/community";
import { CHANNELS } from "../shared/api.ts";
import type { ArtifactPreview, InstalledPluginView, ProjectLinkView, PublishArtifactInput } from "../shared/community.ts";
import { SLASH_COMMANDS, setPluginSlashCommands } from "../shared/slashCommands.ts";
import { backendAccount } from "./backend.ts";
import { DiskFileStore, FetchHttpTransport, SystemClock } from "./adPorts.ts";
import { projectsHome } from "./newProject.ts";
import { currentSettings, writeSetting } from "./settings.ts";
import { currentWorkspace } from "./workspace.ts";

const BUILT_IN_SLASH = SLASH_COMMANDS.map((command) => command.id);
export const communityOrigin = (): string => process.env["ADCODE_COMMUNITY_ORIGIN"] ?? process.env["ADCODE_COLLAB_ORIGIN"] ?? "https://projects.bluethenics.com";

function account() {
  return backendAccount({ clock: new SystemClock(), http: new FetchHttpTransport([]), store: new DiskFileStore(join(app.getPath("userData"), "ads")) });
}
async function token(required: boolean): Promise<string | null> {
  const result = await account()?.getToken().catch(() => null);
  if (result?.ok) return result.value;
  if (required) throw new Error("Sign in to ADCode to do this. Use the account button, then try again.");
  return null;
}
async function displayName(): Promise<string> {
  const profile = await account()?.profile().catch(() => null);
  const value = profile?.ok && profile.value ? profile.value.displayName ?? profile.value.email?.split("@")[0] ?? "ADCode builder" : "ADCode builder";
  return value.slice(0, 64);
}

async function request<T>(path: string, body?: unknown, auth: "optional" | "required" = body === undefined ? "optional" : "required"): Promise<T> {
  const bearer = await token(auth === "required");
  let response: Response;
  try {
    response = await fetch(communityOrigin() + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(body === undefined ? 15_000 : 60_000),
    });
  } catch {
    throw new Error("Could not reach the ADCode community. Check your connection and try again.");
  }
  let result: T & { error?: string };
  try { result = await response.json() as typeof result; } catch { throw new Error("The community service is being updated. Please try again shortly."); }
  if (!response.ok) throw new Error(result.error ?? "The community service could not do that.");
  return result;
}

/* ---------- installed plugins ---------- */

interface PluginState {
  enabled: boolean;
  source: "directory" | "local" | "starter";
  installedAt: number;
  update: string | null;
  /** Setting values this plugin replaced, keyed by setting id. */
  previous: Record<string, boolean | string>;
  /** The plugin's own options as the person set them; read through optionValues. */
  options: Record<string, unknown>;
  /** Kept at this version: no update is offered until the person lets it go. */
  pinned: boolean;
}

const pluginsRoot = (): string => process.env["ADCODE_PLUGINS_HOME"] ?? join(homedir(), ".adcode", "plugins");
const folderFor = (id: string): string => join(pluginsRoot(), `community-${id}`);

async function readInstalled(): Promise<{ manifest: PluginManifest; state: PluginState }[]> {
  const found: { manifest: PluginManifest; state: PluginState }[] = [];
  for (const entry of await readdir(pluginsRoot(), { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !entry.name.startsWith("community-")) continue;
    const folder = join(pluginsRoot(), entry.name);
    try {
      const manifest = parsePluginManifest(await readFile(join(folder, PLUGIN_FILE), "utf8"), BUILT_IN_SLASH);
      let state: PluginState = { enabled: true, source: "directory", installedAt: 0, update: null, previous: {}, options: {}, pinned: false };
      try { state = { ...state, ...JSON.parse(await readFile(join(folder, ".state.json"), "utf8")) as Partial<PluginState> }; } catch { /* A missing state file means on, with nothing to restore. */ }
      found.push({ manifest, state });
    } catch {
      // A plugin this version cannot read is left on disk and ignored, never half-applied.
    }
  }
  return found.sort((a, b) => b.state.installedAt - a.state.installedAt);
}

const view = ({ manifest, state }: { manifest: PluginManifest; state: PluginState }): InstalledPluginView =>
  ({ manifest, enabled: state.enabled, source: state.source, installedAt: state.installedAt, update: state.pinned ? null : state.update, options: optionValues(manifest.options, state.options), pinned: state.pinned });

/**
 * Progress for anything that downloads or writes: an install, a remix, a pull. The window
 * draws it; `total` 0 means the length is not known yet (an indeterminate bar).
 */
function progress(key: string, phase: "download" | "install" | "write" | "done" | "failed", done = 0, total = 0): void {
  for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send(CHANNELS.communityProgress, { key, phase, done, total });
}

async function saveState(id: string, state: PluginState): Promise<void> {
  const target = join(folderFor(id), ".state.json");
  await writeFile(`${target}.tmp`, JSON.stringify(state, null, 2));
  await rename(`${target}.tmp`, target);
}

/** Put a plugin's setting preset in place, remembering what it replaced. */
async function applySettings(manifest: PluginManifest, state: PluginState): Promise<void> {
  const current = currentSettings();
  for (const [id, value] of Object.entries(manifest.contributes.settings)) {
    if (!(id in state.previous) && current[id] !== undefined) state.previous[id] = current[id]!;
    if (current[id] !== value) await writeSetting(id, value);
  }
}

/** Put back what a preset replaced - unless the person has changed that setting since. */
async function restoreSettings(manifest: PluginManifest, state: PluginState): Promise<void> {
  const current = currentSettings();
  for (const [id, previous] of Object.entries(state.previous)) {
    if (current[id] === manifest.contributes.settings[id]) await writeSetting(id, previous);
  }
  state.previous = {};
}

async function writePlugin(manifest: PluginManifest, source: PluginState["source"], pinned = false, key = `install:${manifest.id}`): Promise<void> {
  const folder = folderFor(manifest.id);
  const existing = (await readInstalled()).find((one) => one.manifest.id === manifest.id);
  if (existing?.state.enabled) await restoreSettings(existing.manifest, existing.state);
  // Replace the folder whole: an update that drops a skill must drop its SKILL.md too.
  await rm(folder, { recursive: true, force: true });
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, PLUGIN_FILE), JSON.stringify(manifest, null, 2));
  const total = manifest.contributes.skills.length + 2;
  progress(key, "install", 1, total);
  for (const [index, skill] of manifest.contributes.skills.entries()) {
    await mkdir(join(folder, "skills", skill.name), { recursive: true });
    await writeFile(join(folder, "skills", skill.name, "SKILL.md"), skillMarkdown(skill, manifest.name));
    progress(key, "install", index + 2, total);
  }
  // Options carry over an update or a version change; values a new version no longer has fall away when read.
  const state: PluginState = { enabled: true, source, installedAt: existing?.state.installedAt || Date.now(), update: null, previous: existing?.state.previous ?? {}, options: existing?.state.options ?? {}, pinned };
  await applySettings(manifest, state);
  await saveState(manifest.id, state);
  progress(key, "done", total, total);
}

/** The plugins ADCode ships, by id. Valid by construction: the package's tests parse every one. */
const STARTERS = new Map(STARTER_PLUGINS.map((starter) => { const manifest = parsePluginManifest(starter, BUILT_IN_SLASH); return [manifest.id, manifest] as const; }));

/** An enabled plugin's add-on, for the add-on protocol. Read fresh: turning a plugin off stops serving it. */
export async function installedAddon(pluginId: string, addonId: string): Promise<PluginAddon | null> {
  const found = (await readInstalled()).find((one) => one.manifest.id === pluginId && one.state.enabled);
  return found?.manifest.contributes.addons.find((addon) => addon.id === addonId) ?? null;
}

/** Recompute the composer's plugin commands and tell every window what is installed. */
async function publishInstalled(): Promise<InstalledPluginView[]> {
  const installed = await readInstalled();
  setPluginSlashCommands(installed.filter((one) => one.state.enabled).flatMap((one) => {
    const display = optionDisplay(one.manifest.options, optionValues(one.manifest.options, one.state.options));
    return one.manifest.contributes.slashCommands.map((command) => ({ ...command, prompt: fillOptions(command.prompt, display) }));
  }));
  const views = installed.map(view);
  for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send(CHANNELS.communityPluginsChanged, views);
  return views;
}

const pluginId = (value: unknown): string => {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/.test(value)) throw new Error("Choose a plugin.");
  return value;
};
const artifactId = (value: unknown): string => {
  if (typeof value !== "string" || !/^[a-z0-9]{12,40}$/.test(value)) throw new Error("Choose an artifact.");
  return value;
};
const improvementId = artifactId;
const short = (value: unknown, label: string, max: number, min = 0): string => {
  if (typeof value !== "string" || value.trim().length < min || value.length > max) throw new Error(`${label} must be ${min ? `${min}–` : "up to "}${max} characters.`);
  return value.trim();
};

/* ---------- projects and artifacts ---------- */

function workspaceRoot(): string {
  const root = currentWorkspace()?.root;
  if (!root) throw new Error("Open a project folder first.");
  return root;
}

const REASONS: Record<string, string> = { ignored: "files your .gitignore leaves out", hidden: "hidden folders like .local and .config", excluded: "files you chose to leave out", folder: "generated or installed folders", private: "private files like .env and keys", binary: "images, fonts and other binary files", large: "files over 200 KB", lockfile: "lockfiles (a remix reinstalls)", path: "unusual file names", unreadable: "files that are not text" };

/**
 * Every text file of a project that may be shared, plus counts of what was left out and why.
 *
 * Follows the project's .gitignore, skips hidden folders, and stops one file past the limit:
 * `truncated` then means "more than the limit", never a made-up exact count.
 */
async function collectFiles(root: string, exclude: ReadonlySet<string> = new Set()): Promise<{ files: ArtifactFile[]; skipped: Map<string, number>; truncated: boolean }> {
  const files: ArtifactFile[] = [];
  const skipped = new Map<string, number>();
  const skip = (reason: string): void => { skipped.set(reason, (skipped.get(reason) ?? 0) + 1); };
  const ignored = gitignoreMatcher(await readFile(join(root, ".gitignore"), "utf8").catch(() => ""));
  let visited = 0;
  let truncated = false;
  const walk = async (folder: string): Promise<void> => {
    for (const entry of await readdir(folder, { withFileTypes: true }).catch(() => [])) {
      if (++visited > 20_000) { truncated = true; return; }
      if (files.length > ARTIFACT_LIMITS.files) { truncated = true; return; }
      if (entry.isSymbolicLink()) continue;
      const absolute = join(folder, entry.name);
      const path = relative(root, absolute).split(sep).join("/");
      if (entry.isDirectory()) {
        if (ignored(path, true)) skip("ignored");
        else if (!artifactFolderAllowed(entry.name)) skip(entry.name.startsWith(".") ? "hidden" : "folder");
        else await walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      if (ignored(path, false)) { skip("ignored"); continue; }
      if (exclude.has(path)) { skip("excluded"); continue; }
      const size = (await stat(absolute).catch(() => null))?.size ?? Number.POSITIVE_INFINITY;
      const verdict = artifactFileVerdict(path, size);
      if (!verdict.include) { skip(verdict.reason); continue; }
      const content = await readFile(absolute, "utf8").catch(() => null);
      if (content === null || content.includes("\u0000") || content.includes("�")) { skip("unreadable"); continue; }
      files.push({ path, content });
    }
  };
  await walk(root);
  return { files: files.slice(0, ARTIFACT_LIMITS.files + 1), skipped, truncated };
}

/** Why the open folder cannot be shared at all, read from its own top-level entries. */
async function notShareable(root: string): Promise<string | null> {
  const children = await readdir(root).catch(() => [] as string[]);
  return notAProjectReason(root, homedir(), children);
}

/** A snapshot's problems with the file count said honestly when the walk stopped early. */
function shareProblems(files: readonly ArtifactFile[], truncated: boolean): { check: ReturnType<typeof checkSnapshot>; problems: string[] } {
  const check = checkSnapshot(files);
  const problems = check.problems.filter((problem) => !(truncated && /can hold \d+ files/.test(problem)) && !/looks like a/.test(problem));
  if (truncated) problems.unshift(`This folder has more than ${ARTIFACT_LIMITS.files} files to share. Add the big or generated folders to .gitignore, or open a smaller project.`);
  return { check, problems };
}

async function readLink(root: string): Promise<{ link: RemixRecord; base: ArtifactFile[] } | null> {
  try {
    const link = parseRemixRecord(await readFile(join(root, REMIX_RECORD), "utf8"));
    if (link === null) return null;
    const base = checkSnapshot(JSON.parse(await readFile(join(root, REMIX_BASE), "utf8")) as unknown).files;
    return { link, base: [...base] };
  } catch {
    return null;
  }
}

async function writeLink(root: string, link: RemixRecord, files: readonly ArtifactFile[]): Promise<void> {
  await mkdir(join(root, ".adcode"), { recursive: true });
  await writeFile(join(root, REMIX_BASE), JSON.stringify(files));
  await writeFile(join(root, REMIX_RECORD), JSON.stringify(link, null, 2));
}

/** Write artifact files under `root`, refusing anything that would land outside it. */
async function writeFiles(root: string, files: readonly ArtifactFile[], onWritten?: (done: number) => void): Promise<void> {
  const base = resolve(root);
  for (const [index, file] of files.entries()) {
    if (onWritten !== undefined && index % 5 === 0) onWritten(index);
    if (!isSafeArtifactPath(file.path)) throw new Error(`Refused an unsafe path: ${file.path}`);
    const target = resolve(base, ...file.path.split("/"));
    if (!target.startsWith(base + sep)) throw new Error(`Refused an unsafe path: ${file.path}`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content);
  }
}

async function previewArtifact(exclude: readonly string[] = []): Promise<ArtifactPreview> {
  const root = workspaceRoot();
  const refusal = await notShareable(root);
  if (refusal !== null) return { root, name: basename(root), files: 0, bytes: 0, skipped: [], problems: [refusal], blocked: "not-a-project", secrets: [], link: null, readme: null };
  const { files, skipped, truncated } = await collectFiles(root, new Set(exclude));
  const { check, problems } = shareProblems(files, truncated);
  const secrets = findSecrets(check.files);
  const linked = await readLink(root);
  return {
    root,
    name: basename(root),
    files: check.files.length,
    bytes: check.bytes,
    skipped: [...skipped].map(([reason, count]) => ({ reason: REASONS[reason] ?? reason, count })),
    problems,
    blocked: problems.length > 0 ? "too-large" : null,
    secrets: [...new Map(secrets.map((finding) => [finding.path, { path: finding.path, line: finding.line, kind: finding.kind }])).values()],
    link: linked?.link ?? null,
    readme: check.files.find((file) => /^readme(?:\.md|\.txt)?$/i.test(file.path))?.content.slice(0, 2000) ?? null,
  };
}

async function publishArtifact(input: PublishArtifactInput) {
  const root = workspaceRoot();
  const refusal = await notShareable(root);
  if (refusal !== null) throw new Error(refusal);
  const { files, truncated } = await collectFiles(root, new Set(input.exclude));
  const { check, problems } = shareProblems(files, truncated);
  const secrets = findSecrets(check.files);
  if (secrets.length > 0) throw new Error(`${secrets[0]!.path} looks like it holds a ${secrets[0]!.kind}. Leave it out, or move the value into .env, before sharing.`);
  if (problems.length > 0) throw new Error(problems.slice(0, 3).join(" "));
  const linked = await readLink(root);
  // A remix becomes its own artifact (crediting the original); an owner's folder publishes a new version.
  const ownVersion = linked?.link.role === "owner" ? linked.link.artifactId : undefined;
  const detail = await request<import("@adcode/community").ArtifactDetail>("/community/artifacts/publish", {
    ...(ownVersion ? { id: ownVersion } : {}),
    title: short(input.title, "The title", 80, 3),
    description: short(input.description, "The description", 500, 10),
    tags: input.tags,
    helpWanted: short(input.helpWanted ?? "", "Help wanted", 500),
    message: short(input.message ?? "", "The note", 300),
    files: check.files,
    ownerName: await displayName(),
    remixOf: linked?.link.role === "remix" ? linked.link.artifactId : null,
  });
  await writeLink(root, { artifactId: detail.id, title: detail.title, version: detail.version, remixedAt: Date.now(), role: "owner" }, check.files);
  return detail;
}

async function remix(id: string): Promise<string> {
  const key = `remix:${id}`;
  progress(key, "download");
  const snapshot = await request<ArtifactSnapshot>(`/community/artifacts/${id}/remix`, {}).catch((error: unknown) => { progress(key, "failed"); throw error; });
  const check = checkSnapshot(snapshot.files);
  if (check.files.length === 0) throw new Error("That artifact has no files to remix.");
  const home = projectsHome();
  await mkdir(home, { recursive: true });
  const taken = new Set(await readdir(home).catch(() => [] as string[]));
  const wanted = remixFolderName(snapshot.title);
  let folder = wanted;
  for (let n = 2; taken.has(folder); n++) folder = `${wanted} ${n}`;
  const root = join(home, folder);
  await mkdir(root, { recursive: false });
  await writeFiles(root, check.files, (done) => progress(key, "write", done, check.files.length));
  await writeLink(root, { artifactId: snapshot.id, title: snapshot.title, version: snapshot.version, remixedAt: Date.now(), role: "remix" }, check.files);
  progress(key, "done", check.files.length, check.files.length);
  return root;
}

async function projectLink(): Promise<ProjectLinkView> {
  const root = currentWorkspace()?.root ?? null;
  if (root === null) return { root, link: null, changes: [], latestVersion: null };
  const linked = await readLink(root);
  if (linked === null) return { root, link: null, changes: [], latestVersion: null };
  const { files } = await collectFiles(root);
  const changes = diffSnapshots(linked.base, files).map((change) => ({ path: change.path, kind: change.kind, ...changeStats(change) }));
  const latestVersion = await request<{ version: number }>(`/community/artifacts/${linked.link.artifactId}`).then((detail) => detail.version, () => null);
  return { root, link: linked.link, changes, latestVersion };
}

async function sendImprovement(title: string, message: string) {
  const root = workspaceRoot();
  const linked = await readLink(root);
  if (linked === null || linked.link.role !== "remix") throw new Error("Open a remixed project to send an improvement. Remix an artifact from the Community page first.");
  const { files } = await collectFiles(root);
  const changes = diffSnapshots(linked.base, checkSnapshot(files).files);
  if (changes.length === 0) throw new Error("Nothing has changed since you remixed it yet.");
  return request<import("@adcode/community").ImprovementSummary>(`/community/artifacts/${linked.link.artifactId}/improvements`, {
    baseVersion: linked.link.version, title, message, changes, authorName: await displayName(),
  });
}

/**
 * Bring the open linked project to the artifact's latest version: what changed between the
 * version this folder is linked to and the latest is applied to the files here, leaving any
 * file the person has edited in the meantime alone and naming it as a conflict.
 */
async function pullLatest() {
  const root = workspaceRoot();
  const linked = await readLink(root);
  if (linked === null) throw new Error("This project is not linked to a community artifact.");
  const key = `pull:${linked.link.artifactId}`;
  progress(key, "download");
  const latest = await request<ArtifactSnapshot>(`/community/artifacts/${linked.link.artifactId}/files`, undefined, "required").catch((error: unknown) => { progress(key, "failed"); throw error; });
  if (latest.version <= linked.link.version) return { version: latest.version, applied: 0, conflicts: [] };
  const upstream = diffSnapshots(linked.base, latest.files);
  const { files } = await collectFiles(root);
  const result = applyChanges(files, upstream);
  const local = new Map(files.map((file) => [file.path, file.content]));
  const written = result.files.filter((file) => local.get(file.path) !== file.content);
  await writeFiles(root, written, (done) => progress(key, "write", done, written.length));
  progress(key, "done", written.length, written.length);
  for (const change of upstream) {
    if (change.kind !== "deleted" || result.conflicts.includes(change.path)) continue;
    await rm(resolve(root, ...change.path.split("/")), { force: true });
  }
  await writeLink(root, { ...linked.link, version: latest.version }, latest.files);
  return { version: latest.version, applied: result.applied, conflicts: result.conflicts };
}

/* ---------- IPC ---------- */

/** Paths the person chose to leave out of a share, checked as paths inside the project. */
const paths = (value: unknown): string[] => (Array.isArray(value) ? value.filter((path): path is string => typeof path === "string" && isSafeArtifactPath(path)).slice(0, 500) : []);

export function registerCommunityIpc(): void {
  const query = (params: Record<string, string | null>): string => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value !== null && value !== "") search.set(key, value);
    const text = search.toString();
    return text ? `?${text}` : "";
  };
  const sort = (value: unknown): string => (value === "new" || value === "top" ? value : "trending");

  ipcMain.handle(CHANNELS.communityHome, () => request("/community/home"));
  ipcMain.handle(CHANNELS.communityPlugins, (_event, sorting: unknown, search: unknown, category: unknown) =>
    request(`/community/plugins${query({ sort: sort(sorting), q: typeof search === "string" ? search.slice(0, 60) : null, category: typeof category === "string" && /^[a-z-]{2,20}$/.test(category) ? category : null })}`));
  ipcMain.handle(CHANNELS.communityPlugin, (_event, id: unknown) => request(`/community/plugins/${pluginId(id)}`));
  ipcMain.handle(CHANNELS.communityArtifacts, (_event, sorting: unknown, search: unknown, help: unknown) =>
    request(`/community/artifacts${query({ sort: sort(sorting), q: typeof search === "string" ? search.slice(0, 60) : null, help: help === true ? "1" : null })}`));
  ipcMain.handle(CHANNELS.communityArtifact, (_event, id: unknown) => request(`/community/artifacts/${artifactId(id)}`));
  ipcMain.handle(CHANNELS.communityMe, () => request("/community/me", undefined, "required"));
  ipcMain.handle(CHANNELS.communityMarkRead, async () => { await request("/community/activity/read", {}); });

  ipcMain.handle(CHANNELS.communityInstalled, async () => (await readInstalled()).map(view));
  ipcMain.handle(CHANNELS.communityInstall, async (_event, id: unknown, version: unknown, keep: unknown) => {
    const plugin = pluginId(id);
    const key = `install:${plugin}`;
    progress(key, "download");
    const chosen = typeof version === "string" && /^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(version) ? version : null;
    try {
      const { manifest } = await request<{ manifest: unknown }>(`/community/plugins/${plugin}/install`, chosen === null ? {} : { version: chosen });
      await writePlugin(parsePluginManifest(manifest, BUILT_IN_SLASH), "directory", keep === true);
    } catch (error) {
      progress(key, "failed");
      throw error;
    }
    return publishInstalled();
  });
  ipcMain.handle(CHANNELS.communitySetOptions, async (_event, id: unknown, values: unknown) => {
    const found = (await readInstalled()).find((one) => one.manifest.id === pluginId(id));
    if (found === undefined) throw new Error("That plugin is not installed.");
    await saveState(found.manifest.id, { ...found.state, options: optionValues(found.manifest.options, values) });
    return publishInstalled();
  });
  ipcMain.handle(CHANNELS.communitySetPinned, async (_event, id: unknown, pinned: unknown) => {
    const found = (await readInstalled()).find((one) => one.manifest.id === pluginId(id));
    if (found === undefined) throw new Error("That plugin is not installed.");
    await saveState(found.manifest.id, { ...found.state, pinned: pinned === true });
    return publishInstalled();
  });
  ipcMain.handle(CHANNELS.communityInstallLocal, async (_event, text: unknown) => {
    if (typeof text !== "string") throw new Error("Paste a plugin manifest.");
    await writePlugin(parsePluginManifest(text, BUILT_IN_SLASH), "local");
    return publishInstalled();
  });
  ipcMain.handle(CHANNELS.communityUninstall, async (_event, id: unknown) => {
    const found = (await readInstalled()).find((one) => one.manifest.id === pluginId(id));
    if (found !== undefined) {
      if (found.state.enabled) await restoreSettings(found.manifest, found.state);
      await rm(folderFor(found.manifest.id), { recursive: true, force: true });
      if (found.state.source === "directory") void request(`/community/plugins/${found.manifest.id}/uninstall`, {}).catch(() => {});
    }
    return publishInstalled();
  });
  ipcMain.handle(CHANNELS.communitySetEnabled, async (_event, id: unknown, enabled: unknown) => {
    const found = (await readInstalled()).find((one) => one.manifest.id === pluginId(id));
    if (found === undefined) throw new Error("That plugin is not installed.");
    if (enabled === true && !found.state.enabled) await applySettings(found.manifest, found.state);
    if (enabled !== true && found.state.enabled) await restoreSettings(found.manifest, found.state);
    await saveState(found.manifest.id, { ...found.state, enabled: enabled === true });
    return publishInstalled();
  });
  ipcMain.handle(CHANNELS.communityInstallStarter, async (_event, id: unknown) => {
    const starter = STARTERS.get(pluginId(id));
    if (starter === undefined) throw new Error("That plugin is not one ADCode ships.");
    progress(`install:${starter.id}`, "download", 1, 1);
    await writePlugin(starter, "starter");
    return publishInstalled();
  });
  ipcMain.handle(CHANNELS.communityStarters, () => [...STARTERS.values()]);
  ipcMain.handle(CHANNELS.communityCheckUpdates, async () => {
    const installed = await readInstalled();
    // Plugins ADCode ships update with the app: a newer bundled version is an update.
    for (const one of installed.filter((plugin) => plugin.state.source === "starter")) {
      const bundled = STARTERS.get(one.manifest.id);
      const update = bundled !== undefined && compareVersions(bundled.version, one.manifest.version) > 0 ? bundled.version : null;
      if (update !== one.state.update) await saveState(one.manifest.id, { ...one.state, update });
    }
    const versions = Object.fromEntries(installed.filter((one) => one.state.source === "directory").map((one) => [one.manifest.id, one.manifest.version]));
    if (Object.keys(versions).length > 0) {
      const updates = await request<Record<string, string>>("/community/plugins/updates", { installed: versions }).catch(() => null);
      if (updates !== null) for (const one of installed) {
        const update = updates[one.manifest.id] ?? null;
        if (update !== one.state.update) await saveState(one.manifest.id, { ...one.state, update });
      }
    }
    return publishInstalled();
  });
  ipcMain.handle(CHANNELS.communityPublishPlugin, async (_event, text: unknown, notes: unknown) => {
    if (typeof text !== "string") throw new Error("Write the plugin first.");
    const manifest = parsePluginManifest(text, BUILT_IN_SLASH);
    return request("/community/plugins/publish", { manifest, notes: typeof notes === "string" ? notes.slice(0, 1000) : "", ownerName: await displayName() });
  });
  ipcMain.handle(CHANNELS.communityRemovePlugin, async (_event, id: unknown) => { await request(`/community/plugins/${pluginId(id)}/delete`, {}); });
  ipcMain.handle(CHANNELS.communityReadProjectManifest, async () => {
    const root = currentWorkspace()?.root;
    if (!root) return null;
    return readFile(join(root, PLUGIN_FILE), "utf8").then((text) => text.slice(0, 300_000), () => null);
  });
  ipcMain.handle(CHANNELS.communityWriteProjectManifest, async (_event, text: unknown) => {
    if (typeof text !== "string" || text.length > 300_000) throw new Error("The plugin is too large.");
    const target = join(workspaceRoot(), PLUGIN_FILE);
    await writeFile(target, text);
    return target;
  });

  ipcMain.handle(CHANNELS.communityStar, (_event, kind: unknown, id: unknown, on: unknown) => {
    const which = kind === "plugin" ? "plugin" : "artifact";
    return request("/community/star", { kind: which, id: which === "plugin" ? pluginId(id) : artifactId(id), on: on !== false });
  });
  ipcMain.handle(CHANNELS.communityReport, async (_event, kind: unknown, id: unknown, reason: unknown) => {
    const which = kind === "plugin" ? "plugin" : "artifact";
    await request("/community/report", { kind: which, id: which === "plugin" ? pluginId(id) : artifactId(id), reason: short(reason, "The reason", 500, 5) });
  });

  ipcMain.handle(CHANNELS.communityPreviewArtifact, (_event, exclude: unknown) => previewArtifact(paths(exclude)));
  ipcMain.handle(CHANNELS.communityPublishArtifact, (_event, input: unknown) => {
    const value = input as Partial<PublishArtifactInput> | null;
    if (value === null || typeof value !== "object") throw new Error("Describe the artifact first.");
    const tags = Array.isArray(value.tags) ? value.tags.filter((tag): tag is string => typeof tag === "string").slice(0, 6) : [];
    return publishArtifact({ title: String(value.title ?? ""), description: String(value.description ?? ""), tags, helpWanted: String(value.helpWanted ?? ""), message: String(value.message ?? ""), exclude: paths(value.exclude) });
  });
  ipcMain.handle(CHANNELS.communityRemoveArtifact, async (_event, id: unknown) => { await request(`/community/artifacts/${artifactId(id)}/delete`, {}); });
  ipcMain.handle(CHANNELS.communityRemix, (_event, id: unknown) => remix(artifactId(id)));
  ipcMain.handle(CHANNELS.communityProjectLink, () => projectLink());
  ipcMain.handle(CHANNELS.communitySendImprovement, (_event, title: unknown, message: unknown) =>
    sendImprovement(short(title, "The title", 100, 3), short(message ?? "", "The message", 4000)));
  ipcMain.handle(CHANNELS.communityImprovement, (_event, id: unknown) => request(`/community/improvements/${improvementId(id)}`, undefined, "required"));
  ipcMain.handle(CHANNELS.communityDecide, (_event, id: unknown, accept: unknown, reply: unknown, force: unknown) =>
    request(`/community/improvements/${improvementId(id)}/decide`, { accept: accept === true, reply: typeof reply === "string" ? reply.slice(0, 2000) : "", force: force === true }));
  ipcMain.handle(CHANNELS.communityPullLatest, () => pullLatest());
  ipcMain.handle(CHANNELS.communityWaitlist, (_event, join: unknown, price: unknown, note: unknown) =>
    request("/community/monetize/waitlist", { join: join !== false, price: typeof price === "number" ? price : null, note: typeof note === "string" ? note.slice(0, 500) : "" }));

  // Installed plugins' slash commands are live from the first message, not only after a visit to the hub.
  void publishInstalled().catch(() => {});
}
