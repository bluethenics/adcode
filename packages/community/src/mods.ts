/**
 * Mods: change ADCode by asking for it in the chat.
 *
 * "Make it feel like warm paper", "add /standup", "a focus timer in the status bar": the chat's
 * assistant writes a plugin manifest and calls `customize_adcode`; ADCode checks it with the same
 * strict parser every plugin goes through, shows the person what it changes, and applies it on
 * this computer once they confirm. "Darker accent" later edits the same mod - the assistant
 * lists the mods, changes the manifest and applies it again.
 *
 * Nothing new is trusted: themes only set the listed design tokens, settings only the allowlist,
 * add-ons run sealed with no network - the plugin format's rules, unchanged. This file is the
 * tool the chat calls and the words around it. Pure; no I/O.
 */
import { ADDON_DATA, ADDON_SLOTS, PLUGIN_CATEGORIES, THEME_TOKENS, parsePluginManifest, PluginManifestError, type PluginManifest } from "./plugin.ts";

/** Every mod's id starts with this, so a mod can never replace a plugin installed from the directory. */
export const MOD_PREFIX = "mod-";
export const MOD_TOOL_NAME = "customize_adcode";

/** The shape of a chat tool, kept structural so this package does not depend on the AI package. */
export interface ModToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly mutating: boolean;
}

/**
 * The chat's tool. The first sentence is what the load_tools catalogue shows; the rest - the
 * plugin format, condensed - is sent only once the assistant loads the tool.
 */
export function modToolDefinition(builtInSlash: readonly string[] = []): ModToolDefinition {
  return {
    name: MOD_TOOL_NAME,
    description: [
      "Change how ADCode itself looks and behaves (theme colours, chat commands, palette actions, small add-on panels) by applying a mod; also lists, switches off and removes mods.",
      "Use it when the user asks to customise, theme, restyle or add something to ADCode - not their project. action: \"list\" first when editing an existing mod; \"apply\" with the whole manifest (the user confirms before it is applied; applying a mod with an existing id updates it - raise its version); \"off\", \"on\" or \"remove\" with its id.",
      "Manifest:",
      `- format: 1; id: lowercase letters, digits, hyphens (it is given the "${MOD_PREFIX}" prefix); name: 2-60 chars; version: "1.0.0"; description: 10-300 chars; icon: one emoji; category: one of ${PLUGIN_CATEGORIES.map((one) => one.id).join(", ")}; tags: up to 6 lowercase words; readme: short markdown.`,
      "- contributes: only what the request needs, at least one of:",
      `  - theme: { name, tokens: { token: "#hex" } } with only these tokens: ${THEME_TOKENS.join(", ")}. A full theme sets the backgrounds, the three text colours, borders and the accent so text stays readable (contrast at least 4.5:1).`,
      `  - slashCommands: [{ id (lowercase word), hint, kind: "prompt" | "diff", prompt, overrides }]. overrides: true only to replace a built-in (${builtInSlash.join(", ") || "none"}).`,
      "  - actions: [{ id, title (3-60), uses: \"selection\" | \"file\" | \"nothing\", prompt (10-4000) }] - command palette AI actions.",
      "  - skills: [{ name (lowercase-hyphenated), description, body (markdown) }].",
      "  - macros: [{ id, title, commands: [ADCode command ids such as file.saveAll, workspace.changes, view.togglePanel] }].",
      "  - settings: { settingId: value } for editor, appearance, formatting, navigation and git switches only.",
      `  - addons: [{ id, title (3-40), slot: ${ADDON_SLOTS.map((one) => `"${one.id}"`).join(" | ")}, data: [${ADDON_DATA.map((one) => `"${one.id}"`).join(", ")}], commands: [], prompt: false, html }] - HTML with inline CSS and an inline <script>, sealed with no network. window.adcode: on("data", fn), on("init", fn), run(commandId), prompt(text), store.get/set. Use var(--text-primary), var(--text-secondary), var(--accent), var(--border-hairline). A status bar add-on is one 22px-high line.`,
    ].join("\n"),
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["apply", "list", "on", "off", "remove"] },
        manifest: { type: "object", description: "The whole mod manifest, for apply" },
        id: { type: "string", description: "The mod's id, for on, off and remove" },
      },
      required: ["action"],
    },
    mutating: true,
  };
}

export type ModDraft =
  | { readonly ok: true; readonly manifest: PluginManifest; readonly text: string }
  | { readonly ok: false; readonly problems: readonly string[] };

/** The mod id for whatever id the model wrote: always in the mod namespace, always valid. */
export function modIdFor(raw: unknown): string {
  const base = (typeof raw === "string" ? raw : "custom").toLowerCase().replace(/^mod-/, "").replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  const id = `${MOD_PREFIX}${base || "mine"}`.slice(0, 48).replace(/-+$/, "");
  return id.length >= 4 ? id : `${MOD_PREFIX}mine`;
}

/** A manifest from the assistant as a mod: checked by the plugin parser, id forced into the mod namespace. */
export function readMod(raw: unknown, builtInSlash: readonly string[] = []): ModDraft {
  let value = raw;
  if (typeof raw === "string") {
    try { value = JSON.parse(raw); } catch { return { ok: false, problems: ["The manifest is not valid JSON."] }; }
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { ok: false, problems: ["Send the manifest as a JSON object."] };
  const fixed = { ...(value as Record<string, unknown>), id: modIdFor((value as Record<string, unknown>)["id"]) };
  try {
    const manifest = parsePluginManifest(fixed, builtInSlash);
    return { ok: true, manifest, text: JSON.stringify(fixed, null, 2) };
  } catch (error) {
    return { ok: false, problems: error instanceof PluginManifestError ? error.problems : [error instanceof Error ? error.message : "The mod could not be read."] };
  }
}

/** One line per change a mod makes, in the words a person would use. */
export function describeMod(manifest: PluginManifest): string[] {
  const c = manifest.contributes;
  const lines: string[] = [];
  if (c.theme !== null) lines.push(`Colours: the "${c.theme.name}" theme (${String(Object.keys(c.theme.tokens).length)} colours)`);
  for (const command of c.slashCommands) lines.push(`Chat command /${command.id}${command.hint ? ` - ${command.hint}` : ""}`);
  for (const action of c.actions) lines.push(`Command palette: ${action.title}`);
  for (const addon of c.addons) lines.push(`Add-on "${addon.title}" in ${ADDON_SLOTS.find((slot) => slot.id === addon.slot)?.label ?? addon.slot}`);
  for (const macro of c.macros) lines.push(`Shortcut: ${macro.title} (${String(macro.commands.length)} steps)`);
  for (const skill of c.skills) lines.push(`Assistant skill: ${skill.name}`);
  for (const [id, value] of Object.entries(c.settings)) lines.push(`Setting ${id} → ${String(value)}`);
  return lines;
}

/** The list the assistant reads before editing: each mod, whether it is on, and what it changes. */
export function describeInstalledMods(installed: readonly { readonly manifest: PluginManifest; readonly enabled: boolean }[]): string {
  const mods = installed.filter((one) => one.manifest.id.startsWith(MOD_PREFIX));
  if (mods.length === 0) return "No mods yet.";
  return mods.map((one) => `- ${one.manifest.id} v${one.manifest.version} (${one.enabled ? "on" : "off"}): ${one.manifest.name}. ${describeMod(one.manifest).join("; ")}\n${JSON.stringify(one.manifest)}`).join("\n");
}
