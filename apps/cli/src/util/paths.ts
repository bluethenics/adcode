import { mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Where the CLI keeps its own state, and where the desktop app keeps the identity it shares. */

const HERE = dirname(fileURLToPath(import.meta.url));

/** apps/cli/src/util -> repository root. */
export const REPOSITORY_ROOT = resolve(HERE, "../../../..");

export function cliDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env["ADCODE_CLI_DATA_DIR"];
  if (override !== undefined && override.trim().length > 0) return resolve(override);
  if (process.platform === "win32") {
    return join(env["APPDATA"] ?? join(homedir(), "AppData", "Roaming"), "@adcode", "cli");
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "@adcode", "cli");
  }
  return join(env["XDG_CONFIG_HOME"] ?? join(homedir(), ".config"), "@adcode", "cli");
}

export function desktopDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env["ADCODE_DESKTOP_DATA_DIR"];
  if (override !== undefined && override.trim().length > 0) return resolve(override);
  if (process.platform === "win32") {
    return join(env["APPDATA"] ?? join(homedir(), "AppData", "Roaming"), "@adcode", "desktop");
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "@adcode", "desktop");
  }
  return join(env["XDG_CONFIG_HOME"] ?? join(homedir(), ".config"), "@adcode", "desktop");
}

export const cliPaths = {
  config: (): string => join(cliDataDir(), "config.json"),
  sessions: (): string => join(cliDataDir(), "sessions"),
  ads: (): string => join(cliDataDir(), "ads"),
  cache: (): string => join(cliDataDir(), "cache"),
  debug: (): string => join(cliDataDir(), "debug.log"),
};

export const desktopPaths = {
  settings: (): string => join(desktopDataDir(), "settings.json"),
  providerKeys: (): string => join(desktopDataDir(), "provider-keys.json"),
  identity: (): string => join(desktopDataDir(), "ads", "ads", "identity.json"),
  localState: (): string => join(desktopDataDir(), "Local State"),
  connections: (): string => join(desktopDataDir(), "model-connections.json"),
};

export function ensureDir(path: string): string {
  mkdirSync(path, { recursive: true });
  return path;
}

export function readJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return null;
  }
}

export function packageVersion(): string {
  const pkg = readJsonFile(join(REPOSITORY_ROOT, "package.json"));
  if (typeof pkg === "object" && pkg !== null && typeof (pkg as Record<string, unknown>)["version"] === "string") {
    return (pkg as Record<string, string>)["version"] ?? "0.0.0";
  }
  return "0.0.0";
}

/** The current checkout, so `adcode` can say which build it is running. */
export function buildSource(): { root: string; version: string; packageName: string } {
  const pkg = readJsonFile(join(REPOSITORY_ROOT, "package.json"));
  const record = typeof pkg === "object" && pkg !== null ? (pkg as Record<string, unknown>) : {};
  return {
    root: REPOSITORY_ROOT,
    version: typeof record["version"] === "string" ? record["version"] : "0.0.0",
    packageName: typeof record["name"] === "string" ? record["name"] : "adcode",
  };
}

export function isWindows(): boolean {
  return process.platform === "win32";
}
