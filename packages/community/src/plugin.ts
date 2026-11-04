/**
 * What an ADCode plugin is, and the one function that decides whether a file is one.
 *
 * A plugin is a JSON document, not a program. That is the whole safety model: someone
 * installing a plugin from the public directory is installing words - prompts, skills,
 * colours, setting values and lists of commands ADCode already has - never code that runs
 * with their account or their files. Every contribution below is something the app already
 * knows how to do safely; the plugin only chooses which and with what text.
 *
 * Six kinds of contribution, and each is a way to change a feature, not only to add one:
 *
 * - `slashCommands` add `/words` to the chat composer, or replace the instruction behind a
 *   built-in one (`/review`, `/commit`) when the plugin says `overrides: true`.
 * - `actions` are AI actions in the command palette: a prompt, plus the selection or the
 *   open file when the action asks for it.
 * - `macros` run several existing commands in order - "save all, run tests, open changes".
 * - `skills` are SKILL.md files the assistant reads when a task matches them.
 * - `theme` recolours the workbench through its design tokens.
 * - `settings` are a preset of switch and choice values, applied on install and put back
 *   on uninstall.
 *
 * Pure: no fs, no network, no DOM. The desktop app, the server and the website all run this
 * same parser, so a manifest the directory accepts is one every install will accept.
 */
import { getSetting, isValidSettingValue } from "@adcode/settings";

export const PLUGIN_FORMAT = 1;
/** The file a plugin lives in, inside its install folder and inside a project. */
export const PLUGIN_FILE = "adcode-plugin.json";
/** The largest manifest the directory stores. Skills are the bulk of it. */
export const MAX_MANIFEST_BYTES = 256_000;

export const PLUGIN_CATEGORIES = [
  { id: "ai-actions", label: "AI actions" },
  { id: "workflow", label: "Workflow" },
  { id: "skills", label: "Skills" },
  { id: "themes", label: "Themes" },
  { id: "editor", label: "Editor setup" },
  { id: "learning", label: "Learning" },
  { id: "other", label: "Other" },
] as const;
export type PluginCategory = (typeof PLUGIN_CATEGORIES)[number]["id"];

/** Design tokens a theme may set. Everything else in the stylesheet stays ADCode's. */
export const THEME_TOKENS = [
  "--accent", "--text-on-accent", "--focus-ring",
  "--bg-app", "--bg-workbench", "--bg-chrome", "--bg-editor", "--bg-panel", "--bg-elevated",
  "--bg-hover", "--bg-selected", "--bg-active",
  "--text-primary", "--text-secondary", "--text-tertiary",
  "--border-hairline", "--border-subtle", "--border-strong",
  "--success", "--warning", "--danger",
] as const;
export type ThemeToken = (typeof THEME_TOKENS)[number];

/**
 * The settings a plugin may preset.
 *
 * An allowlist, not a denylist: a new setting is out of reach until somebody decides it is
 * harmless. Text settings are never reachable (one of them is a command line), and nothing
 * that touches ads, updates, the chosen model, keys, sandboxes or connector approval is
 * either - a plugin that quietly switched your provider or turned off "ask before a tool
 * runs" would be the exact surprise this format exists to rule out.
 */
const SETTING_PREFIXES = ["adcode.appearance.", "adcode.editing.", "adcode.formatting.", "adcode.navigation.", "adcode.structure.", "adcode.git."];
const SETTING_IDS = new Set([
  "adcode.ai.designTaste", "adcode.ai.liveAgentView", "adcode.ai.chatWidget", "adcode.ai.autoCompact",
  "adcode.ai.autoCompactAt", "adcode.ai.effort", "adcode.ai.inlineCompletion", "adcode.ai.agentProfiles",
  "adcode.session.autoSave", "adcode.session.workspaceRestore",
]);

