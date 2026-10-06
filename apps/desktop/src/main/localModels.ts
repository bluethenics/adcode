/**
 * Ollama on this computer: installed, running, and which models it has - asked, not assumed.
 *
 * Reported: "I don't even have local AI installed on the laptop but it is showing." The
 * Connect screen listed "Ollama (on this computer)" as ready - "no key needed", in green -
 * on every machine, because status added it unconditionally and a keyless provider counted
 * as connected. Now the row says what is true: running with N models, installed but not
 * running, or not installed, and Ollama counts as ready only when it is running with a model.
 *
 * §9: a machine without Ollama answers "not running" at once (nothing listens on the port),
 * and nothing here throws into the window.
 */
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { delimiter, join } from "node:path";
import type { LocalModelsView } from "../shared/api.ts";

const API = "http://127.0.0.1:11434";

/** Answers stay this fresh: status is asked for often, and Ollama starts and stops rarely. */
const FRESH_MS = 10_000;

/** Where the installers put Ollama, before PATH is searched. */
export function ollamaCandidates(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  const onPath = (env["PATH"] ?? env["Path"] ?? "")
    .split(delimiter)
    .filter((dir) => dir.length > 0)
    .map((dir) => join(dir, platform === "win32" ? "ollama.exe" : "ollama"));
  if (platform === "win32") {
    return [
      join(env["LOCALAPPDATA"] ?? "", "Programs", "Ollama", "ollama.exe"),
      join(env["ProgramFiles"] ?? "C:\\Program Files", "Ollama", "ollama.exe"),
      ...onPath,
    ].filter((path) => !path.startsWith("Programs"));
  }
  if (platform === "darwin") {
    return ["/Applications/Ollama.app/Contents/Resources/ollama", "/usr/local/bin/ollama", "/opt/homebrew/bin/ollama", ...onPath];
  }
  return ["/usr/local/bin/ollama", "/usr/bin/ollama", "/snap/bin/ollama", ...onPath];
}

async function firstExisting(paths: readonly string[]): Promise<string | null> {
  for (const path of paths) {
    try {
      await access(path);
      return path;
    } catch {
      // Not there; try the next.
    }
  }
  return null;
}

/** The chat models Ollama has pulled: embedding models answer no questions. */
export function chatModels(names: readonly string[]): string[] {
  return names.filter((name) => !/embed/i.test(name)).slice(0, 50);
}

/** Whether Ollama answers on its port, and with which models. */
export async function askOllama(fetchImpl: typeof fetch = fetch): Promise<{ running: boolean; models: string[] }> {
  try {
    const response = await fetchImpl(`${API}/api/tags`, { signal: AbortSignal.timeout(1500) });
    if (!response.ok) return { running: false, models: [] };
    const body = (await response.json()) as { models?: Array<{ name?: unknown }> };
    const models = (body.models ?? []).map((one) => one.name).filter((name): name is string => typeof name === "string");
    return { running: true, models: models.slice(0, 50) };
  } catch {
    return { running: false, models: [] };
  }
}

let cached: { at: number; value: LocalModelsView } | null = null;

/** Ollama's state, asked at most every ten seconds unless `fresh`. */
export async function localModels(fresh = false): Promise<LocalModelsView> {
  if (!fresh && cached !== null && Date.now() - cached.at < FRESH_MS) return cached.value;
  const answer = await askOllama();
  const installed = answer.running || (await firstExisting(ollamaCandidates(process.platform, process.env))) !== null;
  const value: LocalModelsView = { installed, running: answer.running, models: chatModels(answer.models) };
  cached = { at: Date.now(), value };
  return value;
}

/**
 * Start Ollama's server, then wait up to eight seconds for it to answer.
 *
 * `ollama serve` is what the tray app runs; started detached, it outlives this window like
 * the tray app would. Only ever on the person's click.
 */
export async function startOllama(): Promise<LocalModelsView> {
  const path = await firstExisting(ollamaCandidates(process.platform, process.env));
  if (path === null) return localModels(true);
  try {
    const child = spawn(path, ["serve"], { detached: true, stdio: "ignore", windowsHide: true });
    child.on("error", () => undefined);
    child.unref();
  } catch {
    return localModels(true);
  }
  for (let waited = 0; waited < 8_000; waited += 500) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const state = await localModels(true);
    if (state.running) return state;
  }
  return localModels(true);
}
