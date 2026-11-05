import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cliPaths } from "../util/paths.ts";
import { COMMAND_ACTIONS, EFFORT_LEVELS, KNOWN_FLAGS, SESSION_ACTIONS, VALUE_FLAGS } from "./words.ts";

/**
 * What Tab should offer, given the words typed so far.
 *
 * Pure: the caller supplies the commands, themes, model ids and session ids, so the rules
 * are testable without a shell. An empty answer lets the shell fall back to file names,
 * which is right for `adcode app <path>`.
 */

export interface CompletionData {
  readonly commands: readonly string[];
  readonly themes: readonly string[];
  readonly models: readonly string[];
  readonly providers: readonly string[];
  readonly sessions: readonly string[];
}

function matching(current: string, candidates: readonly string[]): string[] {
  const prefix = current.toLowerCase();
  return [...new Set(candidates)].filter((candidate) => candidate.toLowerCase().startsWith(prefix));
}

export function completionCandidates(before: readonly string[], current: string, data: CompletionData): string[] {
  const previous = before[before.length - 1];
  if (previous !== undefined && VALUE_FLAGS.includes(previous)) {
    switch (previous) {
      case "--theme":
        return matching(current, data.themes);
      case "--model":
        return matching(current, data.models);
      case "--provider":
        return matching(current, data.providers);
      case "--session":
        return matching(current, ["latest", ...data.sessions]);
      case "--effort":
        return matching(current, EFFORT_LEVELS);
      default:
        return [];
    }
  }
  if (current.startsWith("-")) return matching(current, KNOWN_FLAGS);

  // The positional words so far, with flags and their values set aside.
  const positional: string[] = [];
  for (let index = 0; index < before.length; index += 1) {
    const word = before[index]!;
    if (word === "--") break;
    if (word.startsWith("-")) {
      if (VALUE_FLAGS.includes(word)) index += 1;
      continue;
    }
    positional.push(word);
  }

  const [command, action] = positional;
  if (command === undefined) return matching(current, data.commands);
  if (command === "help") return positional.length === 1 ? matching(current, data.commands) : [];
  const actions = COMMAND_ACTIONS[command];
  if (actions !== undefined && action === undefined) return matching(current, actions);
  if (positional.length === 2) {
    if (command === "models" && action === "use") return matching(current, data.models);
    if (command === "sessions" && action !== undefined && SESSION_ACTIONS.includes(action)) return matching(current, ["latest", ...data.sessions]);
    if (command === "theme" && (action === "set" || action === "show")) return matching(current, data.themes);
    if (command === "completion" && action === "install") return matching(current, COMMAND_ACTIONS["completion"]!.filter((name) => name !== "install"));
  }
  return [];
}

/** Model and provider ids from the last catalogue this machine loaded, so Tab never waits on the network. */
export function completionCachePath(): string {
  return join(cliPaths.cache(), "completion.json");
}

export function readCompletionCache(): { models: string[]; providers: string[] } {
  try {
    const raw = JSON.parse(readFileSync(completionCachePath(), "utf8")) as { models?: unknown; providers?: unknown };
    const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((one): one is string => typeof one === "string") : []);
    return { models: strings(raw.models), providers: strings(raw.providers) };
  } catch {
    return { models: [], providers: [] };
  }
}

export function writeCompletionCache(providers: ReadonlyArray<{ id: string; models: ReadonlyArray<{ id: string }> }>): void {
  const next = `${JSON.stringify({
    providers: providers.map((provider) => provider.id),
    models: [...new Set(providers.flatMap((provider) => provider.models.map((model) => model.id)))],
  })}\n`;
  const path = completionCachePath();
  try {
    if (readFileSync(path, "utf8") === next) return;
  } catch {
    // No cache yet.
  }
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, next, "utf8");
  } catch {
    // Completion is a convenience; a read-only data folder must not break a command.
  }
}