export function pluginMaySet(settingId: string): boolean {
  const setting = getSetting(settingId);
  if (setting === undefined || setting.kind === "text" || !setting.available) return false;
  return SETTING_IDS.has(settingId) || SETTING_PREFIXES.some((prefix) => settingId.startsWith(prefix));
}

export interface PluginSlashCommand {
  readonly id: string;
  readonly hint: string;
  readonly prompt: string;
  /** "diff" attaches the uncommitted changes, like the built-in /review. */
  readonly kind: "prompt" | "diff";
  /** True to replace a built-in command of the same name. Required, so it is never an accident. */
  readonly overrides: boolean;
}

export interface PluginAction {
  readonly id: string;
  readonly title: string;
  readonly prompt: string;
  /** What rides along with the prompt. */
  readonly uses: "selection" | "file" | "nothing";
}

export interface PluginMacro {
  readonly id: string;
  readonly title: string;
  readonly commands: readonly string[];
}

export interface PluginSkill {
  readonly name: string;
  readonly description: string;
  readonly body: string;
}

export interface PluginTheme {
  readonly name: string;
  readonly tokens: Readonly<Partial<Record<ThemeToken, string>>>;
}

export interface PluginContributions {
  readonly slashCommands: readonly PluginSlashCommand[];
  readonly actions: readonly PluginAction[];
  readonly macros: readonly PluginMacro[];
  readonly skills: readonly PluginSkill[];
  readonly theme: PluginTheme | null;
  readonly settings: Readonly<Record<string, boolean | string>>;
}

export interface PluginManifest {
  readonly format: typeof PLUGIN_FORMAT;
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly icon: string;
  readonly category: PluginCategory;
  readonly tags: readonly string[];
  readonly readme: string;
  /** Set when this plugin started as a remix of another plugin or of a built-in feature. */
  readonly remixOf: string | null;
  readonly contributes: PluginContributions;
}

/** Thrown with every problem at once, so the Studio can list them all rather than one per save. */
export class PluginManifestError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(problems.length === 1 ? problems[0]! : `${problems.length} problems: ${problems.join(" ")}`);
    this.problems = problems;
  }
}

export const PLUGIN_ID = /^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/;
const COMMAND_WORD = /^[a-z][a-z0-9-]{0,31}$/;
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TAG = /^[a-z0-9][a-z0-9-]{0,23}$/;
const SEMVER = /^(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})$/;
const COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
/** An app command id as the registry writes them: `ai.explainSelection`, `view.zoomIn`. */
export const APP_COMMAND = /^[a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*){1,3}$/;

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

/**
 * Read a manifest, or throw a `PluginManifestError` naming everything wrong with it.
 *
 * `builtInSlash` is the composer's own command list: a plugin command with one of those
 * names must say `overrides: true`, so replacing `/review` is always a stated intention.
 */
