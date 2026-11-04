/**
 * The Community page's decisions, apart from its DOM: what installed plugins add to the app,
 * the Studio's templates, and the words sent to the assistant when it builds a plugin.
 */
import {
  PLUGIN_CATEGORIES, PLUGIN_FILE, THEME_TOKENS, draftFromFeature, formatManifest, pluginCommandId, pluginMaySet,
  type PluginAction, type PluginManifest, type RemixableFeature,
} from "@adcode/community";
import type { FeatureRecord } from "@adcode/help";
import type { InstalledPluginView } from "../../shared/community.ts";
import type { SlashCommand } from "../../shared/slashCommands.ts";

export interface PluginCommandPlan {
  readonly id: string;
  readonly title: string;
  readonly pluginId: string;
  readonly kind: "action" | "macro";
  readonly action?: PluginAction;
  readonly commands?: readonly string[];
}

/** The palette commands enabled plugins add: one per AI action and one per macro. */
export function pluginCommands(installed: readonly InstalledPluginView[]): PluginCommandPlan[] {
  return installed.filter((one) => one.enabled).flatMap(({ manifest }) => [
    ...manifest.contributes.actions.map((action): PluginCommandPlan => ({ id: pluginCommandId(manifest.id, "action", action.id), title: `${manifest.name}: ${action.title}`, pluginId: manifest.id, kind: "action", action })),
    ...manifest.contributes.macros.map((macro): PluginCommandPlan => ({ id: pluginCommandId(manifest.id, "macro", macro.id), title: `${manifest.name}: ${macro.title}`, pluginId: manifest.id, kind: "macro", commands: macro.commands })),
  ]);
}

