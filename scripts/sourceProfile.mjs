import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

/** Local checkouts must not share Chromium caches or instance locks with the installed app. */
export function sourceProfile(repository, environment = process.env, platform = process.platform, home = homedir()) {
  const explicit = environment.ADCODE_USER_DATA_DIR;
  if (explicit !== undefined) {
    if (!explicit || !isAbsolute(explicit)) throw new Error("ADCODE_USER_DATA_DIR requires an absolute profile directory");
    return resolve(explicit);
  }
  const repositoryPath = resolve(repository);
  const key = createHash("sha256").update(platform === "win32" ? repositoryPath.toLowerCase() : repositoryPath).digest("hex").slice(0, 16);
  const base = platform === "win32"
    ? environment.LOCALAPPDATA || join(home, "AppData", "Local")
    : platform === "darwin" ? join(home, "Library", "Application Support")
    : environment.XDG_CONFIG_HOME || join(home, ".config");
  return join(base, "ADCode", "SourceProfiles", key);
}