export function parsePluginManifest(input: string | unknown, builtInSlash: readonly string[] = []): PluginManifest {
  const problems: string[] = [];
  let raw: unknown = input;
  if (typeof input === "string") {
    if (new TextEncoder().encode(input).length > MAX_MANIFEST_BYTES) throw new PluginManifestError([`A plugin must be under ${MAX_MANIFEST_BYTES / 1000} KB.`]);
    try { raw = JSON.parse(input); } catch { throw new PluginManifestError(["The plugin file is not valid JSON."]); }
  }
  const root = record(raw);
  if (root === null) throw new PluginManifestError(["A plugin must be a JSON object."]);

  const text = (value: unknown, label: string, min: number, max: number): string => {
    if (typeof value !== "string" || value.trim().length < min || value.length > max) {
      problems.push(min === 0 ? `${label} must be text of at most ${max} characters.` : `${label} must be ${min}–${max} characters.`);
      return "";
    }
    return value.trim();
  };
  const list = (value: unknown, label: string, max: number): unknown[] => {
    if (value === undefined) return [];
    if (!Array.isArray(value)) { problems.push(`${label} must be a list.`); return []; }
    if (value.length > max) problems.push(`${label} can have at most ${max} entries.`);
    return value.slice(0, max);
  };

  if (root["format"] !== undefined && root["format"] !== PLUGIN_FORMAT) problems.push(`This plugin uses format ${String(root["format"])}; this version of ADCode reads format ${PLUGIN_FORMAT}.`);
  const id = typeof root["id"] === "string" ? root["id"] : "";
  if (!PLUGIN_ID.test(id)) problems.push("The id must be 3–48 lowercase letters, digits or hyphens, starting and ending with a letter or digit.");
  const name = text(root["name"], "The name", 2, 60);
  const version = typeof root["version"] === "string" && SEMVER.test(root["version"]) ? root["version"] : (problems.push("The version must look like 1.0.0."), "");
  const description = text(root["description"], "The description", 10, 300);
  const icon = root["icon"] === undefined ? "" : text(root["icon"], "The icon", 0, 8);
  const category = PLUGIN_CATEGORIES.some((one) => one.id === root["category"]) ? (root["category"] as PluginCategory) : (problems.push(`The category must be one of: ${PLUGIN_CATEGORIES.map((one) => one.id).join(", ")}.`), "other");
  const tags = [...new Set(list(root["tags"], "Tags", 6).flatMap((tag) => {
    if (typeof tag === "string" && TAG.test(tag)) return [tag];
    problems.push(`The tag ${JSON.stringify(tag)} must be up to 24 lowercase letters, digits or hyphens.`);
    return [];
  }))];
  const readme = root["readme"] === undefined ? "" : text(root["readme"], "The readme", 0, 20_000);
  const remixOf = root["remixOf"] === undefined || root["remixOf"] === null ? null : text(root["remixOf"], "remixOf", 1, 120) || null;

  const contributes = record(root["contributes"] ?? {});
  if (contributes === null) problems.push("contributes must be an object.");
  const c = contributes ?? {};

  const seen = new Set<string>();
  const unique = (kind: string, key: string): boolean => {
    if (seen.has(`${kind}:${key}`)) { problems.push(`Two ${kind} are both called ${key}.`); return false; }
    seen.add(`${kind}:${key}`);
    return true;
  };

  const slashCommands = list(c["slashCommands"], "slashCommands", 20).flatMap((entry, index): PluginSlashCommand[] => {
    const one = record(entry);
    const label = `Slash command ${index + 1}`;
    if (one === null) { problems.push(`${label} must be an object.`); return []; }
    const word = typeof one["id"] === "string" ? one["id"].replace(/^\//, "") : "";
    if (!COMMAND_WORD.test(word)) { problems.push(`${label}: the name must be a lowercase word of up to 32 characters, like "explain-simply".`); return []; }
    const overrides = one["overrides"] === true;
    if (builtInSlash.includes(word) && !overrides) problems.push(`/${word} is a built-in command. Set "overrides": true to replace its instruction, or pick another name.`);
    if (!builtInSlash.includes(word) && overrides) problems.push(`/${word} is not a built-in command, so there is nothing to override.`);
    const kind = one["kind"] === undefined || one["kind"] === "prompt" ? "prompt" : one["kind"] === "diff" ? "diff" : (problems.push(`${label}: kind must be "prompt" or "diff".`), "prompt");
    if (!unique("slash commands", word)) return [];
    return [{ id: word, hint: text(one["hint"], `/${word}'s hint`, 3, 120), prompt: text(one["prompt"], `/${word}'s prompt`, 10, 4000), kind, overrides }];
  });

  const actions = list(c["actions"], "actions", 20).flatMap((entry, index): PluginAction[] => {
    const one = record(entry);
    const label = `Action ${index + 1}`;
    if (one === null) { problems.push(`${label} must be an object.`); return []; }
    const actionId = typeof one["id"] === "string" ? one["id"] : "";
    if (!COMMAND_WORD.test(actionId)) { problems.push(`${label}: the id must be a lowercase word of up to 32 characters.`); return []; }
    const uses = one["uses"] === undefined ? "selection" : one["uses"];
    if (uses !== "selection" && uses !== "file" && uses !== "nothing") problems.push(`${label}: uses must be "selection", "file" or "nothing".`);
    if (!unique("actions", actionId)) return [];
    return [{ id: actionId, title: text(one["title"], `${label}'s title`, 3, 60), prompt: text(one["prompt"], `${label}'s prompt`, 10, 4000), uses: uses === "file" || uses === "nothing" ? uses : "selection" }];
  });

  const macros = list(c["macros"], "macros", 10).flatMap((entry, index): PluginMacro[] => {
    const one = record(entry);
    const label = `Macro ${index + 1}`;
    if (one === null) { problems.push(`${label} must be an object.`); return []; }
    const macroId = typeof one["id"] === "string" ? one["id"] : "";
    if (!COMMAND_WORD.test(macroId)) { problems.push(`${label}: the id must be a lowercase word of up to 32 characters.`); return []; }
    const commands = list(one["commands"], `${label}'s commands`, 12).flatMap((command) => {
      if (typeof command !== "string" || !APP_COMMAND.test(command)) { problems.push(`${label}: ${JSON.stringify(command)} is not an ADCode command id.`); return []; }
      // A macro that ran plugin commands could run itself, or another plugin nobody reviewed with it.
      if (command.startsWith("plugin.") || command.startsWith("community.")) { problems.push(`${label}: macros run ADCode's own commands, not plugin or community commands.`); return []; }
      return [command];
    });
    if (commands.length === 0) problems.push(`${label} needs at least one command.`);
    if (!unique("macros", macroId)) return [];
    return [{ id: macroId, title: text(one["title"], `${label}'s title`, 3, 60), commands }];
  });

  const skills = list(c["skills"], "skills", 10).flatMap((entry, index): PluginSkill[] => {
    const one = record(entry);
    const label = `Skill ${index + 1}`;
    if (one === null) { problems.push(`${label} must be an object.`); return []; }
    const skillName = typeof one["name"] === "string" ? one["name"] : "";
    if (!SKILL_NAME.test(skillName) || skillName.length > 64) { problems.push(`${label}: the name must be lowercase and hyphenated, like "api-review".`); return []; }
    if (!unique("skills", skillName)) return [];
    return [{ name: skillName, description: text(one["description"], `${skillName}'s description`, 10, 1024), body: text(one["body"], `${skillName}'s instructions`, 20, 48_000) }];
  });

  let theme: PluginTheme | null = null;
  if (c["theme"] !== undefined && c["theme"] !== null) {
    const one = record(c["theme"]);
    const tokens = record(one?.["tokens"]);
    if (one === null || tokens === null) problems.push("theme must have a name and a tokens object.");
    else {
      const chosen: Partial<Record<ThemeToken, string>> = {};
      for (const [token, value] of Object.entries(tokens)) {
        if (!(THEME_TOKENS as readonly string[]).includes(token)) { problems.push(`The theme cannot set ${token}. It can set: ${THEME_TOKENS.join(", ")}.`); continue; }
        if (typeof value !== "string" || !COLOR.test(value)) { problems.push(`The theme's ${token} must be a hex colour like #1f6feb.`); continue; }
        chosen[token as ThemeToken] = value.toLowerCase();
      }
      if (Object.keys(chosen).length === 0) problems.push("The theme must set at least one colour.");
      theme = { name: text(one["name"], "The theme's name", 2, 40), tokens: chosen };
    }
  }

  const settings: Record<string, boolean | string> = Object.create(null) as Record<string, boolean | string>;
  const presets = record(c["settings"] ?? {});
  if (presets === null) problems.push("settings must be an object of setting ids and values.");
  else {
    const entries = Object.entries(presets);
    if (entries.length > 30) problems.push("A plugin can preset at most 30 settings.");
    for (const [settingId, value] of entries.slice(0, 30)) {
      const setting = getSetting(settingId);
      if (setting === undefined) { problems.push(`${settingId} is not an ADCode setting.`); continue; }
      if (!pluginMaySet(settingId)) { problems.push(`Plugins cannot change "${setting.label}". It stays in your hands.`); continue; }
      if (!isValidSettingValue(setting, value)) { problems.push(`${JSON.stringify(value)} is not a value "${setting.label}" can hold.`); continue; }
      settings[settingId] = value as boolean | string;
    }
  }

  const contributions: PluginContributions = { slashCommands, actions, macros, skills, theme, settings };
  if (problems.length === 0 && contributionCount(contributions) === 0) problems.push("A plugin must contribute something: a slash command, an action, a macro, a skill, a theme or a settings preset.");
  if (problems.length > 0) throw new PluginManifestError(problems);
  return { format: PLUGIN_FORMAT, id, name, version, description, icon, category, tags, readme, remixOf, contributes: contributions };
}

/** The non-throwing form, for live validation as somebody types in the Studio. */
export function checkPluginManifest(input: string | unknown, builtInSlash: readonly string[] = []):
  { readonly ok: true; readonly manifest: PluginManifest } | { readonly ok: false; readonly problems: readonly string[] } {
  try {
    return { ok: true, manifest: parsePluginManifest(input, builtInSlash) };
  } catch (error) {
    if (error instanceof PluginManifestError) return { ok: false, problems: error.problems };
    throw error;
  }
}

export function contributionCount(contributes: PluginContributions): number {
  return contributes.slashCommands.length + contributes.actions.length + contributes.macros.length +
    contributes.skills.length + (contributes.theme === null ? 0 : 1) + Object.keys(contributes.settings).length;
}

/** "3 slash commands · 1 skill · theme", for a card, in the order a reader cares about. */
export function describeContributions(contributes: PluginContributions): string {
  const parts: string[] = [];
  const add = (count: number, one: string, many: string): void => { if (count > 0) parts.push(`${count} ${count === 1 ? one : many}`); };
  add(contributes.actions.length, "AI action", "AI actions");
  add(contributes.slashCommands.length, "slash command", "slash commands");
  add(contributes.skills.length, "skill", "skills");
  add(contributes.macros.length, "macro", "macros");
  if (contributes.theme !== null) parts.push("theme");
  add(Object.keys(contributes.settings).length, "setting", "settings");
  return parts.join(" · ");
}

/** Semver comparison for x.y.z, which is all the format allows. */
export function compareVersions(a: string, b: string): number {
  const left = a.split(".").map(Number), right = b.split(".").map(Number);
  for (let index = 0; index < 3; index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

/** The next patch version: what the Studio suggests when you publish an update. */
export function nextVersion(version: string): string {
  const [major = 0, minor = 0, patch = 0] = version.split(".").map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

/** A plugin id from a name: "Explain Like I'm Five!" → "explain-like-im-five". */
export function pluginIdFrom(name: string): string {
  const slug = name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48).replace(/-+$/, "");
  return slug.length >= 3 ? slug : `${slug || "my"}-plugin`;
}

/** A palette command id for one of a plugin's actions or macros. */
export const pluginCommandId = (pluginId: string, kind: "action" | "macro", id: string): string => `plugin.${kind}.${pluginId}.${id}`;

/** A blank, valid-once-filled manifest: what "New plugin" starts from. */
export function blankManifest(name = "My plugin"): Record<string, unknown> {
  return {
    format: PLUGIN_FORMAT,
    id: pluginIdFrom(name),
    name,
    version: "1.0.0",
    description: "Say in one sentence what this plugin helps people do.",
    icon: "",
    category: "ai-actions",
    tags: [],
    readme: "",
    contributes: {
      actions: [{ id: "explain-simply", title: "Explain this simply", uses: "selection", prompt: "Explain the selected code to someone who started programming last month. Use one everyday analogy and keep it under 150 words." }],
      slashCommands: [],
      macros: [],
      skills: [],
      settings: {},
    },
  };
}

/** What a built-in feature looks like to the Studio when somebody chooses "Remix this feature". */
export interface RemixableFeature {
  readonly id: string;
  readonly title: string;
  readonly plain: string;
  readonly commands: readonly { readonly command: string; readonly label: string }[];
  /** The feature's settings and their current values. */
  readonly settings: Readonly<Record<string, boolean | string>>;
  /** Built-in slash commands that belong to the feature, with their current instructions. */
  readonly slash?: readonly { readonly id: string; readonly hint: string; readonly prompt: string; readonly kind: "prompt" | "diff" }[];
}

/**
 * A plugin draft that starts as an exact copy of a built-in feature.
 *
 * "Edit any feature" means this: every feature's switches become an editable preset, every
 * command it offers becomes a macro you can reorder or extend, and every chat command it
 * owns becomes an override whose instruction you can rewrite. Publish it and anyone can use
 * your version of the feature.
 */
export function draftFromFeature(feature: RemixableFeature): Record<string, unknown> {
  const settings = Object.fromEntries(Object.entries(feature.settings).filter(([id]) => pluginMaySet(id)));
  const commands = feature.commands.map((one) => one.command).filter((command) => APP_COMMAND.test(command) && !command.startsWith("community.")).slice(0, 12);
  const name = `My ${feature.title}`.slice(0, 60);
  return {
    format: PLUGIN_FORMAT,
    id: pluginIdFrom(`my-${feature.title}`),
    name,
    version: "1.0.0",
    description: `My version of ${feature.title}: ${feature.plain}`.slice(0, 300),
    icon: "",
    category: Object.keys(settings).length > 0 && commands.length === 0 ? "editor" : "workflow",
    tags: [],
    readme: `A remix of ADCode's built-in "${feature.title}".\n\nDescribe what you changed and why.`,
    remixOf: `feature:${feature.id}`,
    contributes: {
      slashCommands: (feature.slash ?? []).map((one) => ({ id: one.id, hint: one.hint, prompt: one.prompt, kind: one.kind, overrides: true })),
      actions: [],
      macros: commands.length > 0 ? [{ id: "run", title: `${feature.title}`.slice(0, 60), commands }] : [],
      skills: [],
      settings,
    },
  };
}

/** A copy of somebody else's plugin, re-identified as yours and credited to theirs. */
export function draftFromPlugin(source: PluginManifest, newName: string): Record<string, unknown> {
  return { ...JSON.parse(JSON.stringify(source)) as Record<string, unknown>, id: pluginIdFrom(newName), name: newName.slice(0, 60), version: "1.0.0", remixOf: `plugin:${source.id}` };
}

/** Pretty JSON with the fields a person edits most at the top. */
export function formatManifest(manifest: Record<string, unknown> | PluginManifest): string {
  const order = ["format", "id", "name", "version", "description", "icon", "category", "tags", "remixOf", "contributes", "readme"];
  const source = manifest as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of order) if (source[key] !== undefined) sorted[key] = source[key];
  for (const [key, value] of Object.entries(source)) if (!(key in sorted)) sorted[key] = value;
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

/** The SKILL.md a plugin skill installs as, frontmatter quoted so a colon cannot break it. */
export function skillMarkdown(skill: PluginSkill, pluginName: string): string {
  return `---\nname: ${skill.name}\ndescription: ${JSON.stringify(skill.description)}\n---\n\n<!-- Installed by the ADCode plugin "${pluginName.replace(/--/g, "-")}". Uninstall the plugin to remove it. -->\n\n${skill.body}\n`;
}
