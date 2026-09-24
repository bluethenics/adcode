import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { resolveSandboxPath } from "./aiSandbox.ts";
import type { AssistantSkillView } from "../shared/assistantControls.ts";

export const SKILL_ROOTS = [".agents/skills", ".adcode/skills", ".claude/skills"];
const MAX_BYTES = 64_000;
export const fingerprint = (text: string): string => createHash("sha256").update(text).digest("hex");
export interface DiscoveredSkill extends AssistantSkillView { readonly content: string; readonly fingerprint: string; readonly directory: string }
export interface InstalledSkillRoot { readonly path: string; readonly source: string }

/** Known user installation locations only: never crawl an entire disk or plugin cache. */
export function installedSkillRoots(home: string, codexHome?: string): InstalledSkillRoot[] {
  const codex = codexHome ? resolve(codexHome) : join(home, ".codex");
  return [
    { path: join(home, ".agents", "skills"), source: "User skills" },
    { path: join(home, ".adcode", "skills"), source: "Adcode" },
    { path: join(home, ".claude", "skills"), source: "Claude" },
    { path: join(codex, "skills"), source: "Codex" },
    { path: join(codex, "skills", ".system"), source: "Codex system" },
  ];
}

/** Common scalar and multiline YAML metadata, without interpreting tags or executing YAML. */
export function parseSkill(content: string): { name: string; description: string } {
  const front = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)?.[1];
  if (!front) throw new Error("SKILL.md needs YAML frontmatter with name and description.");
  const field = (key: string): string => {
    const match = new RegExp(`^${key}:\\s*([^\\r\\n]*)(?:\\r?\\n((?:[ \\t]+[^\\r\\n]*(?:\\r?\\n|$))*))?`, "m").exec(front);
    let value = match?.[1]?.trim() ?? "";
    if (/^[>|][-+]?$/.test(value)) value = (match?.[2] ?? "").trim().replace(/\s+/g, " ");
    if (value.startsWith('"') && value.endsWith('"')) {
      try { value = JSON.parse(value) as string; } catch { throw new Error(`Invalid quoted ${key}.`); }
    } else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1).replaceAll("''", "'");
    return value;
  };
  const name = field("name");
  const description = field("description");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64) throw new Error("Use a lowercase, hyphenated skill name (up to 64 characters).");
  if (!description || description.length > 1024) throw new Error("Skill description must contain 1–1024 characters.");
  return { name, description };
}

export async function discoverSkills(root: string | null, enabled: Record<string, string>, installed: readonly InstalledSkillRoot[] = []): Promise<DiscoveredSkill[]> {
  const found: DiscoveredSkill[] = [];
  const locations: { base: string; relative: string | null; scope: "workspace" | "system"; source: string }[] = [
    ...(root ? SKILL_ROOTS.map(relative => ({ base: root, relative, scope: "workspace" as const, source: "This project" })) : []),
    ...installed.map(location => ({ base: location.path, relative: null, scope: "system" as const, source: location.source })),
  ];
  const seen = new Set<string>();
  for (const location of locations) {
    const { base, scope, source } = location;
    let directory: string;
    let entries;
    try {
      directory = location.relative ? await resolveSandboxPath(base, location.relative) : base;
      const key = process.platform === "win32" ? resolve(directory).toLowerCase() : resolve(directory);
      if (seen.has(key)) continue;
      seen.add(key);
      entries = await readdir(directory, { withFileTypes: true });
    }
    catch { continue; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith(".") || found.length >= 400) continue;
      const portable = `${location.relative ? `${location.relative}/` : ""}${entry.name}/SKILL.md`;
      const id = scope === "workspace" ? portable : `system:${fingerprint(resolve(base)).slice(0, 16)}/${entry.name}/SKILL.md`;
      const displayPath = scope === "workspace" ? portable : join(base, entry.name, "SKILL.md");
      let skillDirectory = join(directory, entry.name);
      let content = "";
      let metadata = { name: entry.name, description: "" };
      let error: string | null = null;
      try {
        const path = await resolveSandboxPath(base, portable);
        skillDirectory = dirname(path);
        const info = await stat(path);
        if (!info.isFile() || info.size > MAX_BYTES) throw new Error("SKILL.md must be a file under 64 KB.");
        content = await readFile(path, "utf8");
        if (Buffer.byteLength(content) > MAX_BYTES) throw new Error("SKILL.md is too large.");
        metadata = parseSkill(content);
        if (metadata.name !== entry.name) throw new Error("Skill name must match its folder name.");
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === "ENOENT") continue;
        error = cause instanceof Error ? cause.message : "Could not read skill.";
      }
      const hash = fingerprint(content);
      const approved = enabled[id];
      if (!error && approved && approved !== hash) error = "Changed since activation. Preview and enable again.";
      found.push({ ...metadata, id, path: displayPath, directory: skillDirectory, scope, source, content, fingerprint: hash, enabled: !error && approved === hash, error, estimatedTokens: Math.ceil(content.length / 3) });
    }
  }
  return found;
}

/** Supporting files remain confined to an enabled skill's own folder. Never execute them. */
export async function readSkillResource(skill: DiscoveredSkill, resource: string): Promise<string> {
  const path = await resolveSandboxPath(skill.directory, resource);
  const info = await stat(path);
  if (!info.isFile() || info.size > MAX_BYTES) throw new Error("Skill resources must be text files under 64 KB.");
  const content = await readFile(path, "utf8");
  if (Buffer.byteLength(content) > MAX_BYTES || content.includes("\0")) throw new Error("Skill resource is not a supported text file.");
  return content;
}