/** The theme in effect: the most recently installed enabled plugin that has one. */
export function activeTheme(installed: readonly InstalledPluginView[]): { readonly pluginId: string; readonly name: string; readonly tokens: Readonly<Record<string, string>> } | null {
  const found = installed.filter((one) => one.enabled && one.manifest.contributes.theme !== null).sort((a, b) => b.installedAt - a.installedAt)[0];
  if (found === undefined) return null;
  const theme = found.manifest.contributes.theme!;
  // Re-checked here: this string becomes a style attribute.
  const tokens = Object.fromEntries(Object.entries(theme.tokens).filter(([token, value]) => (THEME_TOKENS as readonly string[]).includes(token) && typeof value === "string" && /^#[0-9a-f]{3,8}$/i.test(value))) as Record<string, string>;
  return { pluginId: found.manifest.id, name: theme.name, tokens };
}

/** What the assistant is asked when a plugin's AI action runs. The editor context rides with every message. */
export function actionPrompt(action: PluginAction): string {
  const tail = action.uses === "selection" ? "\n\nApply this to the code I have selected." : action.uses === "file" ? "\n\nApply this to the file I have open." : "";
  return `${action.prompt}${tail}`;
}

/** Slash commands of enabled plugins, for the composer's menu, flagged so built-ins can be overridden. */
export function pluginSlashCommands(installed: readonly InstalledPluginView[]): (SlashCommand & { readonly overrides: boolean })[] {
  return installed.filter((one) => one.enabled).flatMap((one) => one.manifest.contributes.slashCommands.map((command) => ({ id: command.id, hint: `${command.hint} · ${one.manifest.name}`, kind: command.kind, prompt: command.prompt, overrides: command.overrides })));
}

export type ContributionKind = "action" | "slash" | "skill" | "macro" | "theme" | "setting";

export const CONTRIBUTION_LABELS: Readonly<Record<ContributionKind, string>> = {
  action: "AI action",
  slash: "Slash command",
  skill: "Skill",
  macro: "Macro",
  theme: "Theme",
  setting: "Setting preset",
};

/** One more contribution of `kind` added to the manifest text, or null when the text is not JSON yet. */
export function addContribution(text: string, kind: ContributionKind): string | null {
  let manifest: Record<string, unknown>;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    manifest = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const contributes = { ...(typeof manifest["contributes"] === "object" && manifest["contributes"] !== null ? manifest["contributes"] as Record<string, unknown> : {}) };
  const list = (key: string): unknown[] => (Array.isArray(contributes[key]) ? [...contributes[key] as unknown[]] : []);
  const unique = (key: string, base: string, field = "id"): string => {
    const taken = new Set(list(key).map((one) => (one as Record<string, unknown>)[field]));
    let name = base;
    for (let n = 2; taken.has(name); n++) name = `${base}-${n}`;
    return name;
  };
  switch (kind) {
    case "action":
      contributes["actions"] = [...list("actions"), { id: unique("actions", "my-action"), title: "Do something useful", uses: "selection", prompt: "Describe exactly what the assistant should do with the selected code, and what a good result looks like." }];
      break;
    case "slash":
      contributes["slashCommands"] = [...list("slashCommands"), { id: unique("slashCommands", "mycommand"), hint: "What this command does, in a few words", kind: "prompt", prompt: "The instruction the assistant receives. Whatever the person types after the command follows it: " }];
      break;
    case "skill":
      contributes["skills"] = [...list("skills"), { name: unique("skills", "my-skill", "name"), description: "When the assistant should use this skill, in one sentence.", body: "# How to do this well\n\n1. The first thing to check.\n2. The way this team does it.\n3. What to avoid." }];
      break;
    case "macro":
      contributes["macros"] = [...list("macros"), { id: unique("macros", "my-macro"), title: "Save everything and show changes", commands: ["file.saveAll", "workspace.changes"] }];
      break;
    case "theme":
      contributes["theme"] = { name: "My theme", tokens: { "--accent": "#7c5cff", "--bg-app": "#14121f", "--bg-editor": "#18162a", "--text-primary": "#ece9ff" } };
      break;
    case "setting":
      contributes["settings"] = { ...(typeof contributes["settings"] === "object" && contributes["settings"] !== null ? contributes["settings"] as Record<string, unknown> : {}), "adcode.editing.minimap": false };
      break;
  }
  return formatManifest({ ...manifest, contributes });
}

/**
 * Ask the assistant to build a plugin: the whole format, the person's idea, and where to
 * write it. The Studio then loads `adcode-plugin.json` from the project with one click.
 */
export function aiBuildPrompt(idea: string, builtInSlash: readonly string[]): string {
  return [
    `Build an ADCode plugin for this idea: ${idea.trim()}`,
    "",
    `Write it as JSON to ${PLUGIN_FILE} at the root of the open project, then tell me what it does in two sentences. The format:`,
    "- format: 1; id: 3–48 lowercase letters, digits, hyphens; name: 2–60 chars; version: \"1.0.0\"; description: 10–300 chars; icon: one emoji;",
    `- category: one of ${PLUGIN_CATEGORIES.map((one) => one.id).join(", ")}; tags: up to 6 lowercase words; readme: markdown explaining how to use it.`,
    "- contributes (use only what the idea needs, at least one):",
    "  - actions: [{ id, title (3–60), uses: \"selection\" | \"file\" | \"nothing\", prompt (10–4000) }] - AI actions in the command palette.",
    `  - slashCommands: [{ id (lowercase word), hint, kind: "prompt" | "diff", prompt, overrides }] - chat commands. To replace a built-in (${builtInSlash.join(", ")}), use its name and overrides: true; otherwise overrides: false.`,
    "  - skills: [{ name (lowercase-hyphenated), description (when to use it), body (the instructions, markdown) }] - knowledge the assistant loads when a task matches.",
    "  - macros: [{ id, title, commands: [ADCode command ids such as file.saveAll, workspace.changes, view.togglePanel] }].",
    `  - theme: { name, tokens: { ${THEME_TOKENS.slice(0, 6).join(", ")}, ...: "#hex" } }.`,
    "  - settings: { settingId: value } - presets for editor, appearance, formatting, navigation and git switches only.",
    "Write prompts the way a senior engineer would ask: the outcome, how to verify it, and what not to do.",
  ].join("\n");
}

/** Every built-in feature, as something the Studio can turn into a plugin draft. */
export function remixableFeatures(records: readonly FeatureRecord[], settings: Readonly<Record<string, unknown>>, slash: readonly SlashCommand[]): RemixableFeature[] {
  const slashFor: Readonly<Record<string, readonly string[]>> = { "ai.composerCommands": slash.filter((one) => one.kind !== "action").map((one) => one.id) };
  return records.filter((record) => !record.entry.id.startsWith("community.")).map((record) => ({
    id: record.entry.id,
    title: record.entry.title,
    plain: record.entry.plain,
    commands: record.actions.flatMap((action) => (action.kind === "command" ? [{ command: action.command, label: action.label }] : [])),
    settings: Object.fromEntries(record.entry.settingIds.filter((id) => pluginMaySet(id) && (typeof settings[id] === "boolean" || typeof settings[id] === "string")).map((id) => [id, settings[id] as boolean | string])),
    slash: (slashFor[record.entry.id] ?? []).flatMap((id) => {
      const command = slash.find((one) => one.id === id);
      return command?.prompt === undefined || command.kind === "action" ? [] : [{ id, hint: command.hint, prompt: command.prompt, kind: command.kind }];
    }),
  })).filter((feature) => feature.commands.length > 0 || Object.keys(feature.settings).length > 0 || (feature.slash?.length ?? 0) > 0);
}

/** The Studio text for "Remix this feature". */
export const featureDraftText = (feature: RemixableFeature): string => formatManifest(draftFromFeature(feature));

export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** Lines describing what installing a plugin will change, for the confirmation and detail views. */
export function installSummary(manifest: PluginManifest): string[] {
  const lines: string[] = [];
  const { actions, slashCommands, skills, macros, theme, settings } = manifest.contributes;
  for (const action of actions) lines.push(`Command palette: "${manifest.name}: ${action.title}"`);
  for (const command of slashCommands) lines.push(command.overrides ? `Replaces the instruction behind /${command.id}` : `Chat command /${command.id} - ${command.hint}`);
  for (const skill of skills) lines.push(`Assistant skill "${skill.name}" - ${skill.description}`);
  for (const macro of macros) lines.push(`Macro "${macro.title}" runs: ${macro.commands.join(" → ")}`);
  if (theme !== null) lines.push(`Recolours ADCode with the "${theme.name}" theme`);
  for (const [id, value] of Object.entries(settings)) lines.push(`Sets ${id.replace(/^adcode\./, "")} to ${String(value)} (put back when you uninstall)`);
  return lines;
}
